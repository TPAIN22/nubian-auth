import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { connect } from './lib/db.js';

import productRoutes from './routes/products.route.js';
import orderRoutes from './routes/orders.route.js';
import cartRoutes from './routes/carts.route.js';
import reviewRoutes from './routes/reviews.route.js';
import categoryRoutes from './routes/categories.route.js';
import brandRoutes from './routes/brands.route.js';
import userRoutes from './routes/users.route.js';
import webhookRoutes from './routes/webhook.routes.js';
import { clerkMiddleware } from '@clerk/express';
import NotificationsRoutes from './routes/notifications.route.js';
dotenv.config();

const app = express();

// 🛡️ Clerk middleware لتفعيل التوثيق

// 🧩 middlewares العامة
app.use(cors(
  {
    origin: ['http://localhost:3000',"http://192.168.56.1:3000" ],
    methods: ['GET', 'POST', 'PUT', 'DELETE' , 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }
));
app.get("/ping", (_, res) => res.send("pong"));
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());


app.use(clerkMiddleware());
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', NotificationsRoutes);
app.use('/api/carts', cartRoutes); 
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/users', userRoutes);

// 🟢 بدء السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  connect();
});
