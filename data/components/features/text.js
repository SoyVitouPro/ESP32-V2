// Text feature: preview, animation, and upload
import { $, rgb565, cropImageData, getTextFontFamily, registerWebFonts, drawTextWithGap, measureTextWithGap } from '../core/utils.js';
import { state, cancelRaf } from '../core/state.js';
import { apiBase } from '../core/api.js';

// Edge smoothing configuration for crisp text
const TEXT_ALPHA_THRESHOLD = 16;
const ALPHA_GAMMA = 1.3;
const ALPHA_MULT = 1.0;

let textBitmapCanvas = null;
let textBitmapKey = '';

const isComplexKhmer = (text) => /[\u1780-\u17FF\u19E0-\u19FF]/.test(text);
const isKhmerFontSelected = () => {
  const sel = document.getElementById('fontFamilySelect');
  const v = sel ? (sel.value || '').toLowerCase() : '';
  return v.includes('battambang') || v.includes('bokor') || v.includes('moul') || v.includes('dangrek');
};

const getThickness = () => parseInt(($('fontThickness') && $('fontThickness').value) || '0', 10) || 0;

const drawTextLineToCanvas = (canvas, text, fam, size, color, xGap, gradientSpec) => {
  const tctx = canvas.getContext('2d');
  const font = `normal ${size}px ${fam}`;
  tctx.font = font; tctx.textBaseline = 'alphabetic'; tctx.textAlign = 'left';
  const complex = isComplexKhmer(text) || isKhmerFontSelected();
  let textWidth = 0;
  if (!complex) {
    textWidth = measureTextWithGap(tctx, text, xGap);
  } else {
    const parts = text.split(/(\s+)/);
    for (const part of parts) {
      if (part.length === 0) continue;
      if (/^\s+$/.test(part)) textWidth += tctx.measureText(part).width + xGap;
      else textWidth += tctx.measureText(part).width;
    }
  }
  const th = Math.max(1, Math.ceil(size * 1.2 + 8));
  const tw = Math.max(1, Math.ceil(textWidth) + 8);
  canvas.width = tw; canvas.height = th;
  tctx.font = font; tctx.textBaseline = 'alphabetic'; tctx.textAlign = 'left';
  if (gradientSpec && gradientSpec !== 'none') {
    const grad = tctx.createLinearGradient(0, 0, textWidth, 0);
    const gradients = {
      rainbow: ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD'],
      sunset: ['#FF512F','#F09819'],
      ocean: ['#2E3192','#1BFFFF'],
      forest: ['#134E5E','#71B280'],
      fire: ['#FF416C','#FF4B2B'],
      purple: ['#667eea','#764ba2']
    };
    const arr = gradients[gradientSpec] || ['#FFFFFF'];
    for (let i = 0; i < arr.length; i++) grad.addColorStop(i/(arr.length-1 || 1), arr[i]);
    tctx.fillStyle = grad;
  } else {
    tctx.fillStyle = '#FFFFFF';
  }
  let currentX = 4; const baseY = Math.floor(size * 1.0);
  if (!complex) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      tctx.fillText(ch, currentX, baseY);
      const cw = tctx.measureText(ch).width;
      currentX += cw + (i < text.length - 1 ? xGap : 0);
      if (ch === ' ' && xGap < 3) currentX += (3 - xGap);
    }
  } else {
    const parts = text.split(/(\s+)/);
    for (const part of parts) {
      if (part.length === 0) continue;
      if (/^\s+$/.test(part)) currentX += (tctx.measureText(part).width + xGap);
      else { tctx.fillText(part, currentX, baseY); currentX += tctx.measureText(part).width; }
    }
  }
};

const buildTextBitmap = (text, fam, size, xGap, color, gradientSpec, thickness, forPreview=false) => {
  const src = document.createElement('canvas');
  drawTextLineToCanvas(src, text, fam, size, color, xGap, gradientSpec);
  const sctx = src.getContext('2d');
  const sdata = sctx.getImageData(0, 0, src.width, src.height);
  const d = sdata.data; const w = src.width, h = src.height;
  let alpha = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) alpha[p] = d[i+3];
  const maxFilterOnce = (input) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const v = input[yy * w + xx]; if (v > m) m = v;
          }
        }
        out[y * w + x] = m;
      }
    }
    return out;
  };
  let thickAlpha = alpha;
  for (let k = 0; k < thickness; k++) thickAlpha = maxFilterOnce(thickAlpha);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (thickAlpha[y * w + x] >= TEXT_ALPHA_THRESHOLD) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < minX || maxY < minY) { const empty = document.createElement('canvas'); empty.width=1; empty.height=1; return empty; }
  const outW = Math.max(1, maxX - minX + 1);
  const outH = Math.max(1, maxY - minY + 1);
  const out = document.createElement('canvas'); out.width = outW; out.height = outH;
  const octx = out.getContext('2d');
  if (gradientSpec && gradientSpec !== 'none') {
    const grad = octx.createLinearGradient(0, 0, outW, 0);
    const gradients = {
      rainbow: ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD'],
      sunset: ['#FF512F','#F09819'],
      ocean: ['#2E3192','#1BFFFF'],
      forest: ['#134E5E','#71B280'],
      fire: ['#FF416C','#FF4B2B'],
      purple: ['#667eea','#764ba2']
    };
    const arr = gradients[gradientSpec] || [color];
    for (let i = 0; i < arr.length; i++) grad.addColorStop(i/(arr.length-1 || 1), arr[i]);
    octx.fillStyle = grad;
  } else {
    octx.fillStyle = color;
  }
  octx.fillRect(0, 0, outW, outH);
  const odata = octx.getImageData(0, 0, outW, outH);
  const od = odata.data;
  if (forPreview) {
    const remapAlpha = (a) => {
      const x = Math.max(0, Math.min(1, a / 255));
      let y = Math.pow(x, ALPHA_GAMMA) * 255 * ALPHA_MULT;
      if (y < TEXT_ALPHA_THRESHOLD) y = 0;
      return y > 255 ? 255 : y;
    };
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const a = thickAlpha[(y + minY) * w + (x + minX)];
        const idx = (y * outW + x) * 4;
        od[idx + 3] = remapAlpha(a);
      }
    }
  } else {
    const T = TEXT_ALPHA_THRESHOLD;
    const isEdge = (yy, xx) => {
      const a0 = thickAlpha[yy * w + xx];
      if (a0 < T) return false;
      for (let dy = -1; dy <= 1; dy++) {
        const y2 = yy + dy; if (y2 < 0 || y2 >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x2 = xx + dx; if (x2 < 0 || x2 >= w) continue;
          if (thickAlpha[y2 * w + x2] < T) return true;
        }
      }
      return false;
    };
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const yy = y + minY, xx = x + minX;
        const idx = (y * outW + x) * 4;
        const a0 = thickAlpha[yy * w + xx];
        if (a0 < T) { od[idx + 3] = 0; continue; }
        od[idx + 3] = isEdge(yy, xx) ? 128 : 255;
      }
    }
  }
  octx.putImageData(odata, 0, 0);
  return out;
};

export const initPreviewAnim = () => {
  const c = $('preview'); const ctx = c.getContext('2d');
  const pw = 128, ph = 64;
  const size = parseInt($('fontSize').value, 10);
  const text = $('text').value;
  const xGap = parseInt($('xGap').value, 10) || 0;
  const fam = getTextFontFamily();
  const color = $('color').value;
  const gradientSpec = $('textGradient').value;
  const thickness = getThickness();

  const key = [text, fam, size, xGap, color, gradientSpec, thickness].join('|');
  if (textBitmapKey !== key) {
    textBitmapCanvas = buildTextBitmap(text, fam, size, xGap, color, gradientSpec, thickness, true);
    textBitmapKey = key;
  }
  state.textW = textBitmapCanvas ? textBitmapCanvas.width : 0;
  state.textH = textBitmapCanvas ? textBitmapCanvas.height : 0;
  const gap = parseInt($('interval').value, 10) || 1;
  state.spacing = Math.max(1, state.textW + gap);
  const minCopies = Math.max(2, Math.ceil((pw + state.textW * 2) / state.spacing) + 1);
  state.heads = [];
  for (let i = 0; i < minCopies; i++) {
    if ($('dir').value === 'left') state.heads.push(pw + (i * state.spacing));
    else state.heads.push(-state.textW - (i * state.spacing));
  }
  state.lastTs = 0; state.accMs = 0;
};

export const drawPreviewFrame = (animated) => {
  const c = $('preview'); const ctx = c.getContext('2d');
  const pw = 128, ph = 64;
  const text = $('text').value; const size = parseInt($('fontSize').value, 10);
  const color = $('color').value; const bg = $('bg').value;
  c.width = pw; c.height = ph; ctx.clearRect(0,0,pw,ph); ctx.fillStyle = bg; ctx.fillRect(0,0,pw,ph);
  if ($('bgMode').value === 'image' && state.loadedImg) {
    const fit = $('imageFit').value; let dw = state.loadedImg.width, dh = state.loadedImg.height;
    if (fit === 'fill') { dw = pw; dh = ph; }
    else if (fit === 'fit') { const s = Math.min(pw/state.loadedImg.width, ph/state.loadedImg.height); dw = Math.max(1, Math.floor(state.loadedImg.width * s)); dh = Math.max(1, Math.floor(state.loadedImg.height * s)); }
    else { dw = Math.min(pw, state.loadedImg.width); dh = Math.min(ph, state.loadedImg.height); }
    const dx = Math.floor(pw * 0.5 - dw / 2); const dy = Math.floor(ph * 0.5 - dh / 2);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(state.loadedImg, dx, dy, dw, dh);
  }
  const cy = Math.floor(ph * 0.5) + 2; const fam = getTextFontFamily();
  const xGap = parseInt($('xGap').value, 10) || 0; const gradientSpec = $('textGradient').value; const thickness = getThickness();
  const key = [text, fam, size, xGap, color, gradientSpec, thickness].join('|');
  if (textBitmapKey !== key) { textBitmapCanvas = buildTextBitmap(text, fam, size, xGap, color, gradientSpec, thickness, true); textBitmapKey = key; }
  state.textW = textBitmapCanvas ? textBitmapCanvas.width : 0;
  if (animated && text.length > 0) {
    if (textBitmapCanvas) {
      state.heads.forEach(headX => {
        const xLeft = Math.floor(headX);
        if (xLeft >= -state.textW && xLeft <= pw) ctx.drawImage(textBitmapCanvas, xLeft, Math.floor(cy - Math.floor(textBitmapCanvas.height/2)));
      });
    }
  } else {
    if (textBitmapCanvas) {
      if (state.textW <= pw) ctx.drawImage(textBitmapCanvas, Math.floor((pw - state.textW) / 2), Math.floor(cy - Math.floor(textBitmapCanvas.height/2)));
      else ctx.drawImage(textBitmapCanvas, 0, Math.floor(cy - Math.floor(textBitmapCanvas.height/2)));
    }
  }
};

export const drawPreview = () => {
  const animate = $('animate').checked;
  if (animate && $('text').value.trim().length > 0) {
    cancelRaf('rafId');
    initPreviewAnim();
    drawPreviewFrame(true);
    const step = (ts) => {
      if (!state.lastTs) state.lastTs = ts; const dt = ts - state.lastTs; state.lastTs = ts; state.accMs += dt;
      const speed = parseInt($('speed').value, 10) || 50; const sign = $('dir').value === 'left' ? -1 : +1;
      const pxPerSec = speed; const pxThisFrame = (pxPerSec * dt) / 1000;
      for (let i = 0; i < state.heads.length; i++) state.heads[i] += sign * pxThisFrame;
      const pw = 128; const first = state.heads[0];
      if (sign < 0 && first <= -state.textW) state.heads.shift(), state.heads.push(state.heads[state.heads.length-1] + state.spacing);
      else if (sign > 0 && first >= pw) state.heads.shift(), state.heads.push(state.heads[state.heads.length-1] - state.spacing);
      drawPreviewFrame(true);
      state.rafId = requestAnimationFrame(step);
    };
    state.rafId = requestAnimationFrame(step);
  } else {
    cancelRaf('rafId');
    drawPreviewFrame(false);
  }
};

export const renderAndUpload = async () => {
  const c = $('preview'); const pw = 128, ph = 64;
  const animate = $('animate').checked; const dir = $('dir').value; const speed = parseInt($('speed').value, 10); const interval = parseInt($('interval').value, 10);
  // Upload background if needed
  if ($('bgMode').value === 'image' && state.loadedImg) {
    const outCanvas = document.createElement('canvas'); outCanvas.width = pw; outCanvas.height = ph;
    const octx = outCanvas.getContext('2d'); octx.imageSmoothingEnabled = false;
    const fit = $('imageFit').value; let dw = state.loadedImg.width, dh = state.loadedImg.height;
    if (fit === 'fill') { dw = pw; dh = ph; }
    else if (fit === 'fit') { const s = Math.min(pw/state.loadedImg.width, ph/state.loadedImg.height); dw = Math.max(1, Math.floor(state.loadedImg.width * s)); dh = Math.max(1, Math.floor(state.loadedImg.height * s)); }
    else { dw = Math.min(pw, state.loadedImg.width); dh = Math.min(ph, state.loadedImg.height); }
    const dx = Math.floor(pw*0.5 - dw/2); const dy = Math.floor(ph*0.5 - dh/2);
    octx.fillStyle = $('bg').value; octx.fillRect(0,0,pw,ph); octx.drawImage(state.loadedImg, dx, dy, dw, dh);
    const outBg = octx.getImageData(0,0,pw,ph);
    const bufBg = new Uint8Array(4 + pw*ph*2);
    bufBg[0]=pw&255; bufBg[1]=(pw>>8)&255; bufBg[2]=ph&255; bufBg[3]=(ph>>8)&255;
    let pb=4, db=outBg.data;
    for(let y=0;y<ph;y++) for(let x=0;x<pw;x++){
      const i=(y*pw+x)*4; const r=db[i], g=db[i+1], b=db[i+2]; const v=rgb565(r,g,b); bufBg[pb++]=v&255; bufBg[pb++]=(v>>8)&255;
    }
    const fdBg = new FormData(); fdBg.append('image', new Blob([bufBg], {type:'application/octet-stream'}), 'bg.rgb565');
    await fetch(apiBase + '/upload_bg', { method:'POST', body: fdBg });
  }
  // Text layer pack A8+RGB565
  let outCanvas = document.createElement('canvas');
  if ($('text').value.trim().length > 0) {
    const fam = getTextFontFamily(); const size = parseInt($('fontSize').value, 10);
    const xGap = parseInt($('xGap').value, 10) || 0; const font = `normal ${size}px ${fam}`; const text = $('text').value;
    const t = document.createElement('canvas'); const tctx = t.getContext('2d'); tctx.font = font; tctx.textBaseline='alphabetic'; tctx.textAlign='left';
    const textWidth = measureTextWithGap(tctx, text, xGap); const th = Math.max(1, Math.ceil(size * 1.2 + 8)); const tw = Math.max(1, Math.ceil(textWidth) + 8);
    t.width = tw; t.height = th; tctx.font = font; tctx.textBaseline='alphabetic'; tctx.textAlign='left';
    // Gradient or solid color
    const gradientSpec = $('textGradient').value;
    if (gradientSpec && gradientSpec !== 'none') {
      const gradientWidth = Math.max(20, Math.ceil(textWidth));
      let gradient;
      switch (gradientSpec) {
        case 'rainbow': gradient = tctx.createLinearGradient(0, 0, gradientWidth, 0); ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD'].forEach((c,i,a)=>gradient.addColorStop(i/(a.length-1),c)); break;
        case 'sunset': gradient = tctx.createLinearGradient(0, 0, gradientWidth, 0); gradient.addColorStop(0, '#FF512F'); gradient.addColorStop(1, '#F09819'); break;
        case 'ocean': gradient = tctx.createLinearGradient(0, 0, gradientWidth, 0); gradient.addColorStop(0, '#2E3192'); gradient.addColorStop(1, '#1BFFFF'); break;
        case 'forest': gradient = tctx.createLinearGradient(0, 0, gradientWidth, 0); gradient.addColorStop(0, '#134E5E'); gradient.addColorStop(1, '#71B280'); break;
        case 'fire': gradient = tctx.createLinearGradient(0, 0, gradientWidth, 0); gradient.addColorStop(0, '#FF416C'); gradient.addColorStop(1, '#FF4B2B'); break;
        case 'purple': gradient = tctx.createLinearGradient(0, 0, gradientWidth, 0); gradient.addColorStop(0, '#667eea'); gradient.addColorStop(1, '#764ba2'); break;
        default: gradient = $('color').value;
      }
      tctx.fillStyle = gradient;
    } else {
      tctx.fillStyle = $('color').value;
    }
    const baseY = Math.floor(size * 1.0);
    drawTextWithGap(tctx, text, 4, baseY, xGap);
    const img = tctx.getImageData(0,0,t.width,t.height); const bb = cropImageData(img.data, t.width, t.height);
    let outW = Math.max(1, bb.w), outH = Math.max(1, bb.h);
    outCanvas.width = outW; outCanvas.height = outH; outCanvas.getContext('2d').putImageData(new ImageData(img.data, t.width, t.height), -bb.x, -bb.y);
  } else { outCanvas.width = 1; outCanvas.height = 1; }
  const out = outCanvas.getContext('2d').getImageData(0,0,outCanvas.width,outCanvas.height);
  const outW = outCanvas.width, outH = outCanvas.height; const buf = new Uint8Array(4 + outW*outH*3);
  buf[0]=outW&255; buf[1]=(outW>>8)&255; buf[2]=outH&255; buf[3]=(outH>>8)&255; let p=4, d=out.data;
  for(let y=0;y<outH;y++) { for(let x=0;x<outW;x++){ const i=(y*outW+x)*4; const r=d[i], g=d[i+1], b=d[i+2], a=d[i+3]; const v=rgb565(r,g,b); buf[p++]=a; buf[p++]=v&255; buf[p++]=(v>>8)&255; }}
  const fd = new FormData();
  fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'img.rgb565');
  fd.append('bg', $('bg').value); fd.append('bgMode', $('bgMode').value); fd.append('offx', 0); fd.append('offy', 0);
  fd.append('animate', ( $('text').value.trim().length>0 && animate)?1:0);
  fd.append('brightness', parseInt($('brightness').value, 10)); fd.append('dir', dir); fd.append('speed', speed); fd.append('interval', interval);
  const res = await fetch(apiBase + '/upload', { method:'POST', body: fd });
  if(!res.ok){ alert('Upload failed: '+res.status); return; }
};

export const initTextFeature = () => {
  try { registerWebFonts(); } catch {}
};

