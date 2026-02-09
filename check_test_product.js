import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const productSchema = new mongoose.Schema({}, { strict: false });
const Product = mongoose.model('Product', productSchema, 'products');

async function checkProduct() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const product = await Product.findOne({ name: 'test' }).lean();
    console.log('Product "test" data:', JSON.stringify(product, null, 2));

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkProduct();
