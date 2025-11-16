// API helpers

export const apiBase = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
  ? 'http://192.168.4.1'
  : '';

export const postForm = (path, formData, opts={}) => fetch(apiBase + path, { method: 'POST', body: formData, ...opts });

export const stopAllModesOnDevice = async () => {
  try {
    await Promise.all([
      fetch(apiBase + '/stop_clock', { method: 'POST' }),
      fetch(apiBase + '/stop_theme', { method: 'POST' })
    ]);
  } catch {}
};

