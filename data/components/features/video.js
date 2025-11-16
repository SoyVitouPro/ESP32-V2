// Video feature: preview and streaming frames
import { $, rgb565 } from '../core/utils.js';
import { state } from '../core/state.js';
import { apiBase } from '../core/api.js';

export const drawVideoPreviewFrame = () => {
  if (!state.videoEl) return;
  const c = $('preview'); const ctx = c.getContext('2d');
  const pw = 128, ph = 64; const bg = $('bg').value;
  c.width=pw; c.height=ph; ctx.clearRect(0,0,pw,ph); ctx.fillStyle=bg; ctx.fillRect(0,0,pw,ph);
  const fit = $('videoFit') ? $('videoFit').value : 'fit';
  let dw = state.videoEl.videoWidth || pw, dh = state.videoEl.videoHeight || ph;
  if (fit === 'fill') { dw = pw; dh = ph; }
  else if (fit === 'fit') { const s = Math.min(pw / (dw || 1), ph / (dh || 1)); dw = Math.max(1, Math.floor(dw * s)); dh = Math.max(1, Math.floor(dh * s)); }
  else { dw = Math.min(pw, dw); dh = Math.min(ph, dh); }
  const dx = Math.floor(pw * 0.5 - dw / 2); const dy = Math.floor(ph * 0.5 - dh / 2);
  try { ctx.drawImage(state.videoEl, dx, dy, dw, dh); } catch {}
};

const previewLoop = (ts) => {
  drawVideoPreviewFrame();
  if (state.videoUploadActive && !state.videoUploadInFlight) {
    if (!state.videoUploadLastMs) state.videoUploadLastMs = ts || performance.now();
    const now = ts || performance.now();
    if (now - state.videoUploadLastMs >= state.videoUploadIntervalMs) {
      state.videoUploadLastMs = now; uploadVideoFrame(true);
    }
  }
  state.videoPreviewRaf = requestAnimationFrame(previewLoop);
};

export const startVideoPreview = () => {
  if (!state.videoEl || state.videoEl.readyState < 2) return;
  if (state.videoPreviewRaf) cancelAnimationFrame(state.videoPreviewRaf);
  state.videoPreviewRaf = requestAnimationFrame(previewLoop);
};

export const uploadVideoFrame = async (nonBlocking) => {
  if (!state.videoEl) return; const pw=128, ph=64;
  const t=document.createElement('canvas'); t.width=pw; t.height=ph; const tctx=t.getContext('2d'); const bg=$('bg').value; tctx.fillStyle=bg; tctx.fillRect(0,0,pw,ph);
  const fit = $('videoFit') ? $('videoFit').value : 'fit'; let dw=state.videoEl.videoWidth||pw, dh=state.videoEl.videoHeight||ph;
  if (fit === 'fill') { dw = pw; dh = ph; }
  else if (fit === 'fit') { const s = Math.min(pw / (dw || 1), ph / (dh || 1)); dw = Math.max(1, Math.floor(dw * s)); dh = Math.max(1, Math.floor(dh * s)); }
  else { dw = Math.min(pw, dw); dh = Math.min(ph, dh); }
  const dx = Math.floor(pw * 0.5 - dw / 2); const dy = Math.floor(ph * 0.5 - dh / 2); try { tctx.drawImage(state.videoEl, dx, dy, dw, dh); } catch { return; }
  const out=tctx.getImageData(0,0,pw,ph); const buf=new Uint8Array(4+pw*ph*2); buf[0]=pw&255; buf[1]=(pw>>8)&255; buf[2]=ph&255; buf[3]=(ph>>8)&255; let p=4,d=out.data;
  for(let y=0;y<ph;y++) for(let x=0;x<pw;x++){ const i=(y*pw+x)*4, r=d[i], g=d[i+1], b=d[i+2]; const v=rgb565(r,g,b); buf[p++]=v&255; buf[p++]=(v>>8)&255; }
  const fd=new FormData(); fd.append('image', new Blob([buf], { type:'application/octet-stream' }), 'video.rgb565'); fd.append('bg', bg); fd.append('bgMode','color'); fd.append('offx',0); fd.append('offy',0);
  try { await fetch(apiBase + '/upload', { method:'POST', body: fd }); } catch {}
};

