// api/_businesses.js - АПИ для управления бизнесами и отзывами
const { readDB, updateDB } = require('./_db');

function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .trim()
    .slice(0, 500)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const { db } = await readDB(true);
      const businesses = db.businesses || [];
      
      const enriched = businesses.map(b => {
        const reviews = b.reviews || [];
        const avgRating = reviews.length > 0
          ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
          : null;
        return { 
          ...b, 
          avgRating: avgRating ? parseFloat(avgRating) : null, 
          reviewCount: reviews.length 
        };
      });
      
      return res.status(200).json({ businesses: enriched });
    } catch (error) {
      console.error('[API/BUSINESSES] GET error:', error);
      return res.status(500).json({ error: 'Failed to load businesses' });
    }
  }

  if (req.method === 'POST') {
    const { secret, name, category, description, address, url, lat, lng } = req.body;
    const BUSINESS_ADMIN_KEY = process.env.BUSINESS_ADMIN_KEY || 'demo_secret';
    
    if (secret !== BUSINESS_ADMIN_KEY) {
      return res.status(403).json({ error: 'Invalid secret' });
    }
    
    if (!name || !category) {
      return res.status(400).json({ error: 'name and category required' });
    }
    
    const numLat = Number(lat);
    const numLng = Number(lng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
    
    try {
      const newBiz = await updateDB(async (db) => {
        if (!db.businesses) db.businesses = [];
        
        const newBusiness = {
          id: db.businesses.length > 0 ? Math.max(...db.businesses.map(b => b.id)) + 1 : 1,
          name: sanitizeText(name),
          category: sanitizeText(category),
          lat: numLat,
          lng: numLng,
          description: sanitizeText(description),
          address: sanitizeText(address),
          url: url ? String(url).trim().slice(0, 500) : null,
          reviews: [],
          createdAt: new Date().toISOString()
        };
        
        db.businesses.push(newBusiness);
        return newBusiness;
      });
      
      return res.status(201).json({ success: true, business: newBiz });
    } catch (error) {
      console.error('[API/BUSINESSES] POST error:', error);
      return res.status(500).json({ error: 'Failed to create business' });
    }
  }
  
  res.status(405).json({ error: 'Method not allowed' });
};
