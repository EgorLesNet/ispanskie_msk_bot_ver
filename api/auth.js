// api/auth.js - Telegram Web Login authentication
require('dotenv/config');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;

/**
 * Verify Telegram Login Widget data
 * https://core.telegram.org/widgets/login#checking-authorization
 */
function verifyTelegramAuth(data) {
  const { hash, ...authData } = data;
  
  if (!hash || !authData.id) {
    return { valid: false, error: 'Missing required fields' };
  }
  
  // Create data-check-string
  const checkArray = Object.keys(authData)
    .sort()
    .map(key => `${key}=${authData[key]}`);
  const dataCheckString = checkArray.join('\n');
  
  // Create secret key from bot token
  const secretKey = crypto.createHash('sha256')
    .update(BOT_TOKEN)
    .digest();
  
  // Calculate hash
  const calculatedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  
  // Verify hash matches
  if (calculatedHash !== hash) {
    return { valid: false, error: 'Data is NOT from Telegram' };
  }
  
  // Check auth date (must be within 24 hours)
  const authDate = parseInt(authData.auth_date);
  const currentTime = Math.floor(Date.now() / 1000);
  
  if (currentTime - authDate > 86400) {
    return { valid: false, error: 'Auth data is outdated' };
  }
  
  return { 
    valid: true, 
    user: {
      id: parseInt(authData.id),
      firstName: authData.first_name || '',
      lastName: authData.last_name || '',
      username: authData.username || '',
      photoUrl: authData.photo_url || '',
      authDate
    }
  };
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const authData = req.body;
    const verification = verifyTelegramAuth(authData);
    
    if (!verification.valid) {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: verification.error 
      });
    }
    
    // Create session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const user = verification.user;
    
    // In production, store session in database/Redis
    // For now, return user data and token
    return res.status(200).json({
      success: true,
      token: sessionToken,
      user: {
        tgId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl,
        displayName: user.firstName + (user.lastName ? ' ' + user.lastName : '')
      }
    });
    
  } catch (error) {
    console.error('[API/AUTH] Error:', error);
    return res.status(500).json({ 
      error: 'Server error',
      message: error.message 
    });
  }
};
