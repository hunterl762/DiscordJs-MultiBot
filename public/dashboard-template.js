(() => {
  const root = document.documentElement;
  const sidebar = document.querySelector('[data-dashboard-sidebar]');
  const overlay = document.querySelector('[data-sidebar-overlay]');
  const toast = document.querySelector('[data-dashboard-toast]');

  const showToast = (message, kind = 'success') => {
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'ddb-toast visible' + (kind === 'error' ? ' error' : '');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.className = 'ddb-toast'; }, 2400);
  };

  const syncTheme = () => {
    const icon = document.querySelector('[data-theme-icon]');
    if (icon) icon.textContent = root.dataset.theme === 'dark' ? '☀' : '☾';
  };

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('kryndexa-dashboard-theme', next);
    syncTheme();
  });
  syncTheme();

  const closeSidebar = () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('open');
  };
  document.querySelector('[data-sidebar-toggle]')?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('open');
  });
  overlay?.addEventListener('click', closeSidebar);
  sidebar?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    if (matchMedia('(max-width: 900px)').matches) closeSidebar();
  }));

  document.querySelectorAll('input[type="search"][data-filter-selector]').forEach((input) => {
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      const selector = input.dataset.filterSelector;
      const attr = input.dataset.filterAttribute;
      let visible = 0;
      if (!selector || !attr) return;
      document.querySelectorAll(selector).forEach((item) => {
        const match = !q || String(item.getAttribute(attr) || '').toLowerCase().includes(q);
        item.hidden = !match;
        if (match) visible++;
      });
      const empty = input.dataset.filterEmpty ? document.querySelector(input.dataset.filterEmpty) : null;
      if (empty) empty.hidden = visible !== 0;
    };
    input.addEventListener('input', apply);
    input.addEventListener('search', apply);
    apply();
  });

  document.querySelectorAll('.ddb-autosave').forEach((input) => {
    input.addEventListener('change', async () => {
      const previous = !input.checked;
      const card = input.closest('.ddb-feature-card,.ddb-ticket-card,.ddb-command-card,.ddb-toggle-card');
      input.disabled = true;
      card?.classList.add('ddb-autosaving');
      try {
        const body = new URLSearchParams({
          _csrf: input.dataset.csrf || '',
          enabled: input.checked ? '1' : '0',
          ...(input.dataset.setting ? { setting: input.dataset.setting } : {}),
        });
        const response = await fetch(input.dataset.autosaveUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!response.ok) throw new Error(await response.text());
        card?.classList.toggle('enabled', input.checked);
        card?.classList.toggle('disabled', !input.checked);
        showToast('Saved automatically');
      } catch (error) {
        input.checked = previous;
        showToast(error?.message || 'Unable to save setting', 'error');
      } finally {
        input.disabled = false;
        card?.classList.remove('ddb-autosaving');
      }
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!confirm(form.dataset.confirm || 'Are you sure?')) event.preventDefault();
    });
  });
})();
