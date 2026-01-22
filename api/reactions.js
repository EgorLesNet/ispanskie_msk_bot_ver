import { readDb, writeDb } from './_db.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const { newsId, reaction } = req.body;

      if (!newsId || !reaction) {
        return res.status(400).json({ error: 'newsId и reaction обязательны' });
      }

      if (reaction !== 'like' && reaction !== 'dislike') {
        return res.status(400).json({ error: 'reaction должен быть like или dislike' });
      }

      const db = readDb();
      const post = db.posts.find(p => p.id === parseInt(newsId));

      if (!post) {
        return res.status(404).json({ error: 'Новость не найдена' });
      }

      // Инициализируем счетчики если их нет
      if (typeof post.likes !== 'number') post.likes = 0;
      if (typeof post.dislikes !== 'number') post.dislikes = 0;

      // Увеличиваем счетчик
      if (reaction === 'like') {
        post.likes += 1;
      } else {
        post.dislikes += 1;
      }

      writeDb(db);

      return res.status(200).json({
        success: true,
        likes: post.likes,
        dislikes: post.dislikes
      });
    } catch (err) {
      console.error('Ошибка reactions:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
  }

  return res.status(405).json({ error: 'Метод не поддерживается' });
}
