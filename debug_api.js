const fetch = require('node-fetch');

async function debugProduct() {
  try {
    // 1. Fetch all products to find one with variants
    console.log('Fetching products...');
    const res = await fetch('http://localhost:5000/api/products?limit=5');
    const data = await res.json();
    
    if (!data.data || data.data.length === 0) {
      console.log('No products found.');
      return;
    }

    // Find a variant product
    const variantProduct = data.data.find(p => p.variants && p.variants.length > 0);
    
    if (!variantProduct) {
      console.log('No variant products found in first 5 results.');
       // Try fetching a specific one if you know ID, otherwise just log the first simple one
       const simple = data.data[0];
       console.log('DEBUGGING SIMPLE PRODUCT:', simple.name);
       console.log('Merchant Price:', simple.merchantPrice);
       console.log('Nubian Markup:', simple.nubianMarkup);
       console.log('Original Price:', simple.originalPrice);
       console.log('Final Price:', simple.finalPrice);
       console.log('Discount Pct:', simple.discountPercentage);
       return;
    }

    console.log('DEBUGGING VARIANT PRODUCT:', variantProduct.name);
    console.log('ID:', variantProduct._id);
    console.log('Root Merchant Price:', variantProduct.merchantPrice);
    console.log('Root Nubian Markup:', variantProduct.nubianMarkup);
    console.log('Root Original Price:', variantProduct.originalPrice);
    console.log('Root Final Price:', variantProduct.finalPrice);
    console.log('Root Discount Pct:', variantProduct.discountPercentage);
    
    console.log('--- VARIANTS ---');
    variantProduct.variants.forEach((v, i) => {
        console.log(`Variant ${i} (${v.sku}):`);
        console.log(`  Merchant Price: ${v.merchantPrice}`);
        console.log(`  Nubian Markup: ${v.nubianMarkup}`);
        console.log(`  Original Price: ${v.originalPrice}`);
        console.log(`  Final Price: ${v.finalPrice}`);
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

debugProduct();
