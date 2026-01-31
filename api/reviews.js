// api/reviews.js - API для работы с отзывами бизнесов (с Telegram авторизацией)
const { readDB, updateDB } = require('./_db');

function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .trim()
    .slice(0, 1000)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '');
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - получить отзывы для бизнеса
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const businessId = parseInt(url.searchParams.get('businessId'));
      const userTgId = url.searchParams.get('userTgId'); // Optional: для подсветки своих отзывов
      
      if (!businessId) {
        return res.status(400).json({ error: 'businessId required' });
      }
      
      const { db } = await readDB(true);
      const businesses = db.businesses || [];
      const business = businesses.find(b => b.id === businessId);
      
      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }
      
      const reviews = (business.reviews || []).map(review => ({
        ...review,
        isOwn: userTgId && review.tgId && String(review.tgId) === String(userTgId)
      }));
      
      // Вычисляем средний рейтинг
      const avgRating = reviews.length > 0
        ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
        : null;
      
      return res.status(200).json({ 
        reviews: reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        avgRating: avgRating ? parseFloat(avgRating) : null,
        reviewCount: reviews.length
      });
    } catch (error) {
      console.error('[API/REVIEWS] GET error:', error);
      return res.status(500).json({ error: 'Failed to load reviews' });
    }
  }

  // POST - добавить новый отзыв (требуется Telegram авторизация)
  if (req.method === 'POST') {
    const { businessId, tgId, userName, rating, comment, photoUrl } = req.body;
    
    // Проверка авторизации Telegram
    if (!tgId || !userName) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Войдите через Telegram, чтобы оставить отзыв'
      });
    }
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId required' });
    }
    
    const numBusinessId = parseInt(businessId);
    if (!Number.isInteger(numBusinessId)) {
      return res.status(400).json({ error: 'Invalid businessId' });
    }
    
    const numRating = parseInt(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ error: 'rating must be 1-5' });
    }
    
    try {
      const newReview = await updateDB(async (db) => {
        if (!db.businesses) db.businesses = [];
        
        const business = db.businesses.find(b => b.id === numBusinessId);
        if (!business) {
          throw new Error('Business not found');
        }
        
        if (!business.reviews) business.reviews = [];
        
        // Проверяем, не оставлял ли пользователь уже отзыв (по tgId)
        const existingReview = business.reviews.find(r => String(r.tgId) === String(tgId));
        if (existingReview) {
          throw new Error('User already reviewed this business');
        }
        
        const review = {
          id: business.reviews.length > 0 ? Math.max(...business.reviews.map(r => r.id)) + 1 : 1,
          tgId: parseInt(tgId),
          userName: sanitizeText(userName),
          photoUrl: photoUrl || null,
          rating: numRating,
          comment: sanitizeText(comment),
          createdAt: new Date().toISOString()
        };
        
        business.reviews.push(review);
        return review;
      });
      
      return res.status(201).json({ success: true, review: newReview });
    } catch (error) {
      console.error('[API/REVIEWS] POST error:', error);
      if (error.message === 'Business not found') {
        return res.status(404).json({ error: 'Business not found' });
      }
      if (error.message === 'User already reviewed this business') {
        return res.status(409).json({ error: 'Вы уже оставили отзыв на этот бизнес' });
      }
      return res.status(500).json({ error: 'Failed to create review' });
    }
  }

  // DELETE - удалить свой отзыв
  if (req.method === 'DELETE') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const businessId = parseInt(url.searchParams.get('businessId'));
      const tgId = url.searchParams.get('tgId');
      
      if (!businessId || !tgId) {
        return res.status(400).json({ error: 'businessId and tgId required' });
      }
      
      const deleted = await updateDB(async (db) => {
        if (!db.businesses) return false;
        
        const business = db.businesses.find(b => b.id === businessId);
        if (!business || !business.reviews) return false;
        
        const reviewIndex = business.reviews.findIndex(r => String(r.tgId) === String(tgId));
        if (reviewIndex === -1) return false;
        
        business.reviews.splice(reviewIndex, 1);
        return true;
      });
      
      if (!deleted) {
        return res.status(404).json({ error: 'Review not found' });
      }
      
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('[API/REVIEWS] DELETE error:', error);
      return res.status(500).json({ error: 'Failed to delete review' });
    }
  }
  
  res.status(405).json({ error: 'Method not allowed' });
};
