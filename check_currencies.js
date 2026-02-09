
import 'dotenv/config';
import mongoose from 'mongoose';
import Currency from './src/models/currency.model.js';

async function checkCurrencies() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const currencies = await Currency.find({ code: { $in: ['SDG', 'EGP'] } });
    console.log('CURRENCIES_START');
    console.log(JSON.stringify(currencies, null, 2));
    console.log('CURRENCIES_END');
    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
}

checkCurrencies();
