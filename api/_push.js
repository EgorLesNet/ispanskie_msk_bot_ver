// api/_push.js - Web Push Notifications (persistent via DB)
require('dotenv/config');
const webpush = require('web-push');
const { readDB, updateDB } = require('./_db');

// VAPID ключи (private key только в env!)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

function normalizeVapidSubject(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (s.startsWith('mailto:')) return s;
  if (s.startsWith('https://') || s.startsWith('http://')) return s;
  return `https://${s.replace(/^\/+/, '')}`;
}

const RAW_VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'https://ispanskie-msk.vercel.app';
const VAPID_SUBJECT = normalizeVapidSubject(RAW_VAPID_SUBJECT);

let PUSH_ENABLED = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    PUSH_ENABLED = true;
    console.log('[PUSH] VAPID configured:', VAPID_SUBJECT);
  } catch (e) {
    PUSH_ENABLED = false;
    console.warn('[PUSH] VAPID invalid, push disabled:', e.message);
  }
} else {
  console.warn('[PUSH] VAPID keys not configured. Push will not work.');
  console.warn('[PUSH] Generate keys with: npx web-push generate-vapid-keys');
}

async function getJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function normalizePushSubs(db) {
  if (!db.pushSubscriptions || !Array.isArray(db.pushSubscriptions)) db.pushSubscriptions = [];
  db.pushSubscriptions = db.pushSubscriptions.filter(r => r && r.subscription && r.subscription.endpoint);
}

async function listSubscriptions() {
  const { db } = await readDB(false);
  normalizePushSubs(db);
  return db.pushSubscriptions;
}

async function upsertSubscription({ subscription, userId }) {
  const endpoint = subscription?.endpoint;
  if (!endpoint) throw new Error('Invalid subscription object');

  const now = new Date().toISOString();
  const key = userId || endpoint;

  await updateDB((db) => {
    normalizePushSubs(db);
    const idx = db.pushSubscriptions.findIndex(r => (r.key === key) || (r.subscription?.endpoint === endpoint));
    const rec = {
      key,
      userId: userId || null,
      endpoint,
      subscription,
      createdAt: idx >= 0 ? (db.pushSubscriptions[idx].createdAt || now) : now,
      updatedAt: now
    };
    if (idx >= 0) db.pushSubscriptions[idx] = rec;
    else db.pushSubscriptions.push(rec);
  });

  return { key, endpoint };
}

async function removeSubscription({ userId, endpoint }) {
  const key = userId || endpoint;
  if (!key) throw new Error('userId or endpoint required');

  let removed = false;

  await updateDB((db) => {
    normalizePushSubs(db);
    const before = db.pushSubscriptions.length;
    db.pushSubscriptions = db.pushSubscriptions.filter(r => {
      if (userId && r.key === userId) return false;
      if (endpoint && r.subscription?.endpoint === endpoint) return false;
      return true;
    });
    removed = db.pushSubscriptions.length !== before;
  });

  return removed;
}

async function handleSubscribe(req, res) {
  try {
    const body = await getJsonBody(req);
    const { subscription, userId } = body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, error: 'Invalid subscription object' });
    }

    const saved = await upsertSubscription({ subscription, userId });

    return res.status(200).json({
      success: true,
      message: 'Subscription registered successfully',
      saved
    });
  } catch (error) {
    console.error('[PUSH] Subscribe error:', error);
    return res.status(500).json({ success: false, error: 'Failed to register subscription', message: error.message });
  }
}

async function handleUnsubscribe(req, res) {
  try {
    const body = await getJsonBody(req);
    const { userId, endpoint } = body;

    const deleted = await removeSubscription({ userId, endpoint });

    return res.status(200).json({
      success: true,
      message: deleted ? 'Unsubscribed successfully' : 'Subscription not found'
    });
  } catch (error) {
    console.error('[PUSH] Unsubscribe error:', error);
    return res.status(500).json({ success: false, error: 'Failed to unsubscribe', message: error.message });
  }
}

async function handleSend(req, res) {
  try {
    const body = await getJsonBody(req);
    const { title, body: text, icon, url, userId, broadcast } = body;

    if (!title || !text) {
      return res.status(400).json({ success: false, error: 'title and body are required' });
    }
    if (!PUSH_ENABLED) {
      return res.status(500).json({ success: false, error: 'Push is not configured (VAPID invalid or missing)' });
    }

    const payload = JSON.stringify({
      title,
      body: text,
      icon: icon || '/logo.png',
      badge: '/logo.png',
      url: url || '/news.html',
      timestamp: Date.now()
    });

    const subs = await listSubscriptions();

    let targets = [];
    if (broadcast) targets = subs;
    else if (userId) targets = subs.filter(r => r.key === userId || r.userId === userId);
    else return res.status(400).json({ success: false, error: 'Either userId or broadcast=true must be specified' });

    const results = { sent: 0, failed: 0, removed: 0, errors: [] };
    const invalidEndpoints = new Set();

    for (const rec of targets) {
      try {
        await webpush.sendNotification(rec.subscription, payload);
        results.sent++;
      } catch (error) {
        results.failed++;
        results.errors.push({ endpoint: rec.endpoint, error: error.message, statusCode: error.statusCode });

        if (error.statusCode === 410 || error.statusCode === 404) {
          invalidEndpoints.add(rec.endpoint);
        }
      }
    }

    if (invalidEndpoints.size) {
      await updateDB((db) => {
        normalizePushSubs(db);
        const before = db.pushSubscriptions.length;
        db.pushSubscriptions = db.pushSubscriptions.filter(r => !invalidEndpoints.has(r.subscription?.endpoint));
        results.removed = before - db.pushSubscriptions.length;
      });
    }

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('[PUSH] Send error:', error);
    return res.status(500).json({ success: false, error: 'Failed to send notification', message: error.message });
  }
}

async function handleGetVapidKey(req, res) {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({ success: false, error: 'VAPID keys not configured' });
  }
  return res.status(200).json({ success: true, publicKey: VAPID_PUBLIC_KEY });
}

async function handleStats(req, res) {
  const subs = await listSubscriptions();
  return res.status(200).json({
    success: true,
    stats: { totalSubscriptions: subs.length }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.pathname.split('/').pop() || req.query?.action;

  if (req.method === 'POST') {
    if (action === 'subscribe') return handleSubscribe(req, res);
    if (action === 'unsubscribe') return handleUnsubscribe(req, res);
    if (action === 'send') return handleSend(req, res);
    return res.status(400).json({ error: 'Unknown action', validActions: ['subscribe', 'unsubscribe', 'send'] });
  }

  if (req.method === 'GET') {
    if (action === 'vapid-key') return handleGetVapidKey(req, res);
    if (action === 'stats') return handleStats(req, res);
    return res.status(400).json({ error: 'Unknown action', validActions: ['vapid-key', 'stats'] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
