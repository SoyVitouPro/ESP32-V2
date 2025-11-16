// WiFi feature
import { $ } from '../core/utils.js';
import { apiBase } from '../core/api.js';

export const scanWifi = async () => {
  const status = $('wifiStatus'); const wrap = $('wifiList'); if (!wrap) return;
  wrap.innerHTML = ''; if (status) status.textContent = 'Scanning...';
  try {
    const r = await fetch(apiBase + '/wifi_scan', { cache: 'no-store' });
    const list = r.ok ? await r.json() : [];
    list.forEach(n => {
      const btn = document.createElement('button'); btn.className='video-fit-box'; const level = n.rssi ?? 0; const lock = n.secure ? '🔒' : '🔓';
      btn.textContent = `${lock} ${n.ssid} (${level}dBm)`; btn.title='Click to connect';
      btn.addEventListener('click', async () => {
        const password = n.secure ? prompt('Password for ' + n.ssid) : '';
        if (status) status.textContent = 'Connecting...';
        const fd = new FormData(); fd.append('ssid', n.ssid); if (password) fd.append('pass', password);
        try { await fetch(apiBase + '/wifi_connect', { method: 'POST', body: fd }); if (status) status.textContent = 'Applying...'; await new Promise(r => setTimeout(r, 1000)); if (status) status.textContent = 'Connected (check device)'; }
        catch { if (status) status.textContent = 'Failed'; }
      });
      wrap.appendChild(btn);
    });
    if (status) status.textContent = list.length ? 'Select a network' : 'No networks found';
  } catch { if (status) status.textContent = 'Scan failed'; }
};

export const initWifiControls = () => { const btnScan = $('btnWifiScan'); if (btnScan) btnScan.addEventListener('click', scanWifi); };

