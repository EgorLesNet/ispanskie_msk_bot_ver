// api/summary.js - AI-генерация сводки новостей за день (FREE Groq API)
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'db', 'news.json');

/**
 * Загрузить новости из БД
 */
function loadNews() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return { posts: [] };
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[API/SUMMARY] Error reading news:', e);
    return { posts: [] };
  }
}

/**
 * Фильтровать новости за текущую дату
 */
function filterTodayNews(posts) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  return posts.filter(post => {
    const postDate = new Date(post.timestamp || post.createdAt);
    return postDate >= today && postDate < tomorrow;
  });
}

/**
 * Генерация сводки через Groq API (БЕСПЛАТНО!)
 * Модель: llama-3.3-70b-versatile (очень быстрая и качественная)
 * Лимит: 14,400 requests/day, 30 req/min
 * https://console.groq.com
 */
async function generateSummaryGroq(posts) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY не установлен в переменных окружения');
  }
  
  // Подготовить текст для анализа
  const newsTexts = posts.map((post, idx) => {
    const text = post.text || '';
    const source = post.source?.title || post.source?.username || 'Неизвестный источник';
    const time = new Date(post.timestamp || post.createdAt).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${idx + 1}. [${time}] ${text}\nИсточник: ${source}`;
  }).join('\n\n');
  
  const systemPrompt = `Ты помощник для жителей района Испанские Кварталы в Москве. Твоя задача - создавать краткие, дружелюбные сводки новостей района.`;
  
  const userPrompt = `Перед тобой посты из локального новостного агрегатора за сегодня.

Твоя задача:
1. Прочитать все новости
2. Выделить 3-5 самых важных/интересных событий
3. Написать краткую сводку (3-4 абзаца, максимум 500 символов)
4. Использовать дружелюбный, живой стиль
5. Упомянуть конкретные детали из постов

Формат ответа:
- Без заголовков типа "Сводка за день"
- Начни сразу с самого важного
- Используй эмодзи для оживления (но не перебарщивай)
- Пиши от первого лица множественного числа ("сегодня у нас")

Новости за сегодня:

${newsTexts}

Напиши краткую сводку:`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Быстрая и качественная модель
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
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
    const summary = data.choices?.[0]?.message?.content || '';
    
    return summary.trim();
    
  } catch (error) {
    console.error('[API/SUMMARY] AI generation failed:', error);
    throw error;
  }
}

/**
 * Fallback: простая текстовая сводка без AI
 */
function generateFallbackSummary(posts) {
  if (posts.length === 0) {
    return '🤷 Сегодня в районе пока всё спокойно! Новостей нет, но день ещё не закончился.';
  }
  
  const count = posts.length;
  let summary = `📰 Сегодня у нас ${count} ${count === 1 ? 'новость' : count < 5 ? 'новости' : 'новостей'}!\n\n`;
  
  // Показываем первые 3 новости
  posts.slice(0, 3).forEach((post, idx) => {
    const text = (post.text || '').substring(0, 100);
    const time = new Date(post.timestamp || post.createdAt).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
    summary += `${idx + 1}. [${time}] ${text}${text.length >= 100 ? '...' : ''}\n\n`;
  });
  
  if (posts.length > 3) {
    summary += `И ещё ${posts.length - 3} новостей! Листайте ленту, чтобы увидеть всё 👇`;
  }
  
  return summary.trim();
}

module.exports = async (req, res) => {
  // CORS
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
    console.log('[API/SUMMARY] Generating daily summary...');
    
    // Загрузить все новости
    const db = loadNews();
    const allPosts = db.posts || [];
    
    // Фильтровать новости за сегодня
    const todayPosts = filterTodayNews(allPosts);
    
    console.log(`[API/SUMMARY] Found ${todayPosts.length} posts today`);
    
    if (todayPosts.length === 0) {
      return res.status(200).json({
        success: true,
        summary: '🤷 Сегодня в районе пока всё спокойно! Новостей нет, но день ещё не закончился.',
        count: 0,
        date: new Date().toISOString().split('T')[0],
        method: 'empty'
      });
    }
    
    let summary;
    let method = 'fallback';
    
    // Попробовать сгенерировать через Groq AI
    try {
      summary = await generateSummaryGroq(todayPosts);
      method = 'groq-ai';
      console.log('[API/SUMMARY] Summary generated via Groq AI');
    } catch (aiError) {
      console.error('[API/SUMMARY] Groq AI failed, using fallback:', aiError.message);
      // Если AI не сработал, используем простую сводку
      summary = generateFallbackSummary(todayPosts);
    }
    
    return res.status(200).json({
      success: true,
      summary,
      count: todayPosts.length,
      date: new Date().toISOString().split('T')[0],
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
