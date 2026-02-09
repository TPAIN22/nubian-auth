
import axios from 'axios';

async function testApi() {
  try {
    const response = await axios.get('http://localhost:5000/api/home?currencyCode=SDG');
    const data = response.data.data;
    
    const trending = data.trending || [];
    console.log('--- TRENDING PRODUCTS ---');
    trending.slice(0, 3).forEach(p => {
      console.log('NAME:', p.name);
      console.log('FINAL_PRICE:', p.finalPrice);
      console.log('DISPLAY:', p.priceDisplay);
      console.log('VARIANT_COUNT:', p.variants?.length || 0);
      if (p.variants && p.variants.length > 0) {
        console.log('FIRST_VARIANT_FINAL:', p.variants[0].finalPrice);
      }
      console.log('---');
    });
  } catch (error) {
    console.error('ERROR:', error.message);
  }
}

testApi();
