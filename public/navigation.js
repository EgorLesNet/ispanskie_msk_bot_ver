/**
 * Navigation module - SPA-навигация для PWA
 *
 * ВАЖНО:
 * Ранее модуль подменял только <body> и выполнял только inline-скрипты.
 * Это ломало страницы, которые держат стили/скрипты в <head> (например Leaflet CSS/JS,
 * или большие inline <style>), поэтому в PWA страницы выглядели как «текст».
 *
 * Теперь модуль:
 * - синхронизирует нужные <link rel="stylesheet"> и <style> из head целевой страницы
 * - загружает <script src> в корректном порядке (без перезагрузки PWA)
 * - выполняет inline-скрипты из body (с защитой от повторной инициализации метрики)
 */

class PWANavigation {
  constructor() {
    this.isPWA =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    this.isTelegramMiniApp = window.Telegram?.WebApp?.initData ? true : false;

    // В Telegram Mini App не используем SPA навигацию
    if (this.isTelegramMiniApp) {
      console.log('[Navigation] Telegram Mini App mode - using default navigation');
      return;
    }

    if (this.isPWA) {
      console.log('[Navigation] PWA mode detected - enabling SPA navigation');
      this.init();
    }
  }

  init() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');

      if (
        !href ||
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('#') ||
        href.startsWith('tel:') ||
        href.startsWith('mailto:')
      ) {
        return;
      }

      if (link.getAttribute('target') === '_blank') {
        return;
      }

      e.preventDefault();
      this.navigateTo(href);
    });

    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.page) {
        this.loadPage(e.state.page);
      }
    });

    if (!history.state || !history.state.page) {
      history.replaceState(
        { page: window.location.pathname },
        '',
        window.location.pathname
      );
    }
  }

  navigateTo(url) {
    history.pushState({ page: url }, '', url);
    this.loadPage(url);

    window.appAdapter?.vibrate?.('light');
  }

  showLoading(on) {
    document.body.style.opacity = on ? '0.7' : '1';
    document.body.style.pointerEvents = on ? 'none' : 'auto';
  }

  cleanupInjectedHead() {
    document.querySelectorAll('[data-pwa-nav="1"]').forEach((el) => el.remove());
  }

  syncHeadStyles(doc) {
    const head = document.head;
    if (!head) return;

    this.cleanupInjectedHead();

    const links = Array.from(
      doc.querySelectorAll('head link[rel="stylesheet"][href]')
    );
    links.forEach((l) => {
      const href = l.getAttribute('href');
      if (!href) return;

      if (
        document.querySelector(
          `head link[rel="stylesheet"][href="${CSS.escape(href)}"]`
        )
      ) {
        return;
      }

      const nl = document.createElement('link');
      nl.rel = 'stylesheet';
      nl.href = href;
      nl.setAttribute('data-pwa-nav', '1');
      head.appendChild(nl);
    });

    const styles = Array.from(doc.querySelectorAll('head style'));
    styles.forEach((s) => {
      const ns = document.createElement('style');
      ns.textContent = s.textContent || '';
      ns.setAttribute('data-pwa-nav', '1');
      head.appendChild(ns);
    });
  }

  async loadExternalScripts(doc) {
    const scripts = Array.from(doc.querySelectorAll('script[src]'));

    const skipSrcContains = ['/app-adapter.js', '/navigation.js', 'telegram-web-app.js'];

    for (const s of scripts) {
      const src = s.getAttribute('src');
      if (!src) continue;

      if (skipSrcContains.some((x) => src.includes(x))) {
        continue;
      }

      if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) {
        continue;
      }

      await new Promise((resolve, reject) => {
        const ns = document.createElement('script');
        ns.src = src;
        ns.async = false;
        ns.defer = false;
        ns.setAttribute('data-pwa-nav', '1');

        ns.onload = () => resolve();
        ns.onerror = (e) => reject(e);

        document.body.appendChild(ns);
      });
    }
  }

  executeInlineBodyScripts(doc) {
    const scripts = Array.from(doc.querySelectorAll('body script:not([src])'));

    scripts.forEach((oldScript) => {
      const code = oldScript.textContent || '';

      // Не запускаем метрику на каждом SPA-переходе
      if (code.includes('mc.yandex.ru/metrika') || code.includes('ym(')) {
        return;
      }

      const newScript = document.createElement('script');
      newScript.textContent = code;
      document.body.appendChild(newScript);
    });
  }

  async loadPage(url) {
    try {
      this.showLoading(true);

      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      document.title = doc.title;
      this.syncHeadStyles(doc);
      document.body.innerHTML = doc.body.innerHTML;

      await this.loadExternalScripts(doc);
      this.executeInlineBodyScripts(doc);

      window.scrollTo(0, 0);
      this.showLoading(false);

      console.log('[Navigation] Page loaded (SPA):', url);

      window.appAdapter?.applyUnifiedTheme?.({
        persist: true,
        source: 'pwa-navigation'
      });
    } catch (error) {
      console.error('[Navigation] Failed to load page:', error);
      this.showLoading(false);
      window.location.href = url;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.pwaNavigation = new PWANavigation();
  });
} else {
  window.pwaNavigation = new PWANavigation();
}
