// Preview animation state
let rafId = 0; let lastTs = 0; let accMs = 0; let head0 = 0; let head1 = 0; let spacing = 0; let textW = 0; let textH = 0;

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

function stopPreviewAnim() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

function drawPreviewFrame(animated){
  const text=$('text').value;
  const fam = getFontFamily();
  const size=parseInt($('fontSize').value,10);
  const font = `bold ${size}px ${fam}`;
  const color=$('color').value;
  const bg=$('bg').value;
  const pw=parseInt($('pw').value,10); const ph=parseInt($('ph').value,10);
  const offx=parseInt($('offx').value,10); const offy=parseInt($('offy').value,10);

  c.width = pw; c.height = ph; // always full panel preview
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
          // rounded rect path
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

function animatePreview(ts){
  if (!$('animate').checked || $('text').value.trim().length === 0) { stopPreviewAnim(); drawPreviewFrame(false); return; }
  if (!lastTs) lastTs = ts;
  const speed = parseInt($('speed').value,10) || 30; // ms/px
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

async function renderAndUpload(){
  drawPreview();
  const pw=parseInt($('pw').value,10); const ph=parseInt($('ph').value,10);
  const animate=$('animate').checked; const dir=$('dir').value;
  const speed=parseInt($('speed').value,10);
  const interval=parseInt($('interval').value,10);
  const offx=parseInt($('offx').value,10); const offy=parseInt($('offy').value,10);

  let outCanvas = document.createElement('canvas');
  if ($('bgMode').value === 'image' && loadedImg) {
    // Build panel-sized background image
    outCanvas.width = pw; outCanvas.height = ph;
    let octx = outCanvas.getContext('2d'); octx.imageSmoothingEnabled=false;
    const fit = $('imageFit').value;
    let dw = loadedImg.width, dh = loadedImg.height;
    if (fit === 'fill') { dw = pw; dh = ph; }
    else if (fit === 'fit') {
      const s = Math.min(pw/loadedImg.width, ph/loadedImg.height);
      dw = Math.max(1, Math.floor(loadedImg.width * s));
      dh = Math.max(1, Math.floor(loadedImg.height * s));
    } else { // original
      dw = Math.min(pw, loadedImg.width); dh = Math.min(ph, loadedImg.height);
    }
    const dx = Math.floor(pw*0.5 - dw/2);
    const dy = Math.floor(ph*0.5 - dh/2);
    // fill with bg color first (areas outside image)
    octx.fillStyle = $('bg').value; octx.fillRect(0,0,pw,ph);
    octx.drawImage(loadedImg, dx, dy, dw, dh);
    // Upload background first
    const outBg = octx.getImageData(0,0,pw,ph);
    const bufBg = new Uint8Array(4 + pw*ph*2);
    bufBg[0]=pw&255; bufBg[1]=(pw>>8)&255; bufBg[2]=ph&255; bufBg[3]=(ph>>8)&255;
    let pb=4; const db=outBg.data;
    for(let y=0;y<ph;y++){
      for(let x=0;x<pw;x++){
        const i=(y*pw+x)*4; const r=db[i], g=db[i+1], b=db[i+2];
        const v=rgb565(r,g,b);
        bufBg[pb++]=v&255; bufBg[pb++]=(v>>8)&255;
      }
    }
    const fdBg = new FormData();
    fdBg.append('image', new Blob([bufBg], {type:'application/octet-stream'}), 'bg.rgb565');
    await fetch(apiBase + '/upload_bg', { method:'POST', body: fdBg });
  }
  // Now build text-only transparent canvas (or skip if no text)
  if ($('text').value.trim().length > 0) {
    // Build transparent text-only canvas
    const fam = getFontFamily(); const size=parseInt($('fontSize').value,10);
    const font = `bold ${size}px ${fam}`;
    let t = document.createElement('canvas'); let tctx = t.getContext('2d');
    tctx.font=font; tctx.textBaseline='alphabetic'; tctx.textAlign='left';
    const metrics = tctx.measureText($('text').value);
    let tw = Math.max(1, Math.ceil(metrics.width)+4);
    let th = Math.max(1, Math.ceil(size*1.2 + 6));
    t.width = tw; t.height = th;
    tctx.font=font; tctx.textBaseline='alphabetic'; tctx.textAlign='left';
    // optional text background box (opaque)
    if ($('textBg').checked) {
      const pad = parseInt($('textBgPad').value,10) || 0;
      t.width = tw + pad*2; t.height = th + pad*2;
      // redraw font after resize
      tctx = t.getContext('2d'); tctx.font=font; tctx.textBaseline='alphabetic'; tctx.textAlign='left';
      tctx.fillStyle = $('textBgColor').value;
      if ($('textBgRound').checked) {
        const r = parseInt($('textBgRadius').value,10) || 0;
        const rr = Math.max(0, Math.min(r, Math.min(t.width,t.height)/2));
        tctx.beginPath();
        tctx.moveTo(rr, 0);
        tctx.arcTo(t.width, 0,   t.width, t.height, rr);
        tctx.arcTo(t.width, t.height, 0,   t.height, rr);
        tctx.arcTo(0,   t.height, 0,   0,   rr);
        tctx.arcTo(0,   0,   t.width, 0,   rr);
        tctx.closePath();
        tctx.fill();
      } else {
        tctx.fillRect(0, 0, t.width, t.height);
      }
    }
    tctx.fillStyle=$('color').value;
    const baseY = Math.floor(size);
    tctx.fillText($('text').value, 0, baseY);
    const img = tctx.getImageData(0,0,t.width,t.height);
    const bb = cropImageData(img.data, t.width, t.height);
    let outW = Math.max(1, bb.w), outH = Math.max(1, bb.h);
    outCanvas.width = outW; outCanvas.height = outH;
    outCanvas.getContext('2d').putImageData(new ImageData(img.data, t.width, t.height), -bb.x, -bb.y);
  } else {
    outCanvas.width = 1; outCanvas.height = 1; // minimal placeholder
  }

  // pack A8 + RGB565 (LE) per pixel with header [w,h]
  const out = outCanvas.getContext('2d').getImageData(0,0,outCanvas.width,outCanvas.height);
  const outW = outCanvas.width, outH = outCanvas.height;
  const buf = new Uint8Array(4 + outW*outH*3);
  buf[0]=outW&255; buf[1]=(outW>>8)&255; buf[2]=outH&255; buf[3]=(outH>>8)&255;
  let p=4; const d=out.data;
  for(let y=0;y<outH;y++){
    for(let x=0;x<outW;x++){
      const i=(y*outW+x)*4; const r=d[i], g=d[i+1], b=d[i+2], a=d[i+3];
      const v=rgb565(r,g,b);
      buf[p++]=a; buf[p++]=v&255; buf[p++]=(v>>8)&255;
    }
  }
  const fd = new FormData();
  fd.append('image', new Blob([buf], {type:'application/octet-stream'}), 'img.rgb565');
  fd.append('bg', $('bg').value);
  fd.append('bgMode', $('bgMode').value);
  fd.append('offx', offx);
  fd.append('offy', offy);
  fd.append('animate', ( $('text').value.trim().length>0 && animate)?1:0);
  fd.append('brightness', parseInt($('brightness').value, 10));
  fd.append('dir', dir);
  fd.append('speed', speed);
  fd.append('interval', interval);
  const res = await fetch(apiBase + '/upload', { method:'POST', body: fd });
  if(!res.ok){ alert('Upload failed: '+res.status); return; }
}