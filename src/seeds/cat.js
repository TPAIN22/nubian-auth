import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Category from '../models/categories.model.js'

dotenv.config()

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('MongoDB connected for seeding...'))
.catch(err => console.error('MongoDB connection error:', err));

const categories = [
  {
    name: 'Electronics',
    description: 'A wide range of electronic devices including phones, laptops, and accessories.',
    image: 'https://example.com/images/electronics.jpg',
    isActive: true,
  },
  {
    name: 'Books',
    description: 'Various genres of books from fiction to non-fiction, suitable for all ages.',
    image: 'https://example.com/images/books.jpg',
    isActive: true,
  },
  {
    name: 'Home & Kitchen',
    description: 'Products for home decor, kitchenware, and small appliances.',
    image: 'https://example.com/images/home_kitchen.jpg',
    isActive: true,
  },
  {
    name: 'Fashion',
    description: 'Trendy clothing, shoes, and accessories for men, women, and children.',
    image: 'https://example.com/images/fashion.jpg',
    isActive: true,
  },
  {
    name: 'Sports & Outdoors',
    description: 'Equipment and apparel for various sports and outdoor activities.',
    image: 'https://example.com/images/sports_outdoors.jpg',
    isActive: true,
  },
  {
    name: 'Beauty & Personal Care',
    description: 'Products for skin care, hair care, makeup, and personal grooming.',
    image: 'https://example.com/images/beauty_personal_care.jpg',
    isActive: false, // مثال لفئة غير نشطة
  },
];

const seedDB = async () => {
  try {
    await Category.deleteMany({}); // حذف جميع الفئات الموجودة لتجنب التكرار
    console.log('Existing categories removed.');

    await Category.insertMany(categories);
    console.log('Categories seeded successfully!');
  } catch (error) {
    console.error('Error seeding categories:', error);
  } finally {
    mongoose.connection.close();
    console.log('MongoDB connection closed.');
  }
};

seedDB();