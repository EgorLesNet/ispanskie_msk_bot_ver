// index.js - ТОЛЬКО для локального запуска
require('dotenv/config');
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Локальные прокси к API (для разработки)
if (!process.env.VERCEL) {
  console.log('🔧 Local development mode');
  
  // Прокси к API файлам
  app.use('/api/news', require('./api/news'));
  app.use('/api/businesses', require('./api/businesses'));
  app.use('/api/reactions', require('./api/reactions'));
  app.use('/api/media', require('./api/media'));
  app.use('/api/summary', require('./api/summary'));
  app.use('/api/auth', require('./api/auth'));
  app.use('/api/reviews', require('./api/reviews'));
  
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
