(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector('[data-theme-toggle]');
  const themeIcon = document.querySelector('[data-theme-icon]');
  const navButton = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');

  const getTheme = () => root.dataset.theme === 'light' ? 'light' : 'dark';

  const applyTheme = (theme, persist = true) => {
    root.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem('multibot-theme', theme); } catch {}
    }

    const dark = theme === 'dark';
    if (themeIcon) themeIcon.textContent = dark ? '☀' : '☾';
    if (themeButton) {
      themeButton.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      themeButton.setAttribute('title', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }
  };

  if (!root.dataset.theme) {
    const preferred = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    applyTheme(preferred, false);
  } else {
    applyTheme(getTheme(), false);
  }

  themeButton?.addEventListener('click', () => {
    applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });

  const closeNav = () => {
    nav?.classList.remove('open');
    navButton?.setAttribute('aria-expanded', 'false');
  };

  navButton?.addEventListener('click', () => {
    const open = !nav?.classList.contains('open');
    nav?.classList.toggle('open', open);
    navButton.setAttribute('aria-expanded', String(open));
  });

  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeNav));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) closeNav();
  });

  const path = window.location.pathname;
  document.querySelectorAll('[data-nav-link]').forEach((link) => {
    const href = link.getAttribute('href');
    const active = href === '/dashboard' ? path.startsWith('/dashboard') : path === href;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
  });

  document.querySelectorAll('[data-loading-form]').forEach((form) => {
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"]');
      if (!button) return;
      button.disabled = true;
      button.textContent = 'Saving…';
    });
  });
})();