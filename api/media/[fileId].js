export default async function handler(req, res) {
  const { fileId } = req.query;
  if (!fileId) return res.status(400).json({ error: 'Missing fileId' });

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: 'Missing BOT_TOKEN' });

  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const fileData = await fileRes.json();

    if (!fileData.ok) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = fileData.result.file_path;
    const tgUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    const ext = String(filePath).split('.').pop().toLowerCase();
    const contentType =
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'png' ? 'image/png' :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif' ? 'image/gif' :
      ext === 'mp4' ? 'video/mp4' :
      'application/octet-stream';

    const tgRes = await fetch(tgUrl);
    if (!tgRes.ok) return res.status(502).json({ error: 'Failed to download from Telegram' });

    const buffer = await tgRes.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Media fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
}
