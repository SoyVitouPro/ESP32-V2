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
  let videoEl = null;
  let videoPreviewRaf = 0;
  let videoUploadActive = false;
  let videoUploadLastMs = 0;
  let videoUploadIntervalMs = 100;
  let videoUploadInFlight = false;

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
    return pv;
  };

  const rgb565 = (r, g, b) => ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | ((b) >> 3);

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

  const getFontFamily = () =>
    `'Noto Sans Khmer', 'Khmer OS Content', system-ui, Arial, sans-serif`;

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
    const fam = getFontFamily();
    const font = `bold ${size}px ${fam}`;

    ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const m = ctx.measureText(text);
    textW = Math.ceil(m.width);
    textH = Math.ceil(size * 1.2);
    const gap = parseInt($('interval').value, 10) || 1;
    spacing = Math.max(1, textW + gap);

    const totalCopies = Math.ceil((pw + spacing * 2) / spacing) + 2;
    heads = [];
    for (let i = 0; i < totalCopies; i++) {
      if ($('dir').value === 'left') heads.push(pw + (i * spacing));
      else heads.push(-textW - (i * spacing));
    }
    lastTs = 0; accMs = 0;
  };

  const drawPreviewFrame = (animated) => {
    const text = $('text').value;
    const fam = getFontFamily();
    const size = parseInt($('fontSize').value, 10);
    const font = `bold ${size}px ${fam}`;
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
    ctx.font = font; ctx.textBaseline = 'middle'; ctx.fillStyle = color;

    if (animated && text.length > 0) {
      ctx.textAlign = 'left';
      heads.forEach(headX => {
        const xLeft = Math.floor(headX);
        if (xLeft >= -textW && xLeft <= 128) ctx.fillText(text, xLeft, cy);
      });
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(text, Math.floor(pw * 0.5), cy);
    }
  };

  const animatePreview = (ts) => {
    if (!$('animate').checked || $('text').value.trim().length === 0) {
      stopPreviewAnim(); drawPreviewFrame(false); return;
    }
    if (!lastTs) lastTs = ts;
    const speed = parseInt($('speed').value, 10) || 30;
    accMs += (ts - lastTs); lastTs = ts;

    const pw = 128;
    while (accMs >= speed) {
      accMs -= speed;
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
    const fam = getFontFamily();
    const font = `bold ${size}px ${fam}`;
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

    ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = col;
    const txt = formatTime(fmt);
      // Adjust vertical position based on font size for better centering
    let yOffset = Math.floor(ph * 0.5);
    if (size <= 15) {
      yOffset -= 2; // Shift up for very small text
    } else if (size <= 20) {
      yOffset -= 1; // Shift up slightly for small text
    }
    ctx.fillText(txt, Math.floor(pw * 0.5), yOffset);
  };

  const startClockPreview = () => {
    if (clockPreviewTimer) clearInterval(clockPreviewTimer);
    drawClockPreviewFrame();
    clockPreviewTimer = setInterval(drawClockPreviewFrame, 1000);
  };

  const renderAndUploadClock = async () => {
    stopPreviewAnim(); stopVideoPreview(); stopThemeTimers();

    const pw = 128, ph = 64;
    const fmt = '24';
    const size = parseInt($('clockSize').value, 10);
    const fam = getFontFamily();
    const font = `bold ${size}px ${fam}`;
    const col = $('clockColor').value;
    const clockBg = $('clockBgColor').value;

    const t = document.createElement('canvas'); t.width = pw; t.height = ph;
    const tctx = t.getContext('2d');
    tctx.fillStyle = clockBg; tctx.fillRect(0, 0, pw, ph);
    tctx.font = font; tctx.textBaseline = 'middle'; tctx.textAlign = 'center'; tctx.fillStyle = col;
    const txt = formatTime(fmt);
      // Adjust vertical position based on font size for better centering
    let yOffset = Math.floor(ph * 0.5);
    if (size <= 15) {
      yOffset -= 2; // Shift up for very small text
    } else if (size <= 20) {
      yOffset -= 1; // Shift up slightly for small text
    }
    tctx.fillText(txt, Math.floor(pw * 0.5), yOffset);

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
    fd.append('dir', 'left');
    fd.append('speed', 20);
    fd.append('interval', 5);
    await fetch(apiBase + '/upload', { method: 'POST', body: fd });
  };

  const startSmoothClockTimer = () => {
    let lastUploadTime = 0;
    const UPLOAD_INTERVAL = 1000;

    const updateClock = async (timestamp) => {
      if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
      if (timestamp - lastUploadTime >= UPLOAD_INTERVAL) {
        lastUploadTime = timestamp;
        try { await renderAndUploadClock(); } catch {}
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

    if (videoMode) {
      stopPreviewAnim(); drawVideoPreviewFrame();
    } else if (clockMode) {
      stopPreviewAnim(); drawClockPreviewFrame();
      if (clockPreviewTimer) clearInterval(clockPreviewTimer);
      clockPreviewTimer = setInterval(drawClockPreviewFrame, 1000);
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
    const tabTheme = $('tabTheme');

    const textCfg = $('textConfig');
    const clockCfg = $('clockConfig');
    const videoCfg = $('videoConfig');
    const themeCfg = $('themeConfig');

    const activate = (which) => {
      const map = { text: textCfg, clock: clockCfg, video: videoCfg, theme: themeCfg };
      // Tabs visual
      [tabText, tabClock, tabVideo, tabTheme].forEach(btn => btn && btn.classList.remove('active'));
      // Sections hide/show
      [textCfg, clockCfg, videoCfg, themeCfg].forEach(el => el && el.classList.add('hidden'));

      if (which === 'text') { tabText.classList.add('active'); textCfg.classList.remove('hidden'); hideThemeControls(); }
      if (which === 'clock') { tabClock.classList.add('active'); clockCfg.classList.remove('hidden'); hideThemeControls(); }
      if (which === 'video') { tabVideo.classList.add('active'); videoCfg.classList.remove('hidden'); hideThemeControls(); }
      if (which === 'theme') {
        tabTheme.classList.add('active'); themeCfg.classList.remove('hidden');
        if (window.__theme) showThemeControls();
      }
    };

    tabText.addEventListener('click', () => activate('text'));
    tabClock.addEventListener('click', () => activate('clock'));
    tabVideo.addEventListener('click', () => activate('video'));
    tabTheme.addEventListener('click', () => activate('theme'));

    // default
    activate('text');

    // Theme upload / start / reapply wiring is in initThemeControls()
  };

  // ========= Theme Controls / Upload =========
  const showThemeControls = () => { $('themeControlsSection').classList.remove('hidden'); };
  const hideThemeControls = () => { $('themeControlsSection').classList.add('hidden'); };

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
    if (window.__theme && window.__theme.settings) {
      window.__theme.settings[setting] = value;
      if (window.__themeTimer) {
        clearInterval(window.__themeTimer);
        const api = window.__theme;
        const pv = getPreviewCanvas();
        const pctx = pv.getContext('2d');
        const state = api.init ? api.init() : {};
        const step = () => { pctx.clearRect(0,0,pv.width,pv.height); api.render(pctx, pv.width, pv.height, state, Date.now()); };
        window.__themeTimer = setInterval(step, 200);
        step();
      }
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
    // Buttons
    const btnThemeUpload = $('btnThemeUpload');
    const btnThemeStart  = $('btnThemeStart');
    const btnThemeReapply = $('btnThemeReapply');

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

    if (btnThemeUpload) btnThemeUpload.addEventListener('click', async () => {
      const inp = $('themeFile'); const f = inp && inp.files && inp.files[0];
      if (!f) { alert('Choose a theme HTML file first'); return; }

      hideThemeControls(); stopThemeTimers();
      window.__theme = null; window.themeInitBackup = null; window.themeRenderBackup = null;

      let txt = await f.text();
      txt = injectThemeSettings(txt);

      const m = txt.match(/<fps>\s*(\d{1,2})\s*<\/fps>/i);
      const currentThemeFps = m ? Math.max(1, Math.min(30, parseInt(m[1],10) || 1)) : 1;

      try {
        const mscript = txt.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
        if (!mscript) throw new Error('No <script> in theme');
        const code = mscript[1];
        eval(code);

        const api = { init: (typeof themeInit !== 'undefined') ? themeInit : null, render: (typeof themeRender !== 'undefined') ? themeRender : null };
        window.themeInitBackup = api.init; window.themeRenderBackup = api.render;
        if (!api || !api.render) throw new Error('themeRender() not found');
        window.__theme = api;

        showThemeControls(); if (!window.themeControlsInitialized) { updateControlValuesFromTheme(); window.themeControlsInitialized = true; }

        const pv = getPreviewCanvas(), pctx = pv.getContext('2d');
        const state = api.init ? api.init() : {};
        if (window.__themeTimer) clearInterval(window.__themeTimer);
        const step = () => { pctx.clearRect(0,0,pv.width,pv.height); api.render(pctx, pv.width, pv.height, state, Date.now()); };
        const period = Math.round(1000 / Math.max(1, Math.min(30, currentThemeFps)));
        window.__themeTimer = setInterval(step, period);
        step();

        stopContentForPreview();

        // Upload theme file as-is to the device
        try {
          const fd = new FormData();
          fd.append('file', f, f.name);
          await fetch(apiBase + '/upload_theme', { method:'POST', body:fd });
        } catch (uploadErr) {
          alert('Theme uploaded for preview but failed to save to device: ' + uploadErr.message);
        }
      } catch (e) {
        alert('Theme error: ' + e.message);
        hideThemeControls(); stopThemeTimers(); window.__theme = null; window.themeInitBackup = null; window.themeRenderBackup = null;
      }
    });

    if (btnThemeStart) btnThemeStart.addEventListener('click', async () => {
      if (!window.__theme) { alert('Upload a theme first'); return; }
      try {
        const r = await fetch(apiBase + '/theme_status', { cache:'no-store' });
        const status = await r.json();
        if (!status.theme_uploaded) { alert('Theme not yet uploaded to device. Please upload the theme first.'); return; }
      } catch { alert('Failed to check theme status. Please try uploading again.'); return; }

      // stop others and keep theme fn refs
      const currentTheme = window.__theme, initB = window.themeInitBackup, renderB = window.themeRenderBackup;
      stopAllRunningContent();
      window.__theme = currentTheme; window.themeInitBackup = initB; window.themeRenderBackup = renderB;

      const api = window.__theme;
      let state = {};
      if (api.init && typeof api.init === 'function') { try { state = api.init(); } catch { state = {}; } }

      if (window.__playTimer) clearInterval(window.__playTimer);
      const pv = getPreviewCanvas(), pctx = pv.getContext('2d');
      const step = async () => {
        try { api.render(pctx, pv.width, pv.height, state, Date.now()); } catch { return; }
        const img = pctx.getImageData(0, 0, pv.width, pv.height);
        const w = pv.width, h = pv.height, d = img.data;
        const buf = new Uint8Array(4 + w * h * 2);
        buf[0] = w & 255; buf[1] = w >> 8; buf[2] = h & 255; buf[3] = h >> 8;
        let i = 4;
        for (let k = 0; k < d.length; k += 4) {
          const r = d[k], g = d[k + 1], b = d[k + 2];
          const v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >>> 3);
          buf[i++] = v & 255; buf[i++] = v >> 8;
        }
        const fd = new FormData(); fd.append('image', new Blob([buf], { type: 'application/octet-stream' }), 'frame.rgb565');
        try { await fetch(apiBase + '/upload', { method: 'POST', body: fd }); } catch {}
      };
      window.__playTimer = setInterval(step, 1000);
      step();
    });

    if (btnThemeReapply) btnThemeReapply.addEventListener('click', async () => {
      if (!window.__theme) { alert('Please upload a theme first'); return; }
      const inp = $('themeFile');
      const f = inp && inp.files && inp.files[0];
      if (!f) { alert('Please select the theme file again to reapply settings'); return; }

      const txt = await f.text();
      const modifiedTxt = injectThemeSettings(txt);
      try {
        const mscript = modifiedTxt.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
        if (!mscript) throw new Error('No <script> in theme');
        const code = mscript[1];
        eval(code);
        const api = { init: (typeof themeInit !== 'undefined') ? themeInit : null, render: (typeof themeRender !== 'undefined') ? themeRender : null };
        if (!api || !api.render) throw new Error('themeRender() not found in modified theme');
        window.__theme = api;

        updateControlValuesFromTheme();

        const pv = getPreviewCanvas(), pctx = pv.getContext('2d');
        const state = api.init ? api.init() : {};
        if (window.__themeTimer) clearInterval(window.__themeTimer);
        const step = () => { pctx.clearRect(0,0,pv.width,pv.height); api.render(pctx, pv.width, pv.height, state, Date.now()); };
        const period = Math.round(1000 / Math.max(1, Math.min(30, 15)));
        window.__themeTimer = setInterval(step, period);
        step();
      } catch (e) {
        alert('Error reapplying theme settings: ' + e.message);
      }
    });
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

  const initEventListeners = () => {
    // Apply (tab-aware)
    $('btn').addEventListener('click', async (e) => {
      e.preventDefault();
      const textMode = !$('textConfig').classList.contains('hidden');
      const clockMode = !$('clockConfig').classList.contains('hidden');
      const videoMode = !$('videoConfig').classList.contains('hidden');
      const themeMode = !$('themeConfig').classList.contains('hidden');

      if (textMode) {
        await renderAndUpload();
      } else if (clockMode) {
        await renderAndUploadClock();
        if (!clockTimer) startSmoothClockTimer();
      } else if (videoMode) {
        // use Start/Stop buttons
        console.log('Video: use Start/Stop buttons');
      } else if (themeMode) {
        console.log('Theme: use Start to apply');
      }
    });

    // Text preview button
    $('btnTextPreview').addEventListener('click', (e) => {
      e.preventDefault();
      stopContentForPreview();
      if ($('animate').checked && $('text').value.trim().length > 0) initPreviewAnim();
      drawPreview();
    });

    // Config inputs (no auto preview except clock)
    ['text','fontSize','color','bg','brightness','animate','dir','speed','interval'].forEach(id=>{
      $(id) && $(id).addEventListener('input', () => {});
    });
    ['clockSize','clockColor','clockBgColor'].forEach(id=>{
      $(id) && $(id).addEventListener('input', () => {
        if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
      });
    });

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

    // Font size boxes
    document.querySelectorAll('.font-size-box').forEach(box=>{
      box.addEventListener('click', () => {
        document.querySelectorAll('.font-size-box').forEach(b=>b.classList.remove('active'));
        box.classList.add('active');
        $('fontSize').value = box.getAttribute('data-size');
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

          document.querySelectorAll('.color-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('.color-box, .color-box-wrapper').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('color').value = this.getAttribute('data-color');
      });
    });

  document.querySelectorAll('.bg-color-box').forEach(box=>{
      box.addEventListener('click', function(){
        document.querySelectorAll('.bg-color-box, .bg-color-box-wrapper').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        $('bg').value = this.getAttribute('data-color');
      });
    });

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
      });
    });

    // Image fit
    $('imageFit').addEventListener('change', () => {});

    // Video start/stop
    $('btnVideoStart').addEventListener('click', () => {
      stopAllRunningContent();
      const fpsSel = $('videoFps');
      const fps = fpsSel ? parseInt(fpsSel.value,10) || 10 : 10;
      videoUploadIntervalMs = Math.max(50, Math.floor(1000 / fps));
      videoUploadActive = true; videoUploadLastMs = 0;
      startVideoPreview();
    });
    $('btnVideoStop').addEventListener('click', () => {
      videoUploadActive = false; videoUploadInFlight = false;
    });

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

    // If bg image — upload bg first
    if ($('bgMode').value === 'image' && loadedImg) {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = pw; outCanvas.height = ph;
      const octx = outCanvas.getContext('2d'); octx.imageSmoothingEnabled = false;
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

      octx.fillStyle = $('bg').value; octx.fillRect(0,0,pw,ph);
      octx.drawImage(loadedImg, dx, dy, dw, dh);

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

    // Text layer
    let outCanvas = document.createElement('canvas');
    if ($('text').value.trim().length > 0) {
      const fam = getFontFamily(); const size = parseInt($('fontSize').value, 10);
      const font = `bold ${size}px ${fam}`;
      const t = document.createElement('canvas');
      const tctx = t.getContext('2d');
      tctx.font = font; tctx.textBaseline = 'alphabetic'; tctx.textAlign = 'left';
      const metrics = tctx.measureText($('text').value);
      let tw = Math.max(1, Math.ceil(metrics.width) + 4);
      let th = Math.max(1, Math.ceil(size * 1.2 + 6));
      t.width = tw; t.height = th;
      tctx.font = font; tctx.textBaseline = 'alphabetic'; tctx.textAlign = 'left';
      tctx.fillStyle = $('color').value;
      const baseY = Math.floor(size);
      tctx.fillText($('text').value, 0, baseY);

      const img = tctx.getImageData(0,0,t.width,t.height);
      const bb = cropImageData(img.data, t.width, t.height);
      let outW = Math.max(1, bb.w), outH = Math.max(1, bb.h);
      outCanvas.width = outW; outCanvas.height = outH;
      outCanvas.getContext('2d').putImageData(new ImageData(img.data, t.width, t.height), -bb.x, -bb.y);
    } else {
      outCanvas.width = 1; outCanvas.height = 1;
    }

    // Pack A8 + RGB565
    const out = outCanvas.getContext('2d').getImageData(0,0,outCanvas.width,outCanvas.height);
    const outW = outCanvas.width, outH = outCanvas.height;
    const buf = new Uint8Array(4 + outW*outH*3);
    buf[0]=outW&255; buf[1]=(outW>>8)&255; buf[2]=outH&255; buf[3]=(outH>>8)&255;
    let p=4, d=out.data;
    for(let y=0;y<outH;y++) for(let x=0;x<outW;x++){
      const i=(y*outH + x) * 4; // bug risk: should be y*outW + x; fix:
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
    fd.append('bgMode', $('bgMode').value);
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
    initThemeControls();
    initPanelConfig();
    hideThemeControls(); // hidden until a theme is loaded
    drawPreview();
  };

  document.addEventListener('DOMContentLoaded', initApp);
})();
