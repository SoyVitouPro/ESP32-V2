// Pixel/color helpers
export const rgb565 = (r, g, b) => ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | ((b) >> 3);

