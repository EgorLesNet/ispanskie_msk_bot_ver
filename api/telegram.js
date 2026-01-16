require('dotenv/config')
const { Telegraf } = require('telegraf')

const BOT_TOKEN = process.env.BOT_TOKEN
const WEBAPP_URL = process.env.WEBAPP_URL

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'fusuges').toLowerCase()
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPO = process.env.GITHUB_REPO || 'EgorLesNet/ispanskie_msk_bot_ver'
const DB_FILE_PATH = process.env.DB_FILE_PATH || 'db.json'
const DB_BRANCH = process.env.DB_BRANCH || 'main'

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required')
if (!WEBAPP_URL) console.warn('[WARN] WEBAPP_URL is not set')
if (!GITHUB_TOKEN) console.warn('[WARN] GITHUB_TOKEN is not set (DB write will fail)')
if (!ADMIN_CHAT_ID) console.warn('[WARN] ADMIN_CHAT_ID is not set (admin moderation notifications will fail)')

const bot = new Telegraf(BOT_TOKEN)

// In-memory state: if user sends photo without caption, wait for next text
const userStates = new Map()

function isAdmin(ctx) {
  const u = ctx?.from
  const chat = ctx?.chat
  const byUsername = Boolean(u?.username) && u.username.toLowerCase() === ADMIN_USERNAME
  const byId =
    ADMIN_CHAT_ID != null &&
    (Number(u?.id) === ADMIN_CHAT_ID || Number(chat?.id) === ADMIN_CHAT_ID)

  return byUsername || byId
}

function normalizeDb(raw) {
  const db = raw && typeof raw === 'object' ? raw : {}
  const postsRaw = Array.isArray(db.posts) ? db.posts : []
  let pending = Array.isArray(db.pending) ? db.pending : []
  let rejected = Array.isArray(db.rejected) ? db.rejected : []

  // Migration: old schema stored pending inside posts
  const posts = []
  const migratedPending = []
  for (const p of postsRaw) {
    if (p && p.status === 'pending') migratedPending.push(p)
    else posts.push(p)
  }
  pending = [...migratedPending, ...pending]

  return { posts, pending, rejected }
}

function nextPostId(db) {
  const ids = []
  for (const a of [db.posts, db.pending, db.rejected]) {
    for (const p of a) if (p && typeof p.id === 'number') ids.push(p.id)
  }
  return ids.length ? Math.max(...ids) + 1 : 1
}

async function readNewsDB() {
  try {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${DB_BRANCH}/${DB_FILE_PATH}`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return { posts: [], pending: [], rejected: [] }
    const json = await response.json()
    return normalizeDb(json)
  } catch (err) {
    console.error('Error reading DB:', err)
    return { posts: [], pending: [], rejected: [] }
  }
}

async function writeNewsDB(db) {
  if (!GITHUB_TOKEN) return false

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}`

  try {
    // Try to get SHA (file may not exist on first run)
    let sha = null
    const getResponse = await fetch(`${apiUrl}?ref=${encodeURIComponent(DB_BRANCH)}`, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json'
      }
    })

    if (getResponse.ok) {
      const fileData = await getResponse.json()
      sha = fileData.sha || null
    } else if (getResponse.status !== 404) {
      const t = await getResponse.text().catch(() => '')
      console.error('GitHub get contents failed:', getResponse.status, t)
      return false
    }

    const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64')

    const putBody = {
      message: 'Update news via bot',
      content,
      branch: DB_BRANCH
    }
    if (sha) putBody.sha = sha

    const updateResponse = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(putBody)
    })

    if (!updateResponse.ok) {
      const t = await updateResponse.text().catch(() => '')
      console.error('GitHub update failed:', updateResponse.status, t)
      return false
    }

    return true
  } catch (err) {
    console.error('Error writing DB:', err)
    return false
  }
}

async function submitNews({ text, author, admin, photoFileId }) {
  const db = await readNewsDB()
  const id = nextPostId(db)

  const base = {
    id,
    text: String(text || '').trim(),
    authorId: author?.id ?? null,
    authorName: [author?.first_name, author?.last_name].filter(Boolean).join(' ').trim(),
    authorUsername: author?.username || null,
    createdAt: new Date().toISOString(),
    photoFileId: photoFileId || null
  }

  let saved
  if (admin) {
    saved = { ...base, status: 'approved', source: 'admin' }
    db.posts.unshift(saved)
  } else {
    saved = { ...base, status: 'pending', source: 'user' }
    db.pending.unshift(saved)
  }

  await writeNewsDB(db)
  return saved
}

async function moderateNews(postId, action) {
  const db = await readNewsDB()

  const idx = db.pending.findIndex(p => p && p.id === postId)
  if (idx === -1) return null

  const p = db.pending.splice(idx, 1)[0]
  if (!p) return null

  if (action === 'approve') {
    const approved = { ...p, status: 'approved' }
    db.posts.unshift(approved)
    await writeNewsDB(db)
    return { post: approved, status: 'approved' }
  }

  if (action === 'reject') {
    const rejected = { ...p, status: 'rejected' }
    db.rejected.unshift(rejected)
    await writeNewsDB(db)
    return { post: rejected, status: 'rejected' }
  }

  return null
}

function adminKeyboard(postId) {
  return {
    inline_keyboard: [[
      { text: '✅ Одобрить', callback_data: `approve:${postId}` },
      { text: '❌ Отклонить', callback_data: `reject:${postId}` }
    ]]
  }
}

async function notifyAdmin(ctx, post) {
  if (!ADMIN_CHAT_ID) return

  const header =
    `📬 Новая новость #${post.id} от ${post.authorName || 'Unknown'}${
      post.authorUsername ? ` (@${post.authorUsername})` : ''
    }:\n\n${post.text}`

  try {
    if (post.photoFileId) {
      await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, post.photoFileId, {
        caption: header,
        reply_markup: adminKeyboard(post.id)
      })
    } else {
      await ctx.telegram.sendMessage(ADMIN_CHAT_ID, header, {
        reply_markup: adminKeyboard(post.id)
      })
    }
  } catch (err) {
    console.error('Failed to notify admin:', err)
  }
}

async function deleteNews(postId) {
  const db = await readNewsDB()

  const places = [
    { key: 'posts', title: 'published' },
    { key: 'pending', title: 'pending' },
    { key: 'rejected', title: 'rejected' }
  ]

  for (const place of places) {
    const arr = db[place.key]
    const idx = arr.findIndex(p => p && p.id === postId)
    if (idx !== -1) {
      const removed = arr.splice(idx, 1)[0]
      await writeNewsDB(db)
      return { place: place.title, post: removed }
    }
  }

  return null
}

bot.start(async ctx => {
  userStates.delete(ctx.from.id)

  await ctx.reply(
    'Добро пожаловать!\n\nИспользуйте кнопку ниже, чтобы открыть приложение:',
    {
      reply_markup: {
        keyboard: [[{ text: '📱 Открыть приложение', web_app: { url: WEBAPP_URL } }]],
        resize_keyboard: true
      }
    }
  )

  await ctx.reply('Или отправьте новость текстом (можно с фото):', {
    reply_markup: { remove_keyboard: true }
  })
})

bot.on('photo', async ctx => {
  const admin = isAdmin(ctx)
  const photos = ctx.message.photo || []
  const best = photos.length ? photos[photos.length - 1] : null
  const photoFileId = best?.file_id || null
  const caption = (ctx.message.caption || '').trim()

  if (caption) {
    const post = await submitNews({ text: caption, author: ctx.from, admin, photoFileId })

    if (admin) {
      await ctx.reply('✅ Новость опубликована!')
    } else {
      await ctx.reply('📩 Новость отправлена на проверку.')
      await notifyAdmin(ctx, post)
    }
    return
  }

  if (!photoFileId) {
    await ctx.reply('Не удалось прочитать фото, попробуйте отправить ещё раз.')
    return
  }

  userStates.set(ctx.from.id, { photoFileId })
  await ctx.reply('🖼 Фото получено! Теперь отправьте текст новости:')
})

bot.on('text', async ctx => {
  const admin = isAdmin(ctx)
  const text = (ctx.message.text || '').trim()
  if (!text || text.startsWith('/')) return

  const state = userStates.get(ctx.from.id)
  const photoFileId = state?.photoFileId || null
  userStates.delete(ctx.from.id)

  const post = await submitNews({ text, author: ctx.from, admin, photoFileId })

  if (admin) {
    await ctx.reply('✅ Новость опубликована!')
  } else {
    await ctx.reply('📩 Новость отправлена на проверку.')
    await notifyAdmin(ctx, post)
  }
})

bot.on('callback_query', async ctx => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('Нет доступа!', { show_alert: true })
    return
  }

  const data = String(ctx.callbackQuery.data || '')
  const [action, idStr] = data.split(':')
  const postId = Number(idStr)

  if (!postId || (action !== 'approve' && action !== 'reject')) {
    await ctx.answerCbQuery('Некорректная команда', { show_alert: true })
    return
  }

  const result = await moderateNews(postId, action)
  if (!result) {
    await ctx.answerCbQuery('Не найдено / уже обработано', { show_alert: true })
    return
  }

  // убрать кнопки у сообщения, чтобы не жали повторно
  try {
    await ctx.editMessageReplyMarkup()
  } catch (_) {}

  if (result.status === 'approved') {
    await ctx.answerCbQuery('Одобрено')
    await ctx.reply(`Новость #${result.post.id} одобрена и опубликована.`)
  } else {
    await ctx.answerCbQuery('Отклонено')
    await ctx.reply(`Новость #${result.post.id} отклонена.`)
  }

  // (опционально) уведомить автора, если он писал боту в личку
  try {
    if (result.post.authorId) {
      const msg =
        result.status === 'approved'
          ? `✅ Ваша новость #${result.post.id} одобрена и опубликована.`
          : `❌ Ваша новость #${result.post.id} отклонена.`
      await ctx.telegram.sendMessage(result.post.authorId, msg)
    }
  } catch (_) {}
})

// Vercel serverless handler
module.exports = async (req, res) => {
  try {
    let update = req.body

    // Safety: sometimes body may arrive as string/buffer
    if (typeof update === 'string') {
      update = JSON.parse(update)
    } else if (Buffer.isBuffer(update)) {
      update = JSON.parse(update.toString('utf8'))
    }

    await bot.handleUpdate(update)
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    res.status(500).json({ error: err?.message || String(err) })
  }
}
