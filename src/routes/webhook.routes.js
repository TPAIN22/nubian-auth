import express from 'express';
import User from '../models/user.model.js';
import { Webhook } from 'svix';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  console.error("❌ WEBHOOK_SECRET is missing in .env");
  process.exit(1);
}

router.post('/clerk', express.raw({ type: '*/*' }), async (req, res) => {
  const payload = req.body;
  const headers = req.headers;

  const wh = new Webhook(WEBHOOK_SECRET);
  let evt;
  try {
    evt = wh.verify(payload, headers);
  } catch (err) {
    console.error("Webhook verification failed:", err.message);
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  const { type, data } = evt;

  try {
    if (type === 'user.created') {
      const { id, first_name, last_name, phone_numbers , email_addresses } = data;
      await User.create({
        clerkId: id,
        fullName: `${first_name} ${last_name}`,
        phone: phone_numbers?.[0]?.phone_number || '',
        emailAddress: email_addresses?.[0]?.email_address || '',
      });
    }

    if (type === 'user.deleted') {
      await User.findOneAndDelete({ clerkId: data.id });
    }
    console.log("Webhook processed successfully");
    return res.status(200).send("Webhook processed");
  } catch (err) {
    console.error("Error handling webhook:", err);
    return res.status(500).send("Server error");
  }
});

export default router;
