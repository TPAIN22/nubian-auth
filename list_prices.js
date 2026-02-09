import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const productSchema = new mongoose.Schema({
  name: String,
  finalPrice: Number,
  merchantPrice: Number,
  price: Number
}, { strict: false });
const Product = mongoose.model('Product', productSchema, 'products');

async function listAllPrices() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const products = await Product.find({}, 'name finalPrice merchantPrice price variants').limit(20).lean();
    console.log('--- PRODUCT PRICING AUDIT ---');
    products.forEach(p => {
      console.log(`NAME: ${p.name}`);
      console.log(`  merchant: ${p.merchantPrice}`);
      console.log(`  final:    ${p.finalPrice}`);
      console.log(`  price:    ${p.price}`);
      if (p.variants && p.variants.length > 0) {
        console.log(`  variants: ${p.variants.length}`);
        p.variants.forEach((v, i) => {
          console.log(`    V${i}: M=${v.merchantPrice}, F=${v.finalPrice}`);
        });
      }
    });

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

listAllPrices();
