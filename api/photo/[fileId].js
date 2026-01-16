export default async function handler(req, res) {
  const { fileId } = req.query;
  
  if (!fileId) {
    return res.status(400).json({ error: 'Missing fileId' });
  }
  
  const BOT_TOKEN = process.env.BOT_TOKEN;
  
  try {
    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    
    if (!fileData.ok) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    
    const filePath = fileData.result.file_path;
    const photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    
    const photoRes = await fetch(photoUrl);
    const buffer = await photoRes.arrayBuffer();
    
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Photo fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch photo' });
  }
}
