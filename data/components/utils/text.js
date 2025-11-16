// Text measurement/drawing helpers and image cropping

export const drawTextWithGap = (ctx, text, x, y, gap) => {
  if (gap === 0) { ctx.fillText(text, x, y); return; }
  let currentX = x;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    ctx.fillText(char, currentX, y);
    const charWidth = ctx.measureText(char).width;
    currentX += charWidth + gap;
    if (char === ' ' && gap < 3) currentX += (3 - gap);
  }
};

export const measureTextWithGap = (ctx, text, gap) => {
  if (gap === 0) return ctx.measureText(text).width;
  let totalWidth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    totalWidth += ctx.measureText(char).width;
    if (i < text.length - 1) {
      totalWidth += gap;
      if (char === ' ' && gap < 3) totalWidth += (3 - gap);
    }
  }
  return totalWidth;
};

export const cropImageData = (img, w, h) => {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = img[(y * w + x) * 4 + 3];
      if (a) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

