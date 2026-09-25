(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector('[data-theme-toggle]');
  const themeIcon = document.querySelector('[data-theme-icon]');
  const navButton = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');

  function currentTheme() {
    return root.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme, persist = true) {
    root.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem('multibot-theme', theme); } catch (_) {}
    }
    if (themeButton) {
      const next = theme === 'dark' ? 'light' : 'dark';
      themeButton.setAttribute('aria-label', `Switch to ${next} mode`);
      themeButton.setAttribute('title', `Switch to ${next} mode`);
    }
    if (themeIcon) themeIcon.textContent = theme === 'dark' ? '☀' : '☾';
  }

  if (!root.dataset.theme) {
    const preferred = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    applyTheme(preferred, false);
  } else {
    applyTheme(currentTheme(), false);
  }

  themeButton?.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  function closeNav() {
    if (!nav || !navButton) return;
    nav.classList.remove('open');
    navButton.setAttribute('aria-expanded', 'false');
  }

  navButton?.addEventListener('click', () => {
    if (!nav) return;
    const open = nav.classList.toggle('open');
    navButton.setAttribute('aria-expanded', String(open));
  });

  nav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeNav);
  });

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
      button.dataset.originalText = button.textContent;
      button.textContent = 'Saving…';
    });
  });
})();