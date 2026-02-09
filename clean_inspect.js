import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const exchangeRateSchema = new mongoose.Schema({
  base: String,
  date: String,
  rates: Map,
  fetchedAt: Date,
  provider: String
}, { strict: false });

const currencySchema = new mongoose.Schema({
  code: String,
  isActive: Boolean,
  manualRate: Number,
  allowManualRate: Boolean
}, { strict: false });

const ExchangeRate = mongoose.model('ExchangeRate', exchangeRateSchema);
const Currency = mongoose.model('Currency', currencySchema);

async function inspect() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const latest = await ExchangeRate.findOne().sort({ date: -1, fetchedAt: -1 }).lean();
    const egp = await Currency.findOne({ code: 'EGP' }).lean();
    const sdg = await Currency.findOne({ code: 'SDG' }).lean();
    
    let output = '';
    output += '--- EXCHANGE RATES DB STATUS ---\n';
    if (latest) {
      output += `Base: ${latest.base}\n`;
      output += `Date: ${latest.date}\n`;
      output += `Provider: ${latest.provider}\n`;
      output += `Rates size: ${latest.rates ? Object.keys(latest.rates).length : 0}\n`;
      if (latest.rates) {
          output += `Sample (EGP): ${latest.rates?.EGP || 'N/A'}\n`;
      }
    } else {
      output += 'EXCHANGE RATE COLLECTION IS EMPTY!\n';
    }
    
    output += '\n--- CURRENCY CONFIG STATUS ---\n';
    output += `EGP: Active=${egp?.isActive}, Manual=${egp?.manualRate}, AllowManual=${egp?.allowManualRate}\n`;
    output += `SDG: Active=${sdg?.isActive}, Manual=${sdg?.manualRate}, AllowManual=${sdg?.allowManualRate}\n`;
    
    fs.writeFileSync('clean_inspect.txt', output);
    await mongoose.connection.close();
  } catch (error) {
    fs.writeFileSync('clean_inspect.txt', 'ERROR: ' + error.message);
  }
}

inspect();
