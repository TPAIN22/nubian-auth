# Nubian Smart Commerce Pricing System

## Overview
The Smart Pricing System automatically calculates product prices based on merchant base prices, Nubian markup, and dynamic market factors. Prices are updated hourly via cron jobs to reflect real-time demand, trending status, and stock levels.

## Architecture

### Backend Components

#### 1. Product Model (`src/models/product.model.js`)
- **New Fields:**
  - `merchantPrice`: Base price set by merchant (required)
  - `nubianMarkup`: Base markup percentage (default: 10%)
  - `dynamicMarkup`: Dynamic markup calculated by system (0-50%)
  - `finalPrice`: Calculated final price = merchantPrice + (merchantPrice * nubianMarkup / 100) + (merchantPrice * dynamicMarkup / 100)
  - `trackingFields`: 24-hour metrics (views24h, cartCount24h, sales24h, favoritesCount)
  - `rankingFields`: Visibility score and ranking metrics

- **Pre-save Middleware:**
  - Automatically calculates `finalPrice` for products and variants
  - Syncs `merchantPrice` with legacy `price` field for backward compatibility
  - Ensures `finalPrice` is never below `merchantPrice`

#### 2. Pricing Service (`src/services/pricing.service.js`)
- **Functions:**
  - `calculateDynamicMarkup(productId)`: Calculates dynamic markup (0-50%) based on:
    - Trending boost (0-15%): Based on sales velocity in last 24h
    - Demand boost (0-12%): Based on conversion rate and favorites
    - Interaction boost (0-10%): Based on views and cart adds in last 24h
    - Stock adjustment (-5% to +8%): Low stock = higher markup, high stock = lower markup
  - `recalculateAllProductPricing()`: Recalculates pricing for all products (called by cron)

#### 3. Cron Service (`src/services/cron.service.js`)
- **Schedule:** Hourly at minute 0 (e.g., 1:00, 2:00, 3:00)
- **Tasks:**
  - Recalculate dynamic markup and finalPrice for all products
  - Recalculate visibility scores for all products
- **Initialization:** Automatically started when server starts (in `src/index.js`)

#### 4. Product Scoring Service (`src/services/productScoring.service.js`)
- **Updated Formula:**
  ```
  visibilityScore = baseScore + trendingBoost + demandBoost + interactionBoost + featuredBoost
  ```
- **Uses 24-hour tracking fields** for more accurate trending and demand calculations

### Frontend Components

#### 1. Price Utilities (`utils/priceUtils.ts`)
- **Updated Functions:**
  - `getFinalPrice()`: Returns finalPrice (smart pricing) > discountPrice > price
  - `getOriginalPrice()`: Returns merchantPrice > price
  - `getPricingBreakdown()`: Returns detailed pricing breakdown for display

#### 2. Product Forms
- **Admin Dashboard** (`src/app/business/products/new/productForm.tsx`):
  - Shows pricing breakdown with live preview
  - Displays: merchantPrice, nubianMarkup (10%), dynamicMarkup (calculated), finalPrice
  
- **Merchant Dashboard** (`src/app/merchant/products/new/productForm.tsx`):
  - Shows pricing preview with alerts
  - Warns that finalPrice cannot be below merchantPrice
  - Displays expected final price with note about dynamic updates

#### 3. Product Display
- **ProductCard** and all product components automatically use `getFinalPrice()` from priceUtils
- Always displays `finalPrice` (never shows below merchantPrice)

### Type Definitions
- Updated `Product` and `ProductVariant` interfaces in:
  - `types/cart.types.ts` (mobile app)
  - `src/types/product.types.ts` (dashboard)

## Pricing Formula

### For Simple Products:
```
finalPrice = merchantPrice + (merchantPrice * nubianMarkup / 100) + (merchantPrice * dynamicMarkup / 100)
```

### For Variants:
Each variant has its own:
- `merchantPrice`: Base price for this variant
- `nubianMarkup`: Defaults to product nubianMarkup (10%)
- `dynamicMarkup`: Same as product dynamicMarkup (calculated hourly)
- `finalPrice`: Calculated using same formula

## Dynamic Markup Calculation

### Factors:
1. **Trending Boost (0-15%)**
   - 50+ sales/24h = 15%
   - 20-49 sales/24h = 12%
   - 10-19 sales/24h = 8%
   - 5-9 sales/24h = 5%
   - 1-4 sales/24h = 2%

2. **Demand Boost (0-12%)**
   - Conversion rate boost (0-7%): Based on sales/views ratio
   - Favorites boost (0-5%): Based on total favorites count

3. **Interaction Boost (0-10%)**
   - Views boost (0-6%): Based on views24h
   - Cart adds boost (0-4%): Based on cartCount24h

4. **Stock Adjustment (-5% to +8%)**
   - Out of stock = +8%
   - Very low stock (1-5) = +6%
   - Low stock (6-10) = +4%
   - Medium-low stock (11-20) = +2%
   - Medium stock (21-50) = 0%
   - High stock (51-100) = -2%
   - Very high stock (200+) = -5%

## Visibility Score Formula

```
visibilityScore = baseScore + trendingBoost + demandBoost + interactionBoost + featuredBoost

Where:
- baseScore = (orderCount * 5) + (viewCount * 1) + (favoriteCount * 3) + (conversionRate * 10) + (storeRating * 4) + discountBoost + newnessBoost
- trendingBoost = Based on sales24h (0-50 points)
- demandBoost = Based on conversion rate and interactions (0-30 points)
- interactionBoost = Based on views24h and cartCount24h (0-20 points)
- featuredBoost = 100 if featured, else 0
```

## API Responses

All product API endpoints now return:
- `merchantPrice`: Base price set by merchant
- `nubianMarkup`: Base markup percentage (default: 10%)
- `dynamicMarkup`: Current dynamic markup (0-50%)
- `finalPrice`: Calculated final price
- `trackingFields`: 24-hour metrics
- `rankingFields`: Visibility and ranking metrics

## Backward Compatibility

- Legacy `price` field is automatically synced with `merchantPrice`
- Legacy `discountPrice` is still supported
- `getFinalPrice()` falls back to `discountPrice` or `price` if `finalPrice` is not available

## Testing Checklist

### Devices to Test:
- Small screens (phones)
- Large screens (tablets)
- Foldables
- Landscape orientation

### Checks:
1. ✅ Price updates correctly after cron job runs
2. ✅ Admin dashboard shows correct pricing breakdown
3. ✅ Merchant forms show correct pricing previews
4. ✅ Variants calculate finalPrice correctly
5. ✅ Cron job updates dynamicMarkup as expected
6. ✅ finalPrice is never below merchantPrice
7. ✅ ProductCard displays finalPrice correctly
8. ✅ API responses include all pricing fields

## Installation

1. Install node-cron:
   ```bash
   npm install node-cron
   ```

2. The cron jobs will automatically start when the server starts.

3. First pricing calculation will run at the next hour (e.g., if server starts at 1:30, first run is at 2:00).

## Monitoring

- Check logs for cron job execution:
  - Look for "🕐 Hourly cron job started"
  - Look for "✅ Pricing recalculation completed"
  - Look for "✅ Visibility score calculation completed"

- Monitor pricing updates:
  - Products should have `finalPrice` calculated
  - `dynamicMarkup` should update hourly based on metrics
  - `trackingFields` should be populated with 24-hour metrics

## Future Enhancements

- Admin override for dynamicMarkup (per product)
- Analytics dashboard showing revenue from markup
- A/B testing for different markup strategies
- Real-time price updates (WebSocket) instead of hourly
- Price history tracking
