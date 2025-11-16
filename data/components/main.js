/* ===============================
   LED Config — Refactored Script
   =============================== */

(() => {
  // ========= Helpers / DOM =========
  const $ = (id) => document.getElementById(id);
  const c = $('preview');
  const ctx = c.getContext('2d');

  // API base
  const apiBase = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
    ? 'http://192.168.4.1'
    : '';

  // Global state
  let loadedImg = null;
  let rafId = 0, lastTs = 0, accMs = 0, spacing = 0, textW = 0, textH = 0;
  let heads = [];
  let clockPreviewTimer = 0;
  let clockTimer = 0;
  let youtubeTimer = 0;
  let youtubeLastCount = null;
  let ytIconImg = null;
  let ytIconImgReady = false;
  let youtubeAnimTimer = 0; // no longer used for URL themes (kept for compatibility)
  let youtubePreviewTimer = 0;
  let selectedThemeId = '';
  // GIF decode + animation state (gifuct-js)
  let gifFrames = [];
  let gifDelays = [];
  let gifLogicalW = 0, gifLogicalH = 0;
  let gifFrameIndex = 0;
  let gifAnimTimer = 0; // LED streaming loop (GIF frames)
  let gifOffscreen = null; // canvas to build frame to image
  let ledOffscreen = null; // 128x64 offscreen for LED composition

  const stopGifAnimation = () => { if (gifAnimTimer) { clearTimeout(gifAnimTimer); gifAnimTimer = 0; } };
  let videoEl = null;
  let videoPreviewRaf = 0;
  let videoUploadActive = false;
  let videoUploadLastMs = 0;
  let videoUploadIntervalMs = 100;
  let videoUploadInFlight = false;

  // Theme file storage
  let originalThemeContent = '';
  let currentThemeFileName = '';

  // ========= Utils =========
  const getPreviewCanvas = () => {
    let pv = $('preview');
    if (!pv) {
      const holder = $('previewInner') || document.body;
      pv = document.createElement('canvas');
      pv.id = 'preview'; pv.width = 128; pv.height = 64; pv.style.background = '#000';
      pv.style.border = '1px solid #243241';
      holder.appendChild(pv);
    }

    // Replace with crisp text bitmap (binary alpha + thickness)
    if ($('text').value.trim().length > 0) {
      const fam = getTextFontFamily();
      const size = parseInt($('fontSize').value, 10);
      const xGap = parseInt($('xGap').value, 10) || 0;
      const color = $('color').value;
      const gradientSpec = $('textGradient').value;
      const thickness = getThickness();
      outCanvas = buildTextBitmap($('text').value, fam, size, xGap, color, gradientSpec, thickness, false);
      console.log(`Crisp text bitmap ready: ${outCanvas.width}x${outCanvas.height}, thickness=${thickness}`);
    }
    return pv;
  };

  const rgb565 = (r, g, b) => ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | ((b) >> 3);

  // Arduino-style map function for JavaScript
  const map = (value, inMin, inMax, outMin, outMax) => {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
  };

  const cropImageData = (img, w, h) => {
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

  // Base fallback fonts
  const fallbackFonts = `'Noto Sans Khmer', 'Khmer OS Content', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', system-ui, Arial, sans-serif`;

  // Existing usage in non-Text features (YouTube/others) keeps fallback
  const getFontFamily = () => fallbackFonts;

  // Text tab font selection
  const getTextFontFamily = () => {
    const sel = document.getElementById('fontFamilySelect');
    const choice = sel ? sel.value : 'default';
    if (choice && choice !== 'default') return `'${choice}', ${fallbackFonts}`;
    return fallbackFonts;
  };

  // Fonts bundled under data/fonts
  const availableFonts = [
    { name: 'Battambang', file: 'fonts/Battambang-Regular.ttf' },
    { name: 'Bokor', file: 'fonts/Bokor-Regular.ttf' },
    { name: 'Moul', file: 'fonts/Moul-Regular.ttf' },
    { name: 'Dangrek', file: 'fonts/Dangrek-Regular.ttf' }
  ];

  const registerWebFonts = () => {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = availableFonts.map(f => `@font-face { font-family: '${f.name}'; src: url('${f.file}') format('truetype'); font-weight: normal; font-style: normal; font-display: swap; }`).join('\n');
    document.head.appendChild(style);
  };

  // ========= Crisp Text Rendering (Binary mask + dilation) =========
  // Edge smoothing configuration
  const TEXT_ALPHA_THRESHOLD = 16; // floor (removes speckles) but keeps anti-alias
  const ALPHA_GAMMA = 1.3;        // <1 brightens edges, >1 darkens
  const ALPHA_MULT = 1.0;         // overall scale
  let textBitmapCanvas = null;
  let textBitmapKey = '';

  const getThickness = () => parseInt(($('fontThickness') && $('fontThickness').value) || '0', 10) || 0;

  const hexToRgb = (hex) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r:255,g:255,b:255 };
  };

  const isComplexKhmer = (text) => /[\u1780-\u17FF\u19E0-\u19FF]/.test(text);
  const isKhmerFontSelected = () => {
    const sel = document.getElementById('fontFamilySelect');
    const v = sel ? (sel.value || '').toLowerCase() : '';
    return v.includes('battambang') || v.includes('bokor') || v.includes('moul') || v.includes('dangrek');
  };

  const drawTextLineToCanvas = (canvas, text, fam, size, color, xGap, gradientSpec) => {
    const tctx = canvas.getContext('2d');
    let px = parseInt(size, 10);
    if (!Number.isFinite(px) || px <= 0) px = 17;
    const font = `normal ${px}px ${fam}`;
    tctx.font = font; tctx.textBaseline = 'alphabetic'; tctx.textAlign = 'left';

    // Determine rendering mode: per-character (Latin) vs per-token (Khmer)
    const complex = isComplexKhmer(text) || isKhmerFontSelected();

    // Measure width
    let textWidth = 0;
    if (!complex) {
      textWidth = measureTextWithGap(tctx, text, xGap);
    } else {
      // Only add extra spacing between whitespace tokens to preserve shaping
      const parts = text.split(/(\s+)/);
      for (const part of parts) {
        if (part.length === 0) continue;
        if (/^\s+$/.test(part)) {
          textWidth += tctx.measureText(part).width + xGap; // apply xGap on spaces only
        } else {
          textWidth += tctx.measureText(part).width;
        }
      }
    }
    const thRaw = Math.ceil(px * 1.2 + 8);
    const th = Number.isFinite(thRaw) && thRaw > 0 ? thRaw : 1;
    const twRaw = Math.ceil(textWidth) + 8;
    const tw = Number.isFinite(twRaw) && twRaw > 0 ? twRaw : 1;
    canvas.width = tw; canvas.height = th;
    tctx.font = font; tctx.textBaseline = 'alphabetic'; tctx.textAlign = 'left';

    // Prepare fill style (solid or gradient)
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
      const arr = gradients[gradientSpec] || [color];
      for (let i = 0; i < arr.length; i++) grad.addColorStop(i/(arr.length-1 || 1), arr[i]);
      tctx.fillStyle = grad;
    } else {
      tctx.fillStyle = color;
    }

    // Draw text
    let currentX = 4; // small left pad
    const baseY = Math.floor(px * 1.0);
    if (!complex) {
      // per-character without snapping X to keep anti-alias smooth
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        tctx.fillText(ch, currentX, baseY);
        const cw = tctx.measureText(ch).width;
        currentX += cw + (i < text.length - 1 ? xGap : 0);
        if (ch === ' ' && xGap < 3) currentX += (3 - xGap);
      }
    } else {
      // per-token (whitespace separated) to preserve complex shaping
      const parts = text.split(/(\s+)/);
      for (const part of parts) {
        if (part.length === 0) continue;
        if (/^\s+$/.test(part)) {
          currentX += (tctx.measureText(part).width + xGap);
        } else {
          tctx.fillText(part, currentX, baseY);
          currentX += tctx.measureText(part).width;
        }
      }
    }
  };

  const buildTextBitmap = (text, fam, size, xGap, color, gradientSpec, thickness, forPreview=false) => {
    // Step 1: draw smooth text to temp canvas
    const src = document.createElement('canvas');
    drawTextLineToCanvas(src, text, fam, size, color, xGap, gradientSpec);

    // Step 2: read alpha channel for smoothing pipeline
    const sctx = src.getContext('2d');
    const sdata = sctx.getImageData(0, 0, src.width, src.height);
    const d = sdata.data; // RGBA
    const w = src.width, h = src.height;
    let alpha = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) alpha[p] = d[i+3];

    // Step 3: thicken by max filter in alpha space (preserves anti-aliased edges)
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
    for (let k = 0; k < Math.max(0, thickness); k++) thickAlpha = maxFilterOnce(thickAlpha);

    // Note: no blur; we will produce crisp interior + controlled edge alpha

    // Step 4: crop bounding box
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (thickAlpha[y * w + x] >= TEXT_ALPHA_THRESHOLD) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < minX || maxY < minY) { const empty = document.createElement('canvas'); empty.width=1; empty.height=1; return empty; }
    const outW = Math.max(1, maxX - minX + 1);
    const outH = Math.max(1, maxY - minY + 1);

    // Step 5: build colored output with binary alpha
    const out = document.createElement('canvas'); out.width = outW; out.height = outH;
    const octx = out.getContext('2d');

    // Fill color/gradient on output, then apply alpha mask
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
    // No outline coloring here; text color/gradient already filled; we only set alpha
    if (forPreview) {
      const remapAlpha = (a) => {
        const x = Math.max(0, Math.min(1, a / 255));
        let y = Math.pow(x, ALPHA_GAMMA) * 255 * ALPHA_MULT;
        if (y < TEXT_ALPHA_THRESHOLD) y = 0; // remove tiny speckles
        return y > 255 ? 255 : y;
      };
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const aBase = thickAlpha[(y + minY) * w + (x + minX)];
          const idx = (y * outW + x) * 4;
          od[idx + 3] = remapAlpha(aBase);
        }
      }
    } else {
      // LED upload: preserve smooth alpha for beautiful rendering on device
      const remapAlpha = (a) => {
        const x = Math.max(0, Math.min(1, a / 255));
        let y = Math.pow(x, ALPHA_GAMMA) * 255 * ALPHA_MULT;
        if (y < TEXT_ALPHA_THRESHOLD) y = 0; // remove tiny speckles
        return y > 255 ? 255 : y;
      };
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const yy = y + minY, xx = x + minX;
          const idx = (y * outW + x) * 4;
          const a0 = thickAlpha[yy * w + xx];
          od[idx + 3] = remapAlpha(a0);
        }
      }
    }
    octx.putImageData(odata, 0, 0);

    return out;
  };

  // ========= Stop / Cleanup =========
  const stopPreviewAnim = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; };
  const stopClockPreview = () => { if (clockPreviewTimer) clearInterval(clockPreviewTimer); clockPreviewTimer = 0; };
  const stopVideoPreview = () => { if (videoPreviewRaf) cancelAnimationFrame(videoPreviewRaf); videoPreviewRaf = 0; };

  const stopThemeTimers = () => {
    if (window.__themeTimer) { clearInterval(window.__themeTimer); window.__themeTimer = null; }
    if (window.__playTimer) { clearInterval(window.__playTimer); window.__playTimer = null; }
  };

  const stopAllRunningContent = () => {
    stopPreviewAnim();
    stopClockPreview();
    if (clockTimer) { cancelAnimationFrame(clockTimer); clockTimer = 0; }
    stopVideoPreview(); videoUploadActive = false; videoUploadInFlight = false;
    stopThemeTimers();
    if (youtubeTimer) { clearInterval(youtubeTimer); youtubeTimer = 0; }
  };

  // Universal function to stop all modes on ESP32 and browser
  const stopAllModes = async () => {
    console.log('🛑 Stopping all modes before starting new one...');

    // Stop browser-side activities
    stopAllRunningContent();
    stopThemeStreaming();

    // Stop ESP32 modes
    try {
      await Promise.all([
        fetch(apiBase + '/stop_clock', { method: 'POST' }),
        fetch(apiBase + '/stop_theme', { method: 'POST' })
      ]);
      console.log('✅ All modes stopped successfully');
    } catch (error) {
      console.warn('⚠️ Failed to stop some modes:', error);
    }
  };

  const stopContentForPreview = () => {
    stopPreviewAnim();
    stopClockPreview();
    stopVideoPreview(); videoUploadActive = false; videoUploadInFlight = false;
    if (window.__themeTimer) { clearInterval(window.__themeTimer); window.__themeTimer = null; }
  };

  // ========= Text Preview =========
  const initPreviewAnim = () => {
    const pw = 128, ph = 64;
    const size = parseInt($('fontSize').value, 10);
    const text = $('text').value;
    const xGap = parseInt($('xGap').value, 10) || 0;
    const fam = getTextFontFamily();
    const color = $('color').value;
    const gradientSpec = $('textGradient').value;
    const thickness = getThickness();
    // Build crisp text bitmap for animation
    const key = [text, fam, size, xGap, color, gradientSpec, thickness].join('|');
    if (textBitmapKey !== key) {
      textBitmapCanvas = buildTextBitmap(text, fam, size, xGap, color, gradientSpec, thickness, true);
      textBitmapKey = key;
    }

    textW = textBitmapCanvas ? textBitmapCanvas.width : 0;
    textH = textBitmapCanvas ? textBitmapCanvas.height : 0;
    const gap = parseInt($('interval').value, 10) || 1;
    spacing = Math.max(1, textW + gap);

    // For long text, ensure we have enough copies to fill the screen
    // Total copies needed = screen width / text width + buffer
    const minCopies = Math.max(2, Math.ceil((pw + textW * 2) / spacing) + 1);
    heads = [];
    for (let i = 0; i < minCopies; i++) {
      if ($('dir').value === 'left') heads.push(pw + (i * spacing));
      else heads.push(-textW - (i * spacing));
    }
    lastTs = 0; accMs = 0;

    console.log(`Text animation initialized: "${text}" width=${textW}px, height=${textH}px, spacing=${spacing}, copies=${minCopies}, xGap=${xGap}, thickness=${thickness}`);
  };

  const drawTextWithGap = (ctx, text, x, y, gap) => {
    if (gap === 0) {
      // No gap, use normal fillText for performance
      ctx.fillText(text, x, y);
      return;
    }

    // Draw text character by character with gaps
    let currentX = x;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      ctx.fillText(char, currentX, y);
      const charWidth = ctx.measureText(char).width;
      currentX += charWidth + gap;
      // Add space between words automatically for better readability
      if (char === ' ' && gap < 3) {
        currentX += (3 - gap); // Ensure minimum word spacing
      }
    }
  };

  const measureTextWithGap = (ctx, text, gap) => {
    if (gap === 0) {
      return ctx.measureText(text).width;
    }

    // Calculate text width with character gaps
    let totalWidth = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      totalWidth += ctx.measureText(char).width;
      if (i < text.length - 1) {
        totalWidth += gap;
        // Add extra spacing for words when gap is small
        if (char === ' ' && gap < 3) {
          totalWidth += (3 - gap); // Ensure minimum word spacing
        }
      }
    }
    return totalWidth;
  };

  // Clock-specific: flat measurement without extra word spacing; allows negative gap
  const measureTextWithGapFlat = (ctx, text, gap) => {
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      total += ctx.measureText(text[i]).width;
      if (i < text.length - 1) total += gap;
    }
    return total;
  };

  // Clock-specific: draw each character with fixed gap (can be negative), no special space boost
  const drawTextWithGapFlat = (ctx, text, x, y, gap) => {
    let cx = x;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      ctx.fillText(ch, cx, y);
      const w = ctx.measureText(ch).width;
      cx += w + (i < text.length - 1 ? gap : 0);
    }
  };

  const drawPreviewFrame = (animated) => {
    const text = $('text').value;
    const size = parseInt($('fontSize').value, 10);
    const color = $('color').value;
    const bg = $('bg').value;
    const pw = 128, ph = 64;

    c.width = pw; c.height = ph;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);

    if ($('bgMode').value === 'image' && loadedImg) {
      const fit = $('imageFit').value;
      let dw = loadedImg.width, dh = loadedImg.height;
      if (fit === 'fill') { dw = pw; dh = ph; }
      else if (fit === 'fit') {
        const s = Math.min(pw / loadedImg.width, ph / loadedImg.height);
        dw = Math.max(1, Math.floor(loadedImg.width * s));
        dh = Math.max(1, Math.floor(loadedImg.height * s));
      } else { dw = Math.min(pw, loadedImg.width); dh = Math.min(ph, loadedImg.height); }
      const dx = Math.floor(pw * 0.5 - dw / 2);
      const dy = Math.floor(ph * 0.5 - dh / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(loadedImg, dx, dy, dw, dh);
    }

    const cy = Math.floor(ph * 0.5) + 2;
    const fam = getTextFontFamily();
    const xGap = parseInt($('xGap').value, 10) || 0;
    const gradientSpec = $('textGradient').value;
    const thickness = getThickness();
    const frameStyle = ($('outlineStyle') && $('outlineStyle').value) || 'none';
    const key = [text, fam, size, xGap, color, gradientSpec, thickness].join('|');
    if (textBitmapKey !== key) {
      textBitmapCanvas = buildTextBitmap(text, fam, size, xGap, color, gradientSpec, thickness, true);
      textBitmapKey = key;
    }
    textW = textBitmapCanvas ? textBitmapCanvas.width : 0;

    // Draw frame on top of background but below text
    if (frameStyle && frameStyle !== 'none') {
      drawFrameOnCanvas(ctx, frameStyle, color, pw, ph);
    }

    if (animated && text.length > 0) {
      if (textBitmapCanvas) {
        heads.forEach(headX => {
          const xLeft = Math.floor(headX);
          if (xLeft >= -textW && xLeft <= pw) {
            ctx.drawImage(textBitmapCanvas, xLeft, Math.floor(cy - Math.floor(textBitmapCanvas.height/2)));
          }
        });
      }
    } else {
      if (textBitmapCanvas) {
        if (textW <= pw) {
          ctx.drawImage(textBitmapCanvas, Math.floor((pw - textW)/2), Math.floor(cy - Math.floor(textBitmapCanvas.height/2)));
        } else {
          // simple center crop for preview
          const sx = Math.max(0, Math.floor(textW/2 - pw/2));
          ctx.drawImage(textBitmapCanvas, sx, 0, Math.min(pw, textW - sx), textBitmapCanvas.height,
            0, Math.floor(cy - Math.floor(textBitmapCanvas.height/2)), Math.min(pw, textW - sx), textBitmapCanvas.height);
        }
      }
    }
  };

  // Draw a frame around the panel edges
  const drawFrameOnCanvas = (ctx, style, color, pw=128, ph=64) => {
    const { r, g, b } = hexToRgb(color || '#FFFFFF');
    const base = `rgb(${r},${g},${b})`;
    if (style === 'border') {
      ctx.save();
      ctx.strokeStyle = base;
      ctx.lineWidth = 1;
      // Draw on the last pixel (outermost edge): 0.5 aligns the 1px stroke on device pixels
      ctx.strokeRect(0.5, 0.5, pw-1, ph-1);
      ctx.restore();
    } else if (style === 'neon') {
      ctx.save();
      // Outer bright edge on last pixel
      ctx.strokeStyle = base;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, pw-1, ph-1);
      // Inset glow rings (inside the edge): 1.5, 2.5, 3.5
      const rings = [
        { inset: 1, a: 0.35 },
        { inset: 2, a: 0.20 },
        { inset: 3, a: 0.10 }
      ];
      rings.forEach(({ inset, a }) => {
        ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
        ctx.lineWidth = 1;
        ctx.strokeRect( inset + 0.5, inset + 0.5, pw - 2*inset - 1, ph - 2*inset - 1 );
      });
      ctx.restore();
    }
  };

  const animatePreview = (ts) => {
    if (!$('animate').checked || $('text').value.trim().length === 0) {
      stopPreviewAnim(); drawPreviewFrame(false); return;
    }
    if (!lastTs) lastTs = ts;
    // Apply same aggressive speed mapping as ESP32: higher percentage = faster animation
    const speedPercent = parseInt($('speed').value, 10) || 80;

    // Aggressive speed mapping matching ESP32
    let targetMs;
    if (speedPercent == 10) {
      targetMs = 50;    // 0.5x of 100% speed (20 FPS)
    } else if (speedPercent == 20) {
      targetMs = 25;    // Same as current 100% speed (40 FPS)
    } else if (speedPercent == 40) {
      targetMs = 17;    // 1.5x faster than current 100% (59 FPS)
    } else if (speedPercent == 60) {
      targetMs = 13;    // 2x faster than current 100% (77 FPS)
    } else if (speedPercent == 80) {
      targetMs = 8;     // 3.5x faster than current 100% (125 FPS)
    } else if (speedPercent == 100) {
      targetMs = 6;     // 4x faster than current 100% (167 FPS)
    } else {
      // Linear interpolation between specific points
      targetMs = map(speedPercent, 10, 100, 50, 6);
    }

    // Ensure minimum delay for browser stability
    const actualSpeed = Math.max(6, Math.round(targetMs));
    accMs += (ts - lastTs); lastTs = ts;

    const pw = 128;
    while (accMs >= actualSpeed) {
      accMs -= actualSpeed;
      if ($('dir').value === 'left') {
        heads = heads.map(h => h - 1);
        heads.forEach((head, i) => { if (head + textW <= 0) heads[i] = Math.max(...heads) + spacing; });
      } else {
        heads = heads.map(h => h + 1);
        heads.forEach((head, i) => { if (head >= pw) heads[i] = Math.min(...heads) - spacing; });
      }
    }
    drawPreviewFrame(true);
    rafId = requestAnimationFrame(animatePreview);
  };

  // ========= Clock =========
  const formatTime = (fmt) => {
    const d = new Date();
    let h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    if (fmt === '12') {
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ${ampm}`;
    }
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const drawClockPreviewFrame = () => {
    const pw = 128, ph = 64;
    const fmt = '24';
    const size = parseInt($('clockSize').value, 10);
    const fam = getTextFontFamily();
    const font = `normal ${size}px ${fam}`;
    const col = $('clockColor').value;
    const clockBg = $('clockBgColor').value;

    c.width = pw; c.height = ph;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = clockBg; ctx.fillRect(0, 0, pw, ph);

    if ($('bgMode').value === 'image' && loadedImg) {
      const fit = $('imageFit').value;
      let dw = loadedImg.width, dh = loadedImg.height;
      if (fit === 'fill') { dw = pw; dh = ph; }
      else if (fit === 'fit') {
        const s = Math.min(pw / loadedImg.width, ph / loadedImg.height);
        dw = Math.max(1, Math.floor(loadedImg.width * s));
        dh = Math.max(1, Math.floor(loadedImg.height * s));
      } else { dw = Math.min(pw, loadedImg.width); dh = Math.min(ph, loadedImg.height); }
      const dx = Math.floor(pw * 0.5 - dw / 2);
      const dy = Math.floor(ph * 0.5 - dh / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(loadedImg, dx, dy, dw, dh);
    }

    // Optional frame under text
    const clockFrame = ($('clockFrameStyle') && $('clockFrameStyle').value) || 'none';
    if (clockFrame !== 'none') {
      drawFrameOnCanvas(ctx, clockFrame, col, pw, ph);
    }
    ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = col;
    const txt = formatTime(fmt);
    // Adjust vertical position based on font size for better centering
    let yOffset = Math.floor(ph * 0.5);
    if (size <= 15) {
      yOffset -= 2; // Shift up for very small text
    } else if (size <= 20) {
      yOffset -= 1; // Shift up slightly for small text
    }
    const gap = parseInt(($('clockXGap') && $('clockXGap').value) || '0', 10) || 0;
    // Center horizontally with selected gap
    const totalW = measureTextWithGapFlat(ctx, txt, gap);
    const x0 = Math.floor((pw - totalW) / 2);
    drawTextWithGapFlat(ctx, txt, x0, yOffset, gap);
  };

  const startClockPreview = () => {
    if (clockPreviewTimer) clearInterval(clockPreviewTimer);
    drawClockPreviewFrame();
    // Update every 100ms for very smooth preview updates (won't affect ESP32 timing)
    clockPreviewTimer = setInterval(drawClockPreviewFrame, 100);
  };

  const renderAndUploadClock = async () => {
    stopPreviewAnim(); stopVideoPreview(); stopThemeTimers();

    const pw = 128, ph = 64;
    const fmt = '24';
    const size = parseInt($('clockSize').value, 10);
    const fam = getTextFontFamily();
    const font = `normal ${size}px ${fam}`;
    const col = $('clockColor').value;
    const clockBg = $('clockBgColor').value;

    const t = document.createElement('canvas'); t.width = pw; t.height = ph;
    const tctx = t.getContext('2d');
    tctx.fillStyle = clockBg; tctx.fillRect(0, 0, pw, ph);
    const clockFrame = ($('clockFrameStyle') && $('clockFrameStyle').value) || 'none';
    if (clockFrame !== 'none') {
      drawFrameOnCanvas(tctx, clockFrame, col, pw, ph);
    }
    tctx.font = font; tctx.textBaseline = 'middle'; tctx.textAlign = 'left'; tctx.fillStyle = col;

    // Get precise current time once to avoid timing drift
    const now = new Date();
    let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    const txt = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

    // Adjust vertical position based on font size for better centering
    let yOffset = Math.floor(ph * 0.5);
    if (size <= 15) {
      yOffset -= 2; // Shift up for very small text
    } else if (size <= 20) {
      yOffset -= 1; // Shift up slightly for small text
    }
    const gap = parseInt(($('clockXGap') && $('clockXGap').value) || '0', 10) || 0;
    // Center horizontally with selected gap (match preview)
    const totalW = measureTextWithGapFlat(tctx, txt, gap);
    const cx = Math.floor((pw - totalW) / 2);
    drawTextWithGapFlat(tctx, txt, cx, yOffset, gap);

    const out = tctx.getImageData(0, 0, pw, ph);
    const buf = new Uint8Array(4 + pw * ph * 2);
    buf[0] = pw & 255; buf[1] = (pw >> 8) & 255; buf[2] = ph & 255; buf[3] = (ph >> 8) & 255;
    let p = 4, d = out.data;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4; const r = d[i], g = d[i + 1], b = d[i + 2];
      const v = rgb565(r, g, b);
      buf[p++] = v & 255; buf[p++] = (v >> 8) & 255;
    }

    const fd = new FormData();
    fd.append('image', new Blob([buf], { type: 'application/octet-stream' }), 'clock.rgb565');
    fd.append('bg', clockBg);
    fd.append('bgMode', 'color');
    fd.append('offx', 0);
    fd.append('offy', 0);
    fd.append('animate', 0);
    fd.append('dir', 'none');
    fd.append('speed', 0);
    fd.append('interval', 0);

    // Use smaller timeout to avoid blocking
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 500); // 500ms timeout

    try {
      await fetch(apiBase + '/upload', {
        method: 'POST',
        body: fd,
        signal: controller.signal
      });
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.log('Clock upload error:', error.message);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const startSmoothClockTimer = () => {
    let lastUploadTime = 0;
    const UPLOAD_INTERVAL = 1000; // Exact 1 second for perfect timing
    let nextUploadTime = performance.now() + UPLOAD_INTERVAL;

    const updateClock = async (timestamp) => {
      const now = performance.now();

      // Always update preview for smoothness
      if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();

      // Use precise timing to avoid double-counting
      if (now >= nextUploadTime) {
        lastUploadTime = now;
        nextUploadTime = now + UPLOAD_INTERVAL;
        try {
          await renderAndUploadClock();
        } catch (error) {
          console.log('Clock upload error:', error);
        }
      }
      if (clockTimer) clockTimer = requestAnimationFrame(updateClock);
    };

    clockTimer = requestAnimationFrame(updateClock);
  };

  // ========= Video =========
  const drawVideoPreviewFrame = () => {
    if (!videoEl) return;
    const pw = 128, ph = 64;
    const bg = $('bg').value;

    c.width = pw; c.height = ph;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, pw, ph);

    const fit = $('videoFit') ? $('videoFit').value : 'fit';
    let dw = videoEl.videoWidth || pw, dh = videoEl.videoHeight || ph;
    if (fit === 'fill') { dw = pw; dh = ph; }
    else if (fit === 'fit') {
      const s = Math.min(pw / (dw || 1), ph / (dh || 1));
      dw = Math.max(1, Math.floor(dw * s)); dh = Math.max(1, Math.floor(dh * s));
    } else { dw = Math.min(pw, dw); dh = Math.min(ph, dh); }
    const dx = Math.floor(pw * 0.5 - dw / 2);
    const dy = Math.floor(ph * 0.5 - dh / 2);
    try { ctx.drawImage(videoEl, dx, dy, dw, dh); } catch {}
  };

  const videoPreviewLoop = (ts) => {
    drawVideoPreviewFrame();
    if (videoUploadActive && !videoUploadInFlight) {
      if (!videoUploadLastMs) videoUploadLastMs = ts || performance.now();
      const now = ts || performance.now();
      if (now - videoUploadLastMs >= videoUploadIntervalMs) {
        videoUploadLastMs = now;
        uploadVideoFrame(true);
      }
    }
    videoPreviewRaf = requestAnimationFrame(videoPreviewLoop);
  };

  const startVideoPreview = () => {
    if (!videoEl || videoEl.readyState < 2) return;
    if (videoPreviewRaf) cancelAnimationFrame(videoPreviewRaf);
    videoPreviewRaf = requestAnimationFrame(videoPreviewLoop);
  };

  const uploadVideoFrame = async (nonBlocking) => {
    if (!videoEl) return;
    const pw = 128, ph = 64;

    const t = document.createElement('canvas'); t.width = pw; t.height = ph;
    const tctx = t.getContext('2d');
    const bg = $('bg').value; tctx.fillStyle = bg; tctx.fillRect(0, 0, pw, ph);

    const fit = $('videoFit') ? $('videoFit').value : 'fit';
    let dw = videoEl.videoWidth || pw, dh = videoEl.videoHeight || ph;
    if (fit === 'fill') { dw = pw; dh = ph; }
    else if (fit === 'fit') {
      const s = Math.min(pw / (dw || 1), ph / (dh || 1));
      dw = Math.max(1, Math.floor(dw * s)); dh = Math.max(1, Math.floor(dh * s));
    } else { dw = Math.min(pw, dw); dh = Math.min(ph, dh); }
    const dx = Math.floor(pw * 0.5 - dw / 2);
    const dy = Math.floor(ph * 0.5 - dh / 2);
    try { tctx.drawImage(videoEl, dx, dy, dw, dh); } catch { return; }

    const out = tctx.getImageData(0, 0, pw, ph);
    const buf = new Uint8Array(4 + pw * ph * 2);
    buf[0] = pw & 255; buf[1] = (pw >> 8) & 255; buf[2] = ph & 255; buf[3] = (ph >> 8) & 255;
    let p = 4, d = out.data;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const v = rgb565(r, g, b);
      buf[p++] = v & 255; buf[p++] = (v >> 8) & 255;
    }

    const fd = new FormData();
    fd.append('image', new Blob([buf], { type: 'application/octet-stream' }), 'video.rgb565');
    fd.append('bg', bg);
    fd.append('bgMode', 'color');
    fd.append('offx', 0);
    fd.append('offy', 0);
    fd.append('animate', 0);
    fd.append('dir', 'left');
    fd.append('speed', 20);
    fd.append('interval', 5);

    try {
      if (nonBlocking) {
        videoUploadInFlight = true;
        fetch(apiBase + '/upload', { method: 'POST', body: fd }).finally(() => { videoUploadInFlight = false; });
      } else {
        await fetch(apiBase + '/upload', { method: 'POST', body: fd });
      }
    } catch { videoUploadInFlight = false; }
  };

  // ========= Main Draw =========
  const drawPreview = () => {
    const videoMode = !$('videoConfig').classList.contains('hidden');
    const clockMode = !$('clockConfig').classList.contains('hidden');
    const textMode = !$('textConfig').classList.contains('hidden');
    const youtubeMode = !$('youtubeConfig').classList.contains('hidden');

    if (videoMode) {
      stopPreviewAnim(); drawVideoPreviewFrame();
    } else if (clockMode) {
      stopPreviewAnim(); drawClockPreviewFrame();
      if (clockPreviewTimer) clearInterval(clockPreviewTimer);
      clockPreviewTimer = setInterval(drawClockPreviewFrame, 1000);
    } else if (youtubeMode) {
      stopPreviewAnim(); drawYoutubePreviewFrame();
    } else if (textMode && $('animate').checked && $('text').value.trim().length > 0) {
      stopPreviewAnim(); initPreviewAnim(); drawPreviewFrame(true); rafId = requestAnimationFrame(animatePreview);
    } else {
      stopPreviewAnim(); drawPreviewFrame(false);
    }
  };

  // ========= Tabs =========
  const initTabs = () => {
    const tabText = $('tabText');
    const tabClock = $('tabClock');
    const tabVideo = $('tabVideo');
    const tabWifi = $('tabWifi');
    const tabYoutube = $('tabYoutube');

    const textCfg = $('textConfig');
    const clockCfg = $('clockConfig');
    const videoCfg = $('videoConfig');
    const wifiCfg = $('wifiConfig');
    const youtubeCfg = $('youtubeConfig');

    const activate = (which) => {
      // Tabs visual
      [tabText, tabClock, tabVideo, tabWifi, tabYoutube].forEach(btn => btn && btn.classList.remove('active'));
      // Sections hide/show
      [textCfg, clockCfg, videoCfg, wifiCfg, youtubeCfg].forEach(el => el && el.classList.add('hidden'));

      if (which === 'text') { tabText.classList.add('active'); textCfg.classList.remove('hidden'); }
      if (which === 'clock') { tabClock.classList.add('active'); clockCfg.classList.remove('hidden'); }
      if (which === 'video') { tabVideo.classList.add('active'); videoCfg.classList.remove('hidden'); }
      if (which === 'wifi') { tabWifi.classList.add('active'); wifiCfg.classList.remove('hidden'); }
      if (which === 'youtube') { tabYoutube.classList.add('active'); youtubeCfg.classList.remove('hidden'); drawYoutubePreviewFrame(); if (youtubePreviewTimer) clearInterval(youtubePreviewTimer); youtubePreviewTimer = setInterval(() => { if (!$('youtubeConfig').classList.contains('hidden')) drawYoutubePreviewFrame(); }, 67); }
    };

    tabText.addEventListener('click', () => {
      stopThemeStreaming(); // Auto-stop when switching away from theme
      if (youtubeTimer) { clearInterval(youtubeTimer); youtubeTimer = 0; }
      if (youtubeAnimTimer) { clearInterval(youtubeAnimTimer); youtubeAnimTimer = 0; }
      if (youtubePreviewTimer) { clearInterval(youtubePreviewTimer); youtubePreviewTimer = 0; }
      stopGifAnimation();
      const overlay = document.getElementById('ytPreviewImg'); if (overlay) overlay.style.display='none';
      activate('text');
    });
    tabClock.addEventListener('click', () => {
      stopThemeStreaming(); // Auto-stop when switching away from theme
      if (youtubeTimer) { clearInterval(youtubeTimer); youtubeTimer = 0; }
      if (youtubeAnimTimer) { clearInterval(youtubeAnimTimer); youtubeAnimTimer = 0; }
      if (youtubePreviewTimer) { clearInterval(youtubePreviewTimer); youtubePreviewTimer = 0; }
      stopGifAnimation();
      const overlay = document.getElementById('ytPreviewImg'); if (overlay) overlay.style.display='none';
      activate('clock');
    });
    tabVideo.addEventListener('click', () => {
      stopThemeStreaming(); // Auto-stop when switching away from theme
      if (youtubeTimer) { clearInterval(youtubeTimer); youtubeTimer = 0; }
      if (youtubeAnimTimer) { clearInterval(youtubeAnimTimer); youtubeAnimTimer = 0; }
      if (youtubePreviewTimer) { clearInterval(youtubePreviewTimer); youtubePreviewTimer = 0; }
      stopGifAnimation();
      const overlay = document.getElementById('ytPreviewImg'); if (overlay) overlay.style.display='none';
      activate('video');
    });
    if (tabWifi) tabWifi.addEventListener('click', () => { if (youtubeTimer) { clearInterval(youtubeTimer); youtubeTimer = 0; } if (youtubeAnimTimer) { clearInterval(youtubeAnimTimer); youtubeAnimTimer = 0; } if (youtubePreviewTimer) { clearInterval(youtubePreviewTimer); youtubePreviewTimer = 0; } stopGifAnimation(); const overlay = document.getElementById('ytPreviewImg'); if (overlay) overlay.style.display='none'; activate('wifi'); });
    if (tabYoutube) tabYoutube.addEventListener('click', () => activate('youtube'));

    // default
    activate('text');

    // Theme feature removed
  };

  // ========= WiFi =========
  const setWifiStatus = (text, ok=false) => {
    const el = $('wifiStatus');
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? '#00ff90' : 'var(--muted)';
  };

  const fetchWifiStatus = async () => {
    try {
      const r = await fetch(apiBase + '/wifi_status');
      if (!r.ok) return;
      const s = await r.json();
      if (s.connected) setWifiStatus(`Connected to ${s.ssid} (${s.ip || 'no IP'})`, true);
      else setWifiStatus('Not connected');
    } catch {}
  };

  const renderWifiList = (nets=[]) => {
    const wrap = $('wifiList'); if (!wrap) return;
    wrap.innerHTML = '';
    if (!nets.length) {
      const span = document.createElement('span'); span.className='muted'; span.textContent='No networks found'; wrap.appendChild(span); return;
    }
    nets.forEach(n => {
      const btn = document.createElement('button');
      btn.className = 'video-fit-box';
      const lock = n.secure ? '🔒' : '🔓';
      const level = n.rssi;
      btn.textContent = `${lock} ${n.ssid} (${level}dBm)`;
      btn.title = 'Click to connect';
      btn.addEventListener('click', async () => {
        const pass = n.secure ? prompt(`Enter password for \"${n.ssid}\"`) : '';
        if (pass === null) return;
        await connectWifi(n.ssid, pass);
      });
      wrap.appendChild(btn);
    });
  };

  const scanWifi = async () => {
    setWifiStatus('Scanning...');
    try {
      const r = await fetch(apiBase + '/wifi_scan');
      if (!r.ok) { setWifiStatus('Scan failed'); return; }
      const list = await r.json();
      renderWifiList(list);
      setWifiStatus('Scan complete');
    } catch (e) {
      setWifiStatus('Scan error');
    }
  };

  const connectWifi = async (ssid, pass) => {
    try {
      setWifiStatus(`Connecting to ${ssid}...`);
      const fd = new FormData();
      fd.append('ssid', ssid);
      fd.append('pass', pass || '');
      const r = await fetch(apiBase + '/wifi_connect', { method: 'POST', body: fd });
      const t = await r.text();
      try { const j = JSON.parse(t); if (j.status === 'connected') { setWifiStatus(`Connected to ${j.ssid} (${j.ip})`, true); return; } }
      catch {}
      setWifiStatus('Failed to connect');
    } catch {
      setWifiStatus('Failed to connect');
    }
  };

  const initWifiControls = () => {
    const btnScan = $('btnWifiScan');
    if (btnScan) btnScan.addEventListener('click', scanWifi);
    fetchWifiStatus();
  };

  // ========= YouTube =========
  const setYtStatus = (txt, good=false) => { const el=$('ytStatus'); if(!el)return; el.textContent=txt; el.style.color= good?'#00ff90':'var(--muted)'; };
  const drawYTIcon = (g, cx, cy, h) => {
    const r = Math.round(h/5);
    const w = Math.round(h*1.6);
    const x = Math.round(cx - w/2);
    const y = Math.round(cy - h/2);
    // red rounded rect
    g.save();
    g.beginPath();
    g.moveTo(x+r, y);
    g.lineTo(x+w-r, y);
    g.quadraticCurveTo(x+w, y, x+w, y+r);
    g.lineTo(x+w, y+h-r);
    g.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    g.lineTo(x+r, y+h);
    g.quadraticCurveTo(x, y+h, x, y+h-r);
    g.lineTo(x, y+r);
    g.quadraticCurveTo(x, y, x+r, y);
    g.closePath();
    g.fillStyle = '#FF0000';
    g.fill();
    // white play triangle
    const triW = Math.round(h*0.6);
    const triH = Math.round(h*0.5);
    g.beginPath();
    g.moveTo(cx - Math.round(triW*0.35), cy - Math.round(triH/2));
    g.lineTo(cx - Math.round(triW*0.35), cy + Math.round(triH/2));
    g.lineTo(cx + Math.round(triW*0.65), cy);
    g.closePath();
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.restore();
    return { w, h };
  };

  const drawYoutubePreviewFrame = () => {
    const pw=128, ph=64; const bg=$('youtubeBgColor')?$('youtubeBgColor').value:'#000000'; const col=$('youtubeTextColor')?$('youtubeTextColor').value:'#FFFFFF';
    c.width=pw; c.height=ph; ctx.clearRect(0,0,pw,ph); ctx.fillStyle=bg; ctx.fillRect(0,0,pw,ph);
    // Frame is drawn last, after logo and text
    const txt = (youtubeLastCount!==null)? String(youtubeLastCount): '—';
    // Prepare text size based on available space after icon
    const uiSize = $('youtubeIconSize') ? parseInt($('youtubeIconSize').value, 10) : 25;
    const iconH = Math.max(10, Math.min(uiSize, Math.round(ph*0.9)));
    const iconW = Math.round(iconH*1.6);
    const gap = 6;
    let size = 28; const fam = getFontFamily(); let font = `bold ${size}px ${fam}`; ctx.font=font; ctx.textBaseline='middle';
    // Measure text width with current size
    let tw = ctx.measureText(txt).width;
    // Total group width for centering
    while ((iconW + gap + tw) > (pw - 8) && size > 10) {
      size -= 2; font = `bold ${size}px ${fam}`; ctx.font=font; tw = ctx.measureText(txt).width;
    }
    const groupW = iconW + gap + tw;
    const x0 = Math.round((pw - groupW)/2);
    const cy = Math.round(ph/2);
    // 1) Draw logo + text
    drawYTIcon(ctx, x0 + Math.round(iconW/2), cy, iconH);
    ctx.fillStyle = col; ctx.textAlign='left'; ctx.fillText(txt, x0 + iconW + gap, cy);
    // 2) Draw frame LAST
    const ytFrame = ($('youtubeFrameStyle') && $('youtubeFrameStyle').value) || 'none';
    if (ytFrame !== 'none') drawFrameOnCanvas(ctx, ytFrame, col, pw, ph);
  };
  const renderAndUploadYoutube = async () => {
    const pw=128, ph=64; const bg=$('youtubeBgColor').value; const col=$('youtubeTextColor').value;
    const canvas=document.createElement('canvas'); canvas.width=pw; canvas.height=ph; const tctx=canvas.getContext('2d');
    tctx.fillStyle=bg; tctx.fillRect(0,0,pw,ph);
    const txt = (youtubeLastCount!==null)? String(youtubeLastCount): '—';
    const uiSize = $('youtubeIconSize') ? parseInt($('youtubeIconSize').value, 10) : 25;
    const iconH = Math.max(10, Math.min(uiSize, Math.round(ph*0.9)));
    const iconW = Math.round(iconH*1.6);
    const gap = 6;
    let size=28; const fam=getFontFamily(); let font=`bold ${size}px ${fam}`; tctx.font=font; tctx.textBaseline='middle';
    let tw=tctx.measureText(txt).width;
    while ((iconW + gap + tw) > (pw - 8) && size>10) { size -= 2; font=`bold ${size}px ${fam}`; tctx.font=font; tw=tctx.measureText(txt).width; }
    const groupW = iconW + gap + tw; const x0 = Math.round((pw - groupW)/2); const cy = Math.round(ph/2);
    // 1) Draw logo + text
    drawYTIcon(tctx, x0 + Math.round(iconW/2), cy, iconH);
    tctx.fillStyle = col; tctx.textAlign='left'; tctx.fillText(txt, x0 + iconW + gap, cy);
    // 2) Draw frame LAST
    const ytFrame = ($('youtubeFrameStyle') && $('youtubeFrameStyle').value) || 'none';
    if (ytFrame !== 'none') drawFrameOnCanvas(tctx, ytFrame, col, pw, ph);
    let out;
    try {
      out=tctx.getImageData(0,0,pw,ph);
    } catch (e) {
      console.warn('Canvas read blocked (CORS). Falling back to classic icon.');
      // recreate canvas to clear taint and redraw vector-only
      const clean=document.createElement('canvas'); clean.width=pw; clean.height=ph; const cctx=clean.getContext('2d');
      cctx.fillStyle=bg; cctx.fillRect(0,0,pw,ph);
      drawYTIcon(cctx, x0 + Math.round(iconW/2), cy, iconH);
      cctx.fillStyle = col; cctx.textAlign='left'; cctx.textBaseline='middle'; cctx.font = `${size}px ${fam}`;
      cctx.fillText(txt, x0 + iconW + gap, cy);
      const ytFrame2 = ($('youtubeFrameStyle') && $('youtubeFrameStyle').value) || 'none';
      if (ytFrame2 !== 'none') drawFrameOnCanvas(cctx, ytFrame2, col, pw, ph);
      out=cctx.getImageData(0,0,pw,ph);
    }
    const buf=new Uint8Array(4+pw*ph*2); buf[0]=pw&255; buf[1]=(pw>>8)&255; buf[2]=ph&255; buf[3]=(ph>>8)&255;
    let p=4, d=out.data; for(let y=0;y<ph;y++) for(let x=0;x<pw;x++){ const i=(y*pw+x)*4; const r=d[i],g=d[i+1],b=d[i+2]; const v=rgb565(r,g,b); buf[p++]=v&255; buf[p++]=(v>>8)&255; }
    const fd=new FormData();
    fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'yt.rgb565');
    fd.append('bg', bg);
    fd.append('bgMode','image');
    fd.append('offx', 0);
    fd.append('offy', 0);
    fd.append('animate',0);
    fd.append('dir','none');
    fd.append('speed',0);
    fd.append('interval',0);
    try { await fetch(apiBase + '/upload', { method:'POST', body:fd }); } catch {}
  };
  const fetchYoutubeStats = async () => {
    try {
      // Safety: only fetch when YouTube tab is visible
      if ($('youtubeConfig') && $('youtubeConfig').classList.contains('hidden')) return;
      const channelId = $('youtubeChannelId') ? $('youtubeChannelId').value.trim() : 'UCaPOzWiPWJFJr9dXzkkvUOw';
      setYtStatus('Updating…');
      const r = await fetch(apiBase + '/yt_stats?id=' + encodeURIComponent(channelId), { cache: 'no-store' });
      if (!r.ok) { setYtStatus('Fetch failed'); return; }
      const j = await r.json();
      if (j && j.subscriberCount) {
        youtubeLastCount = j.subscriberCount;
        setYtStatus('🟢', true);
        drawYoutubePreviewFrame();
        // Do not push here; LED streaming handled by GIF loop
      } else {
        setYtStatus('No data');
      }
    } catch { setYtStatus('Error'); }
  };
  const startYoutubeUpdater = async () => {
    if (youtubeTimer) { clearInterval(youtubeTimer); youtubeTimer = 0; }
    if (youtubeAnimTimer) { clearInterval(youtubeAnimTimer); youtubeAnimTimer = 0; }
    // Initial fetch, then fetch every 5s; upload the static image after each successful fetch
    await fetchYoutubeStats();
    try { await renderAndUploadYoutube(); } catch {}
    youtubeTimer = setInterval(async () => {
      await fetchYoutubeStats();
      try { await renderAndUploadYoutube(); } catch {}
    }, 5000);
  };

  // ========= Theme Controls / Upload =========
  const showThemeControls = () => { const el = $('themeControlsSection'); if (el) el.classList.remove('hidden'); };
  const hideThemeControls = () => { const el = $('themeControlsSection'); if (el) el.classList.add('hidden'); };

  // Setup theme control event handlers after theme is loaded
  const setupThemeControlHandlers = () => {
    console.log('🎛️ Setting up theme control handlers...');

    // Theme font size buttons (15, 20, 35, 60)
    const fontSizeButtons = document.querySelectorAll('.theme-font-size-box');
    console.log('Found theme font size buttons:', fontSizeButtons.length);

    fontSizeButtons.forEach((button, index) => {
      // Remove existing listeners to avoid duplicates
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);

      newButton.addEventListener('click', (e) => {
        console.log('🎯 Font size button clicked:', e.target.dataset.size);
        const size = parseInt(e.target.dataset.size);

        if (window.__theme) {
          // Get theme settings from init() if available, otherwise use the main script's settings
          let themeSettings = null;
          if (window.__theme.init) {
            const state = window.__theme.init();
            themeSettings = state.settings;
          }

          if (themeSettings) {
            themeSettings.fontSize = size;
            console.log('✅ Theme font size updated to:', size, 'Theme settings:', themeSettings);

            // Update active state
            document.querySelectorAll('.theme-font-size-box').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            // Update preview using main system
            updateThemeSetting('fontSize', size);
          } else {
            console.log('❌ Could not access theme settings, using main system update');
            updateThemeSetting('fontSize', size);
          }
        } else {
          console.log('❌ Theme not loaded yet:', window.__theme);
        }
      });
    });

    console.log('✅ Theme control handlers setup complete');
  };

  // Apply current theme with current settings to the LED display
  // Direct theme application function
  const applyThemeDirectly = async () => {
    if (!window.__theme || !originalThemeContent) {
      console.error('❌ No theme loaded to apply');
      return;
    }

    try {
      console.log('🔄 Direct theme application starting...');

      // Stop all existing content
      await stopAllModes();

      // Start theme streaming
      await startThemeStreaming();

      console.log('✅ Theme applied directly and streaming started');
    } catch (error) {
      console.error('❌ Failed to apply theme directly:', error);
      throw error;
    }
  };

  const applyCurrentTheme = async () => {
    if (!window.__theme || !originalThemeContent) {
      console.error('❌ No theme loaded to apply');
      return;
    }

    try {
      console.log('🔄 Applying current theme to LED display...');

      // Stop clock timer when applying theme
      if (clockTimer) {
        cancelAnimationFrame(clockTimer);
        clockTimer = 0;
        console.log('🛑 Clock timer stopped when applying theme');
      }

      // Get current theme state with all user modifications
      const api = window.__theme;
      const state = api.init ? api.init() : {};

      if (!state.settings) {
        console.error('❌ Theme settings not available');
        return;
      }

      console.log('📋 Current theme settings:', state.settings);

      // Modify the original theme content with current settings
      let modifiedThemeHtml = originalThemeContent;

      // Update theme settings in the original content
      console.log('🔍 Before modification - checking fontSize pattern...');
      const originalFontSize = modifiedThemeHtml.match(/fontSize:\s*\d+/);
      console.log('Original fontSize found:', originalFontSize);

      // More robust regex patterns for theme settings
      modifiedThemeHtml = modifiedThemeHtml.replace(/fontSize:\s*\d+/g, `fontSize: ${state.settings.fontSize}`);
      modifiedThemeHtml = modifiedThemeHtml.replace(/fontSize:\s*'\d+'/g, `fontSize: ${state.settings.fontSize}`);
      modifiedThemeHtml = modifiedThemeHtml.replace(/fontSize:\s*"\d+"/g, `fontSize: ${state.settings.fontSize}`);

      modifiedThemeHtml = modifiedThemeHtml.replace(/textColor:\s*['"]([^'"]*)['"]/g, (match, p1) => `textColor: '${state.settings.textColor}'`);
      modifiedThemeHtml = modifiedThemeHtml.replace(/bgColor:\s*['"]([^'"]*)['"]/g, (match, p1) => `bgColor: '${state.settings.bgColor}'`);
      modifiedThemeHtml = modifiedThemeHtml.replace(/timeFormat:\s*['"]([^'"]*)['"]/g, (match, p1) => `timeFormat: '${state.settings.timeFormat}'`);
      modifiedThemeHtml = modifiedThemeHtml.replace(/showSeconds:\s*(true|false)/g, `showSeconds: ${state.settings.showSeconds}`);

      console.log('🔍 After modification - checking fontSize pattern...');
      const modifiedFontSize = modifiedThemeHtml.match(/fontSize:\s*\d+/);
      console.log('Modified fontSize found:', modifiedFontSize);

      console.log('📝 Modified theme HTML with current settings');
      console.log('📏 Theme HTML length:', modifiedThemeHtml.length);

      // Log a small sample of the modified HTML for debugging
      console.log('📄 Sample of modified HTML (first 500 chars):');
      console.log(modifiedThemeHtml.substring(0, 500));

      // DEBUG: Try uploading the original unmodified theme first to test
      console.log('🧪 DEBUG: Testing with original unmodified theme first...');
      const testFormData = new FormData();
      const testBlob = new Blob([originalThemeContent], { type: 'text/html' });
      testFormData.append('file', testBlob, 'test_original.html');

      try {
        const testResponse = await fetch(apiBase + '/upload_theme', {
          method: 'POST',
          body: testFormData
        });
        if (testResponse.ok) {
          console.log('✅ Original theme uploaded successfully for testing');
        } else {
          console.log('❌ Original theme upload failed:', testResponse.status);
        }
      } catch (testError) {
        console.log('❌ Original theme upload error:', testError.message);
      }

      // Now upload the modified theme
      console.log('📤 Now uploading modified theme to device...');
      const formData = new FormData();
      const blob = new Blob([modifiedThemeHtml], { type: 'text/html' });

      // Use the original filename - ESP32 devices often expect specific filenames
      const uploadFileName = currentThemeFileName || 'theme.html';
      formData.append('file', blob, uploadFileName);

      console.log('📝 Uploading theme with original filename:', uploadFileName);

      console.log('📤 Uploading theme to device...');
      const response = await fetch(apiBase + '/upload_theme', {
        method: 'POST',
        body: formData
      });

      console.log('📡 Device response status:', response.status);
      console.log('📡 Device response headers:', response.headers);

      const responseText = await response.text();
      console.log('📡 Device response body:', responseText);

      if (response.ok) {
        console.log('✅ Theme successfully applied to LED display!');

        // Show success message
        const fileName = document.getElementById('themeFileName');
        if (fileName) {
          fileName.textContent = 'Applied to LED ✓';
          fileName.style.color = '#00ff00';
        }
      } else {
        throw new Error(`Upload failed: ${response.status} - ${responseText}`);
      }

    } catch (error) {
      console.error('❌ Failed to apply theme to LED display:', error);
      alert('Failed to apply theme to LED display: ' + error.message);

      const fileName = document.getElementById('themeFileName');
      if (fileName) {
        fileName.textContent = 'Apply Failed ✗';
        fileName.style.color = '#ff0000';
      }
    }
  };

  
  // Function to stop theme streaming
  const stopThemeStreaming = () => {
    if (window.__themeStreamingInterval) {
      clearInterval(window.__themeStreamingInterval);
      window.__themeStreamingInterval = null;
      console.log('🛑 Theme streaming stopped');
    }
  };

  // Start theme streaming automatically (no button needed)
  const startThemeStreaming = async () => {
    if (!window.__theme || !originalThemeContent) {
      console.error('❌ No theme loaded to stream');
      return;
    }

    // Stop any existing streaming first
    stopThemeStreaming();

    try {
      // Stop clock timer when starting theme streaming
      if (clockTimer) {
        cancelAnimationFrame(clockTimer);
        clockTimer = 0;
        console.log('🛑 Clock timer stopped when starting theme streaming');
      }

      // Get current theme state with all user modifications
      const api = window.__theme;
      const state = api.init ? api.init() : {};

      if (!state.settings) {
        console.error('❌ Theme settings not available');
        return;
      }

      let frameCount = 0;

      // Function to render and upload a single frame
      const uploadFrame = async () => {
        try {
          // Create canvas for theme rendering
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 64;
          const ctx = canvas.getContext('2d');

          // Render theme frame with current time
          await api.render(ctx, canvas.width, canvas.height, state, Date.now());

          // Get image data and convert to RGB565 format
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          const width = canvas.width;
          const height = canvas.height;

          // Convert to RGB565 with alpha channel
          const buf = new Uint8Array(4 + width * height * 3);
          buf[0] = width & 255;
          buf[1] = (width >> 8) & 255;
          buf[2] = height & 255;
          buf[3] = (height >> 8) & 255;

          let p = 4;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4;
              const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

              // Convert RGB to RGB565
              const v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);

              buf[p++] = a;      // Alpha channel
              buf[p++] = v & 255; // RGB565 low byte
              buf[p++] = (v >> 8) & 255; // RGB565 high byte
            }
          }

          // Create FormData with NO animation (static clock display)
          const formData = new FormData();
          formData.append('image', new Blob([buf], { type: 'application/octet-stream' }), 'theme.rgb565');
          formData.append('bg', state.settings.bgColor || '#000000');
          formData.append('bgMode', 'color');
          formData.append('offx', 0);
          formData.append('offy', 0);
          formData.append('animate', 0); // NO animation - static display
          formData.append('brightness', 80);
          formData.append('dir', 'none'); // NO direction - don't move
          formData.append('speed', 0); // NO speed
          formData.append('interval', 0); // NO interval

          // Upload frame
          const response = await fetch(apiBase + '/upload', {
            method: 'POST',
            body: formData
          });

          frameCount++;

          if (response.ok || response.status === 200) {
            // Silent success - no console spam
          } else {
            console.warn(`❌ Frame ${frameCount} upload failed:`, response.status);
          }

        } catch (error) {
          console.warn(`❌ Frame ${frameCount} error:`, error.message);
        }
      };

      // Upload first frame immediately
      await uploadFrame();

      // Then upload every second (1 FPS for smooth clock updates)
      window.__themeStreamingInterval = setInterval(uploadFrame, 1000);

  
    } catch (error) {
      console.error('❌ Failed to start theme streaming:', error);
    }
  };

  // Create theme HTML with current settings
  const createThemeWithSettings = (settings) => {
    // Start with original theme content
    let themeHtml = originalThemeContent;

    // Update settings in the theme code
    const updates = [
      { pattern: /textColor:\s*['"][^'"]*['"]/, replacement: `textColor: '${settings.textColor}'` },
      { pattern: /bgColor:\s*['"][^'"]*['"]/, replacement: `bgColor: '${settings.bgColor}'` },
      { pattern: /fontSize:\s*\d+/, replacement: `fontSize: ${settings.fontSize}` },
      { pattern: /timeFormat:\s*['"][^'"]*['"]/, replacement: `timeFormat: '${settings.timeFormat || '24'}'` },
      { pattern: /showSeconds:\s*\w+/, replacement: `showSeconds: ${settings.showSeconds !== false}` }
    ];

    updates.forEach(update => {
      themeHtml = themeHtml.replace(update.pattern, update.replacement);
    });

    return themeHtml;
  };

  // Extract theme code from uploaded HTML
  const extractThemeCode = (themeHtml, settings) => {
    // Extract theme settings and functions
    const scriptMatch = themeHtml.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch) {
      throw new Error('No theme script found in uploaded file');
    }

    let themeScript = scriptMatch[1];

    // Update theme settings with current values
    themeScript = themeScript.replace(/fontSize:\s*\d+/g, `fontSize: ${settings.fontSize}`);
    themeScript = themeScript.replace(/fontSize:\s*'\d+'/g, `fontSize: ${settings.fontSize}`);
    themeScript = themeScript.replace(/fontSize:\s*"\d+"/g, `fontSize: ${settings.fontSize}`);

    themeScript = themeScript.replace(/textColor:\s*['"]([^'"]*)['"]/g, `textColor: '${settings.textColor}'`);
    themeScript = themeScript.replace(/bgColor:\s*['"]([^'"]*)['"]/g, `bgColor: '${settings.bgColor}'`);
    themeScript = themeScript.replace(/timeFormat:\s*['"]([^'"]*)['"]/g, `timeFormat: '${settings.timeFormat}'`);
    themeScript = themeScript.replace(/showSeconds:\s*(true|false)/g, `showSeconds: ${settings.showSeconds}`);

    return `<script>
    // ========================================
    // DIGITAL CLOCK THEME - MERGED
    // ========================================

    ${themeScript}
  </script>`;
  };

  // Merge theme code into index.html
  const mergeThemeIntoIndex = (indexContent, themeCode) => {
    // Find the closing </head> tag
    const headEndMatch = indexContent.match(/<\/head>/);
    if (!headEndMatch) {
      throw new Error('Could not find </head> tag in index.html');
    }

    const headEndIndex = indexContent.indexOf('</head>');

    // Insert theme code before closing </head> tag
    const mergedContent =
      indexContent.substring(0, headEndIndex) +
      '\n  <!-- MERGED CLOCK THEME -->\n' +
      themeCode + '\n' +
      indexContent.substring(headEndIndex);

    return mergedContent;
  };


  const injectThemeSettings = (themeHtml) => {
    const fontSizeSlider = $('fontSizeSlider');
    const themeTextColor = $('themeTextColor');
    const themeBgColor = $('themeBgColor');
    const themeTimeFormat = $('themeTimeFormat');
    const themeShowSeconds = $('themeShowSeconds');
    const themePulseAnimation = $('themePulseAnimation');

    const current = {
      fontSize: fontSizeSlider ? parseInt(fontSizeSlider.value, 10) : 60,
      textColor: themeTextColor ? themeTextColor.value : '#00ff00',
      bgColor: themeBgColor ? themeBgColor.value : '#000000',
      timeFormat: themeTimeFormat ? themeTimeFormat.value : '24',
      showSeconds: themeShowSeconds ? themeShowSeconds.checked : true,
      pulseAnimation: themePulseAnimation ? themePulseAnimation.checked : false,
      showDate: false
    };

    let html = themeHtml;
    html = html.replace(/fontSize:\s*\d+/g, `fontSize: ${current.fontSize}`);
    html = html.replace(/fontSize:\s*'[^']*'/g, `fontSize: ${current.fontSize}`);
    html = html.replace(/textColor:\s*['"][^'"]*['"]/g, `textColor: '${current.textColor}'`);
    html = html.replace(/bgColor:\s*['"][^'"]*['"]/g, `bgColor: '${current.bgColor}'`);
    html = html.replace(/timeFormat:\s*['"][^'"]*['"]/g, `timeFormat: '${current.timeFormat}'`);
    html = html.replace(/showSeconds:\s*(true|false)/g, `showSeconds: ${current.showSeconds}`);
    html = html.replace(/pulseAnimation:\s*(true|false)/g, `pulseAnimation: ${current.pulseAnimation}`);
    html = html.replace(/showDate:\s*(true|false)/g, `showDate: ${current.showDate}`);
    return html;
  };

  const updateThemeSetting = (setting, value) => {
    if (window.__theme) {
      console.log('🔄 updateThemeSetting called:', setting, '=', value);

      // Restart timer with fresh state to apply the setting
      if (window.__themeTimer) {
        clearInterval(window.__themeTimer);
      }

      const api = window.__theme;
      const pv = getPreviewCanvas();
      const pctx = pv.getContext('2d');

      // Get fresh state from theme and apply the setting
      const state = api.init ? api.init() : {};
      if (state.settings) {
        state.settings[setting] = value;
        console.log('✅ Applied setting to theme state:', state.settings);
      }

      const step = () => {
        try {
          pctx.clearRect(0,0,pv.width,pv.height);
          api.render(pctx, pv.width, pv.height, state, Date.now());
        } catch (e) {
          console.error('Error rendering theme after setting update:', e);
        }
      };

      window.__themeTimer = setInterval(step, 200);
      step(); // Render first frame immediately
      console.log('✅ Theme preview updated with new setting');
    } else {
      console.log('❌ Theme not available for setting update');
    }
  };

  const updateControlValuesFromTheme = () => {
    if (!window.__theme || !window.__theme.settings) return;
    const s = window.__theme.settings;

    const fontSizeSlider = $('fontSizeSlider'), fontSizeDisplay = $('fontSizeDisplay');
    if (fontSizeSlider && fontSizeDisplay && s.fontSize !== undefined) {
      fontSizeSlider.value = s.fontSize; fontSizeDisplay.textContent = Math.floor(s.fontSize) + '%';
      const min = parseInt(fontSizeSlider.min, 10), max = parseInt(fontSizeSlider.max, 10);
      const progress = ((s.fontSize - min) / (max - min)) * 100;
      fontSizeSlider.style.setProperty('--progress', progress + '%');
    }
    if ($('themeTextColor') && $('textColorHex') && s.textColor) {
      $('themeTextColor').value = s.textColor; $('textColorHex').textContent = s.textColor;
    }
    if ($('themeBgColor') && $('bgColorHex') && s.bgColor) {
      $('themeBgColor').value = s.bgColor; $('bgColorHex').textContent = s.bgColor;
    }
    if ($('themeTimeFormat') && s.timeFormat) $('themeTimeFormat').value = s.timeFormat;
    if ($('themeShowSeconds') && s.showSeconds !== undefined) $('themeShowSeconds').checked = s.showSeconds;
    if ($('themePulseAnimation') && s.pulseAnimation !== undefined) $('themePulseAnimation').checked = s.pulseAnimation;
  };

  const initThemeControls = () => {
    // Theme file input
    const themeFile = $('themeFile');

    // Sliders / toggles
    const fontSizeSlider = $('fontSizeSlider');
    const fontSizeDisplay = $('fontSizeDisplay');
    const themeTextColor = $('themeTextColor');
    const textColorHex = $('textColorHex');
    const themeBgColor = $('themeBgColor');
    const bgColorHex = $('bgColorHex');
    const themeTimeFormat = $('themeTimeFormat');
    const themeShowSeconds = $('themeShowSeconds');
    const themePulseAnimation = $('themePulseAnimation');

    // Events
    if (fontSizeSlider && fontSizeDisplay) {
      fontSizeSlider.addEventListener('input', () => {
        const value = parseInt(fontSizeSlider.value, 10);
        fontSizeDisplay.textContent = value + '%';
        const min = parseInt(fontSizeSlider.min, 10), max = parseInt(fontSizeSlider.max, 10);
        const progress = ((value - min) / (max - min)) * 100;
        fontSizeSlider.style.setProperty('--progress', progress + '%');
        updateThemeSetting('fontSize', value);
      });
    }
    if (themeTextColor && textColorHex) {
      themeTextColor.addEventListener('input', (e) => {
        textColorHex.textContent = e.target.value; updateThemeSetting('textColor', e.target.value);
      });
      textColorHex.textContent = themeTextColor.value;
    }
    if (themeBgColor && bgColorHex) {
      themeBgColor.addEventListener('input', (e) => {
        bgColorHex.textContent = e.target.value; updateThemeSetting('bgColor', e.target.value);
      });
      bgColorHex.textContent = themeBgColor.value;
    }
    if (themeTimeFormat) themeTimeFormat.addEventListener('change', (e) => updateThemeSetting('timeFormat', e.target.value));
    if (themeShowSeconds) themeShowSeconds.addEventListener('change', (e) => updateThemeSetting('showSeconds', e.target.checked));
    if (themePulseAnimation) themePulseAnimation.addEventListener('change', (e) => updateThemeSetting('pulseAnimation', e.target.checked));

    
    console.log('Setting up theme file event listener. themeFile element:', themeFile);

  
    // Merge theme button
    const btnMergeTheme = document.getElementById('btnMergeTheme');
  if (btnMergeTheme) {
      btnMergeTheme.addEventListener('click', async () => {
        console.log('🎯 Apply Theme button clicked');

        try {
          // Direct upload - no merging needed
          await applyThemeDirectly();

        } catch (error) {
          console.error('❌ Theme application failed:', error);
          alert('Theme application failed: ' + error.message);
          btnMergeTheme.textContent = 'Apply Failed ✗';
          btnMergeTheme.style.background = '#ff0000';
        }
      });
    }

    if (themeFile) {
      console.log('Theme file input found, adding event listener...');

      // Setup upload button with direct file selection
      const btnSelectThemeFile = $('btnSelectThemeFile') || document.getElementById('btnSelectThemeFile');
      const themeFileName = $('themeFileName') || document.getElementById('themeFileName');

      console.log('Theme upload elements - btn:', btnSelectThemeFile, 'fileName:', themeFileName);

      if (btnSelectThemeFile) {
        console.log('Upload button found, adding click listener...');

        btnSelectThemeFile.addEventListener('click', (e) => {
          console.log('Upload button clicked', e);
          e.preventDefault();

          // Stop any existing streaming when uploading new theme
          stopThemeStreaming();

          // Create new file input to avoid hidden input issues
          const newFileInput = document.createElement('input');
          newFileInput.type = 'file';
          newFileInput.accept = '.html';
          newFileInput.style.display = 'none';
          document.body.appendChild(newFileInput);

          console.log('Created file input:', newFileInput);

          newFileInput.addEventListener('change', async () => {
            console.log('New file input change triggered');
            const f = newFileInput.files && newFileInput.files[0];
            if (!f) {
              console.log('No file selected');
              document.body.removeChild(newFileInput);
              return;
            }

            console.log('Theme file selected:', f.name);

            // Update file name display
            if (themeFileName) {
              themeFileName.textContent = f.name;
              themeFileName.style.color = '#00ff00';
            }

            // Load the theme
            await loadThemeFile(f);

            // Clean up
            document.body.removeChild(newFileInput);
          });

          // Trigger file selection
          console.log('Triggering file selection dialog...');
          newFileInput.click();
        });
      }

    // Handle clicks on theme-generated controls
    function handleThemeControlClick(button) {
      console.log('Theme control clicked:', button.textContent, button.dataset);

      // Handle font size buttons
      if (button.dataset.size) {
        const newSize = parseInt(button.dataset.size);
        if (window.__theme && window.__theme.settings) {
          window.__theme.settings.fontSize = newSize;
          console.log('Theme font size updated to:', newSize);

          // Update active state
          const container = button.parentElement;
          Array.from(container.children).forEach(btn => {
            btn.classList.remove('active');
          });
          button.classList.add('active');
        }
      }

      // Handle color preset buttons
      if (button.dataset.preset && window.themeControls && window.themeControls.setColorPreset) {
        window.themeControls.setColorPreset(button.dataset.preset);
        console.log('Color preset updated to:', button.dataset.preset);

        // Update active state
        const container = button.parentElement;
        Array.from(container.children).forEach(btn => {
          btn.classList.remove('active');
        });
        button.classList.add('active');
      }

      // Handle time format buttons
      if (button.dataset.format && window.__theme && window.__theme.settings) {
        window.__theme.settings.timeFormat = button.dataset.format;
        console.log('Time format updated to:', button.dataset.format);

        // Update active state
        const container = button.parentElement;
        Array.from(container.children).forEach(btn => {
          btn.classList.remove('active');
        });
        button.classList.add('active');
      }

      // Handle show/hide seconds button
      if (button.dataset.seconds !== undefined && window.__theme && window.__theme.settings) {
        const showSeconds = button.dataset.seconds === 'true';
        window.__theme.settings.showSeconds = showSeconds;
        console.log('Show seconds updated to:', showSeconds);

        // Update button text and state
        button.textContent = showSeconds ? 'Hide Seconds' : 'Show Seconds';
        button.dataset.seconds = showSeconds ? 'false' : 'true';
      }
    }

    // Load theme file function
    async function loadThemeFile(f) {
      console.log('Starting theme file loading...');

      hideThemeControls(); stopThemeTimers();
      window.__theme = null; window.themeInitBackup = null; window.themeRenderBackup = null;

      console.log('Reading theme file content...');
      let txt = await f.text();
      console.log('Theme file content length:', txt.length);

      // Store original theme content for Apply functionality
      originalThemeContent = txt;
      currentThemeFileName = f.name;
      console.log('📁 Original theme content stored for Apply functionality');

      console.log('Injecting theme settings...');
      txt = injectThemeSettings(txt);

      const m = txt.match(/<fps>\s*(\d{1,2})\s*<\/fps>/i);
      const currentThemeFps = m ? Math.max(1, Math.min(30, parseInt(m[1],10) || 1)) : 1;
      console.log('Theme FPS:', currentThemeFps);

      try {
        console.log('Looking for script tag...');
        const mscript = txt.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
        if (!mscript) throw new Error('No <script> in theme');

        console.log('Found script tag, executing code...');
        const code = mscript[1];
        eval(code);

        console.log('Checking for theme functions...');
        console.log('themeInit exists:', typeof themeInit);
        console.log('themeRender exists:', typeof themeRender);

        const api = { init: (typeof themeInit !== 'undefined') ? themeInit : null, render: (typeof themeRender !== 'undefined') ? themeRender : null };
        window.themeInitBackup = api.init; window.themeRenderBackup = api.render;
        if (!api || !api.render) throw new Error('themeRender() not found');

        console.log('Setting window.__theme to:', api);
        window.__theme = api;

        // Inject theme styles and generate controls if the theme provides them
        if (window.themeControls && window.themeControls.injectStyles) {
          console.log('Injecting theme styles...');
          window.themeControls.injectStyles();
        }

        // Show the main system's theme controls for this theme
        showThemeControls();
        console.log('🎛️ Theme controls section shown');

        // Setup theme control event handlers now that controls are visible
        setTimeout(() => {
          setupThemeControlHandlers();

          // Set initial active state based on theme's default font size
          const state = api.init ? api.init() : {};
          if (state.settings && state.settings.fontSize) {
            let defaultSize = state.settings.fontSize;

            // Force default to 20 if theme sends incorrect value
            if (defaultSize !== 15 && defaultSize !== 20 && defaultSize !== 35 && defaultSize !== 60) {
              defaultSize = 20;
              console.log('⚠️ Invalid font size from theme, forcing to 20');
            }

            console.log('🎯 Setting initial font size active state for:', defaultSize);

            // Remove active class from all theme font size buttons
            document.querySelectorAll('.theme-font-size-box').forEach(btn => btn.classList.remove('active'));

            // Add active class to the button matching the default font size
            const defaultButton = document.querySelector(`.theme-font-size-box[data-size="${defaultSize}"]`);
            if (defaultButton) {
              defaultButton.classList.add('active');
              console.log('✅ Initial font size button set to active:', defaultSize);
            } else {
              // Fallback to size 20 if button not found
              const fallbackButton = document.querySelector(`.theme-font-size-box[data-size="20"]`);
              if (fallbackButton) {
                fallbackButton.classList.add('active');
                console.log('🔧 Using fallback font size 20');
              }
            }
          }
        }, 100);

        const pv = getPreviewCanvas(), pctx = pv.getContext('2d');
        const state = api.init ? api.init() : {};
        if (window.__themeTimer) clearInterval(window.__themeTimer);
        const step = () => {
          pctx.clearRect(0,0,pv.width,pv.height);
          console.log('Rendering to canvas size:', pv.width, 'x', pv.height);
          console.log('Theme state:', state);
          api.render(pctx, pv.width, pv.height, state, Date.now());
          console.log('Theme render completed');
        };
        const period = Math.round(1000 / Math.max(1, Math.min(30, currentThemeFps)));
        window.__themeTimer = setInterval(step, period);
        step();

        stopContentForPreview();

        // Upload theme file as-is to the device
        try {
          const fd = new FormData();
          fd.append('file', f, f.name);
          await fetch(apiBase + '/upload_theme', { method:'POST', body:fd });
          console.log('Theme file uploaded to device successfully');
        } catch (uploadErr) {
          alert('Theme uploaded for preview but failed to save to device: ' + uploadErr.message);
        }

        console.log('Theme loading completed successfully!');

        // Theme will only start when user clicks Apply button (no auto-start)
        console.log('📝 Theme loaded. Click Apply to start streaming.');
      } catch (e) {
        console.error('Theme loading error:', e);
        alert('Theme error: ' + e.message);
        hideThemeControls();
        stopThemeTimers();
        window.__theme = null;
        window.themeInitBackup = null;
        window.themeRenderBackup = null;
      }
    }

    } else {
      console.log('Theme file input not found!');
    }

  };

  // ========= Events / Wiring =========
  const initPanelConfig = () => {
    const btnPC = $('btnPanelConfig');
    const btnPCClose = $('btnPanelClose');
    const btnPCApply = $('btnPanelApply');
    const btnPCCancel = $('btnPanelCancel');

    const openPanelConfig = async () => {
      const page = $('panelConfigPage'); if (!page) return;
      try {
        const r = await fetch(apiBase + '/panel_info', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          const a = $('layout1x1'); if (a) a.checked = true;
        }
      } catch { const a = $('layout1x1'); if (a) a.checked = true; }
      page.classList.remove('hidden');
    };
    const closePanelConfig = () => $('panelConfigPage').classList.add('hidden');

    if (btnPC) btnPC.addEventListener('click', openPanelConfig);
    if (btnPCClose) btnPCClose.addEventListener('click', closePanelConfig);
    if (btnPCCancel) btnPCCancel.addEventListener('click', closePanelConfig);
    if (btnPCApply) btnPCApply.addEventListener('click', async () => {
      const body = new URLSearchParams(); body.set('layout', '1x1');
      try { await fetch(apiBase + '/panel_layout', { method: 'POST', body }); } catch {}
      closePanelConfig();
    });
  };

  const initEventListeners = async () => {
    // Apply (tab-aware)
    $('btn').addEventListener('click', async (e) => {
      e.preventDefault();
      const textMode = !$('textConfig').classList.contains('hidden');
      const clockMode = !$('clockConfig').classList.contains('hidden');
      const videoMode = !$('videoConfig').classList.contains('hidden');
      const themeEl = $('themeConfig');
      const themeMode = themeEl ? !themeEl.classList.contains('hidden') : false; // removed feature
      const youtubeMode = !$('youtubeConfig').classList.contains('hidden');

      // Stop all modes first before starting any new mode
      await stopAllModes();

      if (textMode) {
        console.log('Text: starting text display');
        await renderAndUpload();
      } else if (clockMode) {
        console.log('Clock: starting clock display');
        await renderAndUploadClock();
        if (!clockTimer) startSmoothClockTimer();
      } else if (videoMode) {
        console.log('Video: use Start/Stop buttons');
        // Note: Video mode has its own Start/Stop buttons
      } else if (youtubeMode) {
        console.log('YouTube: starting live counter');
        // Push an initial frame to LED, then start periodic updates
        await renderAndUploadYoutube();
        await startYoutubeUpdater();
      }
    });

    // Preview button (handles text and theme)
    $('btnTextPreview').addEventListener('click', async (e) => {
      e.preventDefault();
      stopContentForPreview();

      // Theme feature removed
      const isYoutubeTab = !$('youtubeConfig').classList.contains('hidden');
      console.log('Preview button clicked');

      if (isYoutubeTab) {
        // Download via ESP, then preview using overlay <img> sourced from ESP
        if (!selectedThemeId) { setYtStatus('Select a theme first'); }
        else {
          await downloadAndSetIcon(selectedThemeId, true);
          const overlay = document.getElementById('ytPreviewImg');
          if (overlay) {
            overlay.style.display = 'block';
            overlay.src = apiBase + '/yt_icon_current?nocache=' + Date.now();
          }
          // Keep redrawing canvas text/positions at ~15 FPS
          if (youtubePreviewTimer) clearInterval(youtubePreviewTimer);
          youtubePreviewTimer = setInterval(() => { if (!$('youtubeConfig').classList.contains('hidden')) drawYoutubePreviewFrame(); }, 67);
        }
      } else {
        console.log('Previewing text instead of theme');
        // Preview text
        if ($('animate').checked && $('text').value.trim().length > 0) initPreviewAnim();
        drawPreview();
      }
    });

    // Config inputs — redraw preview for immediate feedback
    ['text','fontSize','color','bg','xGap'].forEach(id=>{
      $(id) && $(id).addEventListener('input', () => { drawPreview(); });
    });
    // Animation/brightness controls — update on change
    ['brightness','animate','dir','speed','interval'].forEach(id=>{
      $(id) && $(id).addEventListener('change', () => { drawPreview(); });
    });
    ['clockSize','clockColor','clockBgColor'].forEach(id=>{
      $(id) && $(id).addEventListener('input', () => {
        if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
      });
    });

    // YouTube color pickers
    document.querySelectorAll('#youtubeConfig .clock-color-box').forEach(box=>{
      box.addEventListener('click', async function(){
        document.querySelectorAll('#youtubeConfig .clock-color-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('youtubeTextColor').value = this.getAttribute('data-color');
        if (!$('youtubeConfig').classList.contains('hidden')) { drawYoutubePreviewFrame(); try { await renderAndUploadYoutube(); } catch {} }
      });
    });

    // Clock color pickers
    document.querySelectorAll('#clockConfig .clock-color-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('#clockConfig .clock-color-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('clockColor').value = this.getAttribute('data-color');
        if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
      });
    });
    document.querySelectorAll('#clockConfig .clock-bg-color-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('#clockConfig .clock-bg-color-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('clockBgColor').value = this.getAttribute('data-color');
        if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
      });
    });

    // Clock character gap selectors
    document.querySelectorAll('#clockConfig .clock-gap-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('#clockConfig .clock-gap-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('clockXGap').value = this.getAttribute('data-gap') || '0';
        if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
      });
    });

    // Clock frame selector
    document.querySelectorAll('#clockConfig .clock-frame-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('#clockConfig .clock-frame-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('clockFrameStyle').value = this.getAttribute('data-frame') || 'none';
        if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
      });
    });
    document.querySelectorAll('#youtubeConfig .clock-bg-color-box').forEach(box=>{
      box.addEventListener('click', async function(){
        document.querySelectorAll('#youtubeConfig .clock-bg-color-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('youtubeBgColor').value = this.getAttribute('data-color');
        if (!$('youtubeConfig').classList.contains('hidden')) { drawYoutubePreviewFrame(); try { await renderAndUploadYoutube(); } catch {} }
      });
    });
    // YouTube frame selector
    document.querySelectorAll('#youtubeConfig .youtube-frame-box').forEach(box=>{
      box.addEventListener('click', async function(){
        document.querySelectorAll('#youtubeConfig .youtube-frame-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('youtubeFrameStyle').value = this.getAttribute('data-frame') || 'none';
        if (!$('youtubeConfig').classList.contains('hidden')) { drawYoutubePreviewFrame(); try { await renderAndUploadYoutube(); } catch {} }
      });
    });
    // YouTube icon size selectors (exclude frame buttons)
    document.querySelectorAll('#youtubeConfig .font-size-box:not(.youtube-frame-box)').forEach(box=>{
      box.addEventListener('click', async function(){
        document.querySelectorAll('#youtubeConfig .font-size-box:not(.youtube-frame-box)')
          .forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('youtubeIconSize').value = this.getAttribute('data-size');
        if (!$('youtubeConfig').classList.contains('hidden')) { drawYoutubePreviewFrame(); try { await renderAndUploadYoutube(); } catch {} }
      });
    });
    // YouTube theme selection
    const downloadAndSetIcon = async (idOrUrl, isId=true) => {
      try {
        setYtStatus('Downloading icon...');
        const body = new URLSearchParams();
        let r;
        if (isId) {
          body.set('id', idOrUrl);
          r = await fetch(apiBase + '/theme_download', { method: 'POST', body });
        } else {
          body.set('url', idOrUrl);
          r = await fetch(apiBase + '/yt_icon_download', { method: 'POST', body });
        }
        if (!r.ok) throw new Error('download failed');
        const j = await r.json();
        if (!j.ok || !j.path) throw new Error('bad response');
        // Fetch the saved icon back from ESP with CORS and create a blob URL for same-origin drawing
        const iconResp = await fetch(apiBase + '/yt_icon_current', { cache: 'no-store' });
        if (!iconResp.ok) throw new Error('icon fetch failed');
        const blob = await iconResp.blob();
        const objUrl = URL.createObjectURL(blob);
        $('youtubeIconMode').value = 'blob';
        $('youtubeIconUrl').value = objUrl;
        ytIconImgReady = false;
        ytIconImg = new Image();
        ytIconImg.onload = async () => { ytIconImgReady = true; setYtStatus('Icon ready', true); drawYoutubePreviewFrame(); await renderAndUploadYoutube(); };
        ytIconImg.onerror = () => { ytIconImgReady = false; setYtStatus('Icon load failed'); drawYoutubePreviewFrame(); };
        ytIconImg.src = objUrl;
      } catch (e) {
        console.warn('Icon download failed', e);
        setYtStatus('Icon download failed');
      }
    };

    const attachThemeHandlers = () => document.querySelectorAll('.yt-theme-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.yt-theme-item').forEach(b=>b.classList.remove('active'));
        item.classList.add('active');
        const id = item.getAttribute('data-id');
        selectedThemeId = id;
        // Do not auto-download on selection; user can Preview to fetch via public API or Apply to drive LED with ESP download
        setYtStatus('Selected: ' + id);
      });
    });

    // Client-side fetch for preview only (uses public API). Produces a blob URL safe for canvas reads.
    const fetchThemeBlobById = async (id) => {
      try {
        setYtStatus('Fetching preview...');
        const resp = await fetch(`https://api.ikhode.com/themes/${encodeURIComponent(id)}/file`, { cache: 'no-store' });
        if (!resp.ok) throw new Error('http ' + resp.status);
        const blob = await resp.blob();
        const objUrl = URL.createObjectURL(blob);
        $('youtubeIconMode').value = 'blob';
        $('youtubeIconUrl').value = objUrl;
        ytIconImgReady = false;
        ytIconImg = new Image();
        ytIconImg.onload = () => { ytIconImgReady = true; setYtStatus('Preview ready', true); drawYoutubePreviewFrame(); };
        ytIconImg.onerror = () => { ytIconImgReady = false; setYtStatus('Preview failed'); drawYoutubePreviewFrame(); };
        ytIconImg.src = objUrl;
      } catch (e) {
        console.warn('Preview fetch failed', e);
        setYtStatus('Preview fetch failed');
      }
    };

    // Decode the saved icon GIF on browser using gifuct-js (bytes served from ESP), then animate
    const decodeGifFromESP = async () => {
      try {
        // Fetch raw bytes from ESP with CORS allowed
        const resp = await fetch(apiBase + '/yt_icon_current', { cache: 'no-store' });
        if (!resp.ok) throw new Error('icon not found');
        const buf = await resp.arrayBuffer();
        const gif = window.gifuct ? window.gifuct.parseGIF(buf) : (window.parseGIF && window.parseGIF(buf));
        const frames = window.gifuct ? window.gifuct.decompressFrames(gif, true) : window.decompressFrames(gif, true);
        gifLogicalW = gif.lsd.width; gifLogicalH = gif.lsd.height;
        gifFrames = frames.map(f => ({ patch: f.patch, dims: f.dims }));
        gifDelays = frames.map(f => Math.max(67, (f.delay || 10) * 10)); // respect delays, min ~15 FPS
        gifFrameIndex = 0;
        $('youtubeIconMode').value = 'gifdec';
        // Prepare offscreen canvases
        if (!gifOffscreen) { gifOffscreen = document.createElement('canvas'); }
        gifOffscreen.width = gifLogicalW; gifOffscreen.height = gifLogicalH;
        if (!ledOffscreen) { ledOffscreen = document.createElement('canvas'); }
        ledOffscreen.width = 128; ledOffscreen.height = 64;
        setYtStatus('GIF decoded', true);
      } catch (e) {
        console.warn('GIF decode failed', e);
        setYtStatus('GIF decode failed');
      }
    };

    // moved stopGifAnimation earlier to allow use before definition

    const composeYTFrame = (ctx, iconSourceCanvas) => {
      const pw = 128, ph = 64; const bg = $('youtubeBgColor').value; const col = $('youtubeTextColor').value;
      ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
      // Fill background on target
      if (ctx.canvas.width === 128 && ctx.canvas.height === 64) {
        ctx.fillStyle = bg; ctx.fillRect(0,0,pw,ph);
      } else {
        ctx.fillStyle = bg; ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);
      }
      const txt = (youtubeLastCount!==null)? String(youtubeLastCount): '—';
      const uiSize = $('youtubeIconSize') ? parseInt($('youtubeIconSize').value, 10) : 25;
      const iconH = Math.max(10, Math.min(uiSize, Math.round(64*0.9)));
      const iconW = Math.round(iconH*1.6);
      const gap = 6;
      let size=28; const fam=getFontFamily(); let font=`bold ${size}px ${fam}`; ctx.font=font; ctx.textBaseline='middle';
      let tw=ctx.measureText(txt).width;
      while ((iconW + gap + tw) > (128 - 8) && size>10) { size -= 2; font=`bold ${size}px ${fam}`; ctx.font=font; tw=ctx.measureText(txt).width; }
      const groupW = iconW + gap + tw; const x0 = Math.round((128 - groupW)/2); const cy = Math.round(64/2);
      // Frame will be drawn after icon and text
      // 1) Icon + text
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(iconSourceCanvas, x0, cy - Math.round(iconH/2), iconW, iconH);
      ctx.fillStyle = col; ctx.textAlign='left'; ctx.fillText(txt, x0 + iconW + gap, cy);
      // 2) Frame LAST
      const ytFrame = ($('youtubeFrameStyle') && $('youtubeFrameStyle').value) || 'none';
      if (ytFrame !== 'none') drawFrameOnCanvas(ctx, ytFrame, col, pw, ph);
    };

    const playGifLoop = () => {
      stopGifAnimation();
      if (!gifFrames.length || !gifOffscreen) return;
      const frame = gifFrames[gifFrameIndex];
      const delay = 100; // 10 FPS fixed for LED smoothness
      // build current frame image into offscreen
      const gctx = gifOffscreen.getContext('2d');
      const imgData = new ImageData(new Uint8ClampedArray(frame.patch), gifLogicalW, gifLogicalH);
      gctx.putImageData(imgData, 0, 0);
      // Draw to preview canvas text and re-position overlay image
      if (!$('youtubeConfig').classList.contains('hidden')) drawYoutubePreviewFrame();
      // If LED is active (apply pressed), push the frame
      if (youtubeTimer) {
        const lctx = ledOffscreen.getContext('2d');
        composeYTFrame(lctx, gifOffscreen);
        // Convert to RGB565 and upload
        const out = lctx.getImageData(0,0,128,64);
        const buf = new Uint8Array(4 + 128*64*2);
        buf[0]=128&255; buf[1]=(128>>8)&255; buf[2]=64&255; buf[3]=(64>>8)&255;
        let p=4, d=out.data; for(let y=0;y<64;y++){ for(let x=0;x<128;x++){ const i=(y*128+x)*4; const r=d[i],g=d[i+1],b=d[i+2]; const v=((r&0xF8)<<8)|((g&0xFC)<<3)|(b>>3); buf[p++]=v&255; buf[p++]=(v>>8)&255; }}
        const fd = new FormData();
        fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'yt.rgb565');
        fd.append('bg', $('youtubeBgColor').value);
        fd.append('bgMode','image');
        fd.append('offx', 0);
        fd.append('offy', 0);
        fd.append('animate',0);
        fd.append('dir','none');
        fd.append('speed',0);
        fd.append('interval',0);
        fetch(apiBase + '/upload', { method:'POST', body:fd }).catch(()=>{});
      }
      // next frame
      gifFrameIndex = (gifFrameIndex + 1) % gifFrames.length;
      gifAnimTimer = setTimeout(playGifLoop, delay);
    };

    attachThemeHandlers();

    // Load theme IDs (prefer direct API, fallback to ESP proxy if needed)
    // Theme list removed; we only support Icon Upload now.

    // Custom icon upload feature removed

    // Image file
    $('imageFile').addEventListener('change', (e)=>{
      const f = e.target.files && e.target.files[0]; if(!f) return;
      const img = new Image();
      img.onload = ()=>{ loadedImg = img; drawPreview(); };
      img.src = URL.createObjectURL(f);
    });

    // Background mode toggle
    $('bgMode').addEventListener('change', () => {
      const showImg = $('bgMode').value === 'image';
      $('bgColorWrapper').style.display = showImg ? 'none' : 'inline-block';
      $('imageFile').classList.toggle('hidden', !showImg);
      $('imageFitRow').classList.toggle('hidden', !showImg);
    });

    // Animation toggle switch
    const toggleSwitch = $('animate');
    const hiddenCheckbox = $('animateCheckbox');
    let isToggled = hiddenCheckbox && hiddenCheckbox.value === 'true';

    const updateToggleVisual = () => {
      if (isToggled) {
        toggleSwitch.classList.add('checked'); toggleSwitch.setAttribute('data-checked','true');
        $('speedWrapper').classList.remove('disabled');
        $('intervalWrapper').classList.remove('disabled');
      } else {
        toggleSwitch.classList.remove('checked'); toggleSwitch.setAttribute('data-checked','false');
        $('speedWrapper').classList.add('disabled');
        $('intervalWrapper').classList.add('disabled');
      }
    };

    toggleSwitch.addEventListener('click', () => {
      isToggled = !isToggled; updateToggleVisual(); if (hiddenCheckbox) hiddenCheckbox.value = isToggled;
    });
    Object.defineProperty($('animate'), 'checked', { get: () => isToggled, configurable: true });
    updateToggleVisual();

    // Text tab font size boxes (scope to text config only)
    document.querySelectorAll('#textConfig .font-size-box').forEach(box=>{
      box.addEventListener('click', () => {
        document.querySelectorAll('#textConfig .font-size-box').forEach(b=>b.classList.remove('active'));
        box.classList.add('active');
        $('fontSize').value = box.getAttribute('data-size');
      });
    });

    // Outline boxes (None / Border / Neon)
    document.querySelectorAll('.outline-box').forEach(box=>{
      box.addEventListener('click', () => {
        document.querySelectorAll('.outline-box').forEach(b=>b.classList.remove('active'));
        box.classList.add('active');
        const v = box.getAttribute('data-outline') || 'none';
        $('outlineStyle').value = v;
        drawPreview();
      });
    });

    // Brightness boxes
    document.querySelectorAll('.brightness-box').forEach(box=>{
      box.addEventListener('click', () => {
        document.querySelectorAll('.brightness-box').forEach(b=>b.classList.remove('active'));
        box.classList.add('active');
        $('brightness').value = box.getAttribute('data-brightness');
      });
    });

    // Speed boxes
    document.querySelectorAll('.speed-box').forEach(box=>{
      box.addEventListener('click', () => {
        if (!$('animate').checked) return;
        document.querySelectorAll('.speed-box').forEach(b=>b.classList.remove('active'));
        box.classList.add('active');
        $('speed').value = box.getAttribute('data-speed');
      });
    });

    // Interval boxes
    document.querySelectorAll('.interval-box').forEach(box=>{
      box.addEventListener('click', () => {
        if (!$('animate').checked) return;
        document.querySelectorAll('.interval-box').forEach(b=>b.classList.remove('active'));
        box.classList.add('active');
        $('interval').value = box.getAttribute('data-interval');
      });
    });

    // X-gap boxes
    document.querySelectorAll('.x-gap-box').forEach(box=>{
      box.addEventListener('click', () => {
        document.querySelectorAll('.x-gap-box').forEach(b=>b.classList.remove('active'));
        box.classList.add('active');
        $('xGap').value = box.getAttribute('data-gap');
      });
    });

    // Direction buttons
    document.querySelectorAll('.dir-btn').forEach(btn=>{
      btn.addEventListener('click', () => {
        // Remove active class from all direction buttons
        document.querySelectorAll('.dir-btn').forEach(b=>b.classList.remove('active'));
        // Add active class to clicked button
        btn.classList.add('active');
        // Update hidden input value
        $('dir').value = btn.getAttribute('data-dir');
      });
    });

          document.querySelectorAll('.color-box').forEach(box=>{
      box.addEventListener('click', function(){
        if (this.classList.contains('custom-color-btn')) {
          // Handle custom color button - directly open color picker
          const customColorInput = $('customTextColor');
          if (customColorInput) {
            customColorInput.click();
          }
        } else {
          // Handle regular color box
          document.querySelectorAll('.color-box, .color-box-wrapper').forEach(b=>b.classList.remove('active'));
          this.classList.add('active');
          $('color').value = this.getAttribute('data-color');
        }

        // When text color is selected, deactivate all gradient buttons
        document.querySelectorAll('.text-gradient-box').forEach(b=>b.classList.remove('active'));
        $('textGradient').value = 'none';

          });
    });

    // Handle custom color input change
    const customColorInput = $('customTextColor');
    if (customColorInput) {
      customColorInput.addEventListener('input', function() {
        const selectedColor = this.value;
        $('color').value = selectedColor;

        // Update custom color button background
        const customBtn = document.querySelector('.custom-color-btn');
        if (customBtn) {
          customBtn.style.background = selectedColor;
          customBtn.setAttribute('data-color', selectedColor);
        }

        // Remove active class from all color boxes and add to custom button
        document.querySelectorAll('.color-box, .color-box-wrapper').forEach(b=>b.classList.remove('active'));
        if (customBtn) {
          customBtn.classList.add('active');
        }

        // When custom text color is selected, deactivate all gradient buttons
        document.querySelectorAll('.text-gradient-box').forEach(b=>b.classList.remove('active'));
        $('textGradient').value = 'none';

          });
      }

    // Text gradient boxes with mutual exclusivity
    document.querySelectorAll('.text-gradient-box').forEach(box=>{
      box.addEventListener('click', () => {
        // Remove active class from all text gradient boxes
        document.querySelectorAll('.text-gradient-box').forEach(b=>b.classList.remove('active'));
        // Add active class to clicked gradient box
        box.classList.add('active');
        // Update hidden input value
        $('textGradient').value = box.getAttribute('data-gradient');

        // When gradient is selected, deactivate all text color buttons
        document.querySelectorAll('.color-box, .color-box-wrapper').forEach(b=>b.classList.remove('active'));
      });
    });

  document.querySelectorAll('.bg-color-box').forEach(box=>{
      box.addEventListener('click', function(){
        if (this.classList.contains('custom-bg-color-btn')) {
          // Handle custom background color button - directly open color picker
          const customBgColorInput = $('customBgColor');
          if (customBgColorInput) {
            customBgColorInput.click();
          }
        } else {
          // Handle regular background color box
          document.querySelectorAll('.bg-color-box, .bg-color-box-wrapper').forEach(b=>b.classList.remove('active'));
          this.classList.add('active');
          $('bg').value = this.getAttribute('data-color');
        }
      });
    });

    // Handle custom background color input change
    const customBgColorInput = $('customBgColor');
    if (customBgColorInput) {
      customBgColorInput.addEventListener('input', function() {
        const selectedColor = this.value;
        $('bg').value = selectedColor;

        // Update custom background color button background
        const customBtn = document.querySelector('.custom-bg-color-btn');
        if (customBtn) {
          customBtn.style.background = selectedColor;
          customBtn.setAttribute('data-color', selectedColor);
        }

        // Remove active class from all bg color boxes and add to custom button
        document.querySelectorAll('.bg-color-box, .bg-color-box-wrapper').forEach(b=>b.classList.remove('active'));
        if (customBtn) {
          customBtn.classList.add('active');
        }
      });
    }

    // Clock color, background color, and size selection
    document.querySelectorAll('.clock-color-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('.clock-color-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('clockColor').value = this.getAttribute('data-color');
      });
    });

    document.querySelectorAll('.clock-bg-color-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('.clock-bg-color-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('clockBgColor').value = this.getAttribute('data-color');
      });
    });

    document.querySelectorAll('.clock-size-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('.clock-size-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('clockSize').value = this.getAttribute('data-size');
        if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
      });
    });

    // Video fit selection
    document.querySelectorAll('.video-fit-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('.video-fit-box').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('videoFit').value = this.getAttribute('data-fit');
      });
    });

    // Video loop toggle
    const videoLoopToggle = $('videoLoopToggle');
    videoLoopToggle.addEventListener('click', function(){
      const isChecked = this.getAttribute('data-checked') === 'true';
      const newState = !isChecked;
      this.setAttribute('data-checked', newState);
      this.classList.toggle('checked', newState);
      $('videoLoop').checked = newState;
    });

    // Image fit
    $('imageFit').addEventListener('change', () => {});

    // Video controls now use main Preview and Apply buttons

    // Video file
    const vf = $('videoFile');
    videoEl = document.createElement('video');
    videoEl.muted = true; videoEl.loop = true; videoEl.playsInline = true; videoEl.crossOrigin = 'anonymous';
    vf.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        const url = URL.createObjectURL(f); videoEl.src = url; await videoEl.play();
        if (!$('videoConfig').classList.contains('hidden')) startVideoPreview();
      } catch {}
    });

    // Video loop
    $('videoLoop').addEventListener('change', ()=>{ if (videoEl) videoEl.loop = $('videoLoop').checked; });
  };

  const initFontControls = () => {
    try { registerWebFonts(); } catch (e) { console.warn('Font registration failed', e); }
    const sel = $('fontFamilySelect');
    if (!sel) return;

    // Populate options from available fonts
    sel.innerHTML = '';
    const def = document.createElement('option'); def.value = 'default'; def.textContent = 'Default'; sel.appendChild(def);
    availableFonts.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.name; opt.textContent = f.name; sel.appendChild(opt);
    });

    // Set initial value from hidden field if present
    const hidden = $('fontFamily');
    if (hidden && hidden.value) sel.value = hidden.value;

    const triggerPreview = () => {
      if (hidden) hidden.value = sel.value;
      const choice = sel.value;
      if (choice && choice !== 'default' && document.fonts && document.fonts.load) {
        // Try to load font before rendering for accurate metrics
        document.fonts.load(`normal 20px '${choice}'`).then(() => drawPreview()).catch(() => drawPreview());
      } else {
        drawPreview();
      }
    };

    sel.addEventListener('change', triggerPreview);
    // Initial preview in case non-default is preselected
    triggerPreview();
  };

  // ========= Upload Text =========
  const renderAndUpload = async () => {
    stopPreviewAnim(); stopVideoPreview(); stopThemeTimers();
    if (clockTimer) { cancelAnimationFrame(clockTimer); clockTimer = 0; }

    drawPreview();

    const pw = 128, ph = 64;
    const animate = $('animate').checked;
    const dir = $('dir').value;
    const speed = parseInt($('speed').value, 10);
    const interval = parseInt($('interval').value, 10);

    // Prepare background with optional frame; upload as bg image when needed
    const frameStyle = ($('outlineStyle') && $('outlineStyle').value) || 'none';
    const wantFrame = frameStyle !== 'none';
    const bgModeVal = $('bgMode').value;
    if ((bgModeVal === 'image' && loadedImg) || wantFrame) {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = pw; outCanvas.height = ph;
      const octx = outCanvas.getContext('2d'); octx.imageSmoothingEnabled = false;
      // Base background
      octx.fillStyle = $('bg').value; octx.fillRect(0,0,pw,ph);
      if (bgModeVal === 'image' && loadedImg) {
        const fit = $('imageFit').value;
        let dw = loadedImg.width, dh = loadedImg.height;
        if (fit === 'fill') { dw = pw; dh = ph; }
        else if (fit === 'fit') {
          const s = Math.min(pw/loadedImg.width, ph/loadedImg.height);
          dw = Math.max(1, Math.floor(loadedImg.width * s));
          dh = Math.max(1, Math.floor(loadedImg.height * s));
        } else { dw = Math.min(pw, loadedImg.width); dh = Math.min(ph, loadedImg.height); }
        const dx = Math.floor(pw*0.5 - dw/2);
        const dy = Math.floor(ph*0.5 - dh/2);
        octx.drawImage(loadedImg, dx, dy, dw, dh);
      }
      // Frame overlay
      if (wantFrame) drawFrameOnCanvas(octx, frameStyle, $('color').value, pw, ph);

      const outBg = octx.getImageData(0,0,pw,ph);
      const bufBg = new Uint8Array(4 + pw*ph*2);
      bufBg[0]=pw&255; bufBg[1]=(pw>>8)&255; bufBg[2]=ph&255; bufBg[3]=(ph>>8)&255;
      let pb=4, db=outBg.data;
      for(let y=0;y<ph;y++) for(let x=0;x<pw;x++){
        const i=(y*pw+x)*4; const r=db[i], g=db[i+1], b=db[i+2];
        const v=rgb565(r,g,b); bufBg[pb++]=v&255; bufBg[pb++]=(v>>8)&255;
      }
      const fdBg = new FormData();
      fdBg.append('image', new Blob([bufBg], {type:'application/octet-stream'}), 'bg.rgb565');
      await fetch(apiBase + '/upload_bg', { method:'POST', body: fdBg });
    }

    // Text layer using crisp bitmap builder (supports outline)
    let outCanvas = document.createElement('canvas');
    if ($('text').value.trim().length > 0) {
      const fam = getTextFontFamily(); const size = parseInt($('fontSize').value, 10);
      const xGap = parseInt($('xGap').value, 10) || 0;
      const color = $('color').value;
      const gradientSpec = $('textGradient').value;
      const thickness = getThickness();
      outCanvas = buildTextBitmap($('text').value, fam, size, xGap, color, gradientSpec, thickness, false);
    } else { outCanvas.width = 1; outCanvas.height = 1; }

    // Pack A8 + RGB565
    const out = outCanvas.getContext('2d').getImageData(0,0,outCanvas.width,outCanvas.height);
    const outW = outCanvas.width, outH = outCanvas.height;
    const buf = new Uint8Array(4 + outW*outH*3);
    buf[0]=outW&255; buf[1]=(outW>>8)&255; buf[2]=outH&255; buf[3]=(outH>>8)&255;
    let p=4, d=out.data;
    for(let y=0;y<outH;y++) for(let x=0;x<outW;x++){
      const i=(y*outW + x) * 4; // Fixed: changed outH to outW
    }
    // correct packing loop
    p = 4;
    for(let y=0;y<outH;y++) {
      for(let x=0;x<outW;x++){
        const i=(y*outW+x)*4;
        const r=d[i], g=d[i+1], b=d[i+2], a=d[i+3];
        const v=rgb565(r,g,b);
        buf[p++]=a; buf[p++]=v&255; buf[p++]=(v>>8)&255;
      }
    }

    const fd = new FormData();
    fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'img.rgb565');
    fd.append('bg', $('bg').value);
    const effectiveBgMode = wantFrame ? 'image' : $('bgMode').value;
    fd.append('bgMode', effectiveBgMode);
    fd.append('offx', 0);
    fd.append('offy', 0);
    fd.append('animate', ( $('text').value.trim().length>0 && animate)?1:0);
    fd.append('brightness', parseInt($('brightness').value, 10));
    fd.append('dir', dir);
    fd.append('speed', speed);
    fd.append('interval', interval);
    const res = await fetch(apiBase + '/upload', { method:'POST', body: fd });
    if(!res.ok){ alert('Upload failed: '+res.status); return; }
  };

  // ========= Init =========
  const initApp = () => {
    // Show/hide image fit row depending on bgMode
    const showImg = $('bgMode').value === 'image';
    $('imageFitRow').classList.toggle('hidden', !showImg);

    initTabs();
    initEventListeners();
    initFontControls();
    initWifiControls();
    initPanelConfig();
    initChannelModal();
    drawPreview();
  };

  const initChannelModal = () => {
    const btn = $('btnEditChannel');
    const modal = $('editChannelModal');
    const btnClose = $('btnChanClose');
    const btnCancel = $('btnChanCancel');
    const btnSave = $('btnChanSave');
    const btnPaste = $('btnChanPaste');
    const input = $('modalYoutubeChannel');
    const mainInput = $('youtubeChannelId');
    const open = () => { input.value = (mainInput && mainInput.value) || ''; modal.classList.remove('hidden'); };
    const close = () => modal.classList.add('hidden');
    if (btn) btn.addEventListener('click', open);
    if (btnClose) btnClose.addEventListener('click', close);
    if (btnCancel) btnCancel.addEventListener('click', close);
    if (btnPaste) btnPaste.addEventListener('click', async () => {
      try {
        let txt = '';
        if (navigator.clipboard && navigator.clipboard.readText) {
          txt = (await navigator.clipboard.readText()) || '';
        } else {
          txt = window.prompt('Paste channel ID:', input.value || '') || '';
        }
        txt = txt.trim();
        if (txt) {
          input.value = txt;
          try { if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt); } catch {}
        }
      } catch {}
    });
    if (btnSave) btnSave.addEventListener('click', async () => {
      const id = (input.value || '').trim();
      if (!id) { alert('Please enter a channel ID'); return; }
      const body = new URLSearchParams(); body.set('id', id);
      try { await fetch(apiBase + '/yt_channel', { method: 'POST', body }); } catch {}
      if (mainInput) mainInput.value = id;
      setYtStatus('🟢', true);
      close();
      await fetchYoutubeStats();
      await renderAndUploadYoutube();
    });
    // Load saved channel from ESP on startup
    fetch(apiBase + '/yt_channel').then(r=>r.ok?r.json():null).then(j=>{
      if (j && j.id && mainInput) mainInput.value = j.id;
    }).catch(()=>{});
  };

  
  // Global function that theme controls can call to update preview
  // This creates a direct bridge between theme controls and main script
  window.refreshThemePreview = () => {
    console.log('🎨 Global refreshThemePreview called from theme controls');

    if (window.__theme && window.__themeTimer) {
      clearInterval(window.__themeTimer);

      const pv = getPreviewCanvas();
      const pctx = pv.getContext('2d');
      const state = window.__theme.init ? window.__theme.init() : {};

      const step = () => {
        try {
          pctx.clearRect(0,0,pv.width,pv.height);
          window.__theme.render(pctx, pv.width, pv.height, state, Date.now());
        } catch (e) {
          console.error('Error rendering theme after refresh call:', e);
        }
      };

      window.__themeTimer = setInterval(step, 1000);
      step(); // Render immediately
      console.log('✅ Theme preview refreshed via global function');
    }
  };

  document.addEventListener('DOMContentLoaded', initApp);
})();
