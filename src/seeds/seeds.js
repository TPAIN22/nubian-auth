import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Product from '../models/product.model.js'

dotenv.config()

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err))

const sampleProducts = [
  {
    name: 'عود كمبودي فاخر',
    description: 'عود طبيعي أصلي مستخلص من غابات كمبوديا، رائحة فاخرة وثابتة.',
    price: 350,
    stock: 25,
    images: ['https://example.com/oud1.jpg'],
    category: '68222458e6b197721a17282d', // ObjectId كـ String
    brand: '68222458e6b197721a17282e',
  },
  {
    name: 'بخور مروكي سوبر',
    description: 'بخور مروكي عالي الجودة، مثالي للمناسبات والضيوف.',
    price: 200,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name: 'لوفي',
    description: 'عود طبيعي أصلي مستخلص من غابات كمبوديا، رائحة فاخرة وثابتة.',
    price: 350,
    stock: 25,
    images: ['https://example.com/oud1.jpg'],
    category: '68222458e6b197721a17282d', // ObjectId كـ String
    brand: '68222458e6b197721a17282e',
  },
  {
    name:'بخور كولونيا',
    description: 'بخور كولونيا عالي الجودة، مثالي للمناسبات والضيوف.',
    price: 200,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:'قميص جينز',
    description: 'قميص جينز عالي الجودة، مثالي للمناسبات والضيوف.',
    price: 200,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:'شورت جينز',
    description: 'شورت جينز عالي الجودة، مثالي للمناسبات والضيوف.',
    price: 200,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:'شورت جينز',
    description: 'شورت جينز عالي الجودة، مثالي للمناسبات والضيوف.',
    price: 200,
    stock: 40,
    images: ['https://example.com/bukhoor1.jpg'],
    category: '68222458e6b197721a17282d',
    brand: '68222458e6b197721a17282e',
  },
  {
    name:'خلاط كهربائي',
    description: 'خلاط كهربائي عالي الجودة، مثالي للمناسبات والضيوف.',
    price: 200,
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
