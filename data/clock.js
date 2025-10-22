let clockPreviewTimer = 0;
let clockTimer = 0;

function formatTime(fmt){
  const d = new Date();
  let h = d.getHours(); let m = d.getMinutes(); let s = d.getSeconds();
  if (fmt==='12') { const ampm = h>=12?'PM':'AM'; h = h%12 || 12; return `${(''+h).padStart(2,'0')}:${(''+m).padStart(2,'0')}:${(''+s).padStart(2,'0')} ${ampm}`; }
  return `${(''+h).padStart(2,'0')}:${(''+m).padStart(2,'0')}:${(''+s).padStart(2,'0')}`;
}

function drawClockPreviewFrame(){
  const pw=parseInt($('pw').value,10); const ph=parseInt($('ph').value,10);
  const offx=parseInt($('offx').value,10); const offy=parseInt($('offy').value,10);
  const fmt = $('clockFormat').value;
  const size = parseInt($('clockSize').value,10);
  const fam = getFontFamily(); const font = `bold ${size}px ${fam}`;
  const col = $('clockColor').value;
  const bg = $('bg').value;
  c.width = pw; c.height = ph;
  ctx.clearRect(0,0,c.width,c.height);
  // draw background (respect image mode)
  ctx.fillStyle = bg; ctx.fillRect(0,0,pw,ph);
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
  // draw time centered
  ctx.font = font; ctx.textBaseline='middle'; ctx.textAlign='center'; ctx.fillStyle=col;
  const txt = formatTime(fmt);
  ctx.fillText(txt, Math.floor(pw*0.5)+offx, Math.floor(ph*0.5)+offy);
}

function startClockPreview(){
  if (clockPreviewTimer) clearInterval(clockPreviewTimer);
  drawClockPreviewFrame();
  clockPreviewTimer = setInterval(drawClockPreviewFrame, 1000);
}

function stopClockPreview(){
  if (clockPreviewTimer) {
    clearInterval(clockPreviewTimer);
    clockPreviewTimer=0;
  }
}

async function renderAndUploadClock(){
  const pw=parseInt($('pw').value,10); const ph=parseInt($('ph').value,10);
  const offx=parseInt($('offx').value,10); const offy=parseInt($('offy').value,10);
  const fmt = $('clockFormat').value;
  const size = parseInt($('clockSize').value,10);
  const fam = getFontFamily(); const font = `bold ${size}px ${fam}`;
  const col = $('clockColor').value;
  const bg = $('bg').value;
  const t = document.createElement('canvas'); t.width = pw; t.height = ph; const tctx=t.getContext('2d');
  tctx.fillStyle=bg; tctx.fillRect(0,0,pw,ph);
  tctx.font=font; tctx.textBaseline='middle'; tctx.textAlign='center'; tctx.fillStyle=col;
  const txt = formatTime(fmt);
  tctx.fillText(txt, Math.floor(pw*0.5)+offx, Math.floor(ph*0.5)+offy);
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
  fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'clock.rgb565');
  fd.append('bg', bg);
  fd.append('bgMode', 'color');
  fd.append('offx', 0);
  fd.append('offy', 0);
  fd.append('animate', 0);
  fd.append('dir', 'left');
  fd.append('speed', 20);
  fd.append('interval', 5);
  await fetch(apiBase + '/upload', { method:'POST', body: fd });
}

function initClockEvents() {
  const btnClock = document.getElementById('btnClock');
  if (btnClock) btnClock.addEventListener('click', async ()=>{
    await renderAndUploadClock();
    if ($('clockAuto').checked){
      if (clockTimer) clearInterval(clockTimer);
      const sec = parseInt($('clockInterval').value,10)||5;
      clockTimer = setInterval(renderAndUploadClock, sec*1000);
    } else {
      if (clockTimer) { clearInterval(clockTimer); clockTimer=0; }
    }
  });
}