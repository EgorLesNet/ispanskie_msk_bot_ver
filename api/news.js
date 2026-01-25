const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver';
const DB_FILE_PATH = 'db.json';
const DB_BRANCH = process.env.DB_BRANCH || 'main';

async function readDbViaGithubRaw() {
  const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${DB_BRANCH}/${DB_FILE_PATH}`;
  const resp = await fetch(rawUrl, { cache: 'no-store' });

  if (!resp.ok) {
    return { posts: [], pending: [], rejected: [], businesses: [] };
  }

  const text = await resp.text();
  const data = JSON.parse(text);

  return {
    posts: Array.isArray(data.posts) ? data.posts : [],
    pending: Array.isArray(data.pending) ? data.pending : [],
    rejected: Array.isArray(data.rejected) ? data.rejected : [],
    businesses: Array.isArray(data.businesses) ? data.businesses : []
  };
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
