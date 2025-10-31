// ESP32 HUB75 + WebServer pipeline:
// - Browser renders Khmer text (proper shaping) to Canvas
// - Canvas is cropped and converted to RGB565 in JS
// - Browser uploads RGB565 blob to ESP32
// - ESP32 displays the uploaded bitmap on the HUB75 panel

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <FS.h>
#include <LittleFS.h>
#include <ESP32-VirtualMatrixPanel-I2S-DMA.h>
#include <string.h>
#include <vector>
#include <nvs_flash.h>
#include <nvs.h>

// Panel configuration (defaults). Adjust via UI if needed.
#ifndef PANEL_RES_X
#define PANEL_RES_X 128
#endif
#ifndef PANEL_RES_Y
#define PANEL_RES_Y 64
#endif
#ifndef NUM_ROWS
#define NUM_ROWS 1
#endif
#ifndef NUM_COLS
#define NUM_COLS 1
#endif
#define PANEL_CHAIN (NUM_ROWS * NUM_COLS)

// Runtime layout (allows switching panel configurations without recompiling)
static int cur_rows = NUM_ROWS;   // current layout rows
static int cur_cols = NUM_COLS;   // current layout cols
static inline int VIRT_W() { return cur_cols * PANEL_RES_X; }
static inline int VIRT_H() { return cur_rows * PANEL_RES_Y; }

// Panel chain orientation mapping (do not define macros with same names as enum constants)
// Legacy workflow used numeric defines like 0x02; with the current library use enum values.
// To mirror/reverse horizontally as per your request to switch from 0x02 to 0x01,
// set VIRTUAL_MATRIX_CHAIN_TYPE to CHAIN_BOTTOM_RIGHT_UP instead of CHAIN_BOTTOM_LEFT_UP.
#define VIRTUAL_MATRIX_CHAIN_TYPE CHAIN_BOTTOM_RIGHT_UP

// GPIO mapping

// Define GPIO Pins for ESP32-S3-WROOM-1
#define R1_PIN 4
#define G1_PIN 5
#define B1_PIN 6
#define R2_PIN 7
#define G2_PIN 15
#define B2_PIN 16
#define A_PIN 17
#define B_PIN 18
#define C_PIN 8
#define D_PIN 3
#define E_PIN 46
#define LAT_PIN 9
#define OE_PIN 10
#define CLK_PIN 11

MatrixPanel_I2S_DMA *dma_display = nullptr;
VirtualMatrixPanel  *vdisplay = nullptr;

// Wi-Fi SoftAP config
static const char* AP_SSID = "KHMER_PANEL";
static const char* AP_PASS = "12345678"; // 8+ chars required

WebServer server(80);

// CORS headers for cross-origin requests
void sendCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Uploaded text bitmap (RGB565), text-only cropped image
static std::vector<uint8_t> uploadBuf;      // raw bytes as received (header + pixels)
static std::vector<uint16_t> textPixels;    // pixels only, RGB565
static std::vector<uint8_t>  textAlpha;     // optional A8 alpha per pixel
static std::vector<uint16_t> frameBuffer;   // full virtual offscreen RGB565
static std::vector<uint16_t> bgPixels;      // optional background image (virtual-sized)
static bool hasBgImage = false;
static uint16_t imgW = 0, imgH = 0;         // text image size
// Panel config (for multi-panel awareness)
static int g_panel_rows = NUM_ROWS; // hardware default rows
static int g_panel_cols = NUM_COLS; // hardware default cols
static String g_panel_map; // optional: comma-separated indices/names from UI
static std::vector<uint8_t> g_panel_active; // 1=enabled, 0=disabled per physical panel index

// Render settings from client
static uint16_t bgColor = 0x0000;           // RGB565 background
static uint16_t textColor = 0xFFFF;          // ADD: RGB565 text color
static int16_t userOffX = 0;                // base X offset
static int16_t userOffY = 0;                // base Y offset
static bool animate = false;                // scroll enable
static int8_t animDir = -1;                 // -1 = left, +1 = right
static uint16_t animSpeedMs = 30;           // delay between frames (10..60)
static int16_t  loopOffsetPx = 0;           // loop overlap/gap in pixels: <0 overlap, >0 gap

// Animation state
static int16_t scrollX = 0;                 // current scroll position (left of text)
static int16_t baseY = 0;                   // vertically centered baseline + userOffY
static uint32_t lastAnim = 0;
static uint32_t restartAt = 0;              // time to restart next cycle
static bool waitingRestart = false;
static std::vector<int16_t> heads;         // multi-head array for continuous text stream

// Display mode tracking
enum DisplayMode { MODE_NONE, MODE_CLOCK, MODE_THEME };
static DisplayMode currentMode = MODE_NONE;

// Persistent storage structure
struct LastSettings {
  bool animate;
  int8_t animDir;
  uint16_t animSpeedMs;
  int16_t loopOffsetPx;
  uint16_t bgColor;
  uint16_t textColor;        // ADD: Text color
  uint16_t brightness;
  DisplayMode mode;
  bool hasText;
  bool hasBgImage;
  uint16_t textWidth;
  uint16_t textHeight;
  int16_t scrollX;           // Current scroll position
  uint16_t spacing;          // Animation spacing
  uint32_t savedTime;        // When the state was saved
};

static LastSettings lastSettings = {0};
static std::vector<uint16_t> lastFrameBuffer;  // Store last displayed frame
static uint8_t currentBrightness = 200;  // Track current brightness
static uint32_t lastSaveTime = 0;  // Track when we last saved the frame

// Panel helpers
static inline int panelIndexFromXY(int x, int y) {
  int col = x / PANEL_RES_X;
  int row = y / PANEL_RES_Y;
  return row * cur_cols + col; // row-major for current layout
}

static void maskDisabledPanels() {
  if (g_panel_active.empty()) return;
  for (int row = 0; row < g_panel_rows; ++row) {
    for (int col = 0; col < g_panel_cols; ++col) {
      int idx = row * g_panel_cols + col;
      if (idx < (int)g_panel_active.size() && g_panel_active[idx] == 0) {
        int x0 = col * PANEL_RES_X;
        int y0 = row * PANEL_RES_Y;
        for (int y = 0; y < PANEL_RES_Y; ++y) {
          size_t base = (size_t)(y0 + y) * (size_t)VIRT_W() + (size_t)x0;
          for (int x = 0; x < PANEL_RES_X; ++x) {
            frameBuffer[base + (size_t)x] = 0x0000; // force black on disabled panel
          }
        }
      }
    }
  }
}

static const char* panelLabelForIndex(int idx) {
  static const char* labels[] = {"main","second","third","fourth","fifth","sixth","seventh","eighth"};
  int n = sizeof(labels)/sizeof(labels[0]);
  if (idx >= 0 && idx < n) return labels[idx];
  return "panel";
}

// Persistent storage functions
static void saveLastSettings() {
  nvs_handle_t nvs_handle;
  esp_err_t err = nvs_open("storage", NVS_READWRITE, &nvs_handle);
  if (err != ESP_OK) {
    Serial.printf("Error opening NVS: %s\n", esp_err_to_name(err));
    return;
  }

  // Update current settings
  lastSettings.animate = animate;
  lastSettings.animDir = animDir;
  lastSettings.animSpeedMs = animSpeedMs;
  lastSettings.loopOffsetPx = loopOffsetPx;
  lastSettings.bgColor = bgColor;
  lastSettings.textColor = textColor;  // ADD: Save text color
  lastSettings.mode = currentMode;
  lastSettings.hasText = !textPixels.empty();
  lastSettings.hasBgImage = hasBgImage;
  lastSettings.textWidth = imgW;
  lastSettings.textHeight = imgH;

  // Save current animation state - SIMPLE VERSION
  lastSettings.scrollX = scrollX;
  lastSettings.spacing = imgW + loopOffsetPx;
  lastSettings.savedTime = millis();

  // Save settings to NVS
  nvs_set_u8(nvs_handle, "animate", lastSettings.animate ? 1 : 0);
  nvs_set_i8(nvs_handle, "animDir", lastSettings.animDir);
  nvs_set_u16(nvs_handle, "animSpeedMs", lastSettings.animSpeedMs);
  nvs_set_i16(nvs_handle, "loopOffsetPx", lastSettings.loopOffsetPx);
  nvs_set_u16(nvs_handle, "bgColor", lastSettings.bgColor);
  nvs_set_u16(nvs_handle, "textColor", lastSettings.textColor);  // ADD: Save text color
  nvs_set_u8(nvs_handle, "mode", static_cast<uint8_t>(lastSettings.mode));
  nvs_set_u8(nvs_handle, "hasText", lastSettings.hasText ? 1 : 0);
  nvs_set_u8(nvs_handle, "hasBgImage", lastSettings.hasBgImage ? 1 : 0);
  nvs_set_u16(nvs_handle, "textWidth", lastSettings.textWidth);
  nvs_set_u16(nvs_handle, "textHeight", lastSettings.textHeight);

  // Save animation state
  nvs_set_i16(nvs_handle, "scrollX", lastSettings.scrollX);
  nvs_set_u16(nvs_handle, "spacing", lastSettings.spacing);
  nvs_set_u32(nvs_handle, "savedTime", lastSettings.savedTime);

  // Save brightness
  nvs_set_u8(nvs_handle, "brightness", currentBrightness);
  lastSettings.brightness = currentBrightness;

  err = nvs_commit(nvs_handle);
  if (err != ESP_OK) {
    Serial.printf("Error committing NVS: %s\n", esp_err_to_name(err));
  } else {
    Serial.println("Settings saved to NVS");
  }

  nvs_close(nvs_handle);
}

static void loadLastSettings() {
  nvs_handle_t nvs_handle;
  esp_err_t err = nvs_open("storage", NVS_READONLY, &nvs_handle);
  if (err != ESP_OK) {
    Serial.println("No saved settings found, using defaults");
    return;
  }

  // Load settings from NVS
  uint8_t u8_val;
  int8_t i8_val;
  int16_t i16_val;
  uint16_t u16_val;

  if (nvs_get_u8(nvs_handle, "animate", &u8_val) == ESP_OK) {
    lastSettings.animate = (u8_val == 1);
    animate = lastSettings.animate;
  }
  if (nvs_get_i8(nvs_handle, "animDir", &i8_val) == ESP_OK) {
    lastSettings.animDir = i8_val;
    animDir = lastSettings.animDir;
  }
  if (nvs_get_u16(nvs_handle, "animSpeedMs", &u16_val) == ESP_OK) {
    lastSettings.animSpeedMs = u16_val;
    animSpeedMs = lastSettings.animSpeedMs;
  }
  if (nvs_get_i16(nvs_handle, "loopOffsetPx", &i16_val) == ESP_OK) {
    lastSettings.loopOffsetPx = i16_val;
    loopOffsetPx = lastSettings.loopOffsetPx;
  }
  if (nvs_get_u16(nvs_handle, "bgColor", &u16_val) == ESP_OK) {
    lastSettings.bgColor = u16_val;
    bgColor = lastSettings.bgColor;
  }
  if (nvs_get_u16(nvs_handle, "textColor", &u16_val) == ESP_OK) {  // ADD: Load text color
    lastSettings.textColor = u16_val;
    textColor = lastSettings.textColor;
  }
  if (nvs_get_u8(nvs_handle, "mode", &u8_val) == ESP_OK) {
    lastSettings.mode = static_cast<DisplayMode>(u8_val);
    currentMode = lastSettings.mode;
  }
  if (nvs_get_u8(nvs_handle, "hasText", &u8_val) == ESP_OK) {
    lastSettings.hasText = (u8_val == 1);
  }
  if (nvs_get_u8(nvs_handle, "hasBgImage", &u8_val) == ESP_OK) {
    lastSettings.hasBgImage = (u8_val == 1);
    hasBgImage = lastSettings.hasBgImage;
  }
  if (nvs_get_u16(nvs_handle, "textWidth", &u16_val) == ESP_OK) {
    lastSettings.textWidth = u16_val;
    imgW = u16_val;
  }
  if (nvs_get_u16(nvs_handle, "textHeight", &u16_val) == ESP_OK) {
    lastSettings.textHeight = u16_val;
    imgH = u16_val;
  }

  // Load animation state
  uint32_t u32_val;
  if (nvs_get_i16(nvs_handle, "scrollX", &i16_val) == ESP_OK) {
    lastSettings.scrollX = i16_val;
    scrollX = i16_val;
  }
  if (nvs_get_u16(nvs_handle, "spacing", &u16_val) == ESP_OK) {
    lastSettings.spacing = u16_val;
  }
  if (nvs_get_u32(nvs_handle, "savedTime", &u32_val) == ESP_OK) {
    lastSettings.savedTime = u32_val;
  }

  if (nvs_get_u8(nvs_handle, "brightness", &u8_val) == ESP_OK) {
    lastSettings.brightness = u8_val;
    currentBrightness = u8_val;
    if (dma_display) {
      dma_display->setBrightness8(lastSettings.brightness);
    }
  }

  nvs_close(nvs_handle);
  Serial.println("Settings loaded from NVS");

  // Animation restoration will be done after text is loaded in loadLastFrame
  Serial.println("Animation settings loaded - will restore after text data is loaded");
}

static void saveLastFrame() {
  if (frameBuffer.empty()) return;

  // Save frame buffer to file
  File file = LittleFS.open("/last_frame.rgb565", "w");
  if (!file) {
    Serial.println("Failed to open last frame file for writing");
    return;
  }

  size_t bytesToWrite = frameBuffer.size() * sizeof(uint16_t);
  size_t written = file.write(reinterpret_cast<const uint8_t*>(frameBuffer.data()), bytesToWrite);
  file.close();

  if (written == bytesToWrite) {
    Serial.printf("Last frame saved: %u bytes\n", (unsigned)written);
  } else {
    Serial.printf("Error saving last frame: wrote %u of %u bytes\n", (unsigned)written, (unsigned)bytesToWrite);
  }

  // Also save text data if we have it (for animation restoration)
  if (!textPixels.empty()) {
    File textFile = LittleFS.open("/last_text.dat", "w");
    if (textFile) {
      // Save header with dimensions and color
      uint8_t header[8];
      header[0] = imgW & 255;
      header[1] = (imgW >> 8) & 255;
      header[2] = imgH & 255;
      header[3] = (imgH >> 8) & 255;
      header[4] = textAlpha.empty() ? 0 : 1; // Alpha flag
      header[5] = textColor & 255;
      header[6] = (textColor >> 8) & 255;
      header[7] = 0; // Reserved
      textFile.write(header, 8);

      // Save text pixels
      size_t textBytes = textPixels.size() * sizeof(uint16_t);
      textFile.write(reinterpret_cast<const uint8_t*>(textPixels.data()), textBytes);

      // Save alpha channel if present
      if (!textAlpha.empty()) {
        textFile.write(textAlpha.data(), textAlpha.size());
      }

      textFile.close();
      Serial.printf("Text data saved: %u pixels\n", (unsigned)textPixels.size());
    }
  }
}

static void loadLastFrame() {
  // Try to load text data first
  File textFile = LittleFS.open("/last_text.dat", "r");
  if (textFile) {
    Serial.println("Loading saved text data...");

    // Read header
    uint8_t header[8];
    if (textFile.read(header, 8) == 8) {
      uint16_t savedImgW = header[0] | (header[1] << 8);
      uint16_t savedImgH = header[2] | (header[3] << 8);
      bool hasAlpha = (header[4] == 1);
      uint16_t savedTextColor = header[5] | (header[6] << 8);

      // Restore text color
      textColor = savedTextColor;
      Serial.printf("Restored text color: 0x%04X\n", textColor);

      // Load text pixels
      size_t textPixelCount = savedImgW * savedImgH;
      textPixels.resize(textPixelCount);
      size_t textBytesToRead = textPixelCount * sizeof(uint16_t);
      size_t textBytesRead = textFile.read(reinterpret_cast<uint8_t*>(textPixels.data()), textBytesToRead);

      // Load alpha channel if present
      if (hasAlpha && textBytesRead == textBytesToRead) {
        textAlpha.resize(textPixelCount);
        size_t alphaBytesRead = textFile.read(textAlpha.data(), textPixelCount);
        if (alphaBytesRead == textPixelCount) {
          Serial.printf("Text data loaded: %ux%u pixels with alpha\n", savedImgW, savedImgH);
        } else {
          Serial.printf("Error loading alpha channel: read %u of %u bytes\n", (unsigned)alphaBytesRead, (unsigned)textPixelCount);
          textAlpha.clear();
        }
      } else {
        textAlpha.clear();
        Serial.printf("Text data loaded: %ux%u pixels without alpha\n", savedImgW, savedImgH);
      }

      if (textBytesRead == textBytesToRead) {
        imgW = savedImgW;
        imgH = savedImgH;
      }
    }
    textFile.close();
  }

  // Load the frame buffer
  File file = LittleFS.open("/last_frame.rgb565", "r");
  if (!file) {
    Serial.println("No last frame file found");
    return;
  }

  size_t fileSize = file.size();
  size_t expectedSize = VIRT_W() * VIRT_H() * sizeof(uint16_t);

  if (fileSize != expectedSize) {
    Serial.printf("Last frame size mismatch: %u bytes, expected %u bytes\n", (unsigned)fileSize, (unsigned)expectedSize);
    file.close();
    return;
  }

  // Resize frame buffer and load data
  frameBuffer.resize(VIRT_W() * VIRT_H());
  size_t read = file.read(reinterpret_cast<uint8_t*>(frameBuffer.data()), fileSize);
  file.close();

  if (read == fileSize) {
    Serial.printf("Last frame loaded: %u bytes\n", (unsigned)read);

    // Display the last frame immediately
    if (vdisplay && !frameBuffer.empty()) {
      vdisplay->drawRGBBitmap(0, 0, frameBuffer.data(), VIRT_W(), VIRT_H());
      Serial.println("Last frame displayed on startup");
    }

    // Restore animation if needed - IMPROVED VERSION
    if (lastSettings.animate && lastSettings.hasText && !textPixels.empty()) {
      Serial.println("Restoring animation state with text and colors");

      // Initialize basic animation state
      baseY = (int)VIRT_H() / 2 - (int)imgH / 2 + userOffY;
      currentMode = MODE_CLOCK; // Set to clock mode to enable animation loop

      // Ensure all color settings are properly restored
      Serial.printf("Restored colors - BG: 0x%04X, Text: 0x%04X\n", bgColor, textColor);

      // Simple spacing calculation
      int spacing = imgW + loopOffsetPx;
      if (spacing < 1) spacing = 1;

      // IMPROVED: Ensure enough copies for seamless scrolling
      // Need enough copies to cover screen width + extra buffer
      const int minCopiesNeeded = (VIRT_W() / spacing) + 2; // Minimum to cover screen
      const int totalCopies = (minCopiesNeeded > 4) ? minCopiesNeeded : 4; // Always have at least 4 copies
      heads.clear();
      heads.reserve(totalCopies);

      // Simple restart from beginning (no complex time compensation)
      if (animDir < 0) { // left scrolling - start from right edge
        for (int i = 0; i < totalCopies; i++) {
          heads.push_back(VIRT_W() + (i * spacing));
        }
      } else { // right scrolling - start from left edge
        for (int i = 0; i < totalCopies; i++) {
          heads.push_back(-imgW - (i * spacing));
        }
      }

      // Use saved scroll position if valid, otherwise start fresh
      if (lastSettings.scrollX != 0) {
        scrollX = lastSettings.scrollX;
        Serial.printf("Using saved scroll position: %d\n", scrollX);
      } else {
        scrollX = 0;
        Serial.println("Starting scroll from position 0");
      }

      Serial.printf("Animation restored: %d heads, spacing=%d, direction=%s, scrollX=%d, loopOffset=%d\n",
                    totalCopies, spacing, (animDir < 0) ? "left" : "right", scrollX, loopOffsetPx);

      waitingRestart = false;
      lastAnim = millis(); // Start animation immediately
    }
  } else {
    Serial.printf("Error loading last frame: read %u of %u bytes\n", (unsigned)read, (unsigned)fileSize);
  }
}

static int indexFromToken(const String& tok) {
  String t = tok; t.toLowerCase(); t.trim();
  if (t.length() == 0) return -1;
  if (t == "main") return 0;
  if (t == "second") return 1;
  if (t == "third") return 2;
  if (t == "fourth") return 3;
  if (t == "fifth") return 4;
  if (t == "sixth") return 5;
  if (t == "seventh") return 6;
  if (t == "eighth") return 7;
  // also accept numeric (1-based or 0-based)
  bool allDigits = true; for (size_t i=0;i<t.length();++i){ if (!isDigit((int)t[i])) { allDigits=false; break; } }
  if (allDigits) {
    int v = t.toInt();
    if (v >= 1) v -= 1; // treat as 1-based index
    return v;
  }
  return -1;
}

// Serve a file from LittleFS
static String contentTypeFor(const String& path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  return "text/plain";
}

static const char FALLBACK_HTML[] PROGMEM = R"HTML(
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IHUB75</title>
<body style="font-family:system-ui,Arial,sans-serif;padding:16px;line-height:1.5;background:#0b0f14;color:#e7eef7">
<h2 style="margin:0 0 12px">IHUB75</h2>
<p>index.html not found on LittleFS.</p>
<p>Upload it with PlatformIO:</p>
<pre style="background:#121820;padding:12px;border-radius:8px;border:1px solid #1f2a35">pio run -t uploadfs</pre>
<p>Then refresh this page.</p>
</body>
)HTML";

void handleRoot() {
  sendCORSHeaders();
  File f = LittleFS.open("/index.html", "r");
  if (!f) {
    server.send_P(200, "text/html; charset=utf-8", FALLBACK_HTML);
    return;
  }
  server.streamFile(f, contentTypeFor("/index.html"));
  f.close();
}

// Generic file handler for CSS, JS, images, etc.
void handleStaticFile() {
  sendCORSHeaders();
  String path = server.uri();
  if (path == "/") {
    path = "/index.html";
  }

  File f = LittleFS.open(path, "r");
  if (!f) {
    server.send(404, "text/plain", "File not found");
    return;
  }

  String contentType = contentTypeFor(path);
  server.streamFile(f, contentType);
  f.close();
}

static uint16_t hexTo565(const String &hex) {
  // Expect formats like "#RRGGBB" or "RRGGBB"
  String s = hex;
  if (s.startsWith("#")) s.remove(0,1);
  if (s.length() != 6) return 0; // default black
  auto h2 = [](char c)->uint8_t{ if(c>='0'&&c<='9')return c-'0'; c|=0x20; if(c>='a'&&c<='f')return c-'a'+10; return 0; };
  uint8_t r = (h2(s[0])<<4) | h2(s[1]);
  uint8_t g = (h2(s[2])<<4) | h2(s[3]);
  uint8_t b = (h2(s[4])<<4) | h2(s[5]);
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

void handleUploadData() {
  HTTPUpload& up = server.upload();
  if (up.status == UPLOAD_FILE_START) {
    Serial.println("/upload: START");
    uploadBuf.clear();
    imgW = imgH = 0;
  } else if (up.status == UPLOAD_FILE_WRITE) {
    uploadBuf.insert(uploadBuf.end(), up.buf, up.buf + up.currentSize);
  } else if (up.status == UPLOAD_FILE_END) {
    Serial.printf("/upload: END bytes=%u\n", (unsigned)uploadBuf.size());
    if (uploadBuf.size() < 4) { server.send(400, "text/plain", "Bad image"); return; }
    imgW = uploadBuf[0] | (uploadBuf[1] << 8);
    imgH = uploadBuf[2] | (uploadBuf[3] << 8);
    Serial.printf("Parsed image size: %ux%u\n", imgW, imgH);
    // Allow text wider than panel for scrolling animation
    // Set reasonable limits: max 4x panel width for long text
    const uint16_t maxAllowedWidth = (uint16_t)VIRT_W() * 4;
    if (imgW == 0 || imgH == 0 || imgW > maxAllowedWidth || imgH > (uint16_t)VIRT_H()) {
      Serial.printf("Rejected invalid size: %ux%u (max: %ux%u)\n", imgW, imgH, maxAllowedWidth, (uint16_t)VIRT_H());
      server.send(400, "text/plain", "Invalid size");
      return;
    }
    size_t expected565 = 4 + (size_t)imgW * (size_t)imgH * 2;
    size_t expectedA8_565 = 4 + (size_t)imgW * (size_t)imgH * 3;
    Serial.printf("Expected sizes: RGB565=%u, A8+RGB565=%u, received=%u\n", (unsigned)expected565, (unsigned)expectedA8_565, (unsigned)uploadBuf.size());

    if (uploadBuf.size() == expectedA8_565) {
      // Parse A8 + RGB565 interleaved
      Serial.printf("Parsing A8+RGB565 format\n");
      textPixels.assign((size_t)imgW * (size_t)imgH, 0);
      textAlpha.assign((size_t)imgW * (size_t)imgH, 0);
      const uint8_t* p = &uploadBuf[4];
      for (size_t i = 0; i < (size_t)imgW * (size_t)imgH; ++i) {
        uint8_t a = *p++;
        uint16_t pix = (uint16_t)p[0] | ((uint16_t)p[1] << 8); p += 2;
        textAlpha[i] = a;
        textPixels[i] = pix;
      }
    } else if (uploadBuf.size() == expected565) {
      // Legacy RGB565 only
      Serial.printf("Parsing RGB565 format\n");
      const uint16_t* pixels = reinterpret_cast<const uint16_t*>(&uploadBuf[4]);
      textPixels.assign(pixels, pixels + (imgW * imgH));
      textAlpha.clear();
    } else {
      Serial.printf("Size mismatch error: expected %u or %u bytes, got %u\n", (unsigned)expected565, (unsigned)expectedA8_565, (unsigned)uploadBuf.size());
      server.send(400, "text/plain", "Size mismatch");
      return;
    }
    Serial.printf("/upload: parsed %ux%u mode=%s\n", imgW, imgH, textAlpha.empty()?"RGB565":"A8+RGB565");
    // No response here; will be sent in the completion handler
  }
}

void handleUploadDone() {
  sendCORSHeaders();

  // Stop theme mode if it was running
  if (currentMode == MODE_THEME) {
    Serial.println("Stopping theme mode, switching to clock mode");
  }
  currentMode = MODE_CLOCK;

  // Read options - force centering but USE ANIMATION SETTINGS
  bgColor = hexTo565(server.arg("bg"));
  textColor = hexTo565(server.arg("color"));  // ADD: Read text color from upload
  userOffX = 0; // Force center horizontally
  userOffY = 0; // Force center vertically

  // FIX: Read animation parameters from client instead of hardcoding
  animate = (server.arg("animate") == "1");
  animDir = (server.arg("dir") == "right") ? 1 : -1;
  animSpeedMs = server.hasArg("speed") ? constrain(server.arg("speed").toInt(), 2, 60) : 20;
  loopOffsetPx = server.hasArg("interval") ? constrain(server.arg("interval").toInt(), 1, 25) : 5;

  // DEBUG: Print animation settings to Serial
  Serial.printf("Animation settings: animate=%s, dir=%s, speed=%d ms, interval=%d px\n",
                animate ? "true" : "false",
                (animDir == -1) ? "left" : "right",
                animSpeedMs, loopOffsetPx);
  // brightness percent 0..100
  if (server.hasArg("brightness")) {
    int bp = constrain(server.arg("brightness").toInt(), 0, 100);
    uint8_t b8 = (uint8_t)((bp * 255) / 100);
    currentBrightness = b8;
    dma_display->setBrightness8(b8);
  }
  // Clear cached bg image if switching to plain color
  if (server.hasArg("bgMode") && server.arg("bgMode") == "color") {
    hasBgImage = false;
  }

  // If we have a bitmap, either draw once or start animating
  if (!textPixels.empty()) {
    baseY = (int)VIRT_H() / 2 - (int)imgH / 2 + userOffY; // vertical center + offset
    Serial.printf("/upload: drawing at center x~%d y=%d on %dx%d\n", (int)VIRT_W()/2, baseY, (int)VIRT_W(), (int)VIRT_H());
    waitingRestart = false;
    if (animate) {
      // Initialize multi-head array for continuous text stream
      int gap = (int)loopOffsetPx;
      int spacing = (int)imgW + gap; if (spacing < 1) spacing = 1;

      // Calculate how many copies we need to fill the screen + buffer
      const int totalCopies = ((VIRT_W() + spacing * 2) / spacing) + 3;
      heads.clear();
      heads.reserve(totalCopies);

      if (animDir < 0) { // left scrolling - start from right edge
        for (int i = 0; i < totalCopies; i++) {
          heads.push_back(VIRT_W() + (i * spacing));
        }
      } else { // right scrolling - start from left edge
        for (int i = 0; i < totalCopies; i++) {
          heads.push_back(-imgW - (i * spacing));
        }
      }

      Serial.printf("Initialized %d heads for continuous scrolling\n", totalCopies);
      // Compose full frame offscreen then push
      if (hasBgImage && bgPixels.size() == frameBuffer.size()) {
        frameBuffer = bgPixels;
      } else {
        std::fill(frameBuffer.begin(), frameBuffer.end(), bgColor);
      }
      auto blitAt = [&](int xPos){
        int16_t x0 = xPos + userOffX;
        for (int y=0; y<(int)imgH; ++y) {
          int dstY = baseY + y;
          if (dstY < 0 || dstY >= (int)VIRT_H()) continue;
          int srcRow = y * imgW;
          for (int x=0; x<(int)imgW; ++x) {
            int dstX = x0 + x;
            if (dstX < 0 || dstX >= (int)VIRT_W()) continue;
            size_t si = (size_t)srcRow + (size_t)x;
            size_t di = (size_t)dstY * (size_t)VIRT_W() + (size_t)dstX;
            if (di >= frameBuffer.size()) continue;
            if (!g_panel_active.empty()) {
              int pidx = panelIndexFromXY(dstX, dstY);
              if (pidx >= 0 && pidx < (int)g_panel_active.size() && g_panel_active[pidx] == 0) continue;
            }
            if (!textAlpha.empty()) {
              if (textAlpha[si]) frameBuffer[di] = textPixels[si];
            } else {
              frameBuffer[di] = textPixels[si];
            }
          }
        }
      };
      // Draw all heads for continuous text stream
      for (int i = 0; i < (int)heads.size(); i++) {
        blitAt(heads[i]);
      }
      maskDisabledPanels();
      vdisplay->drawRGBBitmap(0, 0, frameBuffer.data(), VIRT_W(), VIRT_H());
      // ensure animation starts moving immediately on next loop
      lastAnim = millis() - animSpeedMs;
    } else {
      if (hasBgImage && bgPixels.size() == frameBuffer.size()) {
        frameBuffer = bgPixels;
      } else {
        std::fill(frameBuffer.begin(), frameBuffer.end(), bgColor);
      }
      int16_t x = (int)VIRT_W() / 2 - (int)imgW / 2 + userOffX; // horizontal center + offset
      for (int y=0; y<(int)imgH; ++y) {
        int dstY = baseY + y;
        if (dstY < 0 || dstY >= (int)VIRT_H()) continue;
        int srcRow = y * imgW;
        for (int x2=0; x2<(int)imgW; ++x2) {
          int dstX = x + x2;
          if (dstX < 0 || dstX >= (int)VIRT_W()) continue;
          size_t si = (size_t)srcRow + (size_t)x2;
          size_t di = (size_t)dstY * (size_t)VIRT_W() + (size_t)dstX;
          if (di >= frameBuffer.size()) continue;
          if (!g_panel_active.empty()) {
            int pidx = panelIndexFromXY(dstX, dstY);
            if (pidx >= 0 && pidx < (int)g_panel_active.size() && g_panel_active[pidx] == 0) continue;
          }
          if (!textAlpha.empty()) {
            if (textAlpha[si]) frameBuffer[di] = textPixels[si];
          } else {
            frameBuffer[di] = textPixels[si];
          }
        }
      }
      maskDisabledPanels();
      vdisplay->drawRGBBitmap(0, 0, frameBuffer.data(), VIRT_W(), VIRT_H());
    }

    // Save settings and last frame
    saveLastSettings();
    saveLastFrame();
  }
  server.send(200, "text/plain", "OK");
}

// Handle background image upload at /upload_bg
// Expects RGB565 little-endian with 4-byte header [wL,wH,hL,hH]
void handleUploadBgData() {
  HTTPUpload& up = server.upload();
  static std::vector<uint8_t> buf;
  static uint16_t bw = 0, bh = 0;
  if (up.status == UPLOAD_FILE_START) {
    buf.clear(); bw = bh = 0;
  } else if (up.status == UPLOAD_FILE_WRITE) {
    buf.insert(buf.end(), up.buf, up.buf + up.currentSize);
  } else if (up.status == UPLOAD_FILE_END) {
    if (buf.size() < 4) { server.send(400, "text/plain", "Bad image"); return; }
    bw = buf[0] | (buf[1] << 8);
    bh = buf[2] | (buf[3] << 8);
    size_t expected = 4 + (size_t)bw * (size_t)bh * 2;
    if (buf.size() != expected) { server.send(400, "text/plain", "Size mismatch"); return; }
    // Resize bgPixels to panel size and blit (centered if different size)
    bgPixels.assign((size_t)VIRT_W() * (size_t)VIRT_H(), bgColor);
    const uint16_t* src = reinterpret_cast<const uint16_t*>(&buf[4]);
    int offx = ((int)VIRT_W() - (int)bw) / 2;
    int offy = ((int)VIRT_H() - (int)bh) / 2;
    for (int y=0; y<(int)bh; ++y) {
      int dy = offy + y; if (dy < 0 || dy >= (int)VIRT_H()) continue;
      for (int x=0; x<(int)bw; ++x) {
        int dx = offx + x; if (dx < 0 || dx >= (int)VIRT_W()) continue;
        bgPixels[(size_t)dy * VIRT_W() + (size_t)dx] = src[(size_t)y * bw + (size_t)x];
      }
    }
    hasBgImage = true;
    // Show background immediately if no text
    if (textPixels.empty()) {
      if (bgPixels.size() == (size_t)VIRT_W() * (size_t)VIRT_H()) {
        vdisplay->drawRGBBitmap(0, 0, bgPixels.data(), VIRT_W(), VIRT_H());
        // Save background as last frame
        frameBuffer = bgPixels;
        saveLastSettings();
        saveLastFrame();
      } else {
        vdisplay->fillScreen(bgColor);
      }
    }
  }
}

void handleUploadBgDone() {
  sendCORSHeaders();
  // No additional args needed; just acknowledge
  server.send(200, "text/plain", "OK");
}

// Handle theme file upload at /upload_theme
void handleUploadTheme() {
  HTTPUpload& up = server.upload();
  static File themeFile;

  if (up.status == UPLOAD_FILE_START) {
    Serial.println("/upload_theme: START");
    // Open file for writing
    themeFile = LittleFS.open("/theme.html", "w");
    if (!themeFile) {
      Serial.println("/upload_theme: Failed to open file for writing");
    }
  } else if (up.status == UPLOAD_FILE_WRITE) {
    if (themeFile) {
      themeFile.write(up.buf, up.currentSize);
    }
  } else if (up.status == UPLOAD_FILE_END) {
    Serial.printf("/upload_theme: END bytes=%u\n", (unsigned)up.totalSize);
    if (themeFile) {
      themeFile.close();
      Serial.println("/upload_theme: Theme saved to /theme.html");

      // Stop clock mode if it was running
      if (currentMode == MODE_CLOCK) {
        Serial.println("Stopping clock mode, switching to theme mode");
        animate = false;  // Stop clock animation
        textPixels.clear();  // Clear text pixels to stop clock display
      }
      currentMode = MODE_THEME;

      sendCORSHeaders();
      server.send(200, "text/plain", "Theme uploaded successfully");
    } else {
      Serial.println("/upload_theme: Failed to save theme (file not open)");
      sendCORSHeaders();
      server.send(500, "text/plain", "Failed to save theme");
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("Starting HUB75 + WebServer for Khmer text...");

  // Initialize NVS
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    // NVS partition was truncated and needs to be erased
    Serial.println("Erasing NVS flash...");
    ESP_ERROR_CHECK(nvs_flash_erase());
    err = nvs_flash_init();
  }
  ESP_ERROR_CHECK(err);
  Serial.println("NVS initialized");

  randomSeed(micros());

  // Module configuration
  HUB75_I2S_CFG mxconfig(
    PANEL_RES_X,
    PANEL_RES_Y,
    PANEL_CHAIN
  );

  // Pin mapping
  mxconfig.gpio.r1 = R1_PIN;
  mxconfig.gpio.g1 = G1_PIN;
  mxconfig.gpio.b1 = B1_PIN;
  mxconfig.gpio.r2 = R2_PIN;
  mxconfig.gpio.g2 = G2_PIN;
  mxconfig.gpio.b2 = B2_PIN;
  mxconfig.gpio.a = A_PIN;
  mxconfig.gpio.b = B_PIN;
  mxconfig.gpio.c = C_PIN;
  mxconfig.gpio.d = D_PIN;
  mxconfig.gpio.e = E_PIN;
  mxconfig.gpio.lat = LAT_PIN;
  mxconfig.gpio.oe = OE_PIN;
  mxconfig.gpio.clk = CLK_PIN;

  // Panel driver/timing options
  mxconfig.clkphase = false;
  mxconfig.driver = HUB75_I2S_CFG::FM6124;

  // Display Setup
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  if (!dma_display->begin()) {
    Serial.println("MatrixPanel_I2S_DMA begin() failed!");
    while (true) { delay(1000); }
  }
  dma_display->setBrightness8(200);
  dma_display->clearScreen();
  // Virtual matrix wrapper for chaining/mapping (uses enum PANEL_CHAIN_TYPE)
  vdisplay = new VirtualMatrixPanel(*dma_display, cur_rows, cur_cols, PANEL_RES_X, PANEL_RES_Y, VIRTUAL_MATRIX_CHAIN_TYPE);
  // Clear screen
  vdisplay->fillScreen(dma_display->color565(0, 0, 0));
  frameBuffer.assign((size_t)VIRT_W() * (size_t)VIRT_H(), 0);

  // Initialize panel-active mask to hardware (all ON by default)
  g_panel_active.assign((size_t)cur_rows * (size_t)cur_cols, 1);

  // Draw seam guides for current layout
  if (cur_cols > 1) {
    for (int y = 0; y < VIRT_H(); ++y) vdisplay->drawPixel(PANEL_RES_X, y, vdisplay->color565(0, 64, 255));
  }
  if (cur_rows > 1) {
    for (int x = 0; x < VIRT_W(); ++x) vdisplay->drawPixel(x, PANEL_RES_Y, vdisplay->color565(0, 64, 255));
  }

  // Mount LittleFS to serve index.html
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed");
  } else {
    Serial.println("LittleFS mounted");
  }

  // Load saved settings and last frame
  loadLastSettings();
  loadLastFrame();

  // Bring up Wi-Fi AP and web server
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(AP_SSID, AP_PASS)) {
    Serial.println("SoftAP failed");
  } else {
    Serial.print("AP SSID: "); Serial.println(AP_SSID);
    Serial.print("AP IP: "); Serial.println(WiFi.softAPIP());
  }
  server.on("/", HTTP_GET, handleRoot);
  server.onNotFound(handleStaticFile);
  server.on("/upload", HTTP_POST, handleUploadDone, handleUploadData);
  server.on("/upload_bg", HTTP_POST, handleUploadBgDone, handleUploadBgData);
  server.on("/upload_theme", HTTP_POST, [](){ server.send(200, "text/plain", "Theme upload complete"); }, handleUploadTheme);
  server.on("/stop_clock", HTTP_POST, [](){
    sendCORSHeaders();
    Serial.println("Stopping clock animation");
    animate = false;  // Stop animation
    textPixels.clear();  // Clear text pixels to stop display
    currentMode = MODE_NONE;  // Set mode to none
    server.send(200, "text/plain", "Clock stopped");
  });
  server.on("/stop_theme", HTTP_POST, [](){
    sendCORSHeaders();
    Serial.println("Stopping theme mode");
    currentMode = MODE_NONE;  // Set mode to none
    // Clear display
    if (vdisplay) {
      vdisplay->fillScreen(0);
    }
    server.send(200, "text/plain", "Theme stopped");
  });

  // CORS preflight handler
  server.on("/upload", HTTP_OPTIONS, [](){
    sendCORSHeaders();
    server.send(200, "text/plain", "");
  });
  server.on("/upload_bg", HTTP_OPTIONS, [](){
    sendCORSHeaders();
    server.send(200, "text/plain", "");
  });
  server.on("/upload_theme", HTTP_OPTIONS, [](){
    sendCORSHeaders();
    server.send(200, "text/plain", "");
  });
  server.on("/theme_status", HTTP_OPTIONS, [](){
    sendCORSHeaders();
    server.send(200, "text/plain", "");
  });
  server.on("/panel_info", HTTP_OPTIONS, [](){
    sendCORSHeaders();
    server.send(200, "text/plain", "");
  });
  server.on("/panel_layout", HTTP_OPTIONS, [](){
    sendCORSHeaders();
    server.send(200, "text/plain", "");
  });
  server.on("/stop_clock", HTTP_OPTIONS, [](){
    sendCORSHeaders();
    server.send(200, "text/plain", "");
  });
  server.on("/stop_theme", HTTP_OPTIONS, [](){
    sendCORSHeaders();
    server.send(200, "text/plain", "");
  });
  // Panel layout configuration: configure panel arrangement
  // usage: POST /panel_layout layout=1x1
  server.on("/panel_layout", HTTP_POST, [](){
    if (!server.hasArg("layout")) { server.send(400, "text/plain", "Missing layout"); return; }
    String l = server.arg("layout"); l.toLowerCase();
    int new_rows = cur_rows, new_cols = cur_cols;
    if (l == "1x1") { new_rows = 1; new_cols = 1; }
    else { server.send(400, "text/plain", "Invalid layout"); return; }

    sendCORSHeaders();
    if (new_rows == cur_rows && new_cols == cur_cols) { server.send(200, "text/plain", "OK"); return; }

    // Recreate virtual panel with new layout
    cur_rows = new_rows; cur_cols = new_cols;
    if (vdisplay) { delete vdisplay; vdisplay = nullptr; }
    vdisplay = new VirtualMatrixPanel(*dma_display, cur_rows, cur_cols, PANEL_RES_X, PANEL_RES_Y, VIRTUAL_MATRIX_CHAIN_TYPE);
    vdisplay->fillScreen(0);

    // Resize buffers and clear
    frameBuffer.assign((size_t)VIRT_W() * (size_t)VIRT_H(), 0);
    if (hasBgImage) {
      // Invalidate bg if size mismatch; user can re-upload
      if (bgPixels.size() != frameBuffer.size()) { hasBgImage = false; bgPixels.clear(); }
    }

    // Redraw seam guides
    if (cur_cols > 1) { for (int y = 0; y < VIRT_H(); ++y) vdisplay->drawPixel(PANEL_RES_X, y, vdisplay->color565(0,64,255)); }
    if (cur_rows > 1) { for (int x = 0; x < VIRT_W(); ++x) vdisplay->drawPixel(x, PANEL_RES_Y, vdisplay->color565(0,64,255)); }

    // Adjust active mask to hardware count (1 panel)
    g_panel_active.assign((size_t)cur_rows * (size_t)cur_cols, 1);
    sendCORSHeaders();
    server.send(200, "text/plain", "OK");
  });
  // Panel info endpoint (detected/configured count)
  server.on("/panel_info", HTTP_GET, [](){
    // Report current layout and hardware detected panel count
    String json = "{";
    json += "\"rows\":" + String(cur_rows) + ",";
    json += "\"cols\":" + String(cur_cols) + ",";
    int detected = 1;
    json += "\"detected\":" + String(detected) + ",";
    // labels
    json += "\"labels\":[";
    for (int i = 0; i < detected; ++i) {
      if (i) json += ",";
      json += "\""; json += panelLabelForIndex(i); json += "\"";
    }
    json += "],";
    // active
    json += "\"active\":[";
    for (int i = 0; i < detected; ++i) {
      if (i) json += ",";
      int v = (i < (int)g_panel_active.size()) ? g_panel_active[i] : 0;
      json += String(v);
    }
    json += "]}";
    sendCORSHeaders();
    server.send(200, "application/json", json);
  });
  // Theme status endpoint
  server.on("/theme_status", HTTP_GET, [](){
    sendCORSHeaders();
    File f = LittleFS.open("/theme.html", "r");
    String status = f ? "{\"theme_uploaded\":true}" : "{\"theme_uploaded\":false}";
    if (f) f.close();
    server.send(200, "application/json", status);
  });
  server.begin();
}

void loop() {
  server.handleClient();
  // Animate if enabled, we have a text bitmap, and we're in clock mode
  if (animate && !textPixels.empty() && currentMode == MODE_CLOCK) {
    uint32_t now = millis();
    if (now - lastAnim >= animSpeedMs) {
      // DEBUG: Animation loop is running
      Serial.printf("Animation loop running - managing %d heads\n", (int)heads.size());
      lastAnim = now;
      // compose background
      if (hasBgImage && bgPixels.size() == frameBuffer.size()) {
        frameBuffer = bgPixels;
      } else {
        std::fill(frameBuffer.begin(), frameBuffer.end(), bgColor);
      }
      // blit two heads
      auto blitAt = [&](int xPos){
        int16_t x0 = xPos + userOffX;
        for (int y=0; y<(int)imgH; ++y) {
          int dstY = baseY + y;
          if (dstY < 0 || dstY >= (int)VIRT_H()) continue;
          int srcRow = y * imgW;
          for (int x2=0; x2<(int)imgW; ++x2) {
            int dstX = x0 + x2;
            if (dstX < 0 || dstX >= (int)VIRT_W()) continue;
            size_t si = (size_t)srcRow + (size_t)x2;
            if (!textAlpha.empty()) {
              if (textAlpha[si]) frameBuffer[(size_t)dstY * VIRT_W() + (size_t)dstX] = textPixels[si];
            } else {
              frameBuffer[(size_t)dstY * VIRT_W() + (size_t)dstX] = textPixels[si];
            }
          }
        }
      };
      // Draw all heads for continuous text stream
      for (int i = 0; i < (int)heads.size(); i++) {
        blitAt(heads[i]);
      }
      vdisplay->drawRGBBitmap(0, 0, frameBuffer.data(), VIRT_W(), VIRT_H());

      // advance all heads
      int gap = (int)loopOffsetPx;
      int spacing = (int)imgW + gap;
      if (spacing < 1) spacing = 1; // Ensure minimum spacing

      if (animDir < 0) { // left scrolling
        // Move all heads left
        for (int i = 0; i < (int)heads.size(); i++) {
          heads[i] -= 1;
        }

        // Recycle any head that goes completely off screen - FIXED VERSION
        for (int i = 0; i < (int)heads.size(); i++) {
          if (heads[i] + imgW <= 0) {
            // Find the rightmost head to position after it
            int rightmost = heads[0];
            for (int j = 1; j < (int)heads.size(); j++) {
              if (heads[j] > rightmost) rightmost = heads[j];
            }
            // Position immediately after the rightmost head with proper spacing
            heads[i] = rightmost + spacing;
            // Debug: ensure smooth transition
            // Serial.printf("Recycled head %d: old pos=%d, new pos=%d, spacing=%d\n", i, heads[i] - spacing, heads[i], spacing);
          }
        }
      } else { // right scrolling
        // Move all heads right
        for (int i = 0; i < (int)heads.size(); i++) {
          heads[i] += 1;
        }

        // Recycle any head that goes completely off screen - FIXED VERSION
        for (int i = 0; i < (int)heads.size(); i++) {
          if (heads[i] >= VIRT_W()) {
            // Find the leftmost head to position before it
            int leftmost = heads[0];
            for (int j = 1; j < (int)heads.size(); j++) {
              if (heads[j] < leftmost) leftmost = heads[j];
            }
            // Position immediately before the leftmost head with proper spacing
            heads[i] = leftmost - spacing;
            // Debug: ensure smooth transition
            // Serial.printf("Recycled head %d: old pos=%d, new pos=%d, spacing=%d\n", i, heads[i] + spacing, heads[i], spacing);
          }
        }
      }
    }
  } else {
    delay(2); // yield CPU when idle
  }
}