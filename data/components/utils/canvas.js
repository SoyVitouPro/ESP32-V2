// Canvas helpers
import { $ } from './dom.js';

export const getPreviewCanvas = () => {
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

