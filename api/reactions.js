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

  const { postId, type } = req.body;
  
  if (!postId || !type) {
    return res.status(400).json({ error: 'postId and type are required' });
  }
  
  if (type !== 'like' && type !== 'dislike') {
    return res.status(400).json({ error: 'type must be "like" or "dislike"' });
  }

  try {
    const result = await updateDB(async (db) => {
      const post = db.posts.find(p => p && p.id === Number(postId));
      if (!post) return null;
      
      if (type === 'like') {
        post.likes = (post.likes || 0) + 1;
        return { likes: post.likes, dislikes: post.dislikes || 0 };
      } else {
        post.dislikes = (post.dislikes || 0) + 1;
        return { likes: post.likes || 0, dislikes: post.dislikes };
      }
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
