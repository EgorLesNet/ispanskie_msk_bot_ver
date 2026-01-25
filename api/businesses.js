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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET - читаем бизнесы
  if (req.method === 'GET') {
    try {
      const db = await readDbViaGithubRaw();
      return res.status(200).json({ businesses: db.businesses || [] });
    } catch (e) {
      console.error('api/businesses GET error:', e);
      return res.status(500).json({ error: 'Failed to load businesses', message: e.message });
    }
  }

  // POST пока не реализован (требует GitHub commits API)
  if (req.method === 'POST') {
    return res.status(405).json({ error: 'POST not implemented yet. Use Telegram bot to add businesses.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
