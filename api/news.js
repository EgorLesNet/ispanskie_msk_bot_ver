const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver'
const DB_FILE_PATH = 'db.json'
const DB_BRANCH = process.env.DB_BRANCH || 'main'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''

async function readDbViaGithubApi() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}?ref=${encodeURIComponent(DB_BRANCH)}`
  const resp = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      ...(GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {})
    },
    cache: 'no-store'
  })

  if (!resp.ok) return { posts: [], pending: [], rejected: [] }

  const json = await resp.json()
  const contentB64 = json?.content || ''
  const buf = Buffer.from(contentB64, 'base64')
  const text = buf.toString('utf8')
  const data = JSON.parse(text)

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
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const db = await readDbViaGithubApi()

    // Публичная лента — только approved
    const posts = db.posts.map(p => ({
      ...p,
      timestamp: p.timestamp || p.createdAt || null,
      category: p.category || 'all',
      photoFileIds: Array.isArray(p.photoFileIds)
        ? p.photoFileIds
        : (p.photoFileId ? [p.photoFileId] : [])
    }))

    return res.status(200).json({ posts })
  } catch (e) {
    console.error('api/news error:', e)
    return res.status(500).json({ error: 'Failed to load news' })
  }
}
