import Product from "../models/product.model.js";

export function computeFinalPrice({ merchantPrice, nubianMarkup = 10, dynamicMarkup = 0 }) {
  const mp = Number(merchantPrice) || 0;
  if (mp <= 0) return 0;

  const nm = Number(nubianMarkup) || 0;
  const dm = Number(dynamicMarkup) || 0;

  const nubian = (mp * nm) / 100;
  const dynamic = (mp * dm) / 100;
  return Math.round(Math.max(mp, mp + nubian + dynamic));
}

// Simple v1 logic (you can replace later)
function computeDynamicMarkupFromSignals({ stock, views24h = 0, cartCount24h = 0, sales24h = 0 }) {
  const s = Number(stock) || 0;

  // scarcity
  let scarcity =
    s <= 5 ? 25 :
    s <= 20 ? 15 :
    s <= 50 ? 8 : 0;

  // demand
  const demandScore = (Number(views24h) || 0) + (Number(cartCount24h) || 0) * 3 + (Number(sales24h) || 0) * 8;
  let demand =
    demandScore >= 200 ? 20 :
    demandScore >= 100 ? 12 :
    demandScore >= 50 ? 6 : 0;

  // clamp 0..50
  return Math.max(0, Math.min(50, scarcity + demand));
}

export async function runDynamicPricingCron() {
  const cursor = Product.find({ isActive: true, deletedAt: null }).cursor();

  for await (const product of cursor) {
    let changed = false;

    // ===== Variant product =====
    if (product.variants?.length) {
      let totalStock = 0;

      product.variants.forEach((v) => {
        const vStock = Number(v.stock) || 0;
        totalStock += vStock;

        const nextDynamic = computeDynamicMarkupFromSignals({
          stock: vStock,
          views24h: product.trackingFields?.views24h,
          cartCount24h: product.trackingFields?.cartCount24h,
          sales24h: product.trackingFields?.sales24h,
        });

        const nextFinal = computeFinalPrice({
          merchantPrice: v.merchantPrice,
          nubianMarkup: v.nubianMarkup ?? product.nubianMarkup,
          dynamicMarkup: nextDynamic,
        });

        // update only if needed
        if (v.dynamicMarkup !== nextDynamic) {
          v.dynamicMarkup = nextDynamic;
          changed = true;
        }

        if (!v.finalPrice || v.finalPrice !== nextFinal) {
          v.finalPrice = nextFinal;
          changed = true;
        }

        // legacy sync (optional)
        if (!v.price || v.price !== v.merchantPrice) {
          v.price = v.merchantPrice;
          changed = true;
        }
      });

      if (product.stock !== totalStock) {
        product.stock = totalStock;
        changed = true;
      }

      // Product-level finalPrice for variant product (optional)
      // We can store min variant finalPrice for display
      const minFinal = Math.min(...product.variants.map((x) => x.finalPrice || 0).filter((n) => n > 0));
      if (Number.isFinite(minFinal) && minFinal > 0 && product.finalPrice !== minFinal) {
        product.finalPrice = minFinal;
        changed = true;
      }
    } else {
      // ===== Simple product =====
      const nextDynamic = computeDynamicMarkupFromSignals({
        stock: product.stock,
        views24h: product.trackingFields?.views24h,
        cartCount24h: product.trackingFields?.cartCount24h,
        sales24h: product.trackingFields?.sales24h,
      });

      const nextFinal = computeFinalPrice({
        merchantPrice: product.merchantPrice,
        nubianMarkup: product.nubianMarkup,
        dynamicMarkup: nextDynamic,
      });

      if (product.dynamicMarkup !== nextDynamic) {
        product.dynamicMarkup = nextDynamic;
        changed = true;
      }
      if (!product.finalPrice || product.finalPrice !== nextFinal) {
        product.finalPrice = nextFinal;
        changed = true;
      }

      // legacy sync (optional)
      if (!product.price || product.price !== product.merchantPrice) {
        product.price = product.merchantPrice;
        changed = true;
      }
    }

    if (changed) {
      product.scoreCalculatedAt = new Date();
      await product.save();
    }
  }
}
