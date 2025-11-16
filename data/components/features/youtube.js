// YouTube feature
import { $, rgb565, getFontFamily } from '../core/utils.js';
import { state } from '../core/state.js';
import { apiBase } from '../core/api.js';

const drawYTIcon = (g, cx, cy, h) => {
  const r = Math.round(h / 6); const w = Math.round(h * 1.6); const x = Math.round(cx - w/2); const y = Math.round(cy - h/2);
  g.save(); g.beginPath(); g.moveTo(x+r, y); g.lineTo(x+w-r, y); g.quadraticCurveTo(x+w, y, x+w, y+r); g.lineTo(x+w, y+h-r); g.quadraticCurveTo(x+w, y+h, x+w-r, y+h); g.lineTo(x+r, y+h); g.quadraticCurveTo(x, y+h, x, y+h-r); g.lineTo(x, y+r); g.quadraticCurveTo(x, y, x+r, y); g.closePath(); g.fillStyle = '#FF0000'; g.fill();
  const triW = Math.round(h*0.6); const triH = Math.round(h*0.5); g.beginPath(); g.moveTo(cx - Math.round(triW*0.35), cy - Math.round(triH/2)); g.lineTo(cx - Math.round(triW*0.35), cy + Math.round(triH/2)); g.lineTo(cx + Math.round(triW*0.65), cy); g.closePath(); g.fillStyle = '#FFFFFF'; g.fill(); g.restore();
  return { w, h };
};

export const setYtStatus = (txt, good=false) => { const el=$('ytStatus'); if(!el)return; el.textContent=txt; el.style.color= good?'#00ff90':'var(--muted)'; };

export const drawYoutubePreviewFrame = () => {
  const c = $('preview'); const ctx = c.getContext('2d');
  const pw=128, ph=64; const bg=$('youtubeBgColor')?$('youtubeBgColor').value:'#000000'; const col=$('youtubeTextColor')?$('youtubeTextColor').value:'#FFFFFF';
  c.width=pw; c.height=ph; ctx.clearRect(0,0,pw,ph); ctx.fillStyle=bg; ctx.fillRect(0,0,pw,ph);
  const txt = (state.youtubeLastCount!==null)? String(state.youtubeLastCount): '—';
  const uiSize = $('youtubeIconSize') ? parseInt($('youtubeIconSize').value, 10) : 25;
  const iconH = Math.max(10, Math.min(uiSize, Math.round(ph*0.9))); const iconW = Math.round(iconH*1.6); const gap = 6;
  let size = 28; const fam = getFontFamily(); let font = `bold ${size}px ${fam}`; ctx.font=font; ctx.textBaseline='middle'; let tw = ctx.measureText(txt).width;
  while ((iconW + gap + tw) > (pw - 8) && size > 10) { size -= 2; font = `bold ${size}px ${fam}`; ctx.font=font; tw = ctx.measureText(txt).width; }
  const groupW = iconW + gap + tw; const x0 = Math.round((pw - groupW)/2); const cy = Math.round(ph/2);
  const overlay = document.getElementById('ytPreviewImg'); if (!overlay || overlay.style.display === 'none') { drawYTIcon(ctx, x0 + Math.round(iconW/2), cy, iconH); }
  ctx.fillStyle = col; ctx.textAlign='left'; ctx.fillText(txt, x0 + iconW + gap, cy);
};

export const renderAndUploadYoutube = async () => {
  const pw=128, ph=64; const bg=$('youtubeBgColor').value; const col=$('youtubeTextColor').value; const fam=getFontFamily();
  const canvas=document.createElement('canvas'); canvas.width=pw; canvas.height=ph; const tctx=canvas.getContext('2d'); tctx.fillStyle=bg; tctx.fillRect(0,0,pw,ph);
  const txt = (state.youtubeLastCount!==null)? String(state.youtubeLastCount): '—'; const uiSize = $('youtubeIconSize') ? parseInt($('youtubeIconSize').value, 10) : 25; const iconH = Math.max(10, Math.min(uiSize, Math.round(ph*0.9))); const iconW = Math.round(iconH*1.6); const gap = 6;
  let size=28; let font=`bold ${size}px ${fam}`; tctx.font=font; tctx.textBaseline='middle'; let tw=tctx.measureText(txt).width;
  while ((iconW + gap + tw) > (pw - 8) && size>10) { size -= 2; font=`bold ${size}px ${fam}`; tctx.font=font; tw=tctx.measureText(txt).width; }
  const groupW = iconW + gap + tw; const x0 = Math.round((pw - groupW)/2); const cy = Math.round(ph/2);
  drawYTIcon(tctx, x0 + Math.round(iconW/2), cy, iconH);
  tctx.fillStyle = col; tctx.textAlign='left'; tctx.fillText(txt, x0 + iconW + gap, cy);
  const out=tctx.getImageData(0,0,pw,ph); const buf=new Uint8Array(4+pw*ph*2); buf[0]=pw&255; buf[1]=(pw>>8)&255; buf[2]=ph&255; buf[3]=(ph>>8)&255; let p=4, d=out.data;
  for(let y=0;y<ph;y++) for(let x=0;x<pw;x++){ const i=(y*pw+x)*4; const r=d[i],g=d[i+1],b=d[i+2]; const v=rgb565(r,g,b); buf[p++]=v&255; buf[p++]=(v>>8)&255; }
  const fd=new FormData(); fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'yt.rgb565'); fd.append('bg', bg); fd.append('bgMode','color'); fd.append('animate',0); fd.append('dir','none'); fd.append('speed',0); fd.append('interval',0);
  try { await fetch(apiBase + '/upload', { method:'POST', body:fd }); } catch {}
};

export const fetchYoutubeStats = async () => {
  try {
    if ($('youtubeConfig') && $('youtubeConfig').classList.contains('hidden')) return;
    const channelId = $('youtubeChannelId') ? $('youtubeChannelId').value.trim() : 'UCaPOzWiPWJFJr9dXzkkvUOw';
    setYtStatus(`Updating ${channelId}...`);
    const r = await fetch(apiBase + '/yt_stats?id=' + encodeURIComponent(channelId), { cache: 'no-store' });
    if (!r.ok) { setYtStatus('Fetch failed'); return; }
    const j = await r.json();
    if (j && j.subscriberCount) { state.youtubeLastCount = j.subscriberCount; setYtStatus(`Live: ${channelId}`, true); drawYoutubePreviewFrame(); } else { setYtStatus('No data'); }
  } catch { setYtStatus('Error'); }
};

export const startYoutubeUpdater = async () => {
  if (state.youtubeTimer) { clearInterval(state.youtubeTimer); state.youtubeTimer = 0; }
  await fetchYoutubeStats();
  state.youtubeTimer = setInterval(fetchYoutubeStats, 5000);
};

