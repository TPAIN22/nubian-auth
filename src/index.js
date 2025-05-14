import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ImageKit from 'imagekit';
import path from 'path';
import { connect } from './lib/db.js';

import productRoutes from './routes/products.route.js';
import orderRoutes from './routes/orders.route.js';
import cartRoutes from './routes/carts.route.js';
import reviewRoutes from './routes/reviews.route.js';
import categoryRoutes from './routes/categories.route.js';
import brandRoutes from './routes/brands.route.js';
import webhookRoutes from './routes/webhook.routes.js';
import { clerkMiddleware } from '@clerk/express';

dotenv.config();

const app = express();

// 🛡️ Clerk middleware لتفعيل التوثيق

// 🧩 middlewares العامة
app.use(cors());
app.use(express.json());

// 📦 الراوتات  

app.use(clerkMiddleware());
app.use('/api/reviews', reviewRoutes);
app.use('/api/carts', cartRoutes); // ← سيتم التحقق داخل هذا الراوت باستخدام requireAuth
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

// 📷 رفع الصور
const storage = multer.memoryStorage();
const upload = multer({ storage });

const imageKit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file provided");
  }

  imageKit.upload(
    {
      file: req.file.buffer,
      fileName: Date.now() + path.extname(req.file.originalname),
    },
    (error, result) => {
      if (error) {
        return res.status(500).send("Error uploading image: " + error.message);
      }
      res.send(result);
    }
  );
});

// 🟢 بدء السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  connect();
});
