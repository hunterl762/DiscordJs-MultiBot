(() => {
  'use strict';

  const SECTION_IDS = ['configuration', 'features', 'ticket-config', 'stream-alerts', 'commands', 'tickets'];

  function sectionTitle(section) {
    if (section.id === 'configuration') return 'Server Configuration';
    const heading = section.querySelector('h2, h1');
    return heading?.textContent?.trim() || section.id.replace(/-/g, ' ');
  }

  function enhanceSection(section, index) {
    if (!section || section.dataset.collapsibleReady === 'true') return;
    section.dataset.collapsibleReady = 'true';
    section.classList.add('dashboard-collapsible-section');

    const title = sectionTitle(section);
    const body = document.createElement('div');
    body.className = 'dashboard-collapsible-body';
    body.id = `dashboard-collapse-body-${section.id}`;

    while (section.firstChild) body.appendChild(section.firstChild);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dashboard-collapse-trigger';
    trigger.setAttribute('aria-controls', body.id);
    trigger.setAttribute('aria-expanded', index === 0 ? 'true' : 'false');
    trigger.innerHTML = `<span class="dashboard-collapse-title"></span><span class="dashboard-collapse-chevron" aria-hidden="true">⌄</span>`;
    trigger.querySelector('.dashboard-collapse-title').textContent = title;

    section.append(trigger, body);
    section.classList.toggle('is-collapsed', index !== 0);
    body.hidden = index !== 0;

    trigger.addEventListener('click', () => {
      const willOpen = section.classList.contains('is-collapsed');
      section.classList.toggle('is-collapsed', !willOpen);
      body.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }

  function openSectionFromHash() {
    const id = location.hash.slice(1);
    if (!SECTION_IDS.includes(id)) return;
    const section = document.getElementById(id);
    const trigger = section?.querySelector(':scope > .dashboard-collapse-trigger');
    const body = section?.querySelector(':scope > .dashboard-collapsible-body');
    if (!section || !trigger || !body) return;
    section.classList.remove('is-collapsed');
    body.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  function init() {
    SECTION_IDS.forEach((id, index) => enhanceSection(document.getElementById(id), index));
    document.querySelectorAll('.dashboard-jump a[href^="#"]').forEach((link) => {
      link.addEventListener('click', () => requestAnimationFrame(openSectionFromHash));
    });
    openSectionFromHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('hashchange', openSectionFromHash);
})();
