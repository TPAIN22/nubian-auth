import { connect } from '../src/lib/db.js';
import Product from '../src/models/product.model.js';
import Merchant from '../src/models/merchant.model.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await connect();
  const approvedMerchants = await Merchant.find({ status: 'APPROVED' }).select('_id').lean();
  const approvedMerchantIds = approvedMerchants.map(m => m._id);

  const baseFilter = {
    isActive: { $ne: false },
    deletedAt: null,
    'variants.stock': { $gt: 0 },
    $or: [
      { merchant: { $in: approvedMerchantIds } },
      { merchant: null },
    ],
  };

  console.log('--- Analyzing Trending Products ---');
  const trendingExplain = await Product.find(baseFilter)
    .sort({ featured: -1, priorityScore: -1, createdAt: -1 })
    .limit(20)
    .explain('executionStats');
  console.log('Trending Stage:', trendingExplain.executionStats.executionStages.stage);
  console.log('Docs Examined:', trendingExplain.executionStats.totalDocsExamined);
  console.log('Execution Time:', trendingExplain.executionStats.executionTimeMillis, 'ms');

  console.log('\n--- Analyzing Flash Deals ---');
  const flashFilter = {
    ...baseFilter,
    $or: [
      { discountPrice: { $gt: 0 } },
      { 'variants.discountPrice': { $gt: 0 } }
    ]
  };
  const flashExplain = await Product.find(flashFilter)
    .sort({ discountPrice: -1, createdAt: -1 })
    .limit(20)
    .explain('executionStats');
  console.log('Flash Stage:', flashExplain.executionStats.executionStages.stage);
  console.log('Docs Examined:', flashExplain.executionStats.totalDocsExamined);
  console.log('Execution Time:', flashExplain.executionStats.executionTimeMillis, 'ms');

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
