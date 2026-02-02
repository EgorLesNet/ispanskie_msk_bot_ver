// api/summary.js - AI-генерация сводки новостей за день
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
 * Генерация сводки через Anthropic Claude API
 */
async function generateSummary(posts) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY не установлен в переменных окружения');
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
  
  const prompt = `Ты помощник для жителей района Испанские Кварталы в Москве. Перед тобой посты из локального новостного агрегатора за сегодня.

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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 800,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API/SUMMARY] Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }
    
    const data = await response.json();
    const summary = data.content?.[0]?.text || '';
    
    return summary.trim();
    
  } catch (error) {
    console.error('[API/SUMMARY] AI generation failed:', error);
    throw error;
  }
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
        date: new Date().toISOString().split('T')[0]
      });
    }
    
    // Генерировать сводку через AI
    const summary = await generateSummary(todayPosts);
    
    console.log('[API/SUMMARY] Summary generated successfully');
    
    return res.status(200).json({
      success: true,
      summary,
      count: todayPosts.length,
      date: new Date().toISOString().split('T')[0]
    });
    
  } catch (error) {
    console.error('[API/SUMMARY] Error:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};
