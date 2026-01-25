// api/media.js
require('dotenv/config');
const { Telegraf } = require('telegraf');

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
    // Получаем информацию о файле
    const file = await bot.telegram.getFile(fileId);
    
    // Проверяем размер (Telegram Bot API лимит: 20MB)
    const fileSize = file.file_size || 0;
    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    
    if (fileSize > MAX_SIZE) {
      return res.status(413).json({ 
        error: 'File too large',
        message: 'Файл превышает 20MB. Telegram Bot API не поддерживает такие файлы.',
        fileSize,
        maxSize: MAX_SIZE
      });
    }

    // Получаем ссылку на файл
    const fileUrl = await bot.telegram.getFileLink(fileId);
    
    // Потоковая передача вместо загрузки в память
    const fetch = require('node-fetch');
    const response = await fetch(fileUrl.href);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    // Устанавливаем заголовки
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    
    // Потоковая передача файла
    response.body.pipe(res);
    
  } catch (error) {
    console.error('Media proxy error:', error);
    
    if (error.message?.includes('file is too big')) {
      return res.status(413).json({ 
        error: 'File too large for Bot API',
        message: 'Используйте файлы до 20MB или настройте локальный Bot API сервер'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch media',
      details: error.message 
    });
  }
};
