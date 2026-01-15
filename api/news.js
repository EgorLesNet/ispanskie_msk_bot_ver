const fs = require('fs');
const path = require('path');

// Path to database file
const dbPath = '/tmp/_db.json';
// Read database
function readDB() {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading DB:', err);
  }
  return { posts: [] };
}

// Write database
function writeDB(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing DB:', err);
  }
}

module.exports = async (req, res) => {
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
    if (!admin || admin.toLowerCase() !== 'fusuges') {
      return res.status(403).json({ error: 'Forbidden' });
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
