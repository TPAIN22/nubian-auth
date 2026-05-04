/**
 * Fix: drop the stale non-sparse unique index on users.referralCode.
 *
 * Run with:
 *   node src/scripts/fix_referralCode_index.js
 *
 * Why:
 *   The User schema declares `referralCode: { unique: true, sparse: true }`,
 *   but the index was created before `sparse: true` was added. Mongoose does
 *   not drop/recreate existing indexes on schema change, so MongoDB still has
 *   the old non-sparse `referralCode_1` index — which treats `null` as a
 *   value and rejects every new user with `{ referralCode: null }` after the
 *   first one (E11000). This blocks getOrCreateUser, which blocks /api/carts
 *   and any other route that lazily provisions a Mongo user from Clerk.
 *
 * What it does:
 *   1. Drops the existing referralCode_1 index.
 *   2. Triggers Mongoose syncIndexes() to recreate it from the schema (sparse).
 *
 * Safe to run multiple times.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/user.model.js';

dotenv.config();

async function run() {
  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const coll = mongoose.connection.collection('users');
  const indexes = await coll.indexes();
  const existing = indexes.find((i) => i.name === 'referralCode_1');

  if (existing) {
    console.log('Found existing index referralCode_1:', existing);
    await coll.dropIndex('referralCode_1');
    console.log('Dropped referralCode_1');
  } else {
    console.log('No existing referralCode_1 index — nothing to drop');
  }

  console.log('Running User.syncIndexes() to rebuild from schema...');
  const result = await User.syncIndexes();
  console.log('syncIndexes result:', result);

  const after = await coll.indexes();
  const recreated = after.find((i) => i.name === 'referralCode_1');
  console.log('referralCode_1 after sync:', recreated);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
