require('dotenv/config')
const express = require('express')
const fetch = require('node-fetch')
const fs = require('fs')
const path = require('path')

const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'fusuges').toLowerCase()
const WEBAPP_URL = process.env.WEBAPP_URL
const PORT = Number(process.env.PORT || 3000)

// Use /tmp for Vercel serverless (writable), otherwise local path
const TMP_DB_PATH = '/tmp/db.json'
const PUBLIC_DB_PATH = path.join(__dirname, 'public', 'db.json')
const LOCAL_DB_PATH = path.join(__dirname, 'db.json')
const DB_PATH = path.join('/tmp', 'db.json')
const INITIAL_DB_PATH = path.join(__dirname, 'public', 'db.json')


// ============== Database Functions ==============

function readNewsDB() {
  try {
    // Сначала пытаемся прочитать из /tmp
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8')
      return JSON.parse(data)
    }
    
    // Если нет в /tmp, берем из public/db.json (начальные данные)
    if (fs.existsSync(INITIAL_DB_PATH)) {
      console.log('Loading initial data from public/db.json')
      const data = fs.readFileSync(INITIAL_DB_PATH, 'utf8')
      const db = JSON.parse(data)
      // Сохраняем в /tmp для последующих запросов
      writeNewsDB(db)
      return db
    }
  } catch (err) {
    console.error('Error reading db.json:', err)
  }
  
  // Если ничего нет - возвращаем пустую структуру
  return {
    posts: [],
    pending: [],
    rejected: [],
    businesses: [],
    seq: 0
  }
}

function writeNewsDB(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
    return true
  } catch (err) {
    console.error('Error writing db.json:', err)
    return false
  }
}


function writeNewsDB(db) {
  try {
    const dbStr = JSON.stringify(db, null, 2)
    
    if (process.env.VERCEL) {
      // On Vercel: write to /tmp (writable)
      fs.writeFileSync(TMP_DB_PATH, dbStr, 'utf8')
    } else {
      // Local: write to db.json
      fs.writeFileSync(LOCAL_DB_PATH, dbStr, 'utf8')
    }
    return true
  } catch (err) {
    console.error('Error writing db.json:', err)
    return false
  }
}

function isAdminUser(user) {
  if (!user) return false
  const username = (user.username || '').toLowerCase()
  return username === ADMIN_USERNAME
}

function addNews({ text, author, isAdmin, photoFileId, media }) {
  const db = readNewsDB()
  db.seq = (db.seq || 0) + 1
  
  const post = {
    id: db.seq,
    text: text || '',
    authorId: author.id,
    authorName: [author.first_name, author.last_name].filter(Boolean).join(' '),
    authorUsername: author.username || null,
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    category: 'all',
    media: media || [],
    photoFileId: photoFileId || null,
    source: null,
    moderationMessage: null,
    status: isAdmin ? 'approved' : 'pending',
    sourceType: isAdmin ? 'admin' : 'user'
  }
  
  if (photoFileId && (!media || media.length === 0)) {
    post.media = [{ type: 'photo', fileId: photoFileId }]
    post.photoFileIds = [photoFileId]
  }
  
  if (isAdmin) {
    db.posts.unshift(post)
  } else {
    if (!db.pending) db.pending = []
    db.pending.unshift(post)
  }
  
  writeNewsDB(db)
  return post
}

function setNewsStatus(postId, newStatus) {
  const db = readNewsDB()
  
  const pendingIndex = (db.pending || []).findIndex(p => p.id === postId)
  if (pendingIndex === -1) return null
  
  const post = db.pending[pendingIndex]
  post.status = newStatus
  
  db.pending.splice(pendingIndex, 1)
  
  if (newStatus === 'approved') {
    db.posts.unshift(post)
  } else if (newStatus === 'rejected') {
    if (!db.rejected) db.rejected = []
    db.rejected.unshift(post)
  }
  
  writeNewsDB(db)
  return post
}

function deleteNews(postId) {
  const db = readNewsDB()
  
  const lists = ['posts', 'pending', 'rejected']
  for (const listName of lists) {
    const list = db[listName] || []
    const index = list.findIndex(p => p.id === postId)
    if (index !== -1) {
      const deleted = list.splice(index, 1)[0]
      writeNewsDB(db)
      return deleted
    }
  }
  
  return null
}

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

function sanitizeText(text) {
  if (!text) return ''
  return String(text)
    .trim()
    .slice(0, 500)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
}

// Express сервер
const app = express()
app.use(express.json())
app.use(express.static('public'))

// Root redirect
app.get('/', (req, res) => res.redirect('/news.html'))

// Serve db.json dynamically
app.get('/db.json', (req, res) => {
  const db = readNewsDB()
  res.json(db)
})

let bot = null

if (BOT_TOKEN && WEBAPP_URL) {
  const { Telegraf, Markup } = require('telegraf')
  bot = new Telegraf(BOT_TOKEN)
  const userStates = new Map()
  
  bot.start(async ctx => {
    userStates.delete(ctx.from.id)
    await ctx.reply(
      'Добро пожаловать! 👋\n\nИспользуйте кнопку ниже, чтобы открыть приложение:',
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
            caption: `📬 Новая новость #${post.id} от ${post.authorName}${post.authorUsername ? ' (@' + post.authorUsername + ')' : ''}:\n\n${post.text}`,
            reply_markup: { inline_keyboard: [[
              { text: '✅ Одобрить', callback_data: `approve:${post.id}` },
              { text: '❌ Отклонить', callback_data: `reject:${post.id}` }
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
          caption: `📬 Новая новость #${post.id} от ${post.authorName}${post.authorUsername ? ' (@' + post.authorUsername + ')' : ''}:\n\n${post.text}`,
          reply_markup: { inline_keyboard: [[
            { text: '✅ Одобрить', callback_data: `approve:${post.id}` },
            { text: '❌ Отклонить', callback_data: `reject:${post.id}` }
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
      await ctx.reply(newStatus === 'approved' ? `Новость #${p.id} одобрена и опубликована.` : `Новость #${p.id} отклонена.`)
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
  
  // Запуск бота только не на Vercel
  if (!process.env.VERCEL) {
    bot.launch().then(() => console.log('Bot started'))
      .catch(err => console.error('Bot launch error:', err))
  }
} else {
  console.log('Bot not started (missing BOT_TOKEN or WEBAPP_URL). Web server only.')
}

// ============== API endpoints ==============

// News API
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

// Business API
app.get('/api/businesses', (req, res) => {
  const db = readNewsDB()
  const businesses = db.businesses || []
  const enriched = businesses.map(b => {
    const reviews = b.reviews || []
    const avgRating = reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
      : null
    return { ...b, avgRating, reviewCount: reviews.length }
  })
  res.json({ businesses: enriched })
})

app.post('/api/businesses', (req, res) => {
  const { secret, name, category, description, address, url, lat, lng } = req.body
  const BUSINESS_ADMIN_KEY = process.env.BUSINESS_ADMIN_KEY || 'demo_secret'
  
  if (secret !== BUSINESS_ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid secret' })
  }
  
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
  const success = writeNewsDB(db)
  
  if (!success) {
    return res.status(500).json({ error: 'Failed to save business' })
  }
  
  res.json({ success: true, business: newBiz })
})

// Reviews API
const reviewRateLimits = new Map()
function canAddReview(userId) {
  const now = Date.now()
  const lastReview = reviewRateLimits.get(userId)
  if (lastReview && (now - lastReview) < 60000) {
    return false
  }
  reviewRateLimits.set(userId, now)
  return true
}

app.get('/api/businesses/:id/reviews', (req, res) => {
  const businessId = Number(req.params.id)
  const db = readNewsDB()
  const business = db.businesses?.find(b => b.id === businessId)
  if (!business) return res.status(404).json({ error: 'Business not found' })
  res.json({ reviews: business.reviews || [] })
})

app.post('/api/businesses/:id/reviews', (req, res) => {
  const businessId = Number(req.params.id)
  const { userId, userName, rating, text } = req.body
  
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

// Media API - теперь обрабатывается в api/media.js


// Запуск сервера только локально
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}

module.exports = app
