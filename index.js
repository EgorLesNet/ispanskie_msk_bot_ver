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

// In-memory хранилище для Vercel serverless
let newsDB = { posts: [], seq: 1 }

function readNewsDB() { return newsDB }
function writeNewsDB(db) { newsDB = db }

function isAdminUser(from) {
  if (!from || !from.username) return false
  return from.username.toLowerCase() === ADMIN_USERNAME
}

function addNews({ text, author, isAdmin, photoFileId }) {
  const db = readNewsDB()
  const post = {
    id: db.seq++,
    text,
    authorId: author.id,
    authorName: [author.first_name, author.last_name].filter(Boolean).join(' '),
    authorUsername: author.username || null,
    createdAt: new Date().toISOString(),
    status: isAdmin ? 'approved' : 'pending',
    source: isAdmin ? 'admin' : 'user',
    photoFileId: photoFileId || null
  }
  db.posts.unshift(post)
  writeNewsDB(db)
  return post
}

function setNewsStatus(postId, status) {
  const db = readNewsDB()
  const p = db.posts.find(x => x.id === postId)
  if (!p) return null
  p.status = status
  writeNewsDB(db)
  return p
}

function deleteNews(postId) {
  const db = readNewsDB()
  const index = db.posts.findIndex(x => x.id === postId)
  if (index === -1) return null
  const deleted = db.posts.splice(index, 1)[0]
  writeNewsDB(db)
  return deleted
}

// Инициализация бота
let bot = null
if (BOT_TOKEN && WEBAPP_URL) {
  const { Telegraf, Markup } = require('telegraf')
  bot = new Telegraf(BOT_TOKEN)
  const userStates = new Map()

  bot.start(async ctx => {
    userStates.delete(ctx.from.id)
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
        })
} else {
    console.log('Bot not started (missing BOT_TOKEN or WEBAPP_URL). Web server only.')
}
// API endpoints
app.get('/api/news', (req, res) => {
  const db = readNewsDB()
  const approved = db.posts.filter(p => p.status === 'approved')
  res.json({ posts: approved })
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

app.get('/api/photo/:fileId', async (req, res) => {
  if (!bot) return res.status(503).json({ error: 'Bot not available' })
  const fileId = req.params.fileId
  try {
    const fileUrl = await bot.telegram.getFileLink(fileId)
    const response = await fetch(fileUrl)
    const buffer = await response.buffer()
    res.set('Content-Type', response.headers.get('content-type'))
    res.send(buffer)
  } catch (err) {
    console.error('Failed to get photo:', err)
    res.status(500).json({ error: 'Failed to get photo' })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:\${PORT}`)
})

module.exports = app
