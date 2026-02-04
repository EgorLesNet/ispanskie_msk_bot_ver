// Service Worker для PWA - версия 1.1.0
// Цель: консистентный UI bundle (PWA должна выглядеть как Telegram Mini App)

const CACHE_NAME = 'ispanskie-v3';
const API_CACHE_NAME = 'ispanskie-api-v3';

// Статические файлы для кэширования
const STATIC_ASSETS = [
  '/news.html',
  '/business.html',
  '/profile.html',
  '/recommendations.html',
  '/stats.html',
  '/logo.png',
  '/manifest.json',
  '/app-adapter.js',
  '/navigation.js',
  '/styles.css'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error('[SW] Installation failed:', error);
      })
  );
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // Удаляем старые версии кэша
              return name !== CACHE_NAME && name !== API_CACHE_NAME;
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Обработка запросов
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Пропускаем запросы к внешним ресурсам (например Telegram SDK), но разрешаем /api
  if (url.origin !== self.location.origin && !url.pathname.startsWith('/api/')) {
    return;
  }

  // HTML навигация (страницы) — Network First, чтобы PWA не залипала на старом HTML
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/news.html')))
    );
    return;
  }

  // API запросы - Network First стратегия
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Кэшируем успешные GET запросы
          if (request.method === 'GET' && response.status === 200) {
            const responseClone = response.clone();
            caches.open(API_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // При офлайн - возвращаем из кэша
          return caches.match(request);
        })
    );
    return;
  }

  // Статические файлы - Cache First стратегия
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Обновляем кэш в фоне
          fetch(request).then((response) => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, response.clone());
              });
            }
          }).catch(() => {});

          return cachedResponse;
        }

        // Если нет в кэше - запрашиваем из сети
        return fetch(request)
          .then((response) => {
            // Кэшируем успешный ответ
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          });
      })
  );
});

// Обработка Push уведомлений
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);

  let data = {
    title: 'Испанские кварталы',
    body: 'Новое уведомление',
    icon: '/logo.png',
    badge: '/logo.png'
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag || 'default',
      requireInteraction: false,
      data: data.url || '/news.html'
    })
  );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);

  event.notification.close();

  const urlToOpen = event.notification.data || '/news.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Если приложение уже открыто - фокусируемся на нем
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus().then(() => client.navigate(urlToOpen));
          }
        }
        // Иначе открываем новое окно
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => caches.delete(name))
        );
      })
    );
  }
});
