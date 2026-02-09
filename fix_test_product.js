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
  price: Number,
  variants: Array
}, { strict: false });
const Product = mongoose.model('Product', productSchema, 'products');

async function fixTestProduct() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find a product named "test" that has a large finalPrice
    const product = await Product.findOne({ name: 'test', finalPrice: { $gt: 1000 } });
    
    if (!product) {
      console.log('No inflated "test" product found.');
      await mongoose.connection.close();
      return;
    }

    console.log(`Original: M=${product.merchantPrice}, F=${product.finalPrice}`);
    
    // Normalize by dividing by 100 (assuming it was cents)
    product.merchantPrice = product.merchantPrice / 100;
    product.finalPrice = product.finalPrice / 100;
    if (product.price) product.price = product.price / 100;
    
    await product.save();
    console.log(`Fixed:    M=${product.merchantPrice}, F=${product.finalPrice}`);

    await mongoose.connection.close();
    console.log('Done.');
  } catch (error) {
    console.error('Error:', error);
  }
}

fixTestProduct();
