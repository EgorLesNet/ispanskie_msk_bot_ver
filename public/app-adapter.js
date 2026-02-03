/**
 * App Adapter - автоматическое определение режима работы приложения
 * Поддерживает: Telegram Mini App, PWA (установленное), Web Browser
 */

class AppAdapter {
  constructor() {
    this.mode = this.detectMode();
    this.user = null;
    this.features = this.getFeatures();
    
    console.log('[AppAdapter] Mode detected:', this.mode);
    console.log('[AppAdapter] Features:', this.features);
  }
  
  /**
   * Определяет режим работы приложения
   * @returns {'telegram-mini-app' | 'pwa-installed' | 'web-browser'}
   */
  detectMode() {
    // Проверка 1: Telegram Mini App
    if (window.Telegram?.WebApp?.initData) {
      return 'telegram-mini-app';
    }
    
    // Проверка 2: Установленное PWA
    if (window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true) {
      return 'pwa-installed';
    }
    
    // Проверка 3: Обычный браузер
    return 'web-browser';
  }
  
  /**
   * Возвращает доступные функции для текущего режима
   */
  getFeatures() {
    const isWebMode = this.mode !== 'telegram-mini-app';
    
    return {
      // UI Features
      showBackButton: this.mode === 'telegram-mini-app',
      showInstallPrompt: this.mode === 'web-browser',
      showTelegramLogin: isWebMode,
      showNavigation: true,
      
      // Auth Features
      useTelegramAuth: this.mode === 'telegram-mini-app',
      useWebAuth: isWebMode,
      
      // Notification Features
      canUseTelegramNotifications: this.mode === 'telegram-mini-app',
      canUseWebPush: isWebMode && 'Notification' in window && 'serviceWorker' in navigator,
      
      // Offline Features
      enableOffline: isWebMode && 'serviceWorker' in navigator,
      enableCache: true,
      
      // API Features
      useTelegramHaptics: this.mode === 'telegram-mini-app',
      useWebVibration: isWebMode && 'vibrate' in navigator
    };
  }
  
  /**
   * Инициализация адаптера
   */
  async init() {
    console.log('[AppAdapter] Initializing...');
    
    switch(this.mode) {
      case 'telegram-mini-app':
        await this.initTelegramMode();
        break;
      
      case 'pwa-installed':
        await this.initPWAMode();
        break;
      
      case 'web-browser':
        await this.initWebMode();
        break;
    }
    
    // Регистрируем обработчики
    this.setupEventListeners();
    
    console.log('[AppAdapter] Initialized successfully');
  }
  
  /**
   * Инициализация для Telegram Mini App
   */
  async initTelegramMode() {
    const tg = window.Telegram.WebApp;
    
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes();
    
    // Применяем тему Telegram
    const isDark = tg.colorScheme === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'dark' : '');
    tg.setHeaderColor(isDark ? '#0e0e0e' : '#f0f2f5');
    tg.setBackgroundColor(isDark ? '#0e0e0e' : '#f0f2f5');
    
    // Показываем кнопку "Назад" если нужно
    if (window.location.pathname !== '/news.html') {
      tg.BackButton.show();
      tg.BackButton.onClick(() => {
        window.history.back();
      });
    }
    
    // Получаем данные пользователя
    if (tg.initDataUnsafe?.user) {
      this.user = {
        id: tg.initDataUnsafe.user.id,
        firstName: tg.initDataUnsafe.user.first_name,
        lastName: tg.initDataUnsafe.user.last_name,
        username: tg.initDataUnsafe.user.username,
        photoUrl: tg.initDataUnsafe.user.photo_url,
        authMethod: 'telegram'
      };
      
      // Сохраняем в localStorage для совместимости
      localStorage.setItem('tgUser', JSON.stringify(this.user));
    }
    
    console.log('[AppAdapter] Telegram mode initialized');
  }
  
  /**
   * Инициализация для установленного PWA
   */
  async initPWAMode() {
    // Регистрируем Service Worker
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        console.log('[AppAdapter] Service Worker registered:', registration);
        
        // Проверяем обновления
        registration.addEventListener('updatefound', () => {
          console.log('[AppAdapter] Service Worker update found');
        });
      } catch (error) {
        console.error('[AppAdapter] Service Worker registration failed:', error);
      }
    }
    
    // Проверяем авторизацию
    const savedUser = localStorage.getItem('tgUser');
    if (savedUser) {
      try {
        this.user = JSON.parse(savedUser);
      } catch (e) {
        console.error('[AppAdapter] Failed to parse saved user:', e);
      }
    }
    
    // Инициализируем Web Push если пользователь авторизован
    if (this.user && this.features.canUseWebPush) {
      await this.initWebPush();
    }
    
    console.log('[AppAdapter] PWA mode initialized');
  }
  
  /**
   * Инициализация для веб-браузера
   */
  async initWebMode() {
    // Показываем кнопку установки PWA
    this.setupInstallPrompt();
    
    // Проверяем авторизацию
    const savedUser = localStorage.getItem('tgUser');
    if (savedUser) {
      try {
        this.user = JSON.parse(savedUser);
      } catch (e) {
        console.error('[AppAdapter] Failed to parse saved user:', e);
      }
    }
    
    console.log('[AppAdapter] Web mode initialized');
  }
  
  /**
   * Настройка промпта установки PWA
   */
  setupInstallPrompt() {
    let deferredPrompt = null;
    
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      
      console.log('[AppAdapter] Install prompt available');
      
      // Показываем кнопку установки
      this.showInstallButton(deferredPrompt);
    });
    
    window.addEventListener('appinstalled', () => {
      console.log('[AppAdapter] PWA installed');
      deferredPrompt = null;
    });
  }
  
  /**
   * Показывает кнопку установки приложения
   */
  showInstallButton(deferredPrompt) {
    // Создаем кнопку если её нет
    let installBtn = document.getElementById('pwa-install-btn');
    
    if (!installBtn) {
      installBtn = document.createElement('button');
      installBtn.id = 'pwa-install-btn';
      installBtn.innerHTML = '📥 Установить приложение';
      installBtn.style.cssText = `
        position: fixed;
        bottom: calc(120px + env(safe-area-inset-bottom));
        left: 50%;
        transform: translateX(-50%);
        padding: 14px 24px;
        background: linear-gradient(135deg, #007aff 0%, #0051d5 100%);
        color: white;
        border: none;
        border-radius: 40px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 122, 255, 0.35);
        z-index: 9999;
        transition: all 0.3s;
      `;
      
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        
        console.log('[AppAdapter] Install prompt outcome:', outcome);
        
        if (outcome === 'accepted') {
          installBtn.remove();
        }
        
        deferredPrompt = null;
      });
      
      document.body.appendChild(installBtn);
    }
  }
  
  /**
   * Инициализация Web Push уведомлений
   */
  async initWebPush() {
    if (!this.features.canUseWebPush) {
      console.log('[AppAdapter] Web Push not available');
      return;
    }
    
    const permission = Notification.permission;
    
    if (permission === 'granted') {
      console.log('[AppAdapter] Web Push permission granted');
      await this.subscribeToWebPush();
    } else if (permission === 'default') {
      console.log('[AppAdapter] Web Push permission not determined');
      // Будем запрашивать позже при необходимости
    } else {
      console.log('[AppAdapter] Web Push permission denied');
    }
  }
  
  /**
   * Подписка на Web Push
   */
  async subscribeToWebPush() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        console.log('[AppAdapter] Already subscribed to Web Push');
        return subscription;
      }
      
      // Здесь будет логика подписки с сервером
      console.log('[AppAdapter] Need to subscribe to Web Push');
      
      return null;
    } catch (error) {
      console.error('[AppAdapter] Web Push subscription failed:', error);
      return null;
    }
  }
  
  /**
   * Настройка обработчиков событий
   */
  setupEventListeners() {
    // Обработка изменения видимости
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('[AppAdapter] App became visible');
      }
    });
    
    // Обработка изменения онлайн/офлайн статуса
    window.addEventListener('online', () => {
      console.log('[AppAdapter] App is online');
    });
    
    window.addEventListener('offline', () => {
      console.log('[AppAdapter] App is offline');
    });
  }
  
  /**
   * Проверка авторизации
   */
  isAuthenticated() {
    return this.user !== null;
  }
  
  /**
   * Получение ID пользователя
   */
  getUserId() {
    if (this.user) {
      return this.user.id;
    }
    
    // Fallback для неавторизованных пользователей
    let userId = localStorage.getItem('newsUserId');
    if (!userId) {
      userId = 'web_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
      localStorage.setItem('newsUserId', userId);
    }
    return userId;
  }
  
  /**
   * Вибрация / Haptic Feedback
   */
  vibrate(type = 'light') {
    if (this.features.useTelegramHaptics && window.Telegram?.WebApp?.HapticFeedback) {
      const tg = window.Telegram.WebApp;
      
      switch(type) {
        case 'light':
          tg.HapticFeedback.impactOccurred('light');
          break;
        case 'medium':
          tg.HapticFeedback.impactOccurred('medium');
          break;
        case 'heavy':
          tg.HapticFeedback.impactOccurred('heavy');
          break;
        case 'success':
          tg.HapticFeedback.notificationOccurred('success');
          break;
        case 'error':
          tg.HapticFeedback.notificationOccurred('error');
          break;
        case 'warning':
          tg.HapticFeedback.notificationOccurred('warning');
          break;
      }
    } else if (this.features.useWebVibration) {
      const patterns = {
        light: 10,
        medium: 20,
        heavy: 50,
        success: [10, 50, 10],
        error: [50, 100, 50],
        warning: [30, 50, 30]
      };
      
      navigator.vibrate(patterns[type] || 10);
    }
  }
  
  /**
   * Показ уведомления
   */
  async showNotification(title, body, options = {}) {
    if (this.mode === 'telegram-mini-app') {
      // В Telegram уведомления показываются через бота
      console.log('[AppAdapter] Telegram notification (handled by bot):', title, body);
      return;
    }
    
    if (this.features.canUseWebPush && Notification.permission === 'granted') {
      const registration = await navigator.serviceWorker.ready;
      
      await registration.showNotification(title, {
        body,
        icon: '/logo.png',
        badge: '/logo.png',
        tag: options.tag || 'default',
        data: options.url || '/news.html',
        ...options
      });
    }
  }
}

// Глобальная инициализация
window.appAdapter = new AppAdapter();

// Инициализируем при загрузке DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.appAdapter.init();
  });
} else {
  window.appAdapter.init();
}