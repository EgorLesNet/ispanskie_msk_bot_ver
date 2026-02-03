// api/_summary.js - AI-генерация сводки новостей за день (FREE Groq API)
const { readDB } = require('./_db');

function filterRecentNews(posts) {
  const MOSCOW_OFFSET = 3 * 60 * 60 * 1000;
  const nowUTC = new Date();
  const nowMoscow = new Date(nowUTC.getTime() + MOSCOW_OFFSET);
  
  const todayStartMoscow = new Date(nowMoscow.getFullYear(), nowMoscow.getMonth(), nowMoscow.getDate());
  const tomorrowStartMoscow = new Date(todayStartMoscow);
  tomorrowStartMoscow.setDate(tomorrowStartMoscow.getDate() + 1);
  
  const todayStartUTC = new Date(todayStartMoscow.getTime() - MOSCOW_OFFSET);
  const tomorrowStartUTC = new Date(tomorrowStartMoscow.getTime() - MOSCOW_OFFSET);
  
  const todayPosts = posts.filter(post => {
    const postDate = new Date(post.timestamp || post.createdAt);
    return postDate >= todayStartUTC && postDate < tomorrowStartUTC;
  });
  
  if (todayPosts.length < 5) {
    const last24hStart = new Date(nowUTC.getTime() - 24 * 60 * 60 * 1000);
    const recentPosts = posts.filter(post => {
      const postDate = new Date(post.timestamp || post.createdAt);
      return postDate >= last24hStart && postDate < nowUTC;
    });
    return { posts: recentPosts, period: 'last24h' };
  }
  
  return { posts: todayPosts, period: 'today' };
}

async function generateSummaryGroq(posts, period) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY не установлен');
  }
  
  const newsTexts = posts.map((post, idx) => {
    const text = post.text || '';
    const source = post.source?.title || post.source?.username || 'Неизвестный источник';
    const postDate = new Date(post.timestamp || post.createdAt);
    const time = postDate.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow'
    });
    const date = postDate.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'numeric',
      timeZone: 'Europe/Moscow'
    });
    return `${idx + 1}. [${date} ${time}] ${text}\nИсточник: ${source}`;
  }).join('\n\n');
  
  const periodText = period === 'last24h' ? 'за последние сутки' : 'за сегодня';
  
  const systemPrompt = `Ты помощник для жителей района Испанские Кварталы в Москве. Твоя задача - создавать краткие, дружелюбные сводки новостей района.`;
  
  const userPrompt = `Перед тобой посты из локального новостного агрегатора ${periodText}.\n\nТвоя задача:\n1. Прочитать все новости\n2. Выделить 3-5 самых важных/интересных событий\n3. Написать краткую сводку (3-4 абзаца, максимум 500 символов)\n4. Использовать дружелюбный, живой стиль\n5. Упомянуть конкретные детали из постов\n\nФормат ответа:\n- Без заголовков типа "Сводка за день"\n- Начни сразу с самого важного\n- Используй эмодзи для оживления (но не перебарщивай)\n- Пиши от первого лица множественного числа ("сегодня у нас")\n${period === 'last24h' ? '- Упомяни, что это новости за последние сутки' : ''}\n\nНовости ${periodText}:\n\n${newsTexts}\n\nНапиши краткую сводку:`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 600,
        top_p: 0.9
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API/SUMMARY] Groq API error:', response.status, errorText);
      throw new Error(`Groq API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
    
  } catch (error) {
    console.error('[API/SUMMARY] AI generation failed:', error);
    throw error;
  }
}

function generateFallbackSummary(posts, period) {
  if (posts.length === 0) {
    return '🤷 Сегодня в районе пока всё спокойно! Новостей нет, но день ещё не закончился.';
  }
  
  const periodText = period === 'last24h' ? 'за последние сутки' : 'сегодня';
  const count = posts.length;
  let summary = `📰 ${periodText.charAt(0).toUpperCase() + periodText.slice(1)} у нас ${count} ${count === 1 ? 'новость' : count < 5 ? 'новости' : 'новостей'}!\n\n`;
  
  posts.slice(0, 3).forEach((post, idx) => {
    const text = (post.text || '').substring(0, 100);
    const postDate = new Date(post.timestamp || post.createdAt);
    const time = postDate.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow'
    });
    const date = postDate.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'numeric',
      timeZone: 'Europe/Moscow'
    });
    summary += `${idx + 1}. [${date} ${time}] ${text}${text.length >= 100 ? '...' : ''}\n\n`;
  });
  
  if (posts.length > 3) {
    summary += `И ещё ${posts.length - 3} новостей! Листайте ленту, чтобы увидеть всё 👇`;
  }
  
  return summary.trim();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { db } = await readDB(false);
    const allPosts = (db.posts || []).filter(p => p.status === 'approved');
    
    const { posts: recentPosts, period } = filterRecentNews(allPosts);
    
    if (recentPosts.length === 0) {
      return res.status(200).json({
        success: true,
        summary: '🤷 Сегодня в районе пока всё спокойно! Новостей нет.',
        count: 0,
        date: new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }),
        period: 'today',
        method: 'empty'
      });
    }
    
    let summary;
    let method = 'fallback';
    
    try {
      summary = await generateSummaryGroq(recentPosts, period);
      method = 'groq-ai';
    } catch (aiError) {
      console.error('[API/SUMMARY] Groq AI failed, using fallback:', aiError.message);
      summary = generateFallbackSummary(recentPosts, period);
    }
    
    return res.status(200).json({
      success: true,
      summary,
      count: recentPosts.length,
      date: new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }),
      period,
      method
    });
    
  } catch (error) {
    console.error('[API/SUMMARY] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
