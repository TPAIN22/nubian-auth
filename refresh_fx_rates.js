import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connect } from './src/lib/db.js';
import { fetchLatestRates } from './src/services/fx.service.js';
import Currency from './src/models/currency.model.js';

dotenv.config();

async function refreshRates() {
  try {
    console.log('Connecting to database...');
    await connect();
    
    // Check for active currencies
    const active = await Currency.find({ isActive: true }).lean();
    console.log(`Active currencies found: ${active.map(c => c.code).join(', ')}`);
    
    if (active.length === 0) {
      console.log('No active currencies. Skipping FX fetch.');
    } else {
      console.log('Triggering FX rate fetch...');
      const result = await fetchLatestRates();
      console.log('Results:', JSON.stringify(result, null, 2));
    }
    
    await mongoose.connection.close();
    console.log('Safe shutdown.');
  } catch (error) {
    console.error('FAILED:', error);
    process.exit(1);
  }
}

refreshRates();
