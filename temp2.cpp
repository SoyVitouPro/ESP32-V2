#include <ESP32-VirtualMatrixPanel-I2S-DMA.h>

// ---------------- Panel Configuration ----------------
#define PANEL_RES_X 128     // Each panel width
#define PANEL_RES_Y 64     // Each panel height
#define NUM_ROWS 2
#define NUM_COLS 1
#define PANEL_CHAIN (NUM_ROWS * NUM_COLS)
#define CHAIN_BOTTOM_LEFT_UP 0x01
#define VIRTUAL_MATRIX_CHAIN_TYPE CHAIN_BOTTOM_LEFT_UP

// ---------------- Pin Configuration ----------------
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
VirtualMatrixPanel *virtualDisp = nullptr;

void setup() {
  Serial.begin(115200);

  HUB75_I2S_CFG mxconfig(
    PANEL_RES_X,
    PANEL_RES_Y,
    PANEL_CHAIN
  );

  // Assign pins
  mxconfig.gpio.r1 = R1_PIN;
  mxconfig.gpio.g1 = G1_PIN;
  mxconfig.gpio.b1 = B1_PIN;
  mxconfig.gpio.r2 = R2_PIN;
  mxconfig.gpio.g2 = G2_PIN;
  mxconfig.gpio.b2 = B2_PIN;
  mxconfig.gpio.a  = A_PIN;
  mxconfig.gpio.b  = B_PIN;
  mxconfig.gpio.c  = C_PIN;
  mxconfig.gpio.d  = D_PIN;
  mxconfig.gpio.e  = E_PIN;
  mxconfig.gpio.lat = LAT_PIN;
  mxconfig.gpio.oe  = OE_PIN;
  mxconfig.gpio.clk = CLK_PIN;
  mxconfig.clkphase = false;
  mxconfig.driver = HUB75_I2S_CFG::FM6124;

  // Initialize display
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  if (!dma_display->begin()) {
    Serial.println("I2S memory allocation failed!");
    while (true);
  }

  dma_display->setBrightness8(255);
  virtualDisp = new VirtualMatrixPanel(*dma_display, NUM_ROWS, NUM_COLS,
                                       PANEL_RES_X, PANEL_RES_Y, VIRTUAL_MATRIX_CHAIN_TYPE);

  virtualDisp->fillScreen(virtualDisp->color565(0, 0, 0)); // Clear screen

  // ---- Draw Text ----
  virtualDisp->setTextColor(virtualDisp->color565(255, 255, 0)); // Yellow
  virtualDisp->setTextWrap(false);

  // Set text size
  virtualDisp->setTextSize(3);  // Increase number for larger text (2, 3, 4...)

  String text = "Hello";

  // Calculate position to center text
  int16_t x = (virtualDisp->width() - (text.length() * 6 * 3)) / 2;
  int16_t y = (virtualDisp->height() / 2) - 8;

  virtualDisp->setCursor(x, y);
  virtualDisp->print(text);
}

void loop() {
  // Nothing here
}