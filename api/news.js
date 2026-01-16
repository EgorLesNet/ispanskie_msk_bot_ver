const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver'
const DB_FILE_PATH = 'db.json'
const DB_BRANCH = process.env.DB_BRANCH || 'main'

async function loadFromGitHub() {
  const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${DB_BRANCH}/${DB_FILE_PATH}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) return { posts: [], pending: [], rejected: [] }
  const data = await response.json()
  // Нормализация, чтобы не падать, если каких-то ключей нет
  return {
    posts: Array.isArray(data.posts) ? data.posts : [],
    pending: Array.isArray(data.pending) ? data.pending : [],
    rejected: Array.isArray(data.rejected) ? data.rejected : []
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  // Важно: чтобы Vercel/браузер не кешировали API-ответ
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const db = await loadFromGitHub()

    // Публичная лента — только одобренные
    return res.status(200).json({ posts: db.posts })
  } catch (e) {
    console.error('api/news error:', e)
    return res.status(500).json({ error: 'Failed to load news' })
  }
}
