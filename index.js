// index.js - упрощенная версия для локального запуска
// На Vercel используются serverless функции из папки /api

require('dotenv/config');
const express = require('express');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());

// Статические файлы
app.use(express.static('public'));

// Редирект с корня на news.html
app.get('/', (req, res) => {
  res.redirect('/news.html');
});

// Если не на Vercel, запускаем локальный сервер
if (!process.env.VERCEL) {
  // Локальные API endpoints (на Vercel они в /api)
  app.use('/api/telegram', require('./api/telegram'));
  app.use('/api/news', require('./api/news'));
  app.use('/api/businesses', require('./api/businesses'));
  app.use('/api/reactions', require('./api/reactions'));
  app.use('/api/media', require('./api/media'));

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in browser`);
  });
}

// Экспорт для Vercel
module.exports = app;
