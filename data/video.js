let videoEl = null;
let videoPreviewRaf = 0;
let videoUploadActive = false;
let videoUploadLastMs = 0;
let videoUploadIntervalMs = 100;
let videoUploadInFlight = false;

// Video preview helpers
function drawVideoPreviewFrame(){
  if (!videoEl) return;
  const pw=parseInt($('pw').value,10); const ph=parseInt($('ph').value,10);
  const bg = $('bg').value;
  c.width = pw; c.height = ph;
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle = bg; ctx.fillRect(0,0,pw,ph);
  // draw video frame with fit
  const fit = document.getElementById('videoFit') ? document.getElementById('videoFit').value : 'fit';
  let dw = videoEl.videoWidth || pw, dh = videoEl.videoHeight || ph;
  if (fit === 'fill') { dw = pw; dh = ph; }
  else if (fit === 'fit') {
    const s = Math.min(pw/(dw||1), ph/(dh||1)); dw = Math.max(1, Math.floor(dw*s)); dh = Math.max(1, Math.floor(dh*s));
  } else { // original
    dw = Math.min(pw, dw); dh = Math.min(ph, dh);
  }
  const dx = Math.floor(pw*0.5 - dw/2);
  const dy = Math.floor(ph*0.5 - dh/2);
  try { ctx.drawImage(videoEl, dx, dy, dw, dh); } catch(_){}
}

function videoPreviewLoop(ts){
  drawVideoPreviewFrame();
  // streaming upload synced with preview FPS
  if (videoUploadActive && !videoUploadInFlight) {
    if (!videoUploadLastMs) videoUploadLastMs = ts || performance.now();
    const now = ts || performance.now();
    if (now - videoUploadLastMs >= videoUploadIntervalMs) {
      videoUploadLastMs = now;
      // fire and forget upload of current frame
      uploadVideoFrame(true);
    }
  }
  videoPreviewRaf = requestAnimationFrame(videoPreviewLoop);
}

function startVideoPreview(){
  if (!videoEl || videoEl.readyState < 2) return; // not enough data
  if (videoPreviewRaf) cancelAnimationFrame(videoPreviewRaf);
  videoPreviewRaf = requestAnimationFrame(videoPreviewLoop);
}

function stopVideoPreview(){
  if (videoPreviewRaf) {
    cancelAnimationFrame(videoPreviewRaf);
    videoPreviewRaf=0;
  }
}

// Video upload
async function uploadVideoFrame(nonBlocking){
  if (!videoEl) return;
  const pw=parseInt($('pw').value,10); const ph=parseInt($('ph').value,10);
  const t = document.createElement('canvas'); t.width = pw; t.height = ph; const tctx=t.getContext('2d');
  // background
  const bg = $('bg').value; tctx.fillStyle=bg; tctx.fillRect(0,0,pw,ph);
  // draw current video frame same as preview
  const fit = document.getElementById('videoFit') ? document.getElementById('videoFit').value : 'fit';
  let dw = videoEl.videoWidth || pw, dh = videoEl.videoHeight || ph;
  if (fit === 'fill') { dw = pw; dh = ph; }
  else if (fit === 'fit') {
    const s = Math.min(pw/(dw||1), ph/(dh||1)); dw = Math.max(1, Math.floor(dw*s)); dh = Math.max(1, Math.floor(dh*s));
  } else { dw = Math.min(pw, dw); dh = Math.min(ph, dh); }
  const dx = Math.floor(pw*0.5 - dw/2);
  const dy = Math.floor(ph*0.5 - dh/2);
  try { tctx.drawImage(videoEl, dx, dy, dw, dh); } catch(_){ return; }
  const out = tctx.getImageData(0,0,pw,ph);
  const buf = new Uint8Array(4 + pw*ph*2);
  buf[0]=pw&255; buf[1]=(pw>>8)&255; buf[2]=ph&255; buf[3]=(ph>>8)&255;
  let p=4; const d=out.data;
  for(let y=0;y<ph;y++){
    for(let x=0;x<pw;x++){
      const i=(y*pw+x)*4; const r=d[i], g=d[i+1], b=d[i+2];
      const v=((r&0xF8)<<8)|((g&0xFC)<<3)|((b)>>3);
      buf[p++]=v&255; buf[p++]=(v>>8)&255;
    }
  }
  const fd = new FormData();
  fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'video.rgb565');
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
      fetch(apiBase + '/upload', { method:'POST', body: fd }).finally(()=>{ videoUploadInFlight = false; });
    } else {
      await fetch(apiBase + '/upload', { method:'POST', body: fd });
    }
  } catch(_){ videoUploadInFlight = false; }
}

function initVideoEvents() {
  const btnVideoStart = document.getElementById('btnVideoStart');
  const btnVideoStop = document.getElementById('btnVideoStop');
  if (btnVideoStart) btnVideoStart.addEventListener('click', ()=>{
    const fpsSel = document.getElementById('videoFps');
    const fps = fpsSel ? parseInt(fpsSel.value,10) || 10 : 10;
    videoUploadIntervalMs = Math.max(50, Math.floor(1000/fps));
    videoUploadActive = true; videoUploadLastMs = 0;
    // ensure preview is running
    startVideoPreview();
  });
  if (btnVideoStop) btnVideoStop.addEventListener('click', ()=>{
    videoUploadActive = false;
    videoUploadInFlight=false;
  });

  // tie loop checkbox to video element
  const loopCb = document.getElementById('videoLoop');
  if (loopCb) loopCb.addEventListener('change', ()=>{
    if (videoEl) videoEl.loop = loopCb.checked;
  });
}

// Video file load
function initVideo() {
  const vf = document.getElementById('videoFile');
  if (!vf) return;
  videoEl = document.createElement('video');
  videoEl.muted = true; videoEl.loop = true; videoEl.playsInline = true; videoEl.crossOrigin='anonymous';
  vf.addEventListener('change', async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try {
      const url = URL.createObjectURL(f);
      videoEl.src = url;
      await videoEl.play();
      // if video tab active start preview
      const inVideo = (document.getElementById('videoConfig') && document.getElementById('videoConfig').style.display !== 'none');
      if (inVideo) startVideoPreview();
    } catch(err){ console.error('Video play failed', err); }
  });
}