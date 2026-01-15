const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPO = 'EgorLesNet/ispanskie_msk_bot_ver'
const DB_FILE_PATH = 'db.json'
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'fusuges').toLowerCase()

// Read database from GitHub
async function readDB() {
  try {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${DB_FILE_PATH}`
    const response = await fetch(url)
    if (response.ok) {
      return await response.json()
    }
  } catch (err) {
    console.error('Error reading DB:', err)
  }
  return { posts: [] }
}

// Write database to GitHub
async function writeDB(db) {
  try {
    const getUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DB_FILE_PATH}`
    const getResponse = await fetch(getUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })
    
    const fileData = await getResponse.json()
    const sha = fileData.sha
    
    const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64')
    const updateResponse = await fetch(getUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Delete news via API',
        content: content,
        sha: sha
      })
    })
    
    return updateResponse.ok
  } catch (err) {
    console.error('Error writing DB:', err)
    return false
  }
}module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = readDB();

  // GET /api/news - Get all posts
  if (req.method === 'GET') {
    return res.status(200).json(db);
  }

  // DELETE /api/news/:id - Delete a post (admin only)
  if (req.method === 'DELETE') {
    const urlParts = req.url.split('/');
    const postId = parseInt(urlParts[urlParts.length - 1].split('?')[0]);
    const { admin } = req.query;

    // Check admin
    if (!admin || admin.toLowerCase() !== ADMIN_USERNAME) {      return res.status(403).json({ error: 'Forbidden' });
    }

    // Find and remove post
    const postIndex = db.posts.findIndex(p => p.id === postId);
    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' });
    }

    db.posts.splice(postIndex, 1);
    writeDB(db);

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
