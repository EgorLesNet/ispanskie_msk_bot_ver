const { getTodayDigest, getDigest } = require('../lib/digest');
const { toggleDigestSubscription, getUser } = require('../lib/users');

module.exports = async (req, res) => {
  // Разрешаем CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // GET /api/digest?date=2026-02-03 - получить дайджест за дату
    if (req.method === 'GET') {
      const { date } = req.query;
      
      if (date) {
        const digest = await getDigest(date);
        return res.json({ success: true, digest });
      }
      
      // Получаем дайджест за сегодня
      const apiKey = process.env.OPENAI_API_KEY || null;
      const digest = await getTodayDigest(apiKey);
      return res.json({ success: true, digest });
    }
    
    // POST /api/digest/subscribe - управление подпиской
    if (req.method === 'POST' && req.url.includes('/subscribe')) {
      const { tgId, enabled } = req.body;
      
      if (!tgId) {
        return res.status(400).json({ success: false, error: 'tgId required' });
      }
      
      const user = await toggleDigestSubscription(tgId, enabled);
      return res.json({ success: true, user });
    }
    
    // GET /api/digest/status?tgId=123 - проверить статус подписки
    if (req.method === 'GET' && req.url.includes('/status')) {
      const { tgId } = req.query;
      
      if (!tgId) {
        return res.status(400).json({ success: false, error: 'tgId required' });
      }
      
      const user = await getUser(parseInt(tgId));
      return res.json({ 
        success: true, 
        subscribed: user?.digestSubscription || false 
      });
    }
    
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  } catch (error) {
    console.error('Digest API error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};