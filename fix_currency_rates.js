
import 'dotenv/config';
import mongoose from 'mongoose';
import Currency from './src/models/currency.model.js';

async function updateCurrencies() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Update EGP
    const egpResult = await Currency.findOneAndUpdate(
      { code: 'EGP' },
      { 
        allowManualRate: true, 
        manualRate: 50.0, 
        manualRateUpdatedAt: new Date(),
        isActive: true 
      },
      { upsert: true, new: true }
    );
    console.log('Updated EGP:', egpResult.code, 'Rate:', egpResult.manualRate);

    // Update SDG
    const sdgResult = await Currency.findOneAndUpdate(
      { code: 'SDG' },
      { 
        allowManualRate: true, 
        manualRate: 1300.0, 
        manualRateUpdatedAt: new Date(),
        isActive: true 
      },
      { upsert: true, new: true }
    );
    console.log('Updated SDG:', sdgResult.code, 'Rate:', sdgResult.manualRate);

    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
}

updateCurrencies();
