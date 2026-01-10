# Production-Grade Notification System Guide

## Overview

This document describes the production-grade notification system for the Nubian marketplace. The system is designed to be scalable, multi-tenant, marketplace-ready, and supports all required notification types and delivery channels.

## Architecture

### Database Schema

1. **Notifications** (`Notification` model)
   - Comprehensive notification schema with type, recipient, channel, status, metadata
   - Supports deduplication, expiration, priority, and categorization
   - Indexed for efficient queries

2. **Notification Preferences** (`NotificationPreferences` model)
   - Per-user/per-merchant preferences
   - Channel preferences (push, in_app, sms, email)
   - Type-based preferences
   - Quiet hours configuration
   - Rate limiting settings
   - Anti-spam settings

3. **Push Tokens** (`PushToken` model - enhanced)
   - Multi-device support
   - Anonymous token support
   - Auto-cleanup of expired tokens
   - Token merging on login
   - Token preservation on logout

### Services

1. **NotificationService** (`src/services/notificationService.js`)
   - Core notification creation and delivery
   - Smart rules enforcement (deduplication, rate limiting, quiet hours, preferences, anti-spam)
   - Batch operations for broadcasts
   - Segmentation support

2. **Notification Event Handlers** (`src/services/notificationEventHandlers.js`)
   - Event-driven architecture
   - Handles all notification types:
     - Transactional (ORDER_CREATED, ORDER_ACCEPTED, etc.)
     - Merchant Alerts (NEW_ORDER, LOW_STOCK, etc.)
     - Behavioral (CART_ABANDONED, PRICE_DROPPED, etc.)
     - Marketing (NEW_ARRIVALS, FLASH_SALE, etc.)

## API Endpoints

### Push Token Management

#### Save Push Token (Anonymous Allowed)
```
POST /api/notifications/tokens
Body: {
  token: string (required),
  platform: 'ios' | 'android' | 'web',
  deviceId: string,
  deviceName: string,
  appVersion: string,
  osVersion: string
}
```

#### Save Merchant Push Token (Authenticated)
```
POST /api/notifications/tokens/merchant
Headers: Authorization: Bearer <token>
Body: { same as above }
```

### Notification Retrieval

#### Get Notifications
```
GET /api/notifications?limit=50&offset=0&category=transactional&isRead=false&type=ORDER_CREATED
Headers: Authorization: Bearer <token>
```

#### Get Unread Count
```
GET /api/notifications/unread?category=transactional
Headers: Authorization: Bearer <token>
```

### Notification Actions

#### Mark as Read
```
PATCH /api/notifications/:notificationId/read
Headers: Authorization: Bearer <token>
```

#### Mark Multiple as Read
```
POST /api/notifications/mark-read
Headers: Authorization: Bearer <token>
Body: { notificationIds: string[] }
```

### Preferences

#### Get Preferences
```
GET /api/notifications/preferences
Headers: Authorization: Bearer <token>
```

#### Update Preferences
```
PUT /api/notifications/preferences
Headers: Authorization: Bearer <token>
Body: {
  channels?: { push: boolean, in_app: boolean, sms: boolean, email: boolean },
  types?: { [type: string]: { enabled: boolean, channels: {...} } },
  quietHours?: { enabled: boolean, start: string, end: string, timezone: string },
  rateLimiting?: { enabled: boolean, maxPerHour: number, maxPerDay: number },
  antiSpam?: { enabled: boolean, minIntervalBetweenSameType: number }
}
```

### Broadcasting (Admin Only)

#### Broadcast to Users/Merchants
```
POST /api/notifications/broadcast
Headers: Authorization: Bearer <admin_token>
Body: {
  type: string,
  title: string,
  body: string,
  deepLink?: string,
  metadata?: object,
  target: 'users' | 'merchants' | 'all'
}
```

#### Send Marketing Notification
```
POST /api/notifications/marketing
Headers: Authorization: Bearer <token>
Body: {
  type: 'NEW_ARRIVALS' | 'FLASH_SALE' | 'MERCHANT_PROMOTION' | 'PERSONALIZED_OFFER',
  title: string,
  body: string,
  deepLink?: string,
  metadata?: object,
  targetRecipients?: null | string[] | { segment: {...} }
}
```

## Event-Driven Integration

### Order Events

The system automatically triggers notifications on order events:

1. **Order Created** (`handleOrderCreated`)
   - Notifies user about order creation
   - Notifies all merchants in the order about new order

2. **Order Status Changed** (`handleOrderStatusChanged`)
   - Notifies user when order status changes (confirmed, shipped, delivered, cancelled)

### Product Events

1. **Product Status Changed** (`handleProductStatusChanged`)
   - Notifies merchant when product is approved/rejected

2. **Low Stock** (`handleLowStock`)
   - Notifies merchant when product stock is low

3. **Back in Stock** (`handleBackInStock`)
   - Notifies users who had product in wishlist when it comes back in stock

### Behavioral Events

1. **Cart Abandoned** (`handleCartAbandoned`)
   - Notifies user about abandoned cart items

2. **Price Changed** (`handlePriceChanged`)
   - Notifies users about price drops (for products in wishlist/viewed)

## Usage Examples

### 1. Creating a Transactional Notification (Order Created)

```javascript
import { handleOrderCreated } from '../services/notificationEventHandlers.js';

// In order.controller.js - after order creation
await handleOrderCreated(order._id);
```

### 2. Creating a Marketing Notification

```javascript
import { createMarketingNotification } from '../services/notificationEventHandlers.js';

// Broadcast to all users
await createMarketingNotification('FLASH_SALE', {
  title: 'Flash Sale - 50% Off!',
  body: 'Limited time offer on selected items',
  deepLink: '/products/sale',
  metadata: { saleId: '123', discount: 50 },
  targetRecipients: null, // null = broadcast to all
});

// Send to specific users
await createMarketingNotification('PERSONALIZED_OFFER', {
  title: 'Special Offer for You',
  body: 'We have a special offer just for you!',
  deepLink: '/offers/personal',
  metadata: { offerId: '456' },
  targetRecipients: ['userId1', 'userId2'], // Array of user IDs
});

// Send to segmented users
await createMarketingNotification('NEW_ARRIVALS', {
  title: 'New Arrivals in Your Favorite Category',
  body: 'Check out the latest products',
  deepLink: '/products/new',
  metadata: { categoryId: '789' },
  targetRecipients: {
    segment: {
      interests: ['electronics'],
      location: 'Sudan',
      purchase_history: { minOrders: 3 },
    },
  },
});
```

### 3. Manual Notification Creation

```javascript
import notificationService from '../services/notificationService.js';

const notification = await notificationService.createNotification({
  type: 'ORDER_DELIVERED',
  recipientType: 'user',
  recipientId: userId, // Can be Clerk ID or ObjectId
  title: 'Order Delivered',
  body: 'Your order has been delivered successfully',
  deepLink: '/orders/12345',
  metadata: {
    orderId: '12345',
    orderNumber: 'ORD-0001',
  },
  channel: 'push',
  priority: 85,
  expiresAt: null, // Or Date for time-sensitive notifications
  merchantId: null, // For multi-tenant tracking
});
```

### 4. Merchant Low Stock Alert

```javascript
import { handleLowStock } from '../services/notificationEventHandlers.js';

// When product stock is updated
await handleLowStock(productId, currentStock, threshold = 10);
```

### 5. Cart Abandonment

```javascript
import { handleCartAbandoned } from '../services/notificationEventHandlers.js';

// After cart timeout (e.g., 24 hours)
const cartItems = await Cart.findOne({ user: userId }).populate('products.product');
await handleCartAbandoned(userId, cartItems.products);
```

## Mobile App Integration

### 1. Register Push Token

```typescript
import { registerForPushNotificationsAsync, registerPushTokenWithAuth } from '@/utils/pushToken';
import { useAuth } from '@clerk/clerk-expo';

// In your app initialization
const { getToken } = useAuth();

useEffect(() => {
  const setupNotifications = async () => {
    const token = await getToken();
    if (token) {
      await registerPushTokenWithAuth(token);
    } else {
      await registerForPushNotificationsAsync();
    }
  };
  setupNotifications();
}, [user]);
```

### 2. Fetch Notifications

```typescript
import { getNotifications, getUnreadCount } from '@/utils/notificationService';
import { useAuth } from '@clerk/clerk-expo';

const { getToken } = useAuth();

const fetchNotifications = async () => {
  const token = await getToken();
  if (!token) return;

  const result = await getNotifications(
    {
      limit: 50,
      offset: 0,
      category: 'transactional',
      isRead: false,
    },
    token
  );

  console.log('Notifications:', result.notifications);
  console.log('Total:', result.total);
};
```

### 3. Mark as Read

```typescript
import { markAsRead } from '@/utils/notificationService';

const handleNotificationPress = async (notificationId: string) => {
  const token = await getToken();
  if (!token) return;

  await markAsRead(notificationId, token);
  // Update local state
};
```

### 4. Get Unread Count for Badge

```typescript
import { getUnreadCount } from '@/utils/notificationService';

const updateBadge = async () => {
  const token = await getToken();
  if (!token) return;

  const count = await getUnreadCount(undefined, token);
  // Update badge icon
};
```

## Smart Rules

### Deduplication
- Prevents duplicate notifications using `deduplicationKey`
- Configurable minimum interval between same-type notifications

### Rate Limiting
- Configurable per-user/per-merchant limits
- Default: 10 per hour, 50 per day
- Can be adjusted via preferences

### Quiet Hours
- Users can configure quiet hours (default: 22:00 - 08:00)
- Push notifications are delayed during quiet hours
- In-app notifications still delivered

### User Preferences
- Per-notification-type preferences
- Channel preferences (push, in_app, sms, email)
- Can disable specific notification types

### Anti-Spam
- Minimum interval between same-type notifications (default: 5 minutes)
- Prevents notification spam

## Notification Types

### Transactional
- `ORDER_CREATED` - When order is created
- `ORDER_ACCEPTED` - When order is accepted/confirmed
- `ORDER_SHIPPED` - When order is shipped
- `ORDER_DELIVERED` - When order is delivered
- `ORDER_CANCELLED` - When order is cancelled
- `REFUND_PROCESSED` - When refund is processed

### Merchant Alerts
- `NEW_ORDER` - When merchant receives new order
- `LOW_STOCK` - When product stock is low
- `PRODUCT_APPROVED` - When product is approved
- `PRODUCT_REJECTED` - When product is rejected
- `PAYOUT_STATUS` - When payout status changes

### Behavioral
- `CART_ABANDONED` - When cart is abandoned
- `VIEWED_NOT_PURCHASED` - When user views but doesn't purchase
- `PRICE_DROPPED` - When price drops on watched product
- `BACK_IN_STOCK` - When product comes back in stock

### Marketing
- `NEW_ARRIVALS` - New products announcement
- `FLASH_SALE` - Flash sale notifications
- `MERCHANT_PROMOTION` - Merchant promotional notifications
- `PERSONALIZED_OFFER` - Personalized offers

## Delivery Channels

### Currently Implemented
- **Push** - Expo push notifications (iOS, Android, Web)
- **In-App** - In-app notification inbox

### Future Implementation
- **SMS** - SMS notifications (future)
- **WhatsApp** - WhatsApp notifications (future)
- **Email** - Email notifications (future)

## Multi-Tenant Support

The system supports multi-merchant marketplace:
- Notifications are scoped by `merchantId`
- Merchants only see their own notifications
- Admin can see all notifications
- Users can receive notifications from multiple merchants

## Marketplace-Ready

The system is designed to be marketplace-ready:
- Not tied to any specific product type
- Generic metadata support for any context
- Extensible notification types
- Scalable architecture
- Multi-tenant isolation

## Example Notification Payloads

### Order Created (User)
```json
{
  "type": "ORDER_CREATED",
  "recipientType": "user",
  "title": "Order Confirmed",
  "body": "Your order #ORD-0001 has been placed successfully. Total: 500 SDG",
  "deepLink": "/orders/12345",
  "metadata": {
    "orderId": "12345",
    "orderNumber": "ORD-0001",
    "totalAmount": 500,
    "status": "pending"
  },
  "channel": "push",
  "category": "transactional",
  "priority": 90
}
```

### New Order (Merchant)
```json
{
  "type": "NEW_ORDER",
  "recipientType": "merchant",
  "title": "New Order Received",
  "body": "You have a new order #ORD-0001 with 3 product(s)",
  "deepLink": "/merchant/orders/12345",
  "metadata": {
    "orderId": "12345",
    "orderNumber": "ORD-0001",
    "merchantRevenue": 450,
    "productCount": 3
  },
  "channel": "push",
  "merchantId": "merchant123",
  "category": "merchant_alerts",
  "priority": 95
}
```

### Flash Sale (Broadcast)
```json
{
  "type": "FLASH_SALE",
  "recipientType": "user",
  "title": "Flash Sale - 50% Off!",
  "body": "Limited time offer on selected items. Shop now!",
  "deepLink": "/products/sale",
  "metadata": {
    "saleId": "sale123",
    "discount": 50,
    "endDate": "2024-12-31T23:59:59Z"
  },
  "channel": "push",
  "category": "marketing",
  "priority": 45,
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

## Testing

### Test Notification Creation
```javascript
// In a test script or controller
import notificationService from './services/notificationService.js';

const testNotification = await notificationService.createNotification({
  type: 'ORDER_CREATED',
  recipientType: 'user',
  recipientId: 'testUserId',
  title: 'Test Notification',
  body: 'This is a test notification',
  channel: 'push',
});
```

## Performance Considerations

1. **Batch Operations**: Use batch operations for broadcasts
2. **Indexes**: All queries are indexed for performance
3. **Pagination**: Always use limit/offset for large result sets
4. **Async Processing**: Notifications are sent asynchronously (fire-and-forget)
5. **Deduplication**: Prevents duplicate notifications and reduces load
6. **Rate Limiting**: Prevents notification spam

## Troubleshooting

### Notifications Not Being Sent
1. Check user preferences - notification type may be disabled
2. Check quiet hours - notifications may be delayed
3. Check rate limits - may have exceeded limits
4. Check push token registration - ensure token is saved
5. Check notification status in database - verify status is 'sent'

### Push Tokens Not Working
1. Verify Expo push token is valid
2. Check device permissions
3. Verify token is saved in database
4. Check token expiration (auto-cleanup after 90 days)
5. Ensure correct API endpoint configuration

## Future Enhancements

1. **SMS Integration** - Integrate SMS service provider
2. **WhatsApp Integration** - Integrate WhatsApp Business API
3. **Email Integration** - Enhanced email templates and delivery
4. **Advanced Segmentation** - Machine learning-based segmentation
5. **A/B Testing** - Test different notification messages
6. **Analytics** - Notification open rates, conversion tracking
7. **Scheduled Notifications** - Schedule notifications for future delivery
8. **Notification Templates** - Template system for common notifications
