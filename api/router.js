// api/router.js - Единый роутер для всех API endpoints
// Решает проблему лимита 12 serverless functions на Vercel Hobby

const authHandler = require('./_modules/auth');
const businessesHandler = require('./_modules/businesses');
const mediaHandler = require('./_modules/media');
const newsHandler = require('./_modules/news');
const reactionsHandler = require('./_modules/reactions');
const reviewsHandler = require('./_modules/reviews');
const summaryHandler = require('./_modules/summary');
const telegramHandler = require('./_modules/telegram');
const profileHandler = require('./_modules/profile');
const mediaFileHandler = require('./_modules/media-file');
const photoFileHandler = require('./_modules/photo-file');

module.exports = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  
  console.log(`[ROUTER] ${req.method} ${path}`);
  
  try {
    // Роутинг по путям
    if (path === '/api/auth' || path.startsWith('/api/auth/')) {
      return await authHandler(req, res);
    }
    
    if (path === '/api/businesses' || path.startsWith('/api/businesses/')) {
      return await businessesHandler(req, res);
    }
    
    if (path === '/api/media' || path.startsWith('/api/media/')) {
      // Проверка на конкретный файл: /api/media/123
      const fileIdMatch = path.match(/^\/api\/media\/([^/]+)$/);
      if (fileIdMatch) {
        req.query = req.query || {};
        req.query.fileId = fileIdMatch[1];
        return await mediaFileHandler(req, res);
      }
      return await mediaHandler(req, res);
    }
    
    if (path === '/api/news' || path.startsWith('/api/news/')) {
      return await newsHandler(req, res);
    }
    
    if (path === '/api/reactions' || path.startsWith('/api/reactions/')) {
      return await reactionsHandler(req, res);
    }
    
    if (path === '/api/reviews' || path.startsWith('/api/reviews/')) {
      return await reviewsHandler(req, res);
    }
    
    if (path === '/api/summary' || path.startsWith('/api/summary/')) {
      return await summaryHandler(req, res);
    }
    
    if (path === '/api/telegram' || path.startsWith('/api/telegram/')) {
      return await telegramHandler(req, res);
    }
    
    if (path === '/api/profile' || path.startsWith('/api/profile/')) {
      return await profileHandler(req, res);
    }
    
    // Роутинг для /api/photo/[fileId]
    const photoMatch = path.match(/^\/api\/photo\/([^/]+)$/);
    if (photoMatch) {
      req.query = req.query || {};
      req.query.fileId = photoMatch[1];
      return await photoFileHandler(req, res);
    }
    
    // 404 для неизвестных путей
    return res.status(404).json({ error: 'API endpoint not found', path });
    
  } catch (error) {
    console.error('[ROUTER] Error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};
