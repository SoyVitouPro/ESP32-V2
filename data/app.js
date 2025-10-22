// Global variables
const $ = id => document.getElementById(id);
const c = document.getElementById('preview');
const ctx = c.getContext('2d');
let loadedImg = null;
let userFontLoaded = false;

// Stop theme timers when switching away from theme tab
function stopThemeTimers() {
  if (window.__themeTimer) {
    clearInterval(window.__themeTimer);
    window.__themeTimer = null;
  }
  if (window.__playTimer) {
    clearInterval(window.__playTimer);
    window.__playTimer = null;
  }
}

// Animation state variables
let rafId = 0; let lastTs = 0; let accMs = 0; let head0 = 0; let head1 = 0; let spacing = 0; let textW = 0; let textH = 0;

// Stop preview animation
function stopPreviewAnim() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

// Initialize preview animation
function initPreviewAnim() {
  const pw=parseInt($('pw').value,10); const ph=parseInt($('ph').value,10);
  const size=parseInt($('fontSize').value,10);
  const text=$('text').value;
  const fam = getFontFamily();
  const font = `bold ${size}px ${fam}`;

  // measure text width (approx, includes padding if enabled)
  ctx.font=font; ctx.textBaseline='middle'; ctx.textAlign='left';
  const m = ctx.measureText(text);
  const pad = $('textBg').checked ? (parseInt($('textBgPad').value,10) || 0) : 0;
  textW = Math.ceil(m.width) + pad*2;
  textH = Math.ceil(size*1.2) + pad*2;
  const gap = parseInt($('interval').value,10) || 1;
  spacing = Math.max(1, textW + gap);

  if ($('dir').value === 'left') {
    head0 = pw; head1 = head0 + spacing;
  } else {
    head0 = -textW; head1 = head0 - spacing;
  }
  lastTs = 0; accMs = 0;
}

// Draw preview frame
function drawPreviewFrame(animated){
  const text=$('text').value;
  const fam = getFontFamily();
  const size=parseInt($('fontSize').value,10);
  const font = `bold ${size}px ${fam}`;
  const color=$('color').value;
  const bg=$('bg').value;
  const pw=parseInt($('pw').value,10); const ph=parseInt($('ph').value,10);
  const offx=parseInt($('offx').value,10); const offy=parseInt($('offy').value,10);

  c.width = pw; c.height = ph;
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle=bg; ctx.fillRect(0,0,c.width,c.height);

  if ($('bgMode').value === 'image' && loadedImg) {
    const fit = $('imageFit').value;
    let dw = loadedImg.width, dh = loadedImg.height;
    if (fit === 'fill') { dw = pw; dh = ph; }
    else if (fit === 'fit') {
      const s = Math.min(pw/loadedImg.width, ph/loadedImg.height);
      dw = Math.max(1, Math.floor(loadedImg.width * s));
      dh = Math.max(1, Math.floor(loadedImg.height * s));
    } else if (fit === 'original') {
      dw = Math.min(pw, loadedImg.width); dh = Math.min(ph, loadedImg.height);
    }
    const dx = Math.floor(pw*0.5 - dw/2);
    const dy = Math.floor(ph*0.5 - dh/2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(loadedImg, dx, dy, dw, dh);
  }

  // text background box (optional) and text overlay
  const cy = Math.floor(ph*0.5) + offy;
  const pad = $('textBg').checked ? (parseInt($('textBgPad').value,10) || 0) : 0;
  ctx.font=font; ctx.textBaseline='middle'; ctx.fillStyle=color;

  if (animated && text.length > 0) {
    // draw two heads for seamless wrap
    ctx.textAlign='left';
    const drawAt = (leftX) => {
      const xLeft = Math.floor(leftX) + offx;
      if ($('textBg').checked){
        ctx.fillStyle = $('textBgColor').value;
        if ($('textBgRound').checked) {
          const r = parseInt($('textBgRadius').value,10) || 0;
          const rr = Math.max(0, Math.min(r, Math.min(textW,textH)/2));
          ctx.beginPath();
          const rx = xLeft - pad, ry = cy - Math.floor(textH/2);
          const rw = textW, rh = textH;
          ctx.moveTo(rx+rr, ry);
          ctx.arcTo(rx+rw, ry,   rx+rw, ry+rh, rr);
          ctx.arcTo(rx+rw, ry+rh, rx,     ry+rh, rr);
          ctx.arcTo(rx,     ry+rh, rx,     ry,     rr);
          ctx.arcTo(rx,     ry,   rx+rw,   ry,     rr);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(xLeft - pad, cy - Math.floor(textH/2), textW, textH);
        }
        ctx.fillStyle = color;
      }
      ctx.fillText(text, xLeft, cy);
    };
    drawAt(head0);
    drawAt(head1);
  } else {
    // static centered
    const cx = Math.floor(pw*0.5) + offx;
    ctx.textAlign='center';
    if ($('textBg').checked){
      const m = ctx.measureText(text);
      const tw = Math.ceil(m.width) + pad*2;
      const th = Math.ceil(size*1.2) + pad*2;
      ctx.fillStyle = $('textBgColor').value;
      if ($('textBgRound').checked) {
        const r = parseInt($('textBgRadius').value,10) || 0;
        const rr = Math.max(0, Math.min(r, Math.min(tw,th)/2));
        const rx = cx - Math.floor(tw/2), ry = cy - Math.floor(th/2);
        ctx.beginPath();
        ctx.moveTo(rx+rr, ry);
        ctx.arcTo(rx+tw, ry,   rx+tw, ry+th, rr);
        ctx.arcTo(rx+tw, ry+th, rx,    ry+th, rr);
        ctx.arcTo(rx,    ry+th, rx,    ry,    rr);
        ctx.arcTo(rx,    ry,   rx+tw,  ry,    rr);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(cx - Math.floor(tw/2), cy - Math.floor(th/2), tw, th);
      }
      ctx.fillStyle = color;
    }
    ctx.fillText(text, cx, cy);
  }
}

// Animate preview
function animatePreview(ts){
  if (!$('animate').checked || $('text').value.trim().length === 0) {
    stopPreviewAnim();
    drawPreviewFrame(false);
    return;
  }

  if (!lastTs) lastTs = ts;
  const speed = parseInt($('speed').value,10) || 30;
  accMs += (ts - lastTs); lastTs = ts;

  while (accMs >= speed) {
    accMs -= speed;
    if ($('dir').value === 'left') { head0 -= 1; head1 -= 1; }
    else { head0 += 1; head1 += 1; }
    const pw = parseInt($('pw').value,10);
    // recycle heads
    if ($('dir').value === 'left') {
      if (head0 + textW <= 0) head0 = head1 + spacing;
      if (head1 + textW <= 0) head1 = head0 + spacing;
    } else {
      if (head0 >= pw) head0 = head1 - spacing;
      if (head1 >= pw) head1 = head0 - spacing;
    }
  }
  drawPreviewFrame(true);
  rafId = requestAnimationFrame(animatePreview);
}

function drawPreview(){
  console.log('drawPreview called');

  const clockMode = (document.getElementById('clockConfig') && document.getElementById('clockConfig').style.display !== 'none');
  const videoMode = (document.getElementById('videoConfig') && document.getElementById('videoConfig').style.display !== 'none');
  const textMode = (document.getElementById('textConfig') && document.getElementById('textConfig').style.display !== 'none');

  console.log('Mode check - text:', textMode, 'clock:', clockMode, 'video:', videoMode);

  if (videoMode) {
    console.log('Drawing video preview');
    stopPreviewAnim();
    if (typeof drawVideoPreviewFrame === 'function') {
      drawVideoPreviewFrame();
    } else {
      console.error('drawVideoPreviewFrame not available');
    }
  } else if (clockMode) {
    console.log('Drawing clock preview');
    stopPreviewAnim();
    if (typeof drawClockPreviewFrame === 'function') {
      drawClockPreviewFrame();
    } else {
      console.error('drawClockPreviewFrame not available');
    }
  } else if (textMode && $('animate').checked && $('text').value.trim().length > 0) {
    console.log('Drawing animated text preview');
    stopPreviewAnim();
    if (typeof initPreviewAnim === 'function') {
      initPreviewAnim();
      if (typeof drawPreviewFrame === 'function') {
        drawPreviewFrame(true);
        rafId = requestAnimationFrame(animatePreview);
      } else {
        console.error('drawPreviewFrame not available');
      }
    } else {
      console.error('initPreviewAnim not available');
    }
  } else {
    console.log('Drawing static preview');
    stopPreviewAnim();
    if (typeof drawPreviewFrame === 'function') {
      drawPreviewFrame(false);
    } else {
      console.error('drawPreviewFrame not available - creating fallback');
      // Fallback preview
      const c = document.getElementById('preview');
      const ctx = c.getContext('2d');
      if (c && ctx) {
        const pw = parseInt($('pw').value,10) || 128;
        const ph = parseInt($('ph').value,10) || 64;
        c.width = pw; c.height = ph;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, pw, ph);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Preview', pw/2, ph/2);
      }
    }
  }
}

function initTabs(){
  const tabText = document.getElementById('tabText');
  const tabClock = document.getElementById('tabClock');
  const tabVideo = document.getElementById('tabVideo');
  const tabTheme = document.getElementById('tabTheme');
  const textCfg = document.getElementById('textConfig');
  const clockCfg = document.getElementById('clockConfig');
  const videoCfg = document.getElementById('videoConfig');
  const themeCfg = document.getElementById('themeConfig');

  function activate(which){
    if (which==='text'){
      tabText.classList.add('active'); tabClock.classList.remove('active'); if (tabVideo) tabVideo.classList.remove('active'); if (tabTheme) tabTheme.classList.remove('active');
      textCfg.style.display='block'; clockCfg.style.display='none'; if (videoCfg) videoCfg.style.display='none'; if (themeCfg) themeCfg.style.display='none';
      stopClockPreview(); stopVideoPreview(); stopThemeTimers();
    } else if (which==='clock') {
      tabClock.classList.add('active'); tabText.classList.remove('active'); if (tabVideo) tabVideo.classList.remove('active'); if (tabTheme) tabTheme.classList.remove('active');
      clockCfg.style.display='block'; textCfg.style.display='none'; if (videoCfg) videoCfg.style.display='none'; if (themeCfg) themeCfg.style.display='none';
      startClockPreview(); stopVideoPreview(); stopThemeTimers();
    } else if (which==='video') {
      if (tabVideo) tabVideo.classList.add('active'); tabText.classList.remove('active'); tabClock.classList.remove('active'); if (tabTheme) tabTheme.classList.remove('active');
      if (videoCfg) videoCfg.style.display='block'; textCfg.style.display='none'; clockCfg.style.display='none'; if (themeCfg) themeCfg.style.display='none';
      stopClockPreview(); startVideoPreview(); stopThemeTimers();
    } else if (which==='theme') {
      if (tabTheme) tabTheme.classList.add('active'); if (tabVideo) tabVideo.classList.remove('active'); tabText.classList.remove('active'); tabClock.classList.remove('active');
      if (themeCfg) themeCfg.style.display='block';
      textCfg.style.display='none'; if (videoCfg) videoCfg.style.display='none'; clockCfg.style.display='none';
      stopClockPreview(); stopVideoPreview();
    }
    drawPreview();
  }

  if (tabText) tabText.addEventListener('click', ()=>activate('text'));
  if (tabClock) tabClock.addEventListener('click', ()=>activate('clock'));
  if (tabVideo) tabVideo.addEventListener('click', ()=>activate('video'));
  if (tabTheme) tabTheme.addEventListener('click', ()=>activate('theme'));

  // Theme: upload + list
  const btnThemeUpload = document.getElementById('btnThemeUpload');
  const btnThemeStart  = document.getElementById('btnThemeStart');
  let currentThemePath = '';
  let currentThemeFps = 1;

  if (btnThemeUpload) btnThemeUpload.addEventListener('click', async ()=>{
    const inp = document.getElementById('themeFile');
    const f = inp && inp.files && inp.files[0];
    if(!f){ alert('Choose a theme HTML file first'); return; }
    const txt = await f.text();
    const m = txt.match(/<fps>\s*(\d{1,2})\s*<\/fps>/i);
    currentThemeFps = m ? Math.max(1, Math.min(30, parseInt(m[1],10)||1)) : 1;
    try{
      const mscript = txt.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
      if(!mscript) throw new Error('No <script> in theme');
      const code = mscript[1];
      const api = Function(`${code}; return {init: (typeof themeInit!=='undefined'?themeInit:null), render: (typeof themeRender!=='undefined'?themeRender:null)};`)();
      if(!api || !api.render){ throw new Error('themeRender() not found'); }
      window.__theme = api;
      const pv = getPreviewCanvas();
      const pctx = pv.getContext('2d');
      const state = api.init ? api.init() : {};
      if(window.__themeTimer) clearInterval(window.__themeTimer);
      const step=()=>{ pctx.clearRect(0,0,pv.width,pv.height); api.render(pctx, pv.width, pv.height, state, Date.now()); };
      const period = Math.round(1000/Math.max(1, Math.min(30,currentThemeFps)));
      window.__themeTimer=setInterval(step, period);
      step();
    }catch(e){ alert('Theme error: '+e.message); }
    try{
      const fd = new FormData(); fd.append('file', f, f.name);
      await fetch(apiBase + '/upload_theme',{method:'POST', body:fd});
      loadThemes();
    }catch(_){ /* ignore */ }
  });

  if (btnThemeStart) btnThemeStart.addEventListener('click', async ()=>{
    const pv = getPreviewCanvas();
    const pctx = pv.getContext('2d');
    if(!window.__theme || !window.__theme.render){ alert('Upload a theme first'); return; }
    const api = window.__theme;
    const state = api.init ? api.init() : {};
    if(window.__playTimer) clearInterval(window.__playTimer);
    const step=async()=>{
      api.render(pctx, pv.width, pv.height, state, Date.now());
      // Pack RGB565 and POST to device
      const img=pctx.getImageData(0,0,pv.width,pv.height);
      const w=pv.width,h=pv.height; const d=img.data; const buf=new Uint8Array(4+w*h*2);
      buf[0]=w&255; buf[1]=w>>8; buf[2]=h&255; buf[3]=h>>8; let i=4;
      for(let k=0;k<d.length;k+=4){ const r=d[k],g=d[k+1],b=d[k+2]; const v=((r&0xF8)<<8)|((g&0xFC)<<3)|(b>>>3); buf[i++]=v&255; buf[i++]=v>>8; }
      const fd=new FormData(); fd.append('image', new Blob([buf],{type:'application/octet-stream'}),'frame.rgb565');
      try{ await fetch(apiBase + '/upload',{method:'POST', body:fd}); }catch(_){ }
    };
    window.__playTimer=setInterval(step, Math.max(1, Math.min(30,currentThemeFps))*1000/currentThemeFps);
    step();
  });

  async function loadThemes(){
    try{
      const r = await fetch(apiBase + '/theme_list'); if(!r.ok) return;
      const arr = await r.json();
      const el = document.getElementById('themeList');
      if(!el) return;
      if(!arr.length) { el.textContent = 'No themes yet.'; return; }
      el.innerHTML = arr.map(p=>`<a href="${p}" target="_blank">${p}</a>`).join('<br>');
    }catch(_){ /* ignore */ }
  }
}

// Panel configuration overlay logic
async function openPanelConfig(){
  const page = document.getElementById('panelConfigPage');
  if (!page) return;
  // Fetch current layout and set radios
  try {
    const r = await fetch(apiBase + '/panel_info', { cache:'no-store' });
    if (r.ok) {
      const j = await r.json();
      const rows = (j.layout && j.layout.rows) ? j.layout.rows : j.rows;
      const cols = (j.layout && j.layout.cols) ? j.layout.cols : j.cols;
      const is1x2 = (rows===2 && cols===1);
      const a = document.getElementById('layout1x2'); const b = document.getElementById('layout2x1');
      if (a && b) { a.checked = !!is1x2; b.checked = !is1x2; }
    }
  } catch(_){ const a = document.getElementById('layout1x2'); const b = document.getElementById('layout2x1'); if (a && b) { a.checked=true; b.checked=false; } }
  page.style.display='block';
}

function closePanelConfig(){
  const page = document.getElementById('panelConfigPage');
  if (page) page.style.display='none';
}

function initPanelConfig() {
  const btnPC = document.getElementById('btnPanelConfig');
  const btnPCClose = document.getElementById('btnPanelClose');
  const btnPCApply = document.getElementById('btnPanelApply');
  const btnPCCancel = document.getElementById('btnPanelCancel');
  if (btnPC) btnPC.addEventListener('click', openPanelConfig);
  if (btnPCClose) btnPCClose.addEventListener('click', closePanelConfig);
  if (btnPCCancel) btnPCCancel.addEventListener('click', closePanelConfig);
  if (btnPCApply) btnPCApply.addEventListener('click', async ()=>{
    const a = document.getElementById('layout1x2');
    const layout = (a && a.checked) ? '1x2' : '2x1';
    const body = new URLSearchParams(); body.set('layout', layout);
    try { await fetch(apiBase + '/panel_layout', { method:'POST', body }); } catch(_){ }
    closePanelConfig();
  });
}

// Initialize all event listeners
function initEventListeners() {
  console.log('Setting up event listeners...');

  // Main render button
  const mainBtn = $('btn');
  if (mainBtn) {
    console.log('Setting up main button click handler');
    mainBtn.addEventListener('click', function(e) {
      console.log('Main button clicked!');
      e.preventDefault();
      if (typeof renderAndUpload === 'function') {
        renderAndUpload();
      } else {
        console.error('renderAndUpload function not available');
      }
    });
    mainBtn.setAttribute('data-initialized', 'true');
  } else {
    console.error('Main button not found!');
  }

  // Center button
  const centerBtn = $('center');
  if (centerBtn) {
    console.log('Setting up center button click handler');
    centerBtn.addEventListener('click', function(e) {
      console.log('Center button clicked!');
      e.preventDefault();
      $('offx').value=0; $('offy').value=0;
      $('offxVal').textContent='0'; $('offyVal').textContent='0';
      drawPreview();
    });
    centerBtn.setAttribute('data-initialized', 'true');
  } else {
    console.error('Center button not found!');
  }

  // Text and configuration inputs
  ['text','fontSize','color','bg','pw','ph','offx','offy','animate','dir','speed','interval','textBgRound','textBgRadius','brightness'].forEach(id=> {
    $(id).addEventListener('input', ()=>{
      if(id==='fontSize'){ $('fontSizeVal').textContent = $('fontSize').value + ' px'; }
      if(id==='speed'){ $('speedVal').textContent = $('speed').value + ' ms'; }
      if(id==='interval'){ $('intervalVal').textContent = $('interval').value + ' px'; }
      if(id==='brightness'){ $('brightnessVal').textContent = $('brightness').value + '%'; }
      drawPreview();
    });
  });

  // Select inputs for mobile
  ['pw','ph'].forEach(id=> $(id).addEventListener('change', drawPreview));

  // Image file upload
  $('imageFile').addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    const img = new Image();
    img.onload = ()=>{ loadedImg = img; drawPreview(); };
    const url = URL.createObjectURL(f);
    img.src = url;
  });

  // Background mode change
  $('bgMode').addEventListener('change', ()=>{
    const mode = $('bgMode').value;
    const showImg = mode==='image';
    $('bg').style.display = showImg? 'none':'inline-block';
    $('imageFile').style.display = showImg? 'inline-block':'none';
    const fitRow = document.getElementById('imageFitRow');
    if (fitRow) fitRow.style.display = showImg? 'grid':'none';
    drawPreview();
  });

  // Image fit change
  $('imageFit').addEventListener('change', drawPreview);

  // Text background settings
  $('textBg').addEventListener('change', drawPreview);
  $('textBgColor').addEventListener('input', drawPreview);
  $('textBgPad').addEventListener('change', drawPreview);
  $('textBgRound').addEventListener('change', drawPreview);
  $('textBgRadius').addEventListener('change', drawPreview);

  // Offset display updates
  $('offx').addEventListener('input', ()=> $('offxVal').textContent=$('offx').value);
  $('offy').addEventListener('input', ()=> $('offyVal').textContent=$('offy').value);

  // Custom font upload
  document.getElementById('customFont').addEventListener('change', async (e)=>{
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const data = await f.arrayBuffer();
      const ff = new FontFace('UserFont', data);
      await ff.load();
      document.fonts.add(ff);
      userFontLoaded = true;
      await document.fonts.ready;
      // enable the Uploaded radio and select it by default
      const uploadedRadio = document.getElementById('fontUploaded');
      if (uploadedRadio) { uploadedRadio.disabled = false; uploadedRadio.checked = true; }
      drawPreview();
    } catch (err) {
      console.error('Custom font failed to load', err);
      alert('Custom font failed to load');
    }
  });

  // Font source changes
  const fontDefault = document.getElementById('fontDefault');
  const fontUploaded = document.getElementById('fontUploaded');
  if (fontDefault) fontDefault.addEventListener('change', drawPreview);
  if (fontUploaded) fontUploaded.addEventListener('change', drawPreview);
}

// Initialize the application
function initApp() {
  console.log('Initializing app...');

  // Check if all required elements exist
  const requiredElements = ['btn', 'center', 'preview', 'text', 'fontSize', 'color', 'bg'];
  const missing = requiredElements.filter(id => !$(id));
  if (missing.length > 0) {
    console.error('Missing elements:', missing);
    return;
  }

  // Initialize display values
  $('brightnessVal').textContent = $('brightness').value + '%';
  $('fontSizeVal').textContent = $('fontSize').value + ' px';
  $('speedVal').textContent = $('speed').value + ' ms';
  $('intervalVal').textContent = $('interval').value + ' px';
  $('offxVal').textContent = $('offx').value;
  $('offyVal').textContent = $('offy').value;

  // Initialize background mode display
  (function(){
    const showImg = $('bgMode').value==='image';
    const fitRow = document.getElementById('imageFitRow');
    if (fitRow) fitRow.style.display = showImg? 'grid':'none';
  })();

  // Initialize all components
  console.log('Initializing tabs...');
  initTabs();

  console.log('Initializing event listeners...');
  initEventListeners();

  console.log('Initializing panel config...');
  initPanelConfig();

  console.log('Initializing video...');
  initVideo();
  initVideoEvents();

  console.log('Initializing clock...');
  initClockEvents();

  // Initial preview
  console.log('Drawing initial preview...');
  setTimeout(() => {
    drawPreview();
    console.log('App initialization complete');
  }, 100);

  // Optional: Try loading local Khmer fonts if present on device
  // loadKhmerWebFonts();
}

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);

// Also initialize when window is fully loaded (fallback)
window.addEventListener('load', function() {
  if (!$('btn') || !$('btn').hasAttribute('data-initialized')) {
    console.log('Fallback initialization...');
    setTimeout(initApp, 200);
  }
});