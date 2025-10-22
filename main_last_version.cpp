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
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <string.h>
#include <vector>

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
#define CHAIN_BOTTOM_LEFT_UP 0x02
#define VIRTUAL_MATRIX_CHAIN_TYPE CHAIN_BOTTOM_LEFT_UP

// GPIO mapping
#define R1_PIN  25
#define G1_PIN  26
#define B1_PIN  27
#define R2_PIN  14
#define G2_PIN  12
#define B2_PIN  13
#define A_PIN   23
#define B_PIN   22
#define C_PIN   5
#define D_PIN   17
#define E_PIN   18
#define LAT_PIN 4
#define OE_PIN  15
#define CLK_PIN 16

MatrixPanel_I2S_DMA *dma_display = nullptr;

// Wi-Fi SoftAP config
static const char* AP_SSID = "KHMER_PANEL";
static const char* AP_PASS = "12345678"; // 8+ chars required

WebServer server(80);

// Uploaded text bitmap (RGB565), text-only cropped image
static std::vector<uint8_t> uploadBuf;      // raw bytes as received (header + pixels)
static std::vector<uint16_t> textPixels;    // pixels only, RGB565
static std::vector<uint8_t>  textAlpha;     // optional A8 alpha per pixel
static std::vector<uint16_t> frameBuffer;   // full panel offscreen RGB565
static std::vector<uint16_t> bgPixels;      // optional background image (panel-sized)
static bool hasBgImage = false;
static uint16_t imgW = 0, imgH = 0;         // text image size
// Panel config (for multi-panel awareness)
static int g_panel_rows = 1;
static int g_panel_cols = 1;
static String g_panel_map; // comma-separated indices

// Render settings from client
static uint16_t bgColor = 0x0000;           // RGB565 background
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
static int16_t headX0 = 0, headX1 = 0;      // twin heads for seamless marquee

// --- Theme upload support (HTML files) ---
static File gThemeFile;
static String sanitizeName(const String& n){
  String s=n; for(size_t i=0;i<s.length();++i){ char c=s[i]; if(!(isalnum(c)||c=='_'||c=='-'||c=='.')) s.setCharAt(i,'_'); }
  if(!s.endsWith(".html")) s += ".html";
  return s;
}
void handleThemeUploadData(){
  HTTPUpload& up = server.upload();
  if(up.status==UPLOAD_FILE_START){
    String name = sanitizeName(up.filename);
    String path = String("/themes/") + name;
    LittleFS.mkdir("/themes");
    if(gThemeFile) gThemeFile.close();
    gThemeFile = LittleFS.open(path, "w");
  } else if(up.status==UPLOAD_FILE_WRITE){
    if(gThemeFile) gThemeFile.write(up.buf, up.currentSize);
  } else if(up.status==UPLOAD_FILE_END){
    if(gThemeFile) gThemeFile.close();
    server.send(200, "text/plain", "OK");
  }
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
  File f = LittleFS.open("/index.html", "r");
  if (!f) {
    server.send_P(200, "text/html; charset=utf-8", FALLBACK_HTML);
    return;
  }
  server.streamFile(f, contentTypeFor("/index.html"));
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
    uploadBuf.clear();
    imgW = imgH = 0;
  } else if (up.status == UPLOAD_FILE_WRITE) {
    uploadBuf.insert(uploadBuf.end(), up.buf, up.buf + up.currentSize);
  } else if (up.status == UPLOAD_FILE_END) {
    if (uploadBuf.size() < 4) { server.send(400, "text/plain", "Bad image"); return; }
    imgW = uploadBuf[0] | (uploadBuf[1] << 8);
    imgH = uploadBuf[2] | (uploadBuf[3] << 8);
    size_t expected565 = 4 + (size_t)imgW * (size_t)imgH * 2;
    size_t expectedA8_565 = 4 + (size_t)imgW * (size_t)imgH * 3;
    if (uploadBuf.size() == expectedA8_565) {
      // Parse A8 + RGB565 interleaved
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
      const uint16_t* pixels = reinterpret_cast<const uint16_t*>(&uploadBuf[4]);
      textPixels.assign(pixels, pixels + (imgW * imgH));
      textAlpha.clear();
    } else {
      server.send(400, "text/plain", "Size mismatch");
      return;
    }
    // No response here; will be sent in the completion handler
  }
}

void handleUploadDone() {
  // Read options
  bgColor = hexTo565(server.arg("bg"));
  userOffX = server.hasArg("offx") ? server.arg("offx").toInt() : 0;
  userOffY = server.hasArg("offy") ? server.arg("offy").toInt() : 0;
  animate = server.hasArg("animate") && server.arg("animate") == "1";
  String dir = server.arg("dir");
  animDir = (dir == "right") ? +1 : -1; // default left
  animSpeedMs = server.hasArg("speed") ? constrain(server.arg("speed").toInt(), 2, 50) : 20;
  // loop gap in pixels: 1..25 (UI sends positive gap)
  int iv = server.hasArg("interval") ? server.arg("interval").toInt() : 1;
  if (iv < 1) iv = 1; if (iv > 25) iv = 25;
  loopOffsetPx = (int16_t)iv;
  // brightness percent 0..100
  if (server.hasArg("brightness")) {
    int bp = constrain(server.arg("brightness").toInt(), 0, 100);
    uint8_t b8 = (uint8_t)((bp * 255) / 100);
    dma_display->setBrightness8(b8);
  }
  // Clear cached bg image if switching to plain color
  if (server.hasArg("bgMode") && server.arg("bgMode") == "color") {
    hasBgImage = false;
  }

  // If we have a bitmap, either draw once or start animating
  if (!textPixels.empty()) {
    baseY = (int)PANEL_RES_Y / 2 - (int)imgH / 2 + userOffY; // vertical center + offset
    waitingRestart = false;
    if (animate) {
      // Initialize twin heads for seamless marquee
      int gap = (int)loopOffsetPx;
      int spacing = (int)imgW + gap; if (spacing < 1) spacing = 1;
      if (animDir < 0) {
        headX0 = (int)PANEL_RES_X;           // start just off right edge
        headX1 = headX0 + spacing;           // next copy further right
      } else {
        headX0 = - (int)imgW;                // start just off left edge
        headX1 = headX0 - spacing;           // next copy further left
      }
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
          if (dstY < 0 || dstY >= (int)PANEL_RES_Y) continue;
          int srcRow = y * imgW;
          for (int x=0; x<(int)imgW; ++x) {
            int dstX = x0 + x;
            if (dstX < 0 || dstX >= (int)PANEL_RES_X) continue;
            size_t si = (size_t)srcRow + (size_t)x;
            if (!textAlpha.empty()) {
              if (textAlpha[si]) frameBuffer[(size_t)dstY * PANEL_RES_X + (size_t)dstX] = textPixels[si];
            } else {
              frameBuffer[(size_t)dstY * PANEL_RES_X + (size_t)dstX] = textPixels[si];
            }
          }
        }
      };
      blitAt(headX0);
      blitAt(headX1);
      dma_display->drawRGBBitmap(0, 0, frameBuffer.data(), PANEL_RES_X, PANEL_RES_Y);
      // ensure animation starts moving immediately on next loop
      lastAnim = millis() - animSpeedMs;
    } else {
      if (hasBgImage && bgPixels.size() == frameBuffer.size()) {
        frameBuffer = bgPixels;
      } else {
        std::fill(frameBuffer.begin(), frameBuffer.end(), bgColor);
      }
      int16_t x = (int)PANEL_RES_X / 2 - (int)imgW / 2 + userOffX; // horizontal center + offset
      for (int y=0; y<(int)imgH; ++y) {
        int dstY = baseY + y;
        if (dstY < 0 || dstY >= (int)PANEL_RES_Y) continue;
        int srcRow = y * imgW;
        for (int x2=0; x2<(int)imgW; ++x2) {
          int dstX = x + x2;
          if (dstX < 0 || dstX >= (int)PANEL_RES_X) continue;
          size_t si = (size_t)srcRow + (size_t)x2;
          if (!textAlpha.empty()) {
            if (textAlpha[si]) frameBuffer[(size_t)dstY * PANEL_RES_X + (size_t)dstX] = textPixels[si];
          } else {
            frameBuffer[(size_t)dstY * PANEL_RES_X + (size_t)dstX] = textPixels[si];
          }
        }
      }
      dma_display->drawRGBBitmap(0, 0, frameBuffer.data(), PANEL_RES_X, PANEL_RES_Y);
    }
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
    bgPixels.assign((size_t)PANEL_RES_X * (size_t)PANEL_RES_Y, bgColor);
    const uint16_t* src = reinterpret_cast<const uint16_t*>(&buf[4]);
    int offx = ((int)PANEL_RES_X - (int)bw) / 2;
    int offy = ((int)PANEL_RES_Y - (int)bh) / 2;
    for (int y=0; y<(int)bh; ++y) {
      int dy = offy + y; if (dy < 0 || dy >= (int)PANEL_RES_Y) continue;
      for (int x=0; x<(int)bw; ++x) {
        int dx = offx + x; if (dx < 0 || dx >= (int)PANEL_RES_X) continue;
        bgPixels[(size_t)dy * PANEL_RES_X + (size_t)dx] = src[(size_t)y * bw + (size_t)x];
      }
    }
    hasBgImage = true;
    // Show background immediately if no text
    if (textPixels.empty()) {
      dma_display->drawRGBBitmap(0, 0, bgPixels.data(), PANEL_RES_X, PANEL_RES_Y);
    }
  }
}

void handleUploadBgDone() {
  // No additional args needed; just acknowledge
  server.send(200, "text/plain", "OK");
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("Starting HUB75 + WebServer for Khmer text...");

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
  frameBuffer.assign((size_t)PANEL_RES_X * (size_t)PANEL_RES_Y, 0);

  // Mount LittleFS to serve index.html
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed");
  } else {
    Serial.println("LittleFS mounted");
  }

  // Bring up Wi-Fi AP and web server
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(AP_SSID, AP_PASS)) {
    Serial.println("SoftAP failed");
  } else {
    Serial.print("AP SSID: "); Serial.println(AP_SSID);
    Serial.print("AP IP: "); Serial.println(WiFi.softAPIP());
  }
  server.on("/", HTTP_GET, handleRoot);
  server.on("/upload", HTTP_POST, handleUploadDone, handleUploadData);
  server.on("/upload_bg", HTTP_POST, handleUploadBgDone, handleUploadBgData);
  // Theme (HTML) upload and listing
  server.on("/upload_theme", HTTP_POST, [](){}, handleThemeUploadData);
  server.on("/theme_list", HTTP_GET, [](){
    String json = "[";
    File dir = LittleFS.open("/themes");
    if(dir){
      File f = dir.openNextFile();
      bool first=true;
      while(f){ String n=f.name(); if(n.endsWith(".html")){ if(!first) json+=","; first=false; json+="\""+n+"\""; } f=dir.openNextFile(); }
    }
    json += "]";
    server.send(200, "application/json", json);
  });
  // Serve any static file from LittleFS if found
  server.onNotFound([](){
    String path = server.uri();
    if(path=="/") { handleRoot(); return; }
    if(LittleFS.exists(path)){
      File f = LittleFS.open(path, "r");
      server.streamFile(f, contentTypeFor(path));
      f.close();
    } else {
      server.send(404, "text/plain", "Not Found");
    }
  });
  // Panel configuration (rows, cols, map)
  server.on("/panel_config", HTTP_POST, [](){
    if (server.hasArg("rows")) { int v = server.arg("rows").toInt(); g_panel_rows = (v < 1) ? 1 : v; }
    if (server.hasArg("cols")) { int v = server.arg("cols").toInt(); g_panel_cols = (v < 1) ? 1 : v; }
    if (server.hasArg("map")) g_panel_map = server.arg("map");
    server.send(200, "text/plain", "OK");
  });
  // Panel info endpoint (detected/configured count)
  server.on("/panel_info", HTTP_GET, [](){
    char buf[128];
    int detected = g_panel_rows * g_panel_cols;
    snprintf(buf, sizeof(buf), "{\"rows\":%d,\"cols\":%d,\"detected\":%d}", g_panel_rows, g_panel_cols, detected);
    server.send(200, "application/json", buf);
  });
  server.begin();
}

void loop() {
  server.handleClient();
  // Animate if enabled and we have a text bitmap
  if (animate && !textPixels.empty()) {
    uint32_t now = millis();
    if (now - lastAnim >= animSpeedMs) {
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
          if (dstY < 0 || dstY >= (int)PANEL_RES_Y) continue;
          int srcRow = y * imgW;
          for (int x2=0; x2<(int)imgW; ++x2) {
            int dstX = x0 + x2;
            if (dstX < 0 || dstX >= (int)PANEL_RES_X) continue;
            size_t si = (size_t)srcRow + (size_t)x2;
            if (!textAlpha.empty()) {
              if (textAlpha[si]) frameBuffer[(size_t)dstY * PANEL_RES_X + (size_t)dstX] = textPixels[si];
            } else {
              frameBuffer[(size_t)dstY * PANEL_RES_X + (size_t)dstX] = textPixels[si];
            }
          }
        }
      };
      blitAt(headX0);
      blitAt(headX1);
      dma_display->drawRGBBitmap(0, 0, frameBuffer.data(), PANEL_RES_X, PANEL_RES_Y);
      // advance heads
      int gap = (int)loopOffsetPx;
      int spacing = (int)imgW + gap; if (spacing < 1) spacing = 1;
      if (animDir < 0) { // left
        headX0 -= 1; headX1 -= 1;
        if (headX0 + (int)imgW <= 0) headX0 = headX1 + spacing;
        if (headX1 + (int)imgW <= 0) headX1 = headX0 + spacing;
      } else { // right
        headX0 += 1; headX1 += 1;
        if (headX0 >= (int)PANEL_RES_X) headX0 = headX1 - spacing;
        if (headX1 >= (int)PANEL_RES_X) headX1 = headX0 - spacing;
      }
    }
  } else {
    delay(2); // yield CPU when idle
  }
}
