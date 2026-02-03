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
  
  // Единый router для всех API endpoints (кроме telegram)
  const router = require('./api/router');
  const telegram = require('./api/telegram');
  
  // Telegram webhook - отдельная функция
  app.use('/api/telegram', telegram);
  
  // Все остальные API через router
  app.use('/api', router);
  
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`✅ API router: /api/*`);
    console.log(`✅ Telegram webhook: /api/telegram`);
  });
}

module.exports = app;
