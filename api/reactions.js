// api/reactions.js - API для лайков и дизлайков
const { updateDB } = require('./_db');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { postId, type, userId } = req.body;
  
  if (!postId || !type || !userId) {
    return res.status(400).json({ error: 'postId, type, and userId are required' });
  }
  
  if (type !== 'like' && type !== 'dislike') {
    return res.status(400).json({ error: 'type must be "like" or "dislike"' });
  }

  try {
    const result = await updateDB(async (db) => {
      const post = db.posts.find(p => p && p.id === Number(postId));
      if (!post) return null;
      
      // Инициализируем счётчики и реакции
      if (typeof post.likes !== 'number') post.likes = 0;
      if (typeof post.dislikes !== 'number') post.dislikes = 0;
      if (!post.userReactions) post.userReactions = {};

      const prevReaction = post.userReactions[userId];

      // Если пользователь уже поставил эту же реакцию - убираем её
      if (prevReaction === type) {
        delete post.userReactions[userId];
        if (type === 'like') post.likes = Math.max(0, post.likes - 1);
        else post.dislikes = Math.max(0, post.dislikes - 1);
        return { 
          likes: post.likes, 
          dislikes: post.dislikes,
          userReaction: null,
          action: 'removed'
        };
      }

      // Убираем предыдущую реакцию
      if (prevReaction === 'like') post.likes = Math.max(0, post.likes - 1);
      if (prevReaction === 'dislike') post.dislikes = Math.max(0, post.dislikes - 1);

      // Добавляем новую реакцию
      post.userReactions[userId] = type;
      if (type === 'like') post.likes++;
      else post.dislikes++;

      return { 
        likes: post.likes, 
        dislikes: post.dislikes,
        userReaction: type,
        action: 'added'
      };
    });
    
    if (!result) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[API/REACTIONS] Error:', error);
    return res.status(500).json({ error: 'Failed to update reaction' });
  }
};
