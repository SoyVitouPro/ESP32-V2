// API base: when running locally via localhost, point to ESP32 AP.
const apiBase = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') ? 'http://192.168.4.1' : '';

function getPreviewCanvas(){
  var pv = document.getElementById('preview');
  if(!pv){
    var holder = document.getElementById('previewInner') || document.body;
    pv = document.createElement('canvas');
    pv.id='preview'; pv.width=256; pv.height=96; pv.style.background='#000';
    pv.style.border='1px solid #243241'; holder.appendChild(pv);
  }
  return pv;
}

function rgb565(r,g,b){return ((r&0xF8)<<8)|((g&0xFC)<<3)|((b)>>3);} // 16-bit

function cropImageData(img,w,h){
  let minX=w, minY=h, maxX=-1, maxY=-1;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const a=img[(y*w+x)*4+3];
      if(a){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
  }
  if(maxX<minX||maxY<minY){return {x:0,y:0,w:0,h:0}};
  return {x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1};
}

function getFontFamily() {
  const useUploaded = (document.getElementById('fontUploaded') && document.getElementById('fontUploaded').checked);
  if (useUploaded && userFontLoaded) return `'UserFont', system-ui, Arial, sans-serif`;
  return `'Noto Sans Khmer', 'Khmer OS Content', system-ui, Arial, sans-serif`;
}

// Attempt to load Khmer webfonts from device storage (LittleFS)
async function loadKhmerWebFonts() {
  const candidates = [
    { family: 'Noto Sans Khmer', url: '/fonts/NotoSansKhmer-Regular.woff2' },
    { family: 'Khmer OS Content', url: '/fonts/KhmerOSContent.woff2' },
    { family: 'Hanuman', url: '/fonts/Hanuman-Regular.woff2' },
  ];
  for (const f of candidates) {
    try {
      const res = await fetch(f.url, { cache: 'no-store' });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const face = new FontFace(f.family, buf);
      await face.load();
      document.fonts.add(face);
    } catch (_) { /* ignore missing fonts */ }
  }
  // Ensure canvas re-renders with any newly available fonts
  try { await document.fonts.ready; } catch(_){}
  drawPreview();
}