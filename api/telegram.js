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

const bot = new Telegraf(BOT_TOKEN)

// если юзер отправил одиночное фото без подписи — ждём текст
const userStates = new Map()

// альбомы (несколько фото): ключ `${fromId}:${mediaGroupId}`
const albums = new Map()

function isAdmin(ctx) {
  const u = ctx?.from
  const chat = ctx?.chat
  const byUsername = Boolean(u?.username) && u.username.toLowerCase() === ADMIN_USERNAME
  const byId =
    ADMIN_CHAT_ID != null &&
    (Number(u?.id) === ADMIN_CHAT_ID || Number(chat?.id) === ADMIN_CHAT_ID)
  return byUsername || byId
}

/**
 * Достаём источник пересланного сообщения.
 * Поддержка старых полей forward_from_chat/forward_from_message_id и новых forward_origin. [web:9]
 */
function getForwardSource(msg) {
  if (!msg) return null

  // Старый формат
  if (msg.forward_from_chat) {
    const chat = msg.forward_from_chat
    const messageId = msg.forward_from_message_id || null
    const username = chat.username || null
    const chatUrl = username ? `https://t.me/${username}` : null
    const postUrl = username && messageId ? `https://t.me/${username}/${messageId}` : null
    return {
      title: chat.title || null,
      username,
      chatId: chat.id ?? null,
      messageId,
      chatUrl,
      postUrl
    }
  }

  // Новый формат (Bot API: forward_origin)
  if (msg.forward_origin) {
    const fo = msg.forward_origin

    // fo.type: "channel" / "chat" / "user" / ...
    const chat = fo.chat || fo.sender_chat || null
    const messageId = fo.message_id || null

    if (chat) {
      const username = chat.username || null
      const chatUrl = username ? `https://t.me/${username}` : null
      const postUrl = username && messageId ? `https://t.me/${username}/${messageId}` : null
      return {
        title: chat.title || null,
        username,
        chatId: chat.id ?? null,
        messageId,
        chatUrl,
        postUrl
      }
    }
  }

  return null
}

// ---------- GitHub DB (Contents API) ----------

function normalizeDb(raw) {
  const db = raw && typeof raw === 'object' ? raw : {}
  const postsRaw = Array.isArray(db.posts) ? db.posts : []
  const pendingRaw = Array.isArray(db.pending) ? db.pending : []
  const rejectedRaw = Array.isArray(db.rejected) ? db.rejected : []

  // миграция: если раньше pending лежали в posts
  const posts = []
  const pending = [...pendingRaw]
  for (const p of postsRaw) {
    if (p && p.status === 'pending') pending.push(p)
    else posts.push(p)
  }

  return { posts, pending, rejected: rejectedRaw }
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
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}?ref=${encodeURIComponent(DB_BRANCH)}`
    const resp = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        ...(GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {})
      },
      cache: 'no-store'
    })

    if (!resp.ok) return { posts: [], pending: [], rejected: [] }

    const json = await resp.json()
    const contentB64 = json?.content || ''
    const buf = Buffer.from(contentB64, 'base64')
    const text = buf.toString('utf8')
    const data = JSON.parse(text)

    return normalizeDb(data)
  } catch (err) {
    console.error('Error reading DB:', err)
    return { posts: [], pending: [], rejected: [] }
  }
}

async function writeNewsDB(db) {
  if (!GITHUB_TOKEN) return false
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}`

  try {
    // SHA текущего файла
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
    const putBody = { message: 'Update news via bot', content, branch: DB_BRANCH }
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

// ---------- Посты ----------

async function submitNews({ text, author, admin, photoFileId, photoFileIds, source }) {
  const db = await readNewsDB()
  const id = nextPostId(db)

  const base = {
    id,
    text: String(text || '').trim(),
    authorId: author?.id ?? null,
    authorName: [author?.first_name, author?.last_name].filter(Boolean).join(' ').trim(),
    authorUsername: author?.username || null,
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    category: 'all',

    photoFileId: photoFileId || null,
    photoFileIds: Array.isArray(photoFileIds) ? photoFileIds : undefined,

    // источник пересланного сообщения (если есть)
    source: source || null,

    moderationMessage: null
  }

  let saved
  if (admin) {
    saved = { ...base, status: 'approved', sourceType: 'admin' }
    db.posts.unshift(saved)
  } else {
    saved = { ...base, status: 'pending', sourceType: 'user' }
    db.pending.unshift(saved)
  }

  await writeNewsDB(db)
  return saved
}

async function appendPhotosToPost(postId, newPhotoFileIds) {
  if (!Array.isArray(newPhotoFileIds) || !newPhotoFileIds.length) return false

  const db = await readNewsDB()
  const allBuckets = [db.posts, db.pending, db.rejected]

  for (const bucket of allBuckets) {
    const p = bucket.find(x => x && x.id === postId)
    if (!p) continue

    const existing = Array.isArray(p.photoFileIds)
      ? p.photoFileIds
      : (p.photoFileId ? [p.photoFileId] : [])

    const merged = [...existing]
    for (const id of newPhotoFileIds) {
      if (id && !merged.includes(id)) merged.push(id)
    }

    p.photoFileIds = merged
    if (!p.photoFileId && merged[0]) p.photoFileId = merged[0]

    await writeNewsDB(db)
    return true
  }

  return false
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

async function attachModerationMessage(postId, msg) {
  const db = await readNewsDB()
  const p = db.pending.find(x => x && x.id === postId)
  if (!p) return false

  p.moderationMessage = {
    chatId: msg?.chat?.id ?? null,
    messageId: msg?.message_id ?? null
  }

  await writeNewsDB(db)
  return true
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

  const src = post.source
  const srcLine = src?.postUrl
    ? `\n\nИсточник: ${src.title || ''} ${src.postUrl}`.trim()
    : (src?.chatUrl ? `\n\nИсточник: ${src.title || ''} ${src.chatUrl}`.trim() : '')

  const header =
    `📬 Новая новость #${post.id} от ${post.authorName || 'Unknown'}${
      post.authorUsername ? ` (@${post.authorUsername})` : ''
    }:\n\n${post.text}${srcLine}`

  try {
    let sent
    if (post.photoFileId) {
      sent = await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, post.photoFileId, {
        caption: header,
        reply_markup: adminKeyboard(post.id)
      })
    } else {
      sent = await ctx.telegram.sendMessage(ADMIN_CHAT_ID, header, {
        reply_markup: adminKeyboard(post.id)
      })
    }

    if (sent?.message_id) {
      await attachModerationMessage(post.id, sent)
    }
  } catch (err) {
    console.error('Failed to notify admin:', err)
  }
}

function extractPostIdFromText(text) {
  if (!text) return null
  const m = String(text).match(/#(\d+)/)
  return m ? Number(m[1]) : null
}

async function findPostIdByReplyMessage(replyMsg) {
  if (!replyMsg) return null
  const replyChatId = replyMsg.chat?.id ?? null
  const replyMessageId = replyMsg.message_id ?? null
  if (replyChatId == null || replyMessageId == null) return null

  const db = await readNewsDB()
  const all = [...db.pending, ...db.posts, ...db.rejected]

  for (const p of all) {
    const mm = p?.moderationMessage
    if (mm && mm.chatId === replyChatId && mm.messageId === replyMessageId) {
      return p.id
    }
  }

  return extractPostIdFromText(replyMsg.text || replyMsg.caption || '') || null
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

// ---------- Команды (важно: до on('text')) ----------

bot.command('start', async ctx => {
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

bot.command('delete', async ctx => {
  if (!isAdmin(ctx)) {
    await ctx.reply('Нет доступа!')
    return
  }

  const full = String(ctx.message?.text || '').trim()
  const parts = full.split(/\s+/)
  let postId = parts[1] ? Number(parts[1]) : null

  if (!postId) {
    const reply = ctx.message?.reply_to_message || null
    postId = await findPostIdByReplyMessage(reply)
  }

  if (!postId) {
    await ctx.reply('Использование:\n/delete <id>\nили ответьте на сообщение модерации и напишите /delete')
    return
  }

  const result = await deleteNews(postId)
  if (!result) {
    await ctx.reply(`Пост #${postId} не найден (или уже удалён).`)
    return
  }

  try {
    const mm = result.post?.moderationMessage
    if (mm?.chatId != null && mm?.messageId != null) {
      await ctx.telegram.deleteMessage(mm.chatId, mm.messageId)
    }
  } catch (_) {}

  await ctx.reply(`🗑 Удалено: #${postId} (раздел: ${result.place}).`)
})

// ---------- Фото ----------

bot.on('photo', async ctx => {
  const admin = isAdmin(ctx)
  const msg = ctx.message

  const photos = msg.photo || []
  const best = photos.length ? photos[photos.length - 1] : null
  const photoFileId = best?.file_id || null
  const caption = (msg.caption || '').trim()
  const mediaGroupId = msg.media_group_id || null

  if (!photoFileId) {
    await ctx.reply('Не удалось прочитать фото, попробуйте ещё раз.')
    return
  }

  const source = getForwardSource(msg)

  // Альбом (несколько фото)
  if (mediaGroupId) {
    const key = `${ctx.from.id}:${mediaGroupId}`
    const cur = albums.get(key) || {
      postId: null,
      photoFileIds: [],
      admin,
      author: ctx.from,
      caption: null,
      source: source || null
    }

    cur.photoFileIds.push(photoFileId)
    if (caption) cur.caption = caption
    if (source && !cur.source) cur.source = source

    // Если caption уже есть и пост ещё не создан — создаём и отвечаем сразу
    if (!cur.postId && cur.caption) {
      const post = await submitNews({
        text: cur.caption,
        author: ctx.from,
        admin,
        photoFileId: cur.photoFileIds[0] || null,
        photoFileIds: cur.photoFileIds,
        source: cur.source
      })

      cur.postId = post.id
      albums.set(key, cur)

      if (admin) {
        await ctx.reply('✅ Новость опубликована!')
      } else {
        await ctx.reply('📩 Новость отправлена на проверку.')
        await notifyAdmin(ctx, post)
      }
      return
    }

    // Если пост уже есть — просто дополняем фото
    if (cur.postId) {
      albums.set(key, cur)
      await appendPhotosToPost(cur.postId, [photoFileId])
      return
    }

    // Текста ещё нет — ждём (в альбомах caption обычно на одном из фото)
    albums.set(key, cur)
    return
  }

  // Одиночное фото
  if (caption) {
    const post = await submitNews({
      text: caption,
      author: ctx.from,
      admin,
      photoFileId,
      photoFileIds: [photoFileId],
      source
    })

    if (admin) {
      await ctx.reply('✅ Новость опубликована!')
    } else {
      await ctx.reply('📩 Новость отправлена на проверку.')
      await notifyAdmin(ctx, post)
    }
    return
  }

  userStates.set(ctx.from.id, { photoFileId, source })
  await ctx.reply('🖼 Фото получено! Теперь отправьте текст новости:')
})

// ---------- Текст ----------

bot.on('text', async (ctx, next) => {
  const text = (ctx.message.text || '').trim()
  if (!text) return

  // команды не съедаем
  if (text.startsWith('/')) {
    if (typeof next === 'function') return next()
    return
  }

  const admin = isAdmin(ctx)

  const state = userStates.get(ctx.from.id)
  const photoFileId = state?.photoFileId || null
  const source = state?.source || getForwardSource(ctx.message) || null
  userStates.delete(ctx.from.id)

  const post = await submitNews({
    text,
    author: ctx.from,
    admin,
    photoFileId,
    photoFileIds: photoFileId ? [photoFileId] : undefined,
    source
  })

  if (admin) {
    await ctx.reply('✅ Новость опубликована!')
  } else {
    await ctx.reply('📩 Новость отправлена на проверку.')
    await notifyAdmin(ctx, post)
  }
})

// ---------- Модерация ----------

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

// ---------- Vercel handler ----------
module.exports = async (req, res) => {
  try {
    let update = req.body
    if (typeof update === 'string') update = JSON.parse(update)
    else if (Buffer.isBuffer(update)) update = JSON.parse(update.toString('utf8'))

    await bot.handleUpdate(update)
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    res.status(500).json({ error: err?.message || String(err) })
  }
}
