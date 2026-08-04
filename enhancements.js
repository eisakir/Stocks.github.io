(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector('#themeToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const savedTheme = localStorage.getItem('stocks-theme');
  const initialTheme = savedTheme || (systemDark.matches ? 'dark' : 'light');
  let deferredInstallPrompt = null;

  function setTheme(theme, save = true) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    themeMeta?.setAttribute('content', theme === 'dark' ? '#07101a' : '#0b1627');
    themeButton?.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    themeButton?.setAttribute('title', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    if (save) localStorage.setItem('stocks-theme', theme);
    if (window.Chart) {
      Chart.defaults.color = getComputedStyle(root).getPropertyValue('--muted-text-color').trim();
      Chart.defaults.borderColor = getComputedStyle(root).getPropertyValue('--border-color').trim();
      Object.values(Chart.instances || {}).forEach(chart => chart.update());
    }
  }

  setTheme(initialTheme, false);
  themeButton?.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
  systemDark.addEventListener?.('change', event => {
    if (!localStorage.getItem('stocks-theme')) setTheme(event.matches ? 'dark' : 'light', false);
  });

  const jumpDialog = document.querySelector('#jumpDialog');
  const installDialog = document.querySelector('#installDialog');
  const openDialog = dialog => {
    if (!dialog?.open) dialog.showModal();
  };
  const closeDialog = dialog => dialog?.open && dialog.close();
  document.querySelector('#jumpButton')?.addEventListener('click', () => openDialog(jumpDialog));
  document.querySelector('#mobileJumpButton')?.addEventListener('click', () => openDialog(jumpDialog));
  document.querySelector('#installHelpButton')?.addEventListener('click', () => openDialog(installDialog));
  document.querySelector('#dialogInstallHelp')?.addEventListener('click', () => {
    closeDialog(jumpDialog);
    openDialog(installDialog);
  });
  document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });
  jumpDialog?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeDialog(jumpDialog)));

  const sections = [...document.querySelectorAll('header[id], main section[id]')];
  const sectionLinks = [...document.querySelectorAll('[data-section]')];
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const id = visible.target.id;
    sectionLinks.forEach(link => {
      const active = link.dataset.section === id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    });
    const names = { top: 'Overview', scanner: 'Scanner', guide: 'Strategies', backtest: 'Backtest', log: 'Decision Log', research: 'Research Library' };
    document.title = `${names[id] || 'Stock Strategy Lab'} · Stocks`;
  }, { rootMargin: '-18% 0px -64% 0px', threshold: [0, .2, .5] });
  sections.forEach(section => observer.observe(section));

  const form = document.querySelector('#searchForm');
  const input = document.querySelector('#tickerInput');
  const error = document.querySelector('#tickerError');
  form?.addEventListener('submit', event => {
    const value = input.value.trim();
    if (!/^[A-Za-z][A-Za-z.\-]{0,9}$/.test(value)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      error.textContent = 'Enter a valid symbol using letters, a period, or a hyphen.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    } else {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    }
  }, true);
  input?.addEventListener('input', () => {
    error.textContent = '';
    input.removeAttribute('aria-invalid');
  });

  document.querySelectorAll('.strategy-button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.strategy-button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));

  const originalDownload = document.querySelector('#downloadCsv');
  originalDownload?.addEventListener('click', () => {
    const status = document.querySelector('#downloadStatus');
    status.textContent = `Decision log prepared for ${input.value.trim().toUpperCase() || 'the current ticker'}.`;
    setTimeout(() => { status.textContent = ''; }, 4000);
  });

  function updateOnlineStatus() {
    const offline = !navigator.onLine;
    const banner = document.querySelector('#offlineBanner');
    banner.hidden = !offline;
  }
  addEventListener('online', updateOnlineStatus);
  addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.querySelector('#installButton').disabled = false;
  });
  document.querySelector('#installButton')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      openDialog(installDialog);
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
  addEventListener('appinstalled', () => {
    document.querySelector('#installButton').textContent = 'Installed';
    document.querySelector('#installButton').disabled = true;
  });

  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
