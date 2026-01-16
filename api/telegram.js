require('dotenv/config')
const { Telegraf, Markup } = require('telegraf')

const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'fusuges').toLowerCase()
const WEBAPP_URL = process.env.WEBAPP_URL

// Path to database file
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver'
const DB_FILE_PATH = 'db.json'

// Read database from GitHub
async function readNewsDB() {
  try {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${DB_FILE_PATH}`
    const response = await fetch(url)
    if (response.ok) {
      return await response.json()
    }
  } catch (err) {
    console.error('Error reading DB:', err)
  }
  return { posts: [] }
}

// Write database to GitHub
async function writeNewsDB(db) {
  try {
    // Get current file SHA
    const getUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}`
    const getResponse = await fetch(getUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
    
    const fileData = await getResponse.json()
    const sha = fileData.sha
    
    // Update file
    const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64')
    const updateResponse = await fetch(getUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Update news via bot',
        content: content,
        sha: sha
      })
    })
    
    return updateResponse.ok
  } catch (err) {
    console.error('Error writing DB:', err)
    return false
  }
}function isAdminUser(from) {
  if (!from || !from.username) return false
  return from.username.toLowerCase() === ADMIN_USERNAME
}

async function addNews({ text, author, isAdmin, photoFileId }) {
    const db = await readNewsDB()
        const post = {
    id: db.posts.length > 0 ? Math.max(...db.posts.map(p => p.id)) + 1 : 1,    text,
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

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN)
const userStates = new Map()

bot.start(async ctx => {
  userStates.delete(ctx.from.id)
  await ctx.reply(
    'Добро пожаловать! 👋\n\nИспользуйте кнопку ниже, чтобы открыть приложение:',
    {
      reply_markup: {
        keyboard: [[
          { text: '📱 Открыть приложение', web_app: { url: WEBAPP_URL } }
        ]],
        resize_keyboard: true
      }
    }
  )
  await ctx.reply('Или отправьте новость текстом (можно с фото):', { reply_markup: { remove_keyboard: true } })
})

bot.on('photo', async ctx => {
  const userId = ctx.from.id
  const isAdmin = isAdminUser(ctx.from)
  const caption = ctx.message.caption || ''
  const photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id

  if (caption.trim()) {
    const post = await addNews({ text: caption, author: ctx.from, isAdmin, photoFileId })
    if (isAdmin) {
      await ctx.reply('✅ Новость опубликована!')
    } else {
      const post = await addNews({ text: caption, author: ctx.from, isAdmin, photoFileId })
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

  const post = await addNews({ text, author: ctx.from, isAdmin, photoFileId })

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

// Serverless function handler for Vercel
module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body)
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    res.status(500).json({ error: err.message })
  }
}
