import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const productSchema = new mongoose.Schema({}, { strict: false });
const Product = mongoose.model('Product', productSchema, 'products');

async function auditPrices() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const products = await Product.find({}).lean();
    console.log(`Auditing ${products.length} products...`);

    const stats = {
      under100: 0,
      between100And1000: 0,
      between1000And10000: 0,
      over10000: 0
    };

    products.forEach(p => {
      const price = p.finalPrice || 0;
      if (price < 100) stats.under100++;
      else if (price < 1000) stats.between100And1000++;
      else if (price < 10000) stats.between1000And10000++;
      else stats.over10000++;
      
      if (price > 1000) {
          console.log(`INFLATED: [${p._id}] ${p.name} - Price: ${price}`);
      }
    });

    console.log('Price Magnitude Stats:', JSON.stringify(stats, null, 2));

    await mongoose.connection.close();
  } catch (error) {
    console.error('Audit failed with error:', error);
    if (mongoose.connection) await mongoose.connection.close();
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

auditPrices();
