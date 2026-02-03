// api/telegram.js - Telegram бот для приема и модерации новостей
require('dotenv/config');
const { Telegraf } = require('telegraf');
const { readDB, updateDB } = require('./_db');
const { getUser, toggleDigestSubscription } = require('../lib/users');

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

/**
 * Конвертирует Telegram entities в HTML
 * Поддерживает: ссылки, жирный, курсив, код, pre
 */
function entitiesToHTML(text, entities) {
  if (!text || !Array.isArray(entities) || entities.length === 0) {
    return text || '';
  }

  // Сортируем entities по offset для правильной обработки
  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  
  let result = '';
  let lastPos = 0;

  for (const entity of sorted) {
    const { offset, length, type, url } = entity;
    
    // Добавляем текст до текущей entity
    if (offset > lastPos) {
      result += escapeHtml(text.substring(lastPos, offset));
    }

    // Извлекаем текст entity
    const entityText = text.substring(offset, offset + length);

    // Оборачиваем в HTML в зависимости от типа
    switch (type) {
      case 'text_link':
        result += `<a href="${escapeHtml(url)}">${escapeHtml(entityText)}</a>`;
        break;
      case 'url':
        result += `<a href="${escapeHtml(entityText)}">${escapeHtml(entityText)}</a>`;
        break;
      case 'bold':
        result += `<b>${escapeHtml(entityText)}</b>`;
        break;
      case 'italic':
        result += `<i>${escapeHtml(entityText)}</i>`;
        break;
      case 'code':
        result += `<code>${escapeHtml(entityText)}</code>`;
        break;
      case 'pre':
        result += `<pre>${escapeHtml(entityText)}</pre>`;
        break;
      case 'underline':
        result += `<u>${escapeHtml(entityText)}</u>`;
        break;
      case 'strikethrough':
        result += `<s>${escapeHtml(entityText)}</s>`;
        break;
      default:
        // Неизвестный тип - просто текст
        result += escapeHtml(entityText);
    }

    lastPos = offset + length;
  }

  // Добавляем оставшийся текст
  if (lastPos < text.length) {
    result += escapeHtml(text.substring(lastPos));
  }

  return result;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

async function submitNews({ text, textHTML, author, admin, media, source }) {
  console.log('[SUBMIT_NEWS] Starting...', {
    text: text?.substring(0, 50),
    hasHTML: !!textHTML,
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
        textHTML: textHTML || null,  // Сохраняем HTML версию
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
        moderationMessage: null
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
  const rawCaption = msg.caption || '';
  const captionEntities = msg.caption_entities || [];
  const caption = rawCaption.trim();
  const captionHTML = entitiesToHTML(rawCaption, captionEntities);
  const mediaGroupId = msg.media_group_id || null;
  const source = getForwardSource(msg);

  // Альбом (несколько фото/видео)
  if (mediaGroupId) {
    const key = `${ctx.from.id}:${mediaGroupId}`;
    const cur = albums.get(key) || {
      postId: null,
      media: [],
      caption: null,
      captionHTML: null,
      source: source || null
    };

    cur.media.push(item);
    if (caption) {
      cur.caption = caption;
      cur.captionHTML = captionHTML;
    }
    if (source && !cur.source) cur.source = source;

    // Если есть подпись и пост еще не создан
    if (!cur.postId && cur.caption) {
      const post = await submitNews({
        text: cur.caption,
        textHTML: cur.captionHTML,
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
      textHTML: captionHTML,
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
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '📰 Включить дайджест', callback_data: 'digest_on' }],
      [{ text: '📱 Открыть приложение', web_app: { url: WEBAPP_URL || 'https://ispanskie-msk-bot-ver.vercel.app' } }]
    ]
  };
  
  await ctx.reply(
    '🏠 Добро пожаловать в бот Испанских Кварталов!\n\n' +
    'Здесь вы можете:\n' +
    '• Отправлять новости района\n' +
    '• Подписаться на ежедневный дайджест (21:00)\n' +
    '• Просматривать карту бизнеса\n\n' +
    'Выберите действие:',
    { reply_markup: keyboard }
  );
});

bot.command('digest_on', async (ctx) => {
  try {
    const tgId = ctx.from.id;
    await toggleDigestSubscription(tgId, true);
    
    await ctx.reply(
      '✅ Вы подписались на ежедневный дайджест!\n\n' +
      '📬 Каждый день в 21:00 вы будете получать краткую сводку новостей района.\n\n' +
      'Чтобы отписаться, используйте команду /digest_off'
    );
  } catch (error) {
    console.error('digest_on error:', error);
    await ctx.reply('Ошибка при подписке. Попробуйте позже.');
  }
});

bot.command('digest_off', async (ctx) => {
  try {
    const tgId = ctx.from.id;
    await toggleDigestSubscription(tgId, false);
    
    await ctx.reply(
      '❌ Вы отписались от ежедневного дайджеста.\n\n' +
      'Чтобы снова подписаться, используйте команду /digest_on'
    );
  } catch (error) {
    console.error('digest_off error:', error);
    await ctx.reply('Ошибка при отписке. Попробуйте позже.');
  }
});

bot.command('digest_status', async (ctx) => {
  try {
    const tgId = ctx.from.id;
    const user = await getUser(tgId);
    
    const subscribed = user?.digestSubscription || false;
    const status = subscribed 
      ? '✅ Вы подписаны на ежедневный дайджест' 
      : '❌ Вы не подписаны на дайджест';
    
    await ctx.reply(
      `${status}\n\n` +
      'Команды:\n' +
      '/digest_on - Подписаться\n' +
      '/digest_off - Отписаться'
    );
  } catch (error) {
    console.error('digest_status error:', error);
    await ctx.reply('Ошибка при проверке статуса. Попробуйте позже.');
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
    const rawText = ctx.message.text || '';
    const text = rawText.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      if (typeof next === 'function') return next();
      return;
    }

    const admin = isAdmin(ctx);
    console.log('[TEXT] Is admin:', admin);
    
    // Конвертируем entities в HTML
    const entities = ctx.message.entities || [];
    const textHTML = entitiesToHTML(rawText, entities);
    console.log('[TEXT] Converted to HTML:', !!textHTML);
    
    const st = userStates.get(ctx.from.id);
    userStates.delete(ctx.from.id);

    const media = st?.media || [];
    const source = st?.source || getForwardSource(ctx.message) || null;

    const post = await submitNews({
      text,
      textHTML,
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
    
    // Обработка подписки на дайджест
    if (data === 'digest_on') {
      const tgId = ctx.from.id;
      await toggleDigestSubscription(tgId, true);
      
      await ctx.answerCbQuery('Подписка оформлена!');
      await ctx.reply(
        '✅ Вы подписались на ежедневный дайджест!\n\n' +
        '📬 Каждый день в 21:00 вы будете получать краткую сводку новостей района.\n\n' +
        'Чтобы отписаться, используйте команду /digest_off'
      );
      return;
    }
    
    // Обработка модерации (только для админов)
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('Нет доступа!', { show_alert: true });
      return;
    }

    const [action, idStr] = data.split(':');
    const postId = Number(idStr);

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
