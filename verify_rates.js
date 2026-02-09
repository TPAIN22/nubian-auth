import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connect } from './src/lib/db.js';
import ExchangeRate from './src/models/exchangeRate.model.js';
import { getLatestRate } from './src/services/fx.service.js';

dotenv.config();

async function checkDb() {
  try {
    await connect();
    
    const latest = await ExchangeRate.findOne().sort({ date: -1, fetchedAt: -1 }).lean();
    console.log('--- LATEST DB EXCHANGE RATE DOCUMENT ---');
    console.log(JSON.stringify(latest, null, 2));
    
    console.log('\n--- SYSTEM RESOLUTION CHECK ---');
    const codes = ['USD', 'EGP', 'SDG', 'SAR'];
    for (const code of codes) {
      const resolved = await getLatestRate(code);
      console.log(`${code}: ${resolved.rate} (Provider: ${resolved.provider})`);
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error(error);
  }
}

checkDb();
