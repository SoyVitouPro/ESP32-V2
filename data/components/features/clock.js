// Clock feature: preview and upload
import { $, rgb565, getFontFamily } from '../core/utils.js';
import { state } from '../core/state.js';
import { apiBase } from '../core/api.js';

const formatTime = (fmt) => {
  const d = new Date();
  let h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  if (fmt === '12') { h = h % 12 || 12; }
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
};

export const drawClockPreviewFrame = () => {
  const c = $('preview'); const ctx = c.getContext('2d');
  const pw = 128, ph = 64;
  const size = parseInt($('clockSize').value, 10);
  const col = $('clockColor').value;
  const bg = $('clockBgColor').value;
  c.width = pw; c.height = ph; ctx.clearRect(0,0,pw,ph); ctx.fillStyle = bg; ctx.fillRect(0,0,pw,ph);
  const fam = getFontFamily(); const font = `bold ${size}px ${fam}`; ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = col;
  const txt = formatTime('24');
  let yOffset = Math.floor(ph * 0.5); if (size <= 15) yOffset -= 2; else if (size <= 20) yOffset -= 1;
  ctx.fillText(txt, Math.floor(pw * 0.5), yOffset);
};

export const renderAndUploadClock = async () => {
  const pw=128, ph=64; const size = parseInt($('clockSize').value, 10); const col=$('clockColor').value; const clockBg=$('clockBgColor').value; const fam=getFontFamily();
  const t=document.createElement('canvas'); t.width=pw; t.height=ph; const tctx=t.getContext('2d');
  tctx.fillStyle=clockBg; tctx.fillRect(0,0,pw,ph); tctx.font=`bold ${size}px ${fam}`; tctx.textBaseline='middle'; tctx.textAlign='center'; tctx.fillStyle=col;
  const now=new Date(); const txt=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  let yOffset = Math.floor(ph * 0.5); if (size <= 15) yOffset -= 2; else if (size <= 20) yOffset -= 1; tctx.fillText(txt, Math.floor(pw*0.5), yOffset);
  const out=tctx.getImageData(0,0,pw,ph); const buf=new Uint8Array(4+pw*ph*2); buf[0]=pw&255; buf[1]=(pw>>8)&255; buf[2]=ph&255; buf[3]=(ph>>8)&255; let p=4, d=out.data;
  for(let y=0;y<ph;y++) for(let x=0;x<pw;x++){ const i=(y*pw+x)*4; const r=d[i], g=d[i+1], b=d[i+2]; const v=rgb565(r,g,b); buf[p++]=v&255; buf[p++]=(v>>8)&255; }
  const fd=new FormData(); fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'clock.rgb565'); fd.append('bg', clockBg); fd.append('bgMode','color'); fd.append('offx',0); fd.append('offy',0); fd.append('animate',0); fd.append('dir','none'); fd.append('speed',0); fd.append('interval',0);
  const controller = new AbortController(); const timeoutId=setTimeout(()=>controller.abort(),500);
  try { await fetch(apiBase + '/upload', { method:'POST', body: fd, signal: controller.signal }); } finally { clearTimeout(timeoutId); }
};

export const startSmoothClockTimer = () => {
  const UPLOAD_INTERVAL = 1000; let nextUploadTime = performance.now() + UPLOAD_INTERVAL;
  const loop = async () => {
    const now = performance.now();
    if (!$('clockConfig').classList.contains('hidden')) drawClockPreviewFrame();
    if (now >= nextUploadTime) { nextUploadTime = now + UPLOAD_INTERVAL; try { await renderAndUploadClock(); } catch {} }
    if (state.clockTimer) state.clockTimer = requestAnimationFrame(loop);
  };
  state.clockTimer = requestAnimationFrame(loop);
};

