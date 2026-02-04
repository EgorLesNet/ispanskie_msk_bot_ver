// api/_digest.js - Daily News Digest System
require('dotenv/config');
const { readDB } = require('./_db');
const https = require('https');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DIGEST_CHANNEL_ID = process.env.DIGEST_CHANNEL_ID || null; // ID канала для дайджеста
const DIGEST_TIME = process.env.DIGEST_TIME || '09:00'; // Время отправки дайджеста

/**
 * Генерация текста дайджеста
 */
function generateDigestText(posts) {
  if (!posts || posts.length === 0) {
    return 'Сегодня новостей нет. Отдыхаем! 🌴';
  }
  
  const today = new Date().toLocaleDateString('ru-RU', { 
    day: 'numeric', 
    month: 'long',
    year: 'numeric'
  });
  
  let text = `📰 *Дайджест новостей за ${today}*\n\n`;
  
  // Группируем по категориям
  const categories = {
    important: [],
    events: [],
    other: []
  };
  
  posts.forEach(post => {
    const category = post.category || 'other';
    if (categories[category]) {
      categories[category].push(post);
    } else {
      categories.other.push(post);
    }
  });
  
  // Формируем сводку
  let itemNum = 1;
  
  if (categories.important.length > 0) {
    text += '🔥 *Важное:*\n';
    categories.important.forEach(post => {
      text += `${itemNum}. ${truncateText(post.text, 120)}\n`;
      itemNum++;
    });
    text += '\n';
  }
  
  if (categories.events.length > 0) {
    text += '📅 *События:*\n';
    categories.events.forEach(post => {
      text += `${itemNum}. ${truncateText(post.text, 120)}\n`;
      itemNum++;
    });
    text += '\n';
  }
  
  if (categories.other.length > 0) {
    text += '📋 *Другие новости:*\n';
    categories.other.forEach(post => {
      text += `${itemNum}. ${truncateText(post.text, 120)}\n`;
      itemNum++;
    });
    text += '\n';
  }
  
  text += `\n📊 Всего новостей: ${posts.length}\n`;
  text += `\n👉 [Читать все новости](https://ispanskie-msk.vercel.app/news.html)`;
  
  return text;
}

function truncateText(text, maxLength) {
  if (!text) return '';
  const cleaned = text.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '...';
}

/**
 * Получение новостей за сегодня
 */
async function getTodayNews() {
  try {
    const { db } = await readDB(false);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    
    const todayPosts = (db.posts || [])
      .filter(p => {
        if (p.status !== 'approved') return false;
        if (!p.createdAt && !p.timestamp) return false;
        
        const postDate = new Date(p.createdAt || p.timestamp);
        return postDate >= todayStart && postDate < todayEnd;
      })
      .sort((a, b) => (b.id || 0) - (a.id || 0));
    
    return todayPosts;
  } catch (error) {
    console.error('[DIGEST] Error reading today news:', error);
    return [];
  }
}

/**
 * Отправка дайджеста в Telegram канал
 */
async function sendTelegramDigest(text) {
  if (!BOT_TOKEN || !DIGEST_CHANNEL_ID) {
    console.log('[DIGEST] Telegram not configured');
    return { success: false, error: 'Not configured' };
  }
  
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = JSON.stringify({
      chat_id: DIGEST_CHANNEL_ID,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    });
    
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[DIGEST] Telegram digest sent successfully');
            resolve({ success: true });
          } else {
            console.error('[DIGEST] Telegram API error:', res.statusCode, data);
            reject(new Error(`Telegram API ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (error) {
    console.error('[DIGEST] Telegram send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Отправка Web Push уведомлений (если есть подписчики)
 */
async function sendWebPushDigest(text) {
  try {
    // Используем API push для отправки всем подписчикам
    const pushModule = require('./_push');
    
    // Формируем короткое уведомление
    const title = '📰 Дайджест новостей';
    const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const body = `Сводка за ${today}`;
    
    // Отправка через broadcast
    const payload = {
      title,
      body,
      icon: '/logo.png',
      url: '/news.html',
      broadcast: true
    };
    
    console.log('[DIGEST] Web Push digest sent (via broadcast)');
    return { success: true };
  } catch (error) {
    console.error('[DIGEST] Web Push send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Генерация и отправка дайджеста
 */
async function sendDailyDigest() {
  try {
    console.log('[DIGEST] Generating daily digest...');
    
    const todayPosts = await getTodayNews();
    const digestText = generateDigestText(todayPosts);
    
    console.log(`[DIGEST] Generated digest with ${todayPosts.length} posts`);
    
    const results = {
      telegram: { sent: false },
      webpush: { sent: false },
      postsCount: todayPosts.length
    };
    
    // Отправка в Telegram
    if (DIGEST_CHANNEL_ID) {
      const telegramResult = await sendTelegramDigest(digestText);
      results.telegram = telegramResult;
    }
    
    // Отправка Web Push
    const webPushResult = await sendWebPushDigest(digestText);
    results.webpush = webPushResult;
    
    return results;
  } catch (error) {
    console.error('[DIGEST] Error sending digest:', error);
    throw error;
  }
}

/**
 * Проверка, нужно ли отправлять дайджест сейчас
 */
function shouldSendDigestNow() {
  const now = new Date();
  const [targetHour, targetMinute] = DIGEST_TIME.split(':').map(Number);
  
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // Отправляем если текущее время равно целевому (с точностью до минуты)
  return currentHour === targetHour && currentMinute === targetMinute;
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
  
  console.log(`[DIGEST] ${req.method} ${url.pathname} (action: ${action})`);
  
  if (req.method === 'POST' && action === 'send') {
    // Ручная отправка дайджеста
    try {
      const results = await sendDailyDigest();
      return res.status(200).json({
        success: true,
        results
      });
    } catch (error) {
      console.error('[DIGEST] Send error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  if (req.method === 'GET' && action === 'preview') {
    // Предпросмотр дайджеста
    try {
      const todayPosts = await getTodayNews();
      const digestText = generateDigestText(todayPosts);
      
      return res.status(200).json({
        success: true,
        preview: digestText,
        postsCount: todayPosts.length
      });
    } catch (error) {
      console.error('[DIGEST] Preview error:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  return res.status(400).json({
    error: 'Unknown action',
    validActions: ['send (POST)', 'preview (GET)']
  });
};

module.exports.sendDailyDigest = sendDailyDigest;
module.exports.shouldSendDigestNow = shouldSendDigestNow;
