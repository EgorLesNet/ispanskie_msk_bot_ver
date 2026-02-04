// api/_push.js - Web Push Notifications (module, not a function)
require('dotenv/config');
const webpush = require('web-push');

// VAPID ключи для Web Push (должны быть в .env)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

function normalizeVapidSubject(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  // По спецификации: только https: или mailto:
  if (s.startsWith('mailto:')) return s;
  if (s.startsWith('https://') || s.startsWith('http://')) return s;

  // Частая ошибка — домен без протокола
  return `https://${s.replace(/^\/+/, '')}`;
}

const RAW_VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'https://ispanskie-msk.vercel.app';
const VAPID_SUBJECT = normalizeVapidSubject(RAW_VAPID_SUBJECT);

let PUSH_ENABLED = false;

// Настройка VAPID (никогда не должна валить весь API)
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(
      VAPID_SUBJECT,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    PUSH_ENABLED = true;
    console.log('[PUSH] VAPID configured successfully:', VAPID_SUBJECT);
  } catch (e) {
    PUSH_ENABLED = false;
    console.warn('[PUSH] VAPID subject invalid, push disabled:', RAW_VAPID_SUBJECT);
    console.warn('[PUSH] Error:', e.message);
  }
} else {
  console.warn('[PUSH] VAPID keys not configured. Push notifications will not work.');
  console.warn('[PUSH] Generate keys with: npx web-push generate-vapid-keys');
}

// Обработка подписки на уведомления
async function handleSubscribe(req, res) {
  try {
    const { subscription, userId } = req.body;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Invalid subscription object'
      });
    }
    
    // Сохраняем подписку
    const subscriptionKey = userId || subscription.endpoint;
    subscriptions.set(subscriptionKey, {
      subscription,
      userId,
      createdAt: new Date().toISOString()
    });
    
    console.log(`[PUSH] New subscription registered: ${subscriptionKey}`);
    console.log(`[PUSH] Total subscriptions: ${subscriptions.size}`);
    
    return res.status(200).json({
      success: true,
      message: 'Subscription registered successfully'
    });
    
  } catch (error) {
    console.error('[PUSH] Subscribe error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to register subscription',
      message: error.message
    });
  }
}

// Отписка от уведомлений
async function handleUnsubscribe(req, res) {
  try {
    const { userId, endpoint } = req.body;
    
    const subscriptionKey = userId || endpoint;
    
    if (!subscriptionKey) {
      return res.status(400).json({
        success: false,
        error: 'userId or endpoint required'
      });
    }
    
    const deleted = subscriptions.delete(subscriptionKey);
    
    console.log(`[PUSH] Unsubscribed: ${subscriptionKey} (existed: ${deleted})`);
    console.log(`[PUSH] Remaining subscriptions: ${subscriptions.size}`);
    
    return res.status(200).json({
      success: true,
      message: deleted ? 'Unsubscribed successfully' : 'Subscription not found'
    });
    
  } catch (error) {
    console.error('[PUSH] Unsubscribe error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to unsubscribe',
      message: error.message
    });
  }
}

// Отправка уведомления
async function handleSend(req, res) {
  try {
    const { title, body, icon, url, userId, broadcast } = req.body;
    
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'title and body are required'
      });
    }
    if (!PUSH_ENABLED) {
  return res.status(500).json({
    success: false,
    error: 'Push is not configured (VAPID invalid or missing)'
  });
}
    
    const payload = JSON.stringify({
      title,
      body,
      icon: icon || '/logo.png',
      badge: '/logo.png',
      url: url || '/',
      timestamp: Date.now()
    });
    
    const results = {
      sent: 0,
      failed: 0,
      errors: []
    };
    
    // Определяем кому отправлять
    let targetSubscriptions = [];
    
    if (broadcast) {
      // Broadcast всем подписчикам
      targetSubscriptions = Array.from(subscriptions.values());
      console.log(`[PUSH] Broadcasting to ${targetSubscriptions.length} subscribers`);
    } else if (userId) {
      // Отправка конкретному пользователю
      const sub = subscriptions.get(userId);
      if (sub) {
        targetSubscriptions = [sub];
        console.log(`[PUSH] Sending to user: ${userId}`);
      } else {
        console.log(`[PUSH] User not found: ${userId}`);
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either userId or broadcast=true must be specified'
      });
    }
    
    // Отправляем уведомления
    for (const { subscription } of targetSubscriptions) {
      try {
        await webpush.sendNotification(subscription, payload);
        results.sent++;
      } catch (error) {
        console.error('[PUSH] Send error:', error);
        results.failed++;
        results.errors.push({
          endpoint: subscription.endpoint,
          error: error.message
        });
        
        // Удаляем невалидные подписки
        if (error.statusCode === 410 || error.statusCode === 404) {
          const key = Array.from(subscriptions.entries())
            .find(([_, sub]) => sub.subscription.endpoint === subscription.endpoint)?.[0];
          if (key) {
            subscriptions.delete(key);
            console.log(`[PUSH] Removed invalid subscription: ${key}`);
          }
        }
      }
    }
    
    console.log(`[PUSH] Results: ${results.sent} sent, ${results.failed} failed`);
    
    return res.status(200).json({
      success: true,
      results
    });
    
  } catch (error) {
    console.error('[PUSH] Send error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send notification',
      message: error.message
    });
  }
}

// Получение публичного VAPID ключа
async function handleGetVapidKey(req, res) {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({
      success: false,
      error: 'VAPID keys not configured'
    });
  }
  
  return res.status(200).json({
    success: true,
    publicKey: VAPID_PUBLIC_KEY
  });
}

// Получение статистики
async function handleStats(req, res) {
  return res.status(200).json({
    success: true,
    stats: {
      totalSubscriptions: subscriptions.size,
      subscriptions: Array.from(subscriptions.entries()).map(([key, data]) => ({
        key,
        userId: data.userId,
        createdAt: data.createdAt
      }))
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.pathname.split('/').pop() || req.query.action;
  
  console.log(`[PUSH] ${req.method} ${url.pathname} (action: ${action})`);
  
  // Роутинг по действиям
  if (req.method === 'POST') {
    switch (action) {
      case 'subscribe':
        return handleSubscribe(req, res);
      case 'unsubscribe':
        return handleUnsubscribe(req, res);
      case 'send':
        return handleSend(req, res);
      default:
        return res.status(400).json({
          error: 'Unknown action',
          validActions: ['subscribe', 'unsubscribe', 'send']
        });
    }
  } else if (req.method === 'GET') {
    switch (action) {
      case 'vapid-key':
        return handleGetVapidKey(req, res);
      case 'stats':
        return handleStats(req, res);
      default:
        return res.status(400).json({
          error: 'Unknown action',
          validActions: ['vapid-key', 'stats']
        });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};
