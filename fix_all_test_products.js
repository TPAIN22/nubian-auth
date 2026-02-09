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

async function fixAllTestProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find all products named "test" that have a large finalPrice
    const products = await Product.find({ name: 'test', finalPrice: { $gt: 1000 } });
    
    console.log(`Found ${products.length} inflated "test" products.`);

    for (const product of products) {
      console.log(`Fixing ID: ${product._id}, M=${product.merchantPrice}, F=${product.finalPrice}`);
      
      // Normalize by dividing by 100
      product.merchantPrice = product.merchantPrice / 100;
      product.finalPrice = product.finalPrice / 100;
      if (product.price) product.price = product.price / 100;
      
      await product.save();
      console.log(`  Fixed to: M=${product.merchantPrice}, F=${product.finalPrice}`);
    }

    await mongoose.connection.close();
    console.log('Done.');
  } catch (error) {
    console.error('Error:', error);
  }
}

fixAllTestProducts();
