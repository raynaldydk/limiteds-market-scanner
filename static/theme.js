const THEME_KEY = 'limiteds-market-theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.theme-toggle').forEach(button => {
    const dark = theme === 'dark';
    button.textContent = dark ? 'Light mode' : 'Dark mode';
    button.setAttribute('aria-pressed', String(dark));
  });
}

let savedTheme = null;
try { savedTheme = localStorage.getItem(THEME_KEY); } catch {}
applyTheme(savedTheme === 'dark' ? 'dark' : 'light');

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(document.documentElement.dataset.theme);
  document.querySelectorAll('.theme-toggle').forEach(button => button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    applyTheme(next);
  }));
});
