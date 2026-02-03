const fs = require('fs').promises;
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.json');
const DIGEST_PATH = path.join(__dirname, '..', 'dailyDigest.json');

/**
 * Генерирует дайджест новостей за сегодня с помощью AI
 * @param {string} apiKey - API ключ для Groq
 * @returns {Promise<object>} - Сгенерированный дайджест
 */
async function generateDailyDigest(apiKey) {
  try {
    // Читаем базу новостей
    const dbData = await fs.readFile(DB_PATH, 'utf8');
    const db = JSON.parse(dbData);
    
    // Получаем новости за сегодня
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayPosts = db.posts.filter(post => {
      const postDate = new Date(post.createdAt);
      postDate.setHours(0, 0, 0, 0);
      return postDate.getTime() === today.getTime() && post.status === 'approved';
    });
    
    if (todayPosts.length === 0) {
      return {
        date: today.toISOString().split('T')[0],
        digest: '📰 Сегодня новых новостей не было.\n\nХорошего вечера! 🌙',
        postsCount: 0,
        generated: new Date().toISOString()
      };
    }
    
    // Формируем промпт для AI
    const newsText = todayPosts.map((post, index) => 
      `${index + 1}. ${post.text.substring(0, 300)}${post.text.length > 300 ? '...' : ''}`
    ).join('\n\n');
    
    // Используем Groq API для генерации дайджеста
    const digest = await generateWithGroq(newsText, todayPosts.length, apiKey);
    
    const digestObj = {
      date: today.toISOString().split('T')[0],
      digest: digest,
      postsCount: todayPosts.length,
      generated: new Date().toISOString(),
      posts: todayPosts.map(p => ({
        id: p.id,
        text: p.text.substring(0, 150) + '...',
        sourceUrl: p.source?.postUrl || null
      }))
    };
    
    // Сохраняем дайджест
    await saveDigest(digestObj);
    
    return digestObj;
  } catch (error) {
    console.error('Error generating digest:', error);
    throw error;
  }
}

/**
 * Генерирует дайджест с помощью Groq API
 */
async function generateWithGroq(newsText, count, apiKey) {
  if (!apiKey) {
    // Fallback: простой дайджест без AI
    return createSimpleDigest(newsText, count);
  }
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'Ты - помощник для создания дайджестов новостей жилого района "Испанские Кварталы" в Москве. Твоя задача - создать краткий, информативный и дружелюбный дайджест из предоставленных новостей. Пиши на русском языке, используй эмодзи для оживления текста. Будь кратким - не более 500 символов. Начни с заголовка "📰 Дайджест дня" и выдели главное.'
          },
          {
            role: 'user',
            content: `Создай дайджест из этих ${count} новост${count === 1 ? 'и' : count < 5 ? 'ей' : 'ей'} за сегодня:\n\n${newsText}\n\nСоздай краткий дайджест (до 500 символов) с заголовком "📰 Дайджест дня", выдели главное, используй эмодзи.`
          }
        ],
        temperature: 0.7,
        max_tokens: 600,
        top_p: 1,
        stream: false
      })
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Groq API error:', response.status, errorData);
      throw new Error(`Groq API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('AI generation error:', error);
    // Fallback на простой дайджест
    return createSimpleDigest(newsText, count);
  }
}

/**
 * Создает простой дайджест без AI (fallback)
 */
function createSimpleDigest(newsText, count) {
  const newsLines = newsText.split('\n\n').slice(0, 5); // Первые 5 новостей
  const preview = newsLines.join('\n');
  
  return `📰 Дайджест дня\n\nСегодня ${count} новост${count === 1 ? 'ь' : count < 5 ? 'и' : 'ей'}:\n\n${preview.substring(0, 400)}...\n\nПолный список в боте! 📱`;
}

/**
 * Сохраняет дайджест в базу
 */
async function saveDigest(digestObj) {
  try {
    let digestData;
    try {
      const data = await fs.readFile(DIGEST_PATH, 'utf8');
      digestData = JSON.parse(data);
    } catch {
      digestData = { digests: [] };
    }
    
    // Удаляем старые дайджесты (оставляем последние 30 дней)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    digestData.digests = digestData.digests.filter(d => 
      new Date(d.generated) > thirtyDaysAgo
    );
    
    // Проверяем, есть ли уже дайджест за эту дату
    const existingIndex = digestData.digests.findIndex(d => d.date === digestObj.date);
    if (existingIndex !== -1) {
      // Обновляем существующий
      digestData.digests[existingIndex] = digestObj;
    } else {
      // Добавляем новый дайджест
      digestData.digests.push(digestObj);
    }
    
    await fs.writeFile(DIGEST_PATH, JSON.stringify(digestData, null, 2));
  } catch (error) {
    console.error('Error saving digest:', error);
  }
}

/**
 * Получает дайджест за указанную дату
 */
async function getDigest(date) {
  try {
    const data = await fs.readFile(DIGEST_PATH, 'utf8');
    const digestData = JSON.parse(data);
    
    const digest = digestData.digests.find(d => d.date === date);
    return digest || null;
  } catch (error) {
    console.error('Error getting digest:', error);
    return null;
  }
}

/**
 * Получает или генерирует дайджест за сегодня
 */
async function getTodayDigest(apiKey) {
  const today = new Date().toISOString().split('T')[0];
  
  // Проверяем, есть ли уже сгенерированный дайджест
  let digest = await getDigest(today);
  
  if (!digest) {
    // Генерируем новый
    digest = await generateDailyDigest(apiKey);
  }
  
  return digest;
}

module.exports = {
  generateDailyDigest,
  getTodayDigest,
  getDigest
};