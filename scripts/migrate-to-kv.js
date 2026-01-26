#!/usr/bin/env node
// scripts/migrate-to-kv.js - Migration script to move data from db.json to Vercel KV

require('dotenv/config');
const { kv } = require('@vercel/kv');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.json');

async function migrate() {
  console.log('🔄 Starting migration from db.json to Vercel KV...');

  if (!process.env.KV_REST_API_URL) {
    console.error('❌ Error: KV_REST_API_URL not found in environment variables');
    console.log('Please set up Vercel KV and configure environment variables.');
    process.exit(1);
  }

  try {
    // Read local db.json
    console.log('📖 Reading db.json...');
    const dbContent = fs.readFileSync(DB_PATH, 'utf8');
    const db = JSON.parse(dbContent);

    console.log(`✅ Found ${db.posts?.length || 0} posts, ${db.pending?.length || 0} pending, ${db.businesses?.length || 0} businesses`);

    // Write to KV
    console.log('💾 Writing to Vercel KV...');
    await kv.set('ispanskie_db', db);

    // Verify
    console.log('🔍 Verifying data...');
    const stored = await kv.get('ispanskie_db');
    
    if (stored && stored.posts && stored.posts.length === db.posts.length) {
      console.log('✅ Migration completed successfully!');
      console.log(`📊 Migrated ${stored.posts.length} posts to Vercel KV`);
    } else {
      console.warn('⚠️  Warning: Verification failed - data may be incomplete');
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;
