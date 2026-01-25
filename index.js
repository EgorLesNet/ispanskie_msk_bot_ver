require('dotenv/config')
const express = require('express')
const fetch = require('node-fetch')

const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'fusuges').toLowerCase()
const WEBAPP_URL = process.env.WEBAPP_URL
const PORT = Number(process.env.PORT || 3000)

// Express сервер
const app = express()
app.use(express.json())
app.use(express.static('public'))

// ============== Security middleware ==============
// CORS - разрешаем только с нашего домена (в production)
const ALLOWED_ORIGINS = [
  'https://ispanskiemskbotver.vercel.app',
  'http://localhost:3000'
]

if (BOT_TOKEN && WEBAPP_URL && !process.env.VERCEL) {
  const { Telegraf, Markup } = require('telegraf')
  bot = new Telegraf(BOT_TOKEN)
  const userStates = new Map && !process.env.VERCEL()
  bot.start(async ctx => {    userStates.delete(ctx.from.id)
    await ctx.reply(
      'Добро пожаловать! 👋\\n\\nИспользуйте кнопку ниже, чтобы открыть приложение:',
      Markup.keyboard([[Markup.button.webApp('📱 Открыть приложение', WEBAPP_URL)]]).resize()
    )
    await ctx.reply('Или отправьте новость текстом (можно с фото):', { reply_markup: { remove_keyboard: true } })
  })

  bot.on('photo', async ctx => {
    const userId = ctx.from.id
    const isAdmin = isAdminUser(ctx.from)
    const caption = ctx.message.caption || ''
    const photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id

    if (caption.trim()) {
      const post = addNews({ text: caption, author: ctx.from, isAdmin, photoFileId })
      if (isAdmin) {
        await ctx.reply('✅ Новость опубликована!')
      } else {
        await ctx.reply('📩 Новость отправлена на проверку.')
        try {
          await ctx.telegram.sendPhoto(ctx.botInfo.id, photoFileId, {
            caption: `📬 Новая новость #\${post.id} от \${post.authorName}\${post.authorUsername ? ' (@' + post.authorUsername + ')' : ''}:\\n\\n\${post.text}`,
            reply_markup: { inline_keyboard: [[
              { text: '✅ Одобрить', callback_data: `approve:\${post.id}` },
              { text: '❌ Отклонить', callback_data: `reject:\${post.id}` }
            ]] }
          })
        } catch (err) { console.error('Failed to notify admin:', err) }
      }
    } else {
      userStates.set(userId, { photoFileId })
      await ctx.reply('🖼 Фото получено! Теперь отправьте текст новости:')
    }
  })

  bot.on('text', async ctx => {
    const userId = ctx.from.id
    const isAdmin = isAdminUser(ctx.from)
    const text = ctx.message.text
    if (text.startsWith('/')) return

    const state = userStates.get(userId)
    const photoFileId = (state && state.photoFileId) || null
    userStates.delete(userId)

    const post = addNews({ text, author: ctx.from, isAdmin, photoFileId })
    if (isAdmin) {
      await ctx.reply('✅ Новость опубликована!')
    } else {
      await ctx.reply('📩 Новость отправлена на проверку.')
      try {
        const msgData = {
          caption: `📬 Новая новость #\${post.id} от \${post.authorName}\${post.authorUsername ? ' (@' + post.authorUsername + ')' : ''}:\\n\\n\${post.text}`,
          reply_markup: { inline_keyboard: [[
            { text: '✅ Одобрить', callback_data: `approve:\${post.id}` },
            { text: '❌ Отклонить', callback_data: `reject:\${post.id}` }
          ]] }
        }
        if (photoFileId) {
          await ctx.telegram.sendPhoto(ctx.botInfo.id, photoFileId, msgData)
        } else {
          await ctx.telegram.sendMessage(ctx.botInfo.id, msgData.caption, { reply_markup: msgData.reply_markup })
        }
      } catch (err) { console.error('Failed to notify admin:', err) }
    }
  })

  bot.on('callback_query', async ctx => {
    const data = ctx.callbackQuery.data || ''
    if (!isAdminUser(ctx.from)) {
      await ctx.answerCbQuery('Нет доступа!', { show_alert: true })
      return
    }

    const [action, idStr] = data.split(':')
    const postId = Number(idStr)
    if (!postId) {
      await ctx.answerCbQuery('Некорректный id')
      return
    }

    if (action === 'approve' || action === 'reject') {
      const newStatus = action === 'approve' ? 'approved' : 'rejected'
      const p = setNewsStatus(postId, newStatus)
      if (!p) {
        await ctx.answerCbQuery('Не найдено')
        return
      }
      await ctx.answerCbQuery(newStatus === 'approved' ? 'Одобрено' : 'Отклонено')
      await ctx.reply(newStatus === 'approved' ? `Новость #\${p.id} одобрена и опубликована.` : `Новость #\${p.id} отклонена.`)
      return
    }
    await ctx.answerCbQuery('Неизвестное действие')
  })

    // Webhook endpoint for Vercel
  app.post('/api/telegram', async (req, res) => {
    try {
      await bot.handleUpdate(req.body)
      res.sendStatus(200)
    } catch (err) {
      console.error('Webhook error:', err)
      res.sendStatus(500)
          }
        })
} else {
    console.log('Bot not started (missing BOT_TOKEN or WEBAPP_URL). Web server only.')
}
// API endpoints
app.get('/api/news', (req, res) => {
  const db = readNewsDB()
  const approved = db.posts.filter(p => p.status === 'approved')
  const postsWithLikes = approved.map(post => ({
        ...post,
        likes: post.likes || 0,
        dislikes: post.dislikes || 0
            }))
  res.json({ posts: postsWithLikes })  
})

// Лайки и дизлайки
app.post('/api/news/:id/like', (req, res) => {
  const postId = Number(req.params.id)
  const db = readNewsDB()
  const post = db.posts.find(p => p.id === postId)
  if (!post) return res.status(404).json({ error: 'Not found' })
  post.likes = (post.likes || 0) + 1
  writeNewsDB(db)
  res.json({ success: true, likes: post.likes })
})

app.post('/api/news/:id/dislike', (req, res) => {
  const postId = Number(req.params.id)
  const db = readNewsDB()
  const post = db.posts.find(p => p.id === postId)
  if (!post) return res.status(404).json({ error: 'Not found' })
  post.dislikes = (post.dislikes || 0) + 1
  writeNewsDB(db)
  res.json({ success: true, dislikes: post.dislikes })
})

app.delete('/api/news/:id', (req, res) => {
  const postId = Number(req.params.id)
  const adminUsername = req.query.admin
  if (!adminUsername || adminUsername.toLowerCase() !== ADMIN_USERNAME) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const deleted = deleteNews(postId)
  if (!deleted) return res.status(404).json({ error: 'Not found' })
  res.json({ success: true, deleted })
})



// ============== Reviews API ==============
// Функция для добавления отзыва
function addReview(businessId, review) {
  const db = readNewsDB()
  const business = db.businesses?.find(b => b.id === businessId)
  if (!business) return null
  if (!business.reviews) business.reviews = []
  const newReview = {
    id: Date.now(),
    userId: review.userId,
    userName: review.userName,
    rating: review.rating,
    text: review.text,
    createdAt: new Date().toISOString()
  }
  business.reviews.unshift(newReview)
  writeNewsDB(db)
  return newReview
}

// Rate limiter (простой in-memory)
const reviewRateLimits = new Map()
function canAddReview(userId) {
  const now = Date.now()
  const lastReview = reviewRateLimits.get(userId)
  if (lastReview && (now - lastReview) < 60000) { // 1 минута
    return false
  }
  reviewRateLimits.set(userId, now)
  return true
}

// Валидация и санитизация
function sanitizeText(text) {
  if (!text) return ''
  return String(text)
    .trim()
    .slice(0, 500)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
}

// API endpoint: GET /api/businesses/:id/reviews
app.get('/api/businesses/:id/reviews', (req, res) => {
  const businessId = Number(req.params.id)
  const db = readNewsDB()
  const business = db.businesses?.find(b => b.id === businessId)
  if (!business) return res.status(404).json({ error: 'Business not found' })
  res.json({ reviews: business.reviews || [] })
})

// API endpoint: POST /api/businesses/:id/reviews
app.post('/api/businesses/:id/reviews', (req, res) => {
  const businessId = Number(req.params.id)
  const { userId, userName, rating, text } = req.body
  
  // Валидация
  if (!userId || !userName) {
    return res.status(400).json({ error: 'userId and userName required' })
  }
  
  const numRating = Number(rating)
  if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: 'rating must be 1-5' })
  }
  
  const cleanText = sanitizeText(text)
  if (cleanText.length < 1 || cleanText.length > 500) {
    return res.status(400).json({ error: 'text must be 1-500 characters' })
  }
  
  // Rate limiting
  if (!canAddReview(userId)) {
    return res.status(429).json({ error: 'Too many reviews. Wait 1 minute.' })
  }
  
  const review = addReview(businessId, {
    userId,
    userName: sanitizeText(userName),
    rating: numRating,
    text: cleanText
  })
  
  if (!review) {
    return res.status(404).json({ error: 'Business not found' })
  }
  
  res.json({ success: true, review })
})

// API endpoint: GET /api/businesses
app.get('/api/businesses', (req, res) => {
  const db = readNewsDB()
  const businesses = db.businesses || []
  // Добавляем средний рейтинг
  const enriched = businesses.map(b => {
    const reviews = b.reviews || []
    const avgRating = reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
      : null
    return { ...b, avgRating, reviewCount: reviews.length }
  })
  res.json({ businesses: enriched })
})

// API endpoint: POST /api/businesses (с улучшенной безопасностью)
app.post('/api/businesses', (req, res) => {
  const { secret, name, category, description, address, url, lat, lng } = req.body
  const BUSINESS_ADMIN_KEY = process.env.BUSINESS_ADMIN_KEY || 'demo_secret'
  
  if (secret !== BUSINESS_ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid secret' })
  }
  
  // Валидация
  if (!name || !category) {
    return res.status(400).json({ error: 'name and category required' })
  }
  
  const numLat = Number(lat)
  const numLng = Number(lng)
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return res.status(400).json({ error: 'Invalid coordinates' })
  }
  
  const db = readNewsDB()
  if (!db.businesses) db.businesses = []
  
  const newBiz = {
    id: db.businesses.length > 0 ? Math.max(...db.businesses.map(b => b.id)) + 1 : 1,
    name: sanitizeText(name),
    category: sanitizeText(category),
    lat: numLat,
    lng: numLng,
    description: sanitizeText(description),
    address: sanitizeText(address),
    url: url ? String(url).trim().slice(0, 500) : null,
    reviews: [],
    createdAt: new Date().toISOString()
  }
  
  db.businesses.push(newBiz)
  writeNewsDB(db)
  res.json({ success: true, business: newBiz })
})

// API endpoint: GET /api/media/:fileId (переименован с /api/photo)
app.get('/api/media/:fileId', async (req, res) => {
  if (!bot) return res.status(503).json({ error: 'Bot not available' })
  const fileId = req.params.fileId
  try {
    const fileUrl = await bot.telegram.getFileLink(fileId)
    const response = await fetch(fileUrl)
    const buffer = await response.buffer()
    res.set('Content-Type', response.headers.get('content-type'))
    res.send(buffer)
  } catch (err) {
    console.error('Failed to get media:', err)
    res.status(500).json({ error: 'Failed to get media' })
  }
})
// hi!
module.exports = app;
