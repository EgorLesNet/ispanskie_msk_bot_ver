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

      // Определяем content-type на основе расширения и пути
  const ext = String(filePath).split('.').pop().toLowerCase();
  const pathLower = String(filePath).toLowerCase();
  
  let contentType;
  
  // Проверяем расширение
  if (ext === 'jpg' || ext === 'jpeg') {
    contentType = 'image/jpeg';
  } else if (ext === 'png') {
    contentType = 'image/png';
  } else if (ext === 'webp') {
    contentType = 'image/webp';
  } else if (ext === 'gif') {
    contentType = 'image/gif';
  } else if (ext === 'mp4' || ext === 'mpeg4' || ext === 'mov') {
    contentType = 'video/mp4';
  } else if (pathLower.includes('video') || pathLower.startsWith('videos/')) {
    // Если в пути есть "video", считаем это видео
    contentType = 'video/mp4';
  } else if (pathLower.includes('photo') || pathLower.startsWith('photos/')) {
    // Если в пути есть "photo", считаем это фото
    contentType = 'image/jpeg';
  } else {
    contentType = 'application/octet-stream';
  }
    // Поддержка Range requests для видео
    const isVideo = contentType.startsWith('video/');
    const rangeHeader = req.headers.range;
    
    if (isVideo && rangeHeader) {
      // Сначала получаем размер файла
      const headRes = await fetch(tgUrl, { method: 'HEAD' });
      const fileSize = parseInt(headRes.headers.get('content-length') || '0');
      
      // Парсим Range заголовок
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      
      // Скачиваем только нужную часть
      const tgRes = await fetch(tgUrl, {
        headers: { Range: `bytes=${start}-${end}` }
      });
      
      if (!tgRes.ok) return res.status(502).json({ error: 'Failed to download from Telegram' });
      
      const buffer = await tgRes.arrayBuffer();
      
      // Отправляем с правильными заголовками для Range
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(buffer));
    } else {
      // Для обычных запросов (фото) или без Range
      const tgRes = await fetch(tgUrl);
      if (!tgRes.ok) return res.status(502).json({ error: 'Failed to download from Telegram' });
      
      const buffer = await tgRes.arrayBuffer();
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (isVideo) {
        res.setHeader('Accept-Ranges', 'bytes');
      }
      res.send(Buffer.from(buffer));
    }  } catch (error) {
    console.error('Media fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
}
