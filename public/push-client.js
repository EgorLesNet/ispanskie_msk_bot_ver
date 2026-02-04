// public/push-client.js
(function () {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker не поддерживается');
    // service-worker.js уже есть в проекте
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function getVapidKey() {
    const res = await fetch('/api/push/vapid-key', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.publicKey) {
      throw new Error(data.error || 'VAPID key недоступен');
    }
    return data.publicKey;
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    return data;
  }

  function getUserIdSafe() {
    try {
      return window.appAdapter?.getUserId?.() || null;
    } catch {
      return null;
    }
  }

  async function getExistingSubscription(reg) {
    const sub = await reg.pushManager.getSubscription();
    return sub || null;
  }

  async function subscribe() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Разрешение на уведомления не выдано');

    const reg = await ensureServiceWorker();
    const publicKey = await getVapidKey();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await postJSON('/api/push/subscribe', {
      subscription: sub,
      userId: getUserIdSafe()
    });

    return sub;
  }

  async function unsubscribe() {
    const reg = await ensureServiceWorker();
    const sub = await getExistingSubscription(reg);
    if (!sub) return;

    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});

    await postJSON('/api/push/unsubscribe', {
      endpoint,
      userId: getUserIdSafe()
    });
  }

  function setStatus(text) {
    const el = document.getElementById('pushStatus');
    if (el) el.textContent = text || '';
  }

  async function refreshUI() {
    const btn = document.getElementById('pushBtn');
    if (!btn) return;

    btn.disabled = true;
    try {
      const reg = await ensureServiceWorker();
      const sub = await getExistingSubscription(reg);
      if (sub) {
        btn.dataset.state = 'on';
        btn.innerHTML = '<span>🔔</span><span>Отключить уведомления</span>';
        setStatus('Уведомления включены');
      } else {
        btn.dataset.state = 'off';
        btn.innerHTML = '<span>🔔</span><span>Включить уведомления</span>';
        setStatus('Уведомления выключены');
      }
    } catch (e) {
      btn.dataset.state = 'off';
      btn.innerHTML = '<span>🔔</span><span>Включить уведомления</span>';
      setStatus(e.message || 'Push недоступен');
    } finally {
      btn.disabled = false;
    }
  }

  async function togglePush() {
    const btn = document.getElementById('pushBtn');
    if (!btn) return;

    btn.disabled = true;
    try {
      if (btn.dataset.state === 'on') {
        await unsubscribe();
      } else {
        await subscribe();
      }
    } catch (e) {
      alert(e.message || 'Ошибка уведомлений');
    } finally {
      btn.disabled = false;
      await refreshUI();
    }
  }

  window.togglePush = togglePush;

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('pushBtn');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        togglePush();
      });
      refreshUI();
    }
  });
})();
