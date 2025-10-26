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
  const applyCurrentTheme = async () => {
    if (!window.__theme || !originalThemeContent) {
      console.error('❌ No theme loaded to apply');
      return;
    }

    try {
      console.log('🔄 Applying current theme to LED display...');

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

  
  // Stream animated theme frames to ESP32 at 1 FPS for live clock updates
  const applyThemeDirectly = async () => {
    if (!window.__theme || !originalThemeContent) {
      console.error('❌ No theme loaded to apply');
      return;
    }

    // Check if already streaming - if so, stop it
    if (window.__themeStreamingInterval) {
      clearInterval(window.__themeStreamingInterval);
      window.__themeStreamingInterval = null;

      btnMergeTheme.textContent = 'Apply to LED';
      btnMergeTheme.style.background = '#27ae60';

      const fileName = document.getElementById('themeFileName');
      if (fileName) {
        fileName.textContent = 'Streaming stopped';
        fileName.style.color = '#ff9900';
      }

      console.log('🛑 Theme streaming stopped');
      return;
    }

    try {
      console.log('🚀 Starting animated theme streaming to ESP32...');

      // Get current theme state with all user modifications
      const api = window.__theme;
      const state = api.init ? api.init() : {};

      if (!state.settings) {
        console.error('❌ Theme settings not available');
        return;
      }

      console.log('📋 Theme settings for streaming:', state.settings);

      // Update UI to show streaming is active
      btnMergeTheme.textContent = 'Stop Streaming';
      btnMergeTheme.style.background = '#e74c3c';

      const fileName = document.getElementById('themeFileName');
      if (fileName) {
        fileName.textContent = 'Streaming live clock...';
        fileName.style.color = '#e74c3c';
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
            console.log(`⏰ Clock frame ${frameCount} uploaded (${new Date().toLocaleTimeString()})`);

            // Update frame count every 5 frames
            if (frameCount % 5 === 0) {
              if (fileName) {
                fileName.textContent = `Live clock - ${frameCount} frames sent`;
                fileName.style.color = '#00ff00';
              }
            }
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

      console.log('⏰ Live clock streaming started (1 FPS updates)');

    } catch (error) {
      console.error('❌ Failed to start theme streaming:', error);
      throw error;
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
            const defaultSize = state.settings.fontSize;
            console.log('🎯 Setting initial font size active state for:', defaultSize);

            // Remove active class from all theme font size buttons
            document.querySelectorAll('.theme-font-size-box').forEach(btn => btn.classList.remove('active'));

            // Add active class to the button matching the default font size
            const defaultButton = document.querySelector(`.theme-font-size-box[data-size="${defaultSize}"]`);
            if (defaultButton) {
              defaultButton.classList.add('active');
              console.log('✅ Initial font size button set to active:', defaultSize);
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
        console.log('Theme: applying theme directly to ESP32');
        await applyThemeDirectly();
      }
    });

    // Preview button (handles text and theme)
    $('btnTextPreview').addEventListener('click', (e) => {
      e.preventDefault();
      stopContentForPreview();

      // Check if theme tab is active and has a loaded theme
      const isThemeTab = !$('themeConfig').classList.contains('hidden');
      const hasTheme = window.__theme && window.__theme.render;

      console.log('Preview button clicked - Theme tab:', isThemeTab, 'Has theme:', hasTheme);

      if (isThemeTab && hasTheme) {
        console.log('Starting theme preview...');
        // Preview theme
        const pv = getPreviewCanvas(), pctx = pv.getContext('2d');
        const state = window.__theme.init ? window.__theme.init() : {};

        if (window.__themeTimer) clearInterval(window.__themeTimer);
        const step = () => {
          pctx.clearRect(0,0,pv.width,pv.height);
          window.__theme.render(pctx, pv.width, pv.height, state, Date.now());
          console.log('Theme frame rendered');
        };
        window.__themeTimer = setInterval(step, 1000); // 1 FPS for theme preview
        step(); // Render first frame immediately
      } else {
        console.log('Previewing text instead of theme');
        // Preview text
        if ($('animate').checked && $('text').value.trim().length > 0) initPreviewAnim();
        drawPreview();
      }
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
