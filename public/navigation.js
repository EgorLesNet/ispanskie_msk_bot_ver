/**
 * Navigation module - SPA-навигация для PWA
 * Перехватывает клики по ссылкам и загружает страницы без перезагрузки
 */

class PWANavigation {
  constructor() {
    this.isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
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
    // Перехватываем все клики по ссылкам
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      
      if (!link) return;
      
      const href = link.getAttribute('href');
      
      // Пропускаем внешние ссылки и якоря
      if (!href || 
          href.startsWith('http://') || 
          href.startsWith('https://') || 
          href.startsWith('#') ||
          href.startsWith('tel:') ||
          href.startsWith('mailto:')) {
        return;
      }
      
      // Пропускаем ссылки с target="_blank"
      if (link.getAttribute('target') === '_blank') {
        return;
      }
      
      // Предотвращаем обычную навигацию
      e.preventDefault();
      
      // Выполняем SPA переход
      this.navigateTo(href);
    });
    
    // Обрабатываем кнопки «Назад»/«Вперёд» браузера
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.page) {
        this.loadPage(e.state.page, false);
      }
    });
  }
  
  navigateTo(url) {
    // Добавляем в историю
    history.pushState({ page: url }, '', url);
    
    // Загружаем страницу
    this.loadPage(url, true);
    
    // Вибрация при навигации
    if (window.appAdapter) {
      window.appAdapter.vibrate('light');
    }
  }
  
  async loadPage(url, updateHistory = true) {
    try {
      // Показываем индикатор загрузки
      document.body.style.opacity = '0.7';
      document.body.style.pointerEvents = 'none';
      
      // Загружаем новую страницу
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      
      // Парсим HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Обновляем title
      document.title = doc.title;
      
      // Обновляем содержимое body
      document.body.innerHTML = doc.body.innerHTML;
      
      // Выполняем скрипты со страницы
      this.executeScripts(doc);
      
      // Прокручиваем наверх
      window.scrollTo(0, 0);
      
      // Восстанавливаем видимость
      document.body.style.opacity = '1';
      document.body.style.pointerEvents = 'auto';
      
      console.log('[Navigation] Page loaded:', url);
      
    } catch (error) {
      console.error('[Navigation] Failed to load page:', error);
      
      // При ошибке делаем обычный переход
      window.location.href = url;
    }
  }
  
  executeScripts(doc) {
    // Находим все inline скрипты
    const scripts = doc.querySelectorAll('script:not([src])');
    
    scripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      newScript.textContent = oldScript.textContent;
      document.body.appendChild(newScript);
    });
  }
}

// Инициализация навигации
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.pwaNavigation = new PWANavigation();
  });
} else {
  window.pwaNavigation = new PWANavigation();
}
