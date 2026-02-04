// api/router.js - Единый роутер для всех API endpoints
// Решает проблему лимита 12 serverless functions на Vercel Hobby

// Импорт модулей с префиксом _ (не являются serverless functions)
const authHandler = require('./_auth');
const businessesHandler = require('./_businesses');
const mediaHandler = require('./_media');
const newsHandler = require('./_news');
const reactionsHandler = require('./_reactions');
const reviewsHandler = require('./_reviews');
const summaryHandler = require('./_summary');
const profileHandler = require('./_profile');
const mediaFileHandler = require('./_media_fileId');
const photoFileHandler = require('./_photo_fileId');
const pushHandler = require('./_push');
const digestHandler = require('./_digest');

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
    
    if (path === '/api/profile' || path.startsWith('/api/profile/')) {
      return await profileHandler(req, res);
    }
    
    if (path === '/api/push' || path.startsWith('/api/push/')) {
      return await pushHandler(req, res);
    }
    
    if (path === '/api/digest' || path.startsWith('/api/digest/')) {
      return await digestHandler(req, res);
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
