// Shared app state across modules

export const state = {
  loadedImg: null,
  // Text animation
  rafId: 0,
  lastTs: 0,
  accMs: 0,
  spacing: 0,
  textW: 0,
  textH: 0,
  heads: [],

  // Clock
  clockPreviewTimer: 0,
  clockTimer: 0,

  // Video
  videoEl: null,
  videoPreviewRaf: 0,
  videoUploadActive: false,
  videoUploadLastMs: 0,
  videoUploadIntervalMs: 100,
  videoUploadInFlight: false,

  // YouTube
  youtubeTimer: 0,
  youtubeLastCount: null,
  ytIconImg: null,
  ytIconImgReady: false,
  youtubeAnimTimer: 0,
  youtubePreviewTimer: 0,
  selectedThemeId: '',

  // GIF
  gifFrames: [],
  gifDelays: [],
  gifLogicalW: 0,
  gifLogicalH: 0,
  gifFrameIndex: 0,
  gifAnimTimer: 0,

  // Theme
  originalThemeContent: '',
  currentThemeFileName: ''
};

export const stopTimer = (idName) => {
  if (state[idName]) { clearInterval(state[idName]); state[idName] = 0; }
};

export const cancelRaf = (name) => {
  if (state[name]) { cancelAnimationFrame(state[name]); state[name] = 0; }
};

