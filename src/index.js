import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import ImageKit from 'imagekit';
import path from 'path';
import productRoutes from './routes/products.route.js'
import orderRoutes from './routes/orders.route.js'
import cartRoutes from './routes/carts.route.js'
import reviewRoutes from './routes/reviews.route.js'
import categoryRoutes from './routes/categories.route.js'
import brandRoutes from './routes/brands.route.js'
import { connect } from './lib/db.js'
import webhookRoutes from './routes/webhook.routes.js'
dotenv.config();

const app = express();
app.use(cors());
app.use('/api/products', productRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/carts', cartRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/brands', brandRoutes)
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);
app.use(express.json()); 
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const imageKit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file provided");
  }

  const file = req.file;

  imageKit.upload(
    {
      file: file.buffer, 
      fileName: Date.now() + path.extname(file.originalname),
    },
    (error, result) => {
      if (error) {
        return res.status(500).send("Error uploading image: " + error);
      }
      res.send(result);
    }
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  connect();
});
