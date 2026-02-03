// api/send-digest.js - Отправка ежедневного дайджеста подписчикам
require('dotenv/config');
const { getTodayDigest } = require('../lib/digest');
const { getDigestSubscribers } = require('../lib/users');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://ispanskie-msk-bot-ver.vercel.app';

/**
 * Отправляет сообщение через Telegram Bot API
 */
async function sendMessage(chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${response.status} - ${error}`);
  }
  
  return await response.json();
}

module.exports = async (req, res) => {
  // Безопасность: проверяем секретный ключ для cron
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.log('[SEND_DIGEST] Unauthorized access attempt');
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  if (!BOT_TOKEN) {
    console.error('[SEND_DIGEST] BOT_TOKEN not configured');
    return res.status(503).json({ success: false, error: 'Bot not configured' });
  }
  
  console.log('[SEND_DIGEST] Starting digest send at', new Date().toISOString());
  
  try {
    // Получаем дайджест за сегодня
    const groqApiKey = process.env.GROQ_API_KEY || null;
    const digestData = await getTodayDigest(groqApiKey);
    
    if (!digestData || !digestData.digest) {
      console.log('[SEND_DIGEST] No digest data available');
      return res.json({ 
        success: true, 
        message: 'No digest to send',
        postsCount: 0,
        sentCount: 0
      });
    }
    
    const digestText = digestData.digest;
    const postsCount = digestData.postsCount || 0;
    
    console.log('[SEND_DIGEST] Digest generated:', {
      postsCount,
      textLength: digestText.length
    });
    
    // Получаем подписчиков
    const subscribers = await getDigestSubscribers();
    
    if (!subscribers || subscribers.length === 0) {
      console.log('[SEND_DIGEST] No subscribers found');
      return res.json({ 
        success: true, 
        message: 'No subscribers',
        postsCount,
        sentCount: 0
      });
    }
    
    console.log('[SEND_DIGEST] Found', subscribers.length, 'subscribers');
    
    // Кнопка "Открыть ХАБ" с прямой ссылкой на мини-приложение
    const keyboard = {
      inline_keyboard: [[
        { 
          text: '📱 Открыть ХАБ', 
          url: WEBAPP_URL
        }
      ]]
    };
    
    // Отправляем дайджест каждому подписчику
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    for (const user of subscribers) {
      try {
        const chatId = user.tgId;
        
        await sendMessage(chatId, digestText, keyboard);
        successCount++;
        
        console.log(`[SEND_DIGEST] Sent to user ${chatId}`);
        
        // Небольшая задержка, чтобы не превысить лимиты Telegram API
        if (subscribers.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        errorCount++;
        const errorMsg = error.message || String(error);
        errors.push({ userId: user.tgId, error: errorMsg });
        console.error(`[SEND_DIGEST] Error sending to ${user.tgId}:`, errorMsg);
      }
    }
    
    const result = {
      success: true,
      postsCount,
      subscribersCount: subscribers.length,
      sentCount: successCount,
      errorCount,
      timestamp: new Date().toISOString()
    };
    
    if (errors.length > 0) {
      result.errors = errors;
    }
    
    console.log('[SEND_DIGEST] Completed:', result);
    
    return res.json(result);
  } catch (error) {
    console.error('[SEND_DIGEST] Critical error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || String(error),
      timestamp: new Date().toISOString()
    });
  }
};
