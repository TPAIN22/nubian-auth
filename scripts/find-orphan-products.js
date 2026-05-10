// One-off audit: list every product without a merchant assigned.
// Run: node scripts/find-orphan-products.js
//
// Optional bulk-assign:
//   node scripts/find-orphan-products.js --assign <merchantId>
import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../src/models/product.model.js';
import Merchant from '../src/models/merchant.model.js';

const ASSIGN_FLAG_INDEX = process.argv.indexOf('--assign');
const targetMerchantId =
  ASSIGN_FLAG_INDEX !== -1 ? process.argv[ASSIGN_FLAG_INDEX + 1] : null;

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const orphans = await Product.find(
    { $or: [{ merchant: null }, { merchant: { $exists: false } }] },
    { _id: 1, name: 1, status: 1, isActive: 1, deletedAt: 1, createdAt: 1 },
  ).lean();

  console.log(`Found ${orphans.length} product(s) without a merchant:\n`);
  for (const p of orphans) {
    console.log(
      [
        p._id,
        `"${p.name}"`,
        `status=${p.status}`,
        `active=${p.isActive}`,
        p.deletedAt ? 'deleted' : 'live',
        new Date(p.createdAt).toISOString().slice(0, 10),
      ].join('\t'),
    );
  }

  if (targetMerchantId) {
    if (!mongoose.Types.ObjectId.isValid(targetMerchantId)) {
      console.error(`\n--assign value "${targetMerchantId}" is not a valid ObjectId`);
      process.exit(1);
    }
    const merchant = await Merchant.findById(targetMerchantId).lean();
    if (!merchant) {
      console.error(`\nMerchant ${targetMerchantId} not found`);
      process.exit(1);
    }
    const ids = orphans.map((p) => p._id);
    const result = await Product.updateMany(
      { _id: { $in: ids } },
      { $set: { merchant: merchant._id } },
    );
    console.log(
      `\nAssigned ${result.modifiedCount}/${orphans.length} orphan products to merchant ${merchant.storeName || merchant._id}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
