// api/media.js
require('dotenv/config');
const { Telegraf } = require('telegraf');
const https = require('https');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;

module.exports = async (req, res) => {
  if (!bot) {
    return res.status(503).json({ error: 'Bot not configured' });
  }

  const { fileId } = req.query;
  if (!fileId) {
    return res.status(400).json({ error: 'Missing fileId parameter' });
  }

  try {
    // 1. Получаем инфо о файле
    let fileInfo;
    try {
      fileInfo = await bot.telegram.getFile(fileId);
    } catch (error) {
      // Telegram Bot API возвращает ошибку для файлов > 20MB
      if (error.message?.includes('file is too big') || 
          error.response?.description?.includes('file is too big')) {
        console.log(`File ${fileId} is too large for Bot API`);
        return res.status(413).json({ 
          error: 'File too large',
          message: 'Файл слишком большой (>20MB). Telegram Bot API не поддерживает скачивание файлов больше 20MB.'
        });
      }
      throw error;
    }
    
    const fileSize = fileInfo.file_size || 0;
    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    
    // 2. Проверяем размер (дополнительная проверка)
    if (fileSize > MAX_SIZE) {
      console.log(`File too large: ${fileSize} bytes (max ${MAX_SIZE})`);
      return res.status(413).json({ 
        error: 'File too large',
        message: `Файл ${(fileSize/1024/1024).toFixed(1)} MB превышает лимит 20 MB`,
        fileSize,
        maxSize: MAX_SIZE
      });
    }
    
    // 3. Получаем ссылку
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    
    // 4. Потоковая передача
    return new Promise((resolve, reject) => {
      https.get(fileUrl, (stream) => {
        res.setHeader('Content-Type', stream.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        stream.pipe(res);
        stream.on('end', resolve);
        stream.on('error', reject);
      }).on('error', reject);
    });
    
  } catch (error) {
    console.error('Media proxy error:', error.message || error);
    
    // Обработка специфичных ошибок Telegram
    if (error.message?.includes('file is too big')) {
      return res.status(413).json({ 
        error: 'File too large for Bot API',
        message: 'Файл слишком большой. Telegram Bot API поддерживает файлы до 20MB.'
      });
    }
    
    if (error.message?.includes('Bad Request')) {
      return res.status(400).json({
        error: 'Bad request to Telegram API',
        message: 'Не удалось получить файл из Telegram'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch media',
      message: 'Ошибка загрузки медиа'
    });
  }
};
