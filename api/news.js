// api/news.js
const https = require('https');

const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver';
const DB_FILE_PATH = 'db.json';
const DB_BRANCH = 'main';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

async function readDBViaGitHubRaw() {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${DB_BRANCH}/${DB_FILE_PATH}`;
    const text = await httpsGet(rawUrl);
    const data = JSON.parse(text);
    
    return {
      posts: Array.isArray(data.posts) ? data.posts : [],
      pending: Array.isArray(data.pending) ? data.pending : [],
      rejected: Array.isArray(data.rejected) ? data.rejected : [],
      businesses: Array.isArray(data.businesses) ? data.businesses : []
    };
  } catch (e) {
    console.error('readDBViaGitHubRaw error:', e);
    return { posts: [], pending: [], rejected: [], businesses: [] };
  }
}

function normalizePost(p) {
  return {
    id: p.id,
    text: p.text || '',
    authorId: p.authorId,
    authorName: p.authorName,
    authorUsername: p.authorUsername,
    createdAt: p.createdAt,
    timestamp: p.timestamp,
    category: p.category || null,
    media: p.media || [],
    photoFileId: p.photoFileId || null,
    source: p.source || null,
    moderationMessage: p.moderationMessage || null,
    status: p.status || 'approved',
    sourceType: p.sourceType || 'admin',
    likes: p.likes || 0,
    dislikes: p.dislikes || 0
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const db = await readDBViaGitHubRaw();
    
    // Возвращаем только одобренные новости
    const approvedPosts = (db.posts || [])
      .filter(p => p.status === 'approved')
      .map(normalizePost)
      .sort((a, b) => b.id - a.id); // Сначала новые
    
    console.log(`[API/NEWS] Returning ${approvedPosts.length} posts`);
    return res.json({ posts: approvedPosts });
  }
  
  res.status(405).json({ error: 'Method not allowed' });
};
