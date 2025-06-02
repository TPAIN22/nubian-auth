import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Product from '../models/product.model.js'

dotenv.config()

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err))

const sampleProducts = [
  {
    name: 'test',
    description: 'test test test  test test test test test test test test test test test.',
    price: 8350,
    discountPrice: 9900,
    stock: 25,
    images: ['https://example.com/oud1.jpg'],
    category: '68222458e6b197721a17282d', // ObjectId كـ String
    brand: '68222458e6b197721a17282e',
  },
  {
    name: ' test 2',
    description: ' test test test test test test test test test test test test test test test test',
    price: 2070,
    discountPrice: 3000,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name: ' test3',
    description: ' test test test test test test test test test test test test test test test test test',
    price: 3050,
    discountPrice: 4000,
    stock: 25,
    images: ['https://example.com/oud1.jpg'],
    category: '68222458e6b197721a17282d', // ObjectId كـ String
    brand: '68222458e6b197721a17282e',
  },
  {
    name:' test4 ',
    description: ' test test test test test test test test test test test test test test test test test test test',
    price: 5200,
    discountPrice: 6000,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:' test5',
    description: '  test test test test test test test test test test test test test test test test test test test test test test test test test test test test',
    price: 2330,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:' test9',
    description: 'شورت جينز عالي الجودة، مثالي للمناسبات والضيوف.',
    price: 2800,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:' test6',
    description: ' test test test test test test test test test test test test test test test test test test test test test test test test test test test test test test test test test test test test',
    price: 7900,
    discountPrice: 9650,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:' test7',
    description: ' test test test test test test test test test test test test test test test test test test test test test test test',
    price: 250000,
    discountPrice: 300000,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:' test7',
    description: ' test test test test test test test test test test test test test test test test test test test test test test test test test test test test',
    price: 250000,
    discountPrice: 300000,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  }
]

async function seedProducts() {
  try {
    await Product.deleteMany()
    const inserted = await Product.insertMany(sampleProducts)
    console.log(`✅ Inserted ${inserted.length} products`)
    process.exit()
  } catch (error) {
    console.error('❌ Error inserting products:', error)
    process.exit(1)
  }
}

seedProducts()
