// api/auth.js - Telegram Web Login authentication
require('dotenv/config');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('[AUTH] BOT_TOKEN is not set!');
}

/**
 * Parse Telegram initData string into object
 * @param {string} initData - Raw initData string from Telegram
 * @returns {object} Parsed data object
 */
function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const result = {};
  
  for (const [key, value] of params.entries()) {
    // Parse nested JSON (like user object)
    if (key === 'user') {
      try {
        result[key] = JSON.parse(value);
      } catch (e) {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Verify Telegram Web App initData
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyTelegramWebAppData(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    
    if (!hash) {
      return { valid: false, error: 'Missing hash in initData' };
    }
    
    // Create data-check-string from sorted params
    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    // Create secret key: HMAC_SHA256("WebAppData", bot_token)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();
    
    // Calculate hash: HMAC_SHA256(secret_key, data_check_string)
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    
    if (calculatedHash !== hash) {
      console.error('[AUTH] Hash mismatch:', {
        received: hash,
        calculated: calculatedHash
      });
      return { valid: false, error: 'Data verification failed' };
    }
    
    // Parse user data
    const userJson = urlParams.get('user');
    if (!userJson) {
      return { valid: false, error: 'Missing user data' };
    }
    
    const user = JSON.parse(userJson);
    const authDate = parseInt(urlParams.get('auth_date') || '0');
    
    // Check if auth data is not too old (24 hours)
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime - authDate > 86400) {
      return { valid: false, error: 'Auth data is outdated (>24h)' };
    }
    
    return {
      valid: true,
      user: {
        id: user.id,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        username: user.username || '',
        photoUrl: user.photo_url || '',
        languageCode: user.language_code || '',
        authDate
      }
    };
    
  } catch (error) {
    console.error('[AUTH] Verification error:', error);
    return { valid: false, error: 'Verification failed: ' + error.message };
  }
}

/**
 * Verify Telegram Login Widget data (legacy fallback)
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
    let verification;
    
    // Check if initData string is provided (Telegram Web App)
    if (req.body.initData && typeof req.body.initData === 'string') {
      console.log('[AUTH] Using Telegram Web App initData validation');
      verification = verifyTelegramWebAppData(req.body.initData);
    }
    // Fallback to legacy widget auth or direct user data
    else if (req.body.id || req.body.hash) {
      console.log('[AUTH] Using legacy Telegram auth validation');
      verification = verifyTelegramAuth(req.body);
    }
    // No valid auth data
    else {
      console.error('[AUTH] No valid authentication data provided');
      return res.status(400).json({ 
        error: 'Bad request',
        message: 'No valid authentication data provided'
      });
    }
    
    if (!verification.valid) {
      console.error('[AUTH] Verification failed:', verification.error);
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: verification.error 
      });
    }
    
    console.log('[AUTH] Authentication successful for user:', verification.user.id);
    
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
