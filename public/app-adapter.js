/**
 * App Adapter - автоматическое определение режима работы приложения
 * Поддерживает: Telegram Mini App, PWA (установленное), Web Browser
 */

class AppAdapter {
  constructor() {
    this.mode = this.detectMode();
    this.user = null;
    this.features = this.getFeatures();
    this.pushSubscription = null;
    
    console.log('[AppAdapter] Mode detected:', this.mode);
    console.log('[AppAdapter] Features:', this.features);
  }
  
  /**
   * Определяет режим работы приложения
   * @returns {'telegram-mini-app' | 'pwa-installed' | 'web-browser'}
   */
  detectMode() {
    if (window.Telegram?.WebApp?.initData) {
      return 'telegram-mini-app';
    }
    
    if (window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true) {
      return 'pwa-installed';
    }
    
    return 'web-browser';
  }
  
  /**
   * Возвращает доступные функции для текущего режима
   */
  getFeatures() {
    const isWebMode = this.mode !== 'telegram-mini-app';
    
    return {
      showBackButton: this.mode === 'telegram-mini-app',
      showInstallPrompt: this.mode === 'web-browser',
      showTelegramLogin: isWebMode,
      showNavigation: true,
      useTelegramAuth: this.mode === 'telegram-mini-app',
      useWebAuth: isWebMode,
      canUseTelegramNotifications: this.mode === 'telegram-mini-app',
      canUseWebPush: isWebMode && 'Notification' in window && 'serviceWorker' in navigator,
      enableOffline: isWebMode && 'serviceWorker' in navigator,
      enableCache: true,
      useTelegramHaptics: this.mode === 'telegram-mini-app',
      useWebVibration: isWebMode && 'vibrate' in navigator
    };
  }
  
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
    
    this.setupEventListeners();
    console.log('[AppAdapter] Initialized successfully');
  }
  
  async initTelegramMode() {
    const tg = window.Telegram.WebApp;
    
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes();
    
    const isDark = tg.colorScheme === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'dark' : '');
    tg.setHeaderColor(isDark ? '#0e0e0e' : '#f0f2f5');
    tg.setBackgroundColor(isDark ? '#0e0e0e' : '#f0f2f5');
    
    if (window.location.pathname !== '/news.html') {
      tg.BackButton.show();
      tg.BackButton.onClick(() => window.history.back());
    }
    
    if (tg.initDataUnsafe?.user) {
      this.user = {
        id: tg.initDataUnsafe.user.id,
        firstName: tg.initDataUnsafe.user.first_name,
        lastName: tg.initDataUnsafe.user.last_name,
        username: tg.initDataUnsafe.user.username,
        photoUrl: tg.initDataUnsafe.user.photo_url,
        authMethod: 'telegram'
      };
      localStorage.setItem('tgUser', JSON.stringify(this.user));
    }
    
    console.log('[AppAdapter] Telegram mode initialized');
  }
  
  async initPWAMode() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        console.log('[AppAdapter] Service Worker registered:', registration);
        
        registration.addEventListener('updatefound', () => {
          console.log('[AppAdapter] Service Worker update found');
        });
      } catch (error) {
        console.error('[AppAdapter] Service Worker registration failed:', error);
      }
    }
    
    const savedUser = localStorage.getItem('tgUser');
    if (savedUser) {
      try {
        this.user = JSON.parse(savedUser);
      } catch (e) {
        console.error('[AppAdapter] Failed to parse saved user:', e);
      }
    }
    
    if (this.user && this.features.canUseWebPush) {
      await this.initWebPush();
    }
    
    console.log('[AppAdapter] PWA mode initialized');
  }
  
  async initWebMode() {
    this.setupInstallPrompt();
    
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
  
  setupInstallPrompt() {
    let deferredPrompt = null;
    
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      console.log('[AppAdapter] Install prompt available');
      this.showInstallButton(deferredPrompt);
    });
    
    window.addEventListener('appinstalled', () => {
      console.log('[AppAdapter] PWA installed');
      deferredPrompt = null;
    });
  }
  
  showInstallButton(deferredPrompt) {
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
    } else {
      console.log('[AppAdapter] Web Push permission denied');
    }
  }
  
  /**
   * Запрос разрешения на уведомления
   */
  async requestNotificationPermission() {
    if (!this.features.canUseWebPush) {
      console.log('[AppAdapter] Web Push not supported');
      return false;
    }
    
    if (Notification.permission === 'granted') {
      return true;
    }
    
    try {
      const permission = await Notification.requestPermission();
      console.log('[AppAdapter] Notification permission:', permission);
      
      if (permission === 'granted') {
        await this.subscribeToWebPush();
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[AppAdapter] Error requesting notification permission:', error);
      return false;
    }
  }
  
  /**
   * Подписка на Web Push с регистрацией на сервере
   */
  async subscribeToWebPush() {
    if (!this.features.canUseWebPush) {
      console.log('[AppAdapter] Web Push not available');
      return null;
    }
    
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        console.log('[AppAdapter] Already subscribed to Web Push');
        this.pushSubscription = subscription;
        return subscription;
      }
      
      // Получаем VAPID ключ с сервера
      const vapidResponse = await fetch('/api/push/vapid-key');
      const vapidData = await vapidResponse.json();
      
      if (!vapidData.success || !vapidData.publicKey) {
        throw new Error('Failed to get VAPID public key');
      }
      
      console.log('[AppAdapter] Got VAPID public key');
      
      // Создаем подписку
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(vapidData.publicKey)
      });
      
      console.log('[AppAdapter] Created push subscription');
      
      // Регистрируем подписку на сервере
      const registerResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userId: this.getUserId()
        })
      });
      
      const registerData = await registerResponse.json();
      
      if (registerData.success) {
        console.log('[AppAdapter] Push subscription registered on server');
        this.pushSubscription = subscription;
        return subscription;
      } else {
        throw new Error(registerData.error || 'Failed to register subscription');
      }
      
    } catch (error) {
      console.error('[AppAdapter] Web Push subscription failed:', error);
      return null;
    }
  }
  
  /**
   * Отписка от Web Push
   */
  async unsubscribeFromWebPush() {
    try {
      if (this.pushSubscription) {
        await this.pushSubscription.unsubscribe();
        console.log('[AppAdapter] Unsubscribed from Web Push');
      }
      
      // Уведомляем сервер
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.getUserId()
        })
      });
      
      this.pushSubscription = null;
      return true;
    } catch (error) {
      console.error('[AppAdapter] Failed to unsubscribe from Web Push:', error);
      return false;
    }
  }
  
  /**
   * Проверка статуса подписки на уведомления
   */
  async isPushSubscribed() {
    if (!this.features.canUseWebPush) {
      return false;
    }
    
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription !== null;
    } catch (error) {
      console.error('[AppAdapter] Error checking push subscription:', error);
      return false;
    }
  }
  
  /**
   * Конвертация VAPID ключа из base64 в Uint8Array
   */
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    
    return outputArray;
  }
  
  setupEventListeners() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('[AppAdapter] App became visible');
      }
    });
    
    window.addEventListener('online', () => {
      console.log('[AppAdapter] App is online');
    });
    
    window.addEventListener('offline', () => {
      console.log('[AppAdapter] App is offline');
    });
  }
  
  isAuthenticated() {
    return this.user !== null;
  }
  
  getUserId() {
    if (this.user) {
      return this.user.id;
    }
    
    let userId = localStorage.getItem('newsUserId');
    if (!userId) {
      userId = 'web_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
      localStorage.setItem('newsUserId', userId);
    }
    return userId;
  }
  
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
  
  async showNotification(title, body, options = {}) {
    if (this.mode === 'telegram-mini-app') {
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