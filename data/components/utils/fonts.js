// Font helpers and registration

export const fallbackFonts = `'Noto Sans Khmer', 'Khmer OS Content', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', system-ui, Arial, sans-serif`;

export const getFontFamily = () => fallbackFonts;

export const getTextFontFamily = () => {
  const sel = document.getElementById('fontFamilySelect');
  const choice = sel ? sel.value : 'default';
  if (choice && choice !== 'default') return `'${choice}', ${fallbackFonts}`;
  return fallbackFonts;
};

export const availableFonts = [
  { name: 'Battambang', file: 'fonts/Battambang-Regular.ttf' },
  { name: 'Bokor', file: 'fonts/Bokor-Regular.ttf' },
  { name: 'Moul', file: 'fonts/Moul-Regular.ttf' },
  { name: 'Dangrek', file: 'fonts/Dangrek-Regular.ttf' }
];

export const registerWebFonts = () => {
  const style = document.createElement('style');
  style.type = 'text/css';
  style.textContent = availableFonts.map(f => `@font-face { font-family: '${f.name}'; src: url('${f.file}') format('truetype'); font-weight: normal; font-style: normal; font-display: swap; }`).join('\n');
  document.head.appendChild(style);
};

