// api/news.js - API для получения новостей
const { readDB } = require('./_db');

function normalizePost(p) {
  if (!p) return null;
  
  return {
    id: p.id,
    text: p.text || '',
    authorId: p.authorId,
    authorName: p.authorName,
    authorUsername: p.authorUsername,
    createdAt: p.createdAt,
    timestamp: p.timestamp,
    category: p.category || 'all',
    media: Array.isArray(p.media) ? p.media : [],
    photoFileId: p.photoFileId || null,
    photoFileIds: Array.isArray(p.photoFileIds) ? p.photoFileIds : [],
    source: p.source || null,
    status: p.status || 'approved',
    sourceType: p.sourceType || 'admin',
    likes: p.likes || 0,
    dislikes: p.dislikes || 0
  };
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=10, stale-while-revalidate=30');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Параметры пагинации
    const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Максимум 50
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    
    // Читаем базу (с кэшем)
    const { db } = await readDB(true);
    
    // Фильтруем и сортируем
    const allApprovedPosts = (db.posts || [])
      .filter(p => p && p.status === 'approved')
      .map(normalizePost)
      .filter(Boolean)
      .sort((a, b) => (b.id || 0) - (a.id || 0));
    
    const total = allApprovedPosts.length;
    
    // Применяем пагинацию
    const paginatedPosts = allApprovedPosts.slice(offset, offset + limit);
    
    console.log(`[API/NEWS] Returning ${paginatedPosts.length} of ${total} posts (offset: ${offset}, limit: ${limit})`);
    
    return res.status(200).json({
      posts: paginatedPosts,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API/NEWS] Error:', error);
    return res.status(500).json({
      error: 'Failed to load news',
      message: error.message
    });
  }
};
