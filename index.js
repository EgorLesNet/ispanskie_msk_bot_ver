// index.js - минимальный сервер для локальной разработки
// На Vercel используются serverless функции из /api

require('dotenv/config');
const express = require('express');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статические файлы
app.use(express.static('public'));

// Перенаправление корня на news.html
app.get('/', (req, res) => {
  res.redirect('/news.html');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mode: process.env.VERCEL ? 'vercel' : 'local',
    timestamp: new Date().toISOString(),
    env: {
      hasBotToken: !!process.env.BOT_TOKEN,
      hasGithubToken: !!process.env.GITHUB_TOKEN,
      hasWebappUrl: !!process.env.WEBAPP_URL
    }
  });
});

// Если не на Vercel, подключаем локальные API handlers
if (!process.env.VERCEL) {
  console.log('\n⏳ Loading API handlers for local development...');
  
  try {
    const telegramHandler = require('./api/telegram');
    const newsHandler = require('./api/news');
    const businessesHandler = require('./api/businesses');
    const reactionsHandler = require('./api/reactions');
    const mediaHandler = require('./api/media');
    
    app.post('/api/telegram', telegramHandler);
    app.get('/api/news', newsHandler);
    app.all('/api/businesses*', businessesHandler);
    app.all('/api/reactions', reactionsHandler);
    app.get('/api/media', mediaHandler);
    
    console.log('✅ API handlers loaded successfully\n');
  } catch (error) {
    console.error('\n❌ Failed to load API handlers:', error.message);
    console.log('⚠️  Some API endpoints may not work locally\n');
  }
  
  app.listen(PORT, () => {
    console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃   📰 Ispanskie News Bot - Local Server      ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃   🌐 Server: http://localhost:${PORT}           ┃
┃   📝 Mode: Development                        ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
    `);
    
    // Проверка переменных окружения
    if (!process.env.BOT_TOKEN) {
      console.log('\n⚠️  BOT_TOKEN not set - Telegram bot will not work');
    } else {
      console.log('\n✅ BOT_TOKEN configured');
    }
    
    if (!process.env.GITHUB_TOKEN) {
      console.log('⚠️  GITHUB_TOKEN not set - database write operations will fail');
    } else {
      console.log('✅ GITHUB_TOKEN configured');
    }
    
    if (!process.env.WEBAPP_URL) {
      console.log('⚠️  WEBAPP_URL not set - web app button may not work\n');
    } else {
      console.log('✅ WEBAPP_URL configured\n');
    }
  });
}

// Экспорт для Vercel
module.exports = app;
