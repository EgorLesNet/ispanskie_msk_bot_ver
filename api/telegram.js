// api/telegram.js - Telegram бот для приема и модерации новостей
require('dotenv/config');
const { Telegraf } = require('telegraf');
const { readDB, updateDB } = require('./_db');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'fusuges').toLowerCase();
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required!');
  module.exports = async (req, res) => {
    res.status(503).json({ error: 'Bot not configured' });
  };
  return;
}

const bot = new Telegraf(BOT_TOKEN);

// Состояния пользователей
const userStates = new Map();
const albums = new Map();

// =========================
// Helper Functions
// =========================

function isAdmin(ctx) {
  const u = ctx?.from;
  const chat = ctx?.chat;
  const byUsername = Boolean(u?.username) && u.username.toLowerCase() === ADMIN_USERNAME;
  const byId = ADMIN_CHAT_ID != null && (Number(u?.id) === ADMIN_CHAT_ID || Number(chat?.id) === ADMIN_CHAT_ID);
  return byUsername || byId;
}

function getForwardSource(msg) {
  if (!msg) return null;

  if (msg.forward_from_chat) {
    const chat = msg.forward_from_chat;
    const messageId = msg.forward_from_message_id || null;
    const username = chat.username || null;
    return {
      title: chat.title || null,
      username,
      chatId: chat.id ?? null,
      messageId,
      chatUrl: username ? `https://t.me/${username}` : null,
      postUrl: username && messageId ? `https://t.me/${username}/${messageId}` : null
    };
  }

  if (msg.forward_origin) {
    const fo = msg.forward_origin;
    const chat = fo.chat || fo.sender_chat || null;
    const messageId = fo.message_id || null;
    if (chat) {
      const username = chat.username || null;
      return {
        title: chat.title || null,
        username,
        chatId: chat.id ?? null,
        messageId,
        chatUrl: username ? `https://t.me/${username}` : null,
        postUrl: username && messageId ? `https://t.me/${username}/${messageId}` : null
      };
    }
  }

  return null;
}

function nextPostId(db) {
  const ids = [];
  for (const arr of [db.posts, db.pending, db.rejected]) {
    for (const p of arr) {
      if (p && typeof p.id === 'number') ids.push(p.id);
    }
  }
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function extractPostIdFromText(text) {
  if (!text) return null;
  const m = String(text).match(/#(\d+)/);
  return m ? Number(m[1]) : null;
}

async function findPostIdByReplyMessage(replyMsg) {
  if (!replyMsg) return null;
  const replyChatId = replyMsg.chat?.id ?? null;
  const replyMessageId = replyMsg.message_id ?? null;
  if (replyChatId == null || replyMessageId == null) return null;

  // Читаем без кэша!
  const { db } = await readDB(false);
  const all = [...db.pending, ...db.posts, ...db.rejected];

  for (const p of all) {
    const mm = p?.moderationMessage;
    if (mm && mm.chatId === replyChatId && mm.messageId === replyMessageId) {
      return p.id;
    }
  }

  return extractPostIdFromText(replyMsg.text || replyMsg.caption || '') || null;
}

/**
 * Выбирает оптимальный размер фото (не оригинал, чтобы избежать 20MB лимита)
 * Telegram создаёт несколько версий: small, medium, large, original
 * Берём предпоследнюю (высокое качество, но < 1MB)
 */
function getBestPhotoSize(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  
  // Если только 1 размер, возьмём его
  if (photos.length === 1) return photos[0];
  
  // Если 2 размера, возьмём последний
  if (photos.length === 2) return photos[1];
  
  // Если 3+ размера, возьмём предпоследний (не оригинал)
  // Это гарантированно < 1MB, но высокого качества
  return photos[photos.length - 2];
}

// =========================
// Database Operations
// =========================

async function submitNews({ text, author, admin, media, source }) {
  console.log('[SUBMIT_NEWS] Starting...', {
    text: text?.substring(0, 50),
    authorId: author?.id,
    admin,
    mediaCount: media?.length || 0
  });

  try {
    const result = await updateDB(async (db) => {
      const id = nextPostId(db);
      console.log('[SUBMIT_NEWS] Generated post ID:', id);

      const mediaArr = Array.isArray(media) ? media.filter(x => x && x.fileId && x.type) : [];
      const photoIds = mediaArr.filter(m => m.type === 'photo').map(m => m.fileId);
      const firstPhoto = photoIds[0] || null;

      const base = {
        id,
        text: String(text || '').trim(),
        authorId: author?.id ?? null,
        authorName: [author?.first_name, author?.last_name].filter(Boolean).join(' ').trim(),
        authorUsername: author?.username || null,
        createdAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        category: 'all',
        media: mediaArr,
        photoFileId: firstPhoto,
        photoFileIds: photoIds.length ? photoIds : undefined,
        source: source || null,
        moderationMessage: null,
        likes: 0,
        dislikes: 0
      };

      let saved;
      if (admin) {
        saved = { ...base, status: 'approved', sourceType: 'admin' };
        db.posts.unshift(saved);
        console.log('[SUBMIT_NEWS] Saved as approved post #', id);
      } else {
        saved = { ...base, status: 'pending', sourceType: 'user' };
        db.pending.unshift(saved);
        console.log('[SUBMIT_NEWS] Saved as pending post #', id);
      }

      return saved;
    });

    console.log('[SUBMIT_NEWS] Success! Post #', result.id);
    return result;
  } catch (error) {
    console.error('[SUBMIT_NEWS] Error:', error);
    throw error;
  }
}

async function appendMediaToPost(postId, items) {
  const add = Array.isArray(items) ? items.filter(x => x && x.fileId && x.type) : [];
  if (!add.length) return false;

  return updateDB(async (db) => {
    const buckets = [db.posts, db.pending, db.rejected];
    for (const bucket of buckets) {
      const p = bucket.find(x => x && x.id === postId);
      if (!p) continue;

      const existing = Array.isArray(p.media) ? p.media : [];
      const merged = [...existing];

      for (const it of add) {
        if (!merged.some(m => m.type === it.type && m.fileId === it.fileId)) {
          merged.push(it);
        }
      }

      p.media = merged;

      const photos = merged.filter(m => m.type === 'photo').map(m => m.fileId);
      p.photoFileIds = photos.length ? photos : undefined;
      p.photoFileId = photos[0] || null;

      return true;
    }
    return false;
  });
}

async function moderateNews(postId, action) {
  return updateDB(async (db) => {
    const idx = db.pending.findIndex(p => p && p.id === postId);
    if (idx === -1) {
      console.log(`[MODERATE] Post #${postId} not found in pending. Current pending IDs:`, db.pending.map(p => p?.id));
      return null;
    }

    const p = db.pending.splice(idx, 1)[0];
    if (!p) return null;

    if (action === 'approve') {
      const approved = { ...p, status: 'approved' };
      db.posts.unshift(approved);
      return { post: approved, status: 'approved' };
    }

    if (action === 'reject') {
      const rejected = { ...p, status: 'rejected' };
      db.rejected.unshift(rejected);
      return { post: rejected, status: 'rejected' };
    }

    return null;
  });
}

async function attachModerationMessage(postId, msg) {
  return updateDB(async (db) => {
    const p = db.pending.find(x => x && x.id === postId);
    if (!p) return false;
    p.moderationMessage = {
      chatId: msg?.chat?.id ?? null,
      messageId: msg?.message_id ?? null
    };
    return true;
  });
}

async function deleteNews(postId) {
  return updateDB(async (db) => {
    const places = [
      { key: 'posts', title: 'published' },
      { key: 'pending', title: 'pending' },
      { key: 'rejected', title: 'rejected' }
    ];

    for (const place of places) {
      const arr = db[place.key];
      const idx = arr.findIndex(p => p && p.id === postId);
      if (idx !== -1) {
        const removed = arr.splice(idx, 1)[0];
        return { place: place.title, post: removed };
      }
    }
    return null;
  });
}

// =========================
// Reactions (Like/Dislike)
// =========================

async function updateReaction(postId, reactionType, userId) {
  return updateDB(async (db) => {
    // Ищем пост во всех разделах
    const post = db.posts.find(p => p && p.id === postId);
    if (!post) return null;

    // Инициализируем счётчики если их нет
    if (typeof post.likes !== 'number') post.likes = 0;
    if (typeof post.dislikes !== 'number') post.dislikes = 0;
    if (!post.userReactions) post.userReactions = {};

    const prevReaction = post.userReactions[userId];

    // Если пользователь уже поставил эту же реакцию - убираем её
    if (prevReaction === reactionType) {
      delete post.userReactions[userId];
      if (reactionType === 'like') post.likes = Math.max(0, post.likes - 1);
      else post.dislikes = Math.max(0, post.dislikes - 1);
      return { post, action: 'removed', reaction: reactionType };
    }

    // Убираем предыдущую реакцию
    if (prevReaction === 'like') post.likes = Math.max(0, post.likes - 1);
    if (prevReaction === 'dislike') post.dislikes = Math.max(0, post.dislikes - 1);

    // Добавляем новую реакцию
    post.userReactions[userId] = reactionType;
    if (reactionType === 'like') post.likes++;
    else post.dislikes++;

    return { post, action: 'added', reaction: reactionType };
  });
}

function getReactionKeyboard(post, userId) {
  const userReaction = post.userReactions?.[userId] || null;
  const likesCount = post.likes || 0;
  const dislikesCount = post.dislikes || 0;

  const likeEmoji = userReaction === 'like' ? '👍🏻' : '👍';
  const dislikeEmoji = userReaction === 'dislike' ? '👎🏻' : '👎';

  return {
    inline_keyboard: [[
      { text: `${likeEmoji} ${likesCount}`, callback_data: `like:${post.id}` },
      { text: `${dislikeEmoji} ${dislikesCount}`, callback_data: `dislike:${post.id}` }
    ]]
  };
}

// =========================
// Bot Helpers
// =========================

function adminKeyboard(postId) {
  return {
    inline_keyboard: [[
      { text: '✅ Одобрить', callback_data: `approve:${postId}` },
      { text: '❌ Отклонить', callback_data: `reject:${postId}` }
    ]]
  };
}

async function notifyAdmin(ctx, post) {
  if (!ADMIN_CHAT_ID) {
    console.log('ADMIN_CHAT_ID not set, skipping admin notification');
    return;
  }

  const src = post.source;
  const srcUrl = src?.postUrl || src?.chatUrl || '';
  const srcTitle = src?.title || (src?.username ? `@${src.username}` : 'Источник');
  const srcLine = srcUrl ? `\n\nИсточник: ${srcTitle} ${srcUrl}` : '';

  const header = `📬 Новая новость #${post.id} от ${post.authorName || 'Unknown'}${
    post.authorUsername ? ` (@${post.authorUsername})` : ''
  }:\n\n${post.text}${srcLine}`;

  try {
    const firstPhoto = post.photoFileId;
    let sent;
    
    if (firstPhoto) {
      sent = await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, firstPhoto, {
        caption: header,
        reply_markup: adminKeyboard(post.id)
      });
    } else {
      sent = await ctx.telegram.sendMessage(ADMIN_CHAT_ID, header, {
        reply_markup: adminKeyboard(post.id)
      });
    }
    
    if (sent?.message_id) {
      await attachModerationMessage(post.id, sent);
    }
  } catch (err) {
    console.error('Failed to notify admin:', err);
  }
}

// =========================
// Media Handler
// =========================

async function handleMedia(ctx, item) {
  const admin = isAdmin(ctx);
  const msg = ctx.message;
  const caption = (msg.caption || '').trim();
  const mediaGroupId = msg.media_group_id || null;
  const source = getForwardSource(msg);

  // Альбом (несколько фото/видео)
  if (mediaGroupId) {
    const key = `${ctx.from.id}:${mediaGroupId}`;
    const cur = albums.get(key) || {
      postId: null,
      media: [],
      caption: null,
      source: source || null
    };

    cur.media.push(item);
    if (caption) cur.caption = caption;
    if (source && !cur.source) cur.source = source;

    // Если есть подпись и пост еще не создан
    if (!cur.postId && cur.caption) {
      const post = await submitNews({
        text: cur.caption,
        author: ctx.from,
        admin,
        media: cur.media,
        source: cur.source
      });
      cur.postId = post.id;
      albums.set(key, cur);

      if (admin) {
        await ctx.reply('✅ Новость опубликована!');
      } else {
        await ctx.reply('📩 Новость отправлена на проверку.');
        await notifyAdmin(ctx, post);
      }
      
      // Удаляем альбом через 30 секунд
      setTimeout(() => albums.delete(key), 30000);
      return;
    }

    // Если пост уже создан, добавляем медиа
    if (cur.postId) {
      albums.set(key, cur);
      await appendMediaToPost(cur.postId, [item]);
      return;
    }

    // Сохраняем и ждем подписи
    albums.set(key, cur);
    setTimeout(() => albums.delete(key), 30000);
    return;
  }

  // Одно фото/видео с подписью
  if (caption) {
    const post = await submitNews({
      text: caption,
      author: ctx.from,
      admin,
      media: [item],
      source
    });

    if (admin) {
      await ctx.reply('✅ Новость опубликована!');
    } else {
      await ctx.reply('📩 Новость отправлена на проверку.');
      await notifyAdmin(ctx, post);
    }
    return;
  }

  // Одно фото/видео без подписи - ждем текст
  userStates.set(ctx.from.id, { media: [item], source });
  await ctx.reply('📎 Медиа получено! Теперь отправьте текст новости:');
}

// =========================
// Bot Handlers
// =========================

bot.command('start', async (ctx) => {
  userStates.delete(ctx.from.id);
  
  if (!WEBAPP_URL) {
    return ctx.reply('Добро пожаловать! Отправьте новость текстом (можно с фото/видео):');
  }
  
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
  );
  
  await ctx.reply('Или отправьте новость текстом (можно с фото/видео):', {
    reply_markup: { remove_keyboard: true }
  });
});

bot.command('news', async (ctx) => {
  try {
    const { db } = await readDB(false);
    const latestPosts = db.posts.slice(0, 5); // Последние 5 новостей

    if (latestPosts.length === 0) {
      return ctx.reply('Новостей пока нет 🤷\u200d♂️');
    }

    await ctx.reply('📰 Последние новости:\n\nВыберите новость, чтобы поставить лайк или дизлайк!');

    for (const post of latestPosts) {
      const text = `#${post.id}\n\n${post.text}`;
      const userId = ctx.from.id;
      
      if (post.photoFileId) {
        await ctx.replyWithPhoto(post.photoFileId, {
          caption: text,
          reply_markup: getReactionKeyboard(post, userId)
        });
      } else {
        await ctx.reply(text, {
          reply_markup: getReactionKeyboard(post, userId)
        });
      }
    }
  } catch (error) {
    console.error('[NEWS] Error:', error);
    await ctx.reply('Ошибка при загрузке новостей. Попробуйте позже.');
  }
});

bot.command('delete', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('Нет доступа!');
  }

  const full = String(ctx.message?.text || '').trim();
  const parts = full.split(/\s+/);
  let postId = parts[1] ? Number(parts[1]) : null;

  if (!postId) {
    const reply = ctx.message?.reply_to_message || null;
    postId = await findPostIdByReplyMessage(reply);
  }

  if (!postId) {
    return ctx.reply('Использование:\n/delete <id>\nили ответьте на сообщение модерации и напишите /delete');
  }

  const result = await deleteNews(postId);
  if (!result) {
    return ctx.reply(`Пост #${postId} не найден (или уже удалён).`);
  }

  try {
    const mm = result.post?.moderationMessage;
    if (mm?.chatId != null && mm?.messageId != null) {
      await ctx.telegram.deleteMessage(mm.chatId, mm.messageId);
    }
  } catch (e) {
    console.log('Could not delete moderation message:', e.message);
  }

  return ctx.reply(`🗑 Удалено: #${postId} (раздел: ${result.place}).`);
});

bot.on('photo', async (ctx) => {
  try {
    const photos = ctx.message.photo || [];
    // Используем сжатую версию, не оригинал
    const best = getBestPhotoSize(photos);
    const fileId = best?.file_id;
    if (!fileId) {
      return ctx.reply('Не удалось прочитать фото, попробуйте ещё раз.');
    }
    return handleMedia(ctx, { type: 'photo', fileId });
  } catch (error) {
    console.error('Photo handler error:', error);
    await ctx.reply('Ошибка при обработке фото. Попробуйте ещё раз.');
  }
});

bot.on('video', async (ctx) => {
  try {
    const fileId = ctx.message.video?.file_id;
    if (!fileId) {
      return ctx.reply('Не удалось прочитать видео, попробуйте ещё раз.');
    }
    return handleMedia(ctx, { type: 'video', fileId });
  } catch (error) {
    console.error('Video handler error:', error);
    await ctx.reply('Ошибка при обработке видео. Попробуйте ещё раз.');
  }
});

bot.on('text', async (ctx, next) => {
  console.log('[TEXT] Received text from:', ctx.from?.username || ctx.from?.id);
  
  try {
    const text = (ctx.message.text || '').trim();
    if (!text) return;

    if (text.startsWith('/')) {
      if (typeof next === 'function') return next();
      return;
    }

    const admin = isAdmin(ctx);
    console.log('[TEXT] Is admin:', admin);
    
    const st = userStates.get(ctx.from.id);
    userStates.delete(ctx.from.id);

    const media = st?.media || [];
    const source = st?.source || getForwardSource(ctx.message) || null;

    const post = await submitNews({
      text,
      author: ctx.from,
      admin,
      media,
      source
    });

    console.log('[TEXT] Post created successfully #', post.id);

    if (admin) {
      await ctx.reply('✅ Новость опубликована!');
    } else {
      await ctx.reply('📩 Новость отправлена на проверку.');
      await notifyAdmin(ctx, post);
    }
  } catch (error) {
    console.error('[TEXT] Handler error:', error);
    console.error('[TEXT] Stack:', error.stack);
    await ctx.reply('Ошибка при обработке сообщения. Попробуйте ещё раз.');
  }
});

bot.on('callback_query', async (ctx) => {
  try {
    const data = String(ctx.callbackQuery.data || '');
    const [action, idStr] = data.split(':');
    const postId = Number(idStr);

    // Обработка лайков/дизлайков
    if (action === 'like' || action === 'dislike') {
      const userId = ctx.from.id;
      const result = await updateReaction(postId, action, userId);

      if (!result) {
        await ctx.answerCbQuery('Новость не найдена', { show_alert: true });
        return;
      }

      // Обновляем кнопки
      try {
        await ctx.editMessageReplyMarkup(
          getReactionKeyboard(result.post, userId).inline_keyboard
        );
      } catch (e) {
        console.log('Could not update keyboard:', e.message);
      }

      const emoji = action === 'like' ? '👍' : '👎';
      const actionText = result.action === 'removed' ? 'убрали' : 'поставили';
      await ctx.answerCbQuery(`Вы ${actionText} ${emoji}`);
      return;
    }

    // Модерация (только для админов)
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('Нет доступа!', { show_alert: true });
      return;
    }

    if (!postId || (action !== 'approve' && action !== 'reject')) {
      await ctx.answerCbQuery('Некорректная команда', { show_alert: true });
      return;
    }

    const result = await moderateNews(postId, action);
    if (!result) {
      await ctx.answerCbQuery('Не найдено / уже обработано', { show_alert: true });
      return;
    }

    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) {
      console.log('Could not remove keyboard:', e.message);
    }

    if (result.status === 'approved') {
      await ctx.answerCbQuery('Одобрено');
      await ctx.reply(`Новость #${result.post.id} одобрена и опубликована.`);
    } else {
      await ctx.answerCbQuery('Отклонено');
      await ctx.reply(`Новость #${result.post.id} отклонена.`);
    }
  } catch (error) {
    console.error('Callback query error:', error);
    await ctx.answerCbQuery('Ошибка обработки', { show_alert: true });
  }
});

// =========================
// Webhook Handler for Vercel
// =========================

module.exports = async (req, res) => {
  try {
    let update = req.body;
    
    if (typeof update === 'string') {
      update = JSON.parse(update);
    } else if (Buffer.isBuffer(update)) {
      update = JSON.parse(update.toString('utf8'));
    }

    await bot.handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ 
      error: 'Webhook processing failed',
      message: err?.message || String(err) 
    });
  }
};
