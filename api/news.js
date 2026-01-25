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

async function readDbViaGithubRaw() {
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
    console.error('readDbViaGithubRaw error:', e);
    return { posts: [], pending: [], rejected: [], businesses: [] };
  }
}

function normalizePost(p) {
  const photoIds = Array.isArray(p.photoFileIds)
    ? p.photoFileIds
    : (p.photoFileId ? [p.photoFileId] : []);

  const media = Array.isArray(p.media) ? p.media : [];

  return {
    ...p,
    timestamp: p.timestamp || p.createdAt || null,
    category: p.category || 'all',
    photoFileIds: photoIds,
    media
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = await readDbViaGithubRaw();
    const posts = (db.posts || []).map(normalizePost);
    return res.status(200).json({ posts, businesses: db.businesses || [] });
  } catch (e) {
    console.error('api/news error:', e);
    return res.status(500).json({ error: 'Failed to load news', message: e.message });
  }
};
