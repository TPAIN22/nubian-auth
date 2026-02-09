import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const productSchema = new mongoose.Schema({
  name: String,
  merchantPrice: Number,
  finalPrice: Number,
  price: Number
}, { strict: false });
const Product = mongoose.model('Product', productSchema, 'products');

async function listTestProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const products = await Product.find({ name: 'test' }).lean();
    console.log('--- TEST PRODUCTS AUDIT ---');
    products.forEach(p => {
      console.log(`ID: ${p._id}`);
      console.log(`  merchant: ${p.merchantPrice}`);
      console.log(`  final:    ${p.finalPrice}`);
      console.log(`  price:    ${p.price}`);
    });

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

listTestProducts();
