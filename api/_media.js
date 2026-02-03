// api/_media.js - Proxy для медиа файлов из Telegram
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
    let fileInfo;
    try {
      fileInfo = await bot.telegram.getFile(fileId);
    } catch (error) {
      if (error.message?.includes('file is too big') || 
          error.response?.description?.includes('file is too big')) {
        return res.status(413).json({ 
          error: 'File too large',
          message: 'Файл слишком большой (>20MB)'
        });
      }
      throw error;
    }
    
    const fileSize = fileInfo.file_size || 0;
    const MAX_SIZE = 20 * 1024 * 1024;
    
    if (fileSize > MAX_SIZE) {
      return res.status(413).json({ 
        error: 'File too large',
        message: `Файл ${(fileSize/1024/1024).toFixed(1)} MB превышает лимит 20 MB`
      });
    }
    
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    
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
    res.status(500).json({ 
      error: 'Failed to fetch media',
      message: 'Ошибка загрузки медиа'
    });
  }
};
