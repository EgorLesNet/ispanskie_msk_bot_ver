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

// одиночное фото/видео без подписи -> ждём текст
const userStates = new Map()

// альбомы: key = `${fromId}:${mediaGroupId}`
const albums = new Map()

function isAdmin(ctx) {
  const u = ctx?.from
  const chat = ctx?.chat
  const byUsername = Boolean(u?.username) && u.username.toLowerCase() === ADMIN_USERNAME
  const byId = ADMIN_CHAT_ID != null && (Number(u?.id) === ADMIN_CHAT_ID || Number(chat?.id) === ADMIN_CHAT_ID)
  return byUsername || byId
}

/**
 * Источник пересланного сообщения: forward_from_chat/forward_from_message_id или forward_origin. [web:9]
 */
function getForwardSource(msg) {
  if (!msg) return null

  if (msg.forward_from_chat) {
    const chat = msg.forward_from_chat
    const messageId = msg.forward_from_message_id || null
    const username = chat.username || null
    return {
      title: chat.title || null,
      username,
      chatId: chat.id ?? null,
      messageId,
      chatUrl: username ? `https://t.me/${username}` : null,
      postUrl: username && messageId ? `https://t.me/${username}/${messageId}` : null
    }
  }

  if (msg.forward_origin) {
    const fo = msg.forward_origin
    const chat = fo.chat || fo.sender_chat || null
    const messageId = fo.message_id || null
    if (chat) {
      const username = chat.username || null
      return {
        title: chat.title || null,
        username,
        chatId: chat.id ?? null,
        messageId,
        chatUrl: username ? `https://t.me/${username}` : null,
        postUrl: username && messageId ? `https://t.me/${username}/${messageId}` : null
      }
    }
  }

  return null
}

// ---------- DB через GitHub Contents API с retry ----------

function normalizeDb(raw) {
  const db = raw && typeof raw === 'object' ? raw : {}
  const postsRaw = Array.isArray(db.posts) ? db.posts : []
  const pendingRaw = Array.isArray(db.pending) ? db.pending : []
  const rejectedRaw = Array.isArray(db.rejected) ? db.rejected : []

  // миграция: если pending лежали в posts
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

async function readDbFile() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}?ref=${encodeURIComponent(DB_BRANCH)}`
  const resp = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      ...(GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {})
    },
    cache: 'no-store'
  })

  if (!resp.ok) {
    // если файла нет — стартуем с пустого
    if (resp.status === 404) return { sha: null, db: { posts: [], pending: [], rejected: [] } }
    const t = await resp.text().catch(() => '')
    throw new Error(`GitHub read failed: ${resp.status} ${t}`)
  }

  const json = await resp.json()
  const sha = json?.sha || null
  const contentB64 = json?.content || ''
  const buf = Buffer.from(contentB64, 'base64')
  const text = buf.toString('utf8')
  const data = JSON.parse(text)
  return { sha, db: normalizeDb(data) }
}

async function writeDbFile(db, sha) {
  if (!GITHUB_TOKEN) throw new Error('Missing GITHUB_TOKEN')

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}`
  const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64')

  const body = { message: 'Update news via bot', content, branch: DB_BRANCH }
  if (sha) body.sha = sha

  const resp = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  return resp
}

/**
 * updateDB(mutator) делает read->mutate->write с повтором при конфликте sha (409).
 */
async function updateDB(mutator, retries = 4) {
  let lastErr = null

  for (let i = 0; i < retries; i++) {
    try {
      const { sha, db } = await readDbFile()
      const result = await mutator(db)
      const putResp = await writeDbFile(db, sha)

      if (putResp.ok) return result

      // конфликт sha (обычно 409) -> повторим
      const txt = await putResp.text().catch(() => '')
      lastErr = new Error(`GitHub write failed: ${putResp.status} ${txt}`)
      if (putResp.status === 409) continue

      throw lastErr
    } catch (e) {
      lastErr = e
    }
  }

  throw lastErr || new Error('updateDB failed')
}

// ---------- Посты / модерация ----------

async function submitNews({ text, author, admin, media, source }) {
  return updateDB(async (db) => {
    const id = nextPostId(db)

    const mediaArr = Array.isArray(media) ? media.filter(x => x && x.fileId && x.type) : []
    const photoFileIds = mediaArr.filter(m => m.type === 'photo').map(m => m.fileId)
    const firstPhoto = photoFileIds[0] || null

    const base = {
      id,
      text: String(text || '').trim(),
      authorId: author?.id ?? null,
      authorName: [author?.first_name, author?.last_name].filter(Boolean).join(' ').trim(),
      authorUsername: author?.username || null,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      category: 'all',

      // новая схема
      media: mediaArr,

      // совместимость со старой схемой сайта
      photoFileId: firstPhoto,
      photoFileIds: photoFileIds.length ? photoFileIds : undefined,

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

    return saved
  })
}

async function appendMediaToPost(postId, items) {
  const add = Array.isArray(items) ? items.filter(x => x && x.fileId && x.type) : []
  if (!add.length) return false

  return updateDB(async (db) => {
    const buckets = [db.posts, db.pending, db.rejected]
    for (const bucket of buckets) {
      const p = bucket.find(x => x && x.id === postId)
      if (!p) continue

      const existing = Array.isArray(p.media) ? p.media : []
      const merged = [...existing]

      for (const it of add) {
        if (!merged.some(m => m.type === it.type && m.fileId === it.fileId)) merged.push(it)
      }

      p.media = merged

      const photoIds = merged.filter(m => m.type === 'photo').map(m => m.fileId)
      p.photoFileIds = photoIds.length ? photoIds : undefined
      p.photoFileId = photoIds[0] || null

      return true
    }
    return false
  })
}

async function moderateNews(postId, action) {
  return updateDB(async (db) => {
    const idx = db.pending.findIndex(p => p && p.id === postId)
    if (idx === -1) return null

    const p = db.pending.splice(idx, 1)[0]
    if (!p) return null

    if (action === 'approve') {
      const approved = { ...p, status: 'approved' }
      db.posts.unshift(approved)
      return { post: approved, status: 'approved' }
    }

    if (action === 'reject') {
      const rejected = { ...p, status: 'rejected' }
      db.rejected.unshift(rejected)
      return { post: rejected, status: 'rejected' }
    }

    return null
  })
}

async function attachModerationMessage(postId, msg) {
  return updateDB(async (db) => {
    const p = db.pending.find(x => x && x.id === postId)
    if (!p) return false
    p.moderationMessage = { chatId: msg?.chat?.id ?? null, messageId: msg?.message_id ?? null }
    return true
  })
}

async function deleteNews(postId) {
  return updateDB(async (db) => {
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
        return { place: place.title, post: removed }
      }
    }
    return null
  })
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
  const srcUrl = src?.postUrl || src?.chatUrl || ''
  const srcTitle = src?.title || (src?.username ? `@${src.username}` : 'Источник')
  const srcLine = srcUrl ? `\n\nИсточник: ${srcTitle} ${srcUrl}` : ''

  const header =
    `📬 Новая новость #${post.id} от ${post.authorName || 'Unknown'}${
      post.authorUsername ? ` (@${post.authorUsername})` : ''
    }:\n\n${post.text}${srcLine}`

  try {
    // Админу можно отправлять просто текстом, медиа он увидит на сайте;
    // но если есть фото — отправим превью первым фото.
    const firstPhoto = post.photoFileId

    let sent
    if (firstPhoto) {
      sent = await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, firstPhoto, {
        caption: header,
        reply_markup: adminKeyboard(post.id)
      })
    } else {
      sent = await ctx.telegram.sendMessage(ADMIN_CHAT_ID, header, {
        reply_markup: adminKeyboard(post.id)
      })
    }

    if (sent?.message_id) await attachModerationMessage(post.id, sent)
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

  const { db } = await readDbFile()
  const all = [...db.pending, ...db.posts, ...db.rejected]

  for (const p of all) {
    const mm = p?.moderationMessage
    if (mm && mm.chatId === replyChatId && mm.messageId === replyMessageId) return p.id
  }

  return extractPostIdFromText(replyMsg.text || replyMsg.caption || '') || null
}

// ---------- Команды (до on('text')) ----------

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
  await ctx.reply('Или отправьте новость текстом (можно с фото/видео):', { reply_markup: { remove_keyboard: true } })
})

bot.command('delete', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('Нет доступа!')

  const full = String(ctx.message?.text || '').trim()
  const parts = full.split(/\s+/)
  let postId = parts[1] ? Number(parts[1]) : null

  if (!postId) {
    const reply = ctx.message?.reply_to_message || null
    postId = await findPostIdByReplyMessage(reply)
  }

  if (!postId) {
    return ctx.reply('Использование:\n/delete <id>\nили ответьте на сообщение модерации и напишите /delete')
  }

  const result = await deleteNews(postId)
  if (!result) return ctx.reply(`Пост #${postId} не найден (или уже удалён).`)

  try {
    const mm = result.post?.moderationMessage
    if (mm?.chatId != null && mm?.messageId != null) {
      await ctx.telegram.deleteMessage(mm.chatId, mm.messageId)
    }
  } catch (_) {}

  return ctx.reply(`🗑 Удалено: #${postId} (раздел: ${result.place}).`)
})

// ---------- Универсальный хендлер медиа ----------

async function handleMedia(ctx, item) {
  const admin = isAdmin(ctx)
  const msg = ctx.message
  const caption = (msg.caption || '').trim()
  const mediaGroupId = msg.media_group_id || null
  const source = getForwardSource(msg)

  // альбом
  if (mediaGroupId) {
    const key = `${ctx.from.id}:${mediaGroupId}`
    const cur = albums.get(key) || {
      postId: null,
      media: [],
      caption: null,
      source: source || null
    }

    cur.media.push(item)
    if (caption) cur.caption = caption
    if (source && !cur.source) cur.source = source

    // Если подпись появилась — создаём пост (один раз) и отвечаем сразу
    if (!cur.postId && cur.caption) {
      const post = await submitNews({
        text: cur.caption,
        author: ctx.from,
        admin,
        media: cur.media,
        source: cur.source
      })
      cur.postId = post.id
      albums.set(key, cur)

      if (admin) await ctx.reply('✅ Новость опубликована!')
      else {
        await ctx.reply('📩 Новость отправлена на проверку.')
        await notifyAdmin(ctx, post)
      }
      return
    }

    // Если пост уже создан — дописываем медиа в него (с retry)
    if (cur.postId) {
      albums.set(key, cur)
      await appendMediaToPost(cur.postId, [item])
      return
    }

    // подписи ещё нет -> ждём (в альбомах caption обычно на одном элементе) [web:98]
    albums.set(key, cur)
    return
  }

  // одиночное медиа
  if (caption) {
    const post = await submitNews({
      text: caption,
      author: ctx.from,
      admin,
      media: [item],
      source
    })

    if (admin) await ctx.reply('✅ Новость опубликована!')
    else {
      await ctx.reply('📩 Новость отправлена на проверку.')
      await notifyAdmin(ctx, post)
    }
    return
  }

  // без подписи -> ждём текст
  userStates.set(ctx.from.id, { media: [item], source })
  await ctx.reply('📎 Медиа получено! Теперь отправьте текст новости:')
}

// фото
bot.on('photo', async ctx => {
  const photos = ctx.message.photo || []
  const best = photos.length ? photos[photos.length - 1] : null
  const fileId = best?.file_id
  if (!fileId) return ctx.reply('Не удалось прочитать фото, попробуйте ещё раз.')
  return handleMedia(ctx, { type: 'photo', fileId })
})

// видео
bot.on('video', async ctx => {
  const fileId = ctx.message.video?.file_id
  if (!fileId) return ctx.reply('Не удалось прочитать видео, попробуйте ещё раз.')
  return handleMedia(ctx, { type: 'video', fileId })
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

  const st = userStates.get(ctx.from.id)
  userStates.delete(ctx.from.id)

  const media = st?.media || []
  const source = st?.source || getForwardSource(ctx.message) || null

  const post = await submitNews({
    text,
    author: ctx.from,
    admin,
    media,
    source
  })

  if (admin) await ctx.reply('✅ Новость опубликована!')
  else {
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

  try { await ctx.editMessageReplyMarkup() } catch (_) {}

  if (result.status === 'approved') {
    await ctx.answerCbQuery('Одобрено')
    await ctx.reply(`Новость #${result.post.id} одобрена и опубликована.`)
  } else {
    await ctx.answerCbQuery('Отклонено')
    await ctx.reply(`Новость #${result.post.id} отклонена.`)
  }
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
