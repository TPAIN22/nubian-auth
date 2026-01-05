# Nubian API

Backend API server for the Nubian e-commerce platform built with Express.js, MongoDB, and Clerk authentication.

## Features

- 🛍️ Complete e-commerce API
- 👤 User authentication with Clerk
- 📦 Product management
- 🛒 Shopping cart functionality
- 📋 Order management
- 💬 Product reviews
- 🎫 Coupon system
- 📧 Email notifications
- 🛡️ Security features (Helmet, rate limiting, input validation)
- 📝 Structured logging with Winston
- 🏥 Health check endpoints

## Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js 5
- **Database**: MongoDB with Mongoose
- **Authentication**: Clerk
- **Email**: Resend
- **Image Management**: ImageKit
- **Logging**: Winston
- **Security**: Helmet, express-rate-limit

## Prerequisites

- Node.js 18+ and npm
- MongoDB database (local or cloud)
- Clerk account (for authentication)
- Resend account (for email)
- ImageKit account (optional, for image management)

## Getting Started

### 1. Clone the repository

```bash
git clone <repository-url>
cd nubian-auth
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/nubian-db

# Clerk Authentication
CLERK_SECRET_KEY=sk_test_your_secret_key_here
CLERK_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Email (Resend)
RESEND_API_KEY=re_your_api_key_here

# CORS Configuration (comma-separated)
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,https://nubian-sd.store

# Logging
LOG_LEVEL=info
```

### 4. Start the server

Development (with auto-reload):
```bash
npm run dev
```

Production:
```bash
npm start
```

The server will start on `http://localhost:5000` (or the PORT specified in your .env file).

## API Endpoints

### Health Checks
- `GET /health` - Health check endpoint
- `GET /ready` - Readiness check (includes database connection check)

### Products
- `GET /api/products` - Get all products (with pagination)
- `GET /api/products/:id` - Get product by ID
- `POST /api/products` - Create product (admin only)
- `PATCH /api/products/:id` - Update product (admin only)
- `DELETE /api/products/:id` - Delete product (admin only)

### Orders
- `GET /api/orders/my-orders` - Get current user's orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order
- `GET /api/orders/admin` - Get all orders (admin only)
- `PATCH /api/orders/:id/status` - Update order status (admin only)

### Cart
- `GET /api/carts` - Get user's cart
- `POST /api/carts` - Add product to cart
- `PATCH /api/carts` - Update cart item
- `DELETE /api/carts` - Remove item from cart

### Reviews
- `GET /api/reviews` - Get reviews (with optional product filter)
- `POST /api/reviews` - Create review
- `GET /api/reviews/all` - Get all reviews (admin only)

### Other Endpoints
- Categories, Brands, Coupons, Wishlist, Addresses, Banners, Notifications

## Security Features

- **Helmet.js** - Security headers
- **Rate Limiting** - Prevents API abuse
- **Input Validation** - Request validation (with express-validator)
- **CORS** - Configurable cross-origin resource sharing
- **Request Size Limits** - Prevents large payload attacks
- **Error Handling** - Centralized error handling with sanitized error messages
- **Logging** - Structured logging with request ID tracking
- **Authentication** - Clerk-based authentication
- **Authorization** - Role-based access control (admin/user)

## Project Structure

```
nubian-auth/
├── src/
│   ├── controllers/      # Request handlers
│   ├── models/           # Mongoose models
│   ├── routes/           # Express routes
│   ├── middleware/       # Custom middleware
│   │   ├── auth.middleware.js
│   │   ├── errorHandler.middleware.js
│   │   └── logger.middleware.js
│   ├── lib/              # Utilities
│   │   ├── db.js         # Database connection
│   │   ├── logger.js     # Winston logger
│   │   └── envValidator.js
│   ├── webhooks/         # Webhook handlers
│   └── index.js          # Application entry point
├── logs/                 # Log files (created at runtime)
└── ...
```

## Logging

The application uses Winston for structured logging. Logs are written to:
- Console (development)
- `logs/error.log` (error level logs)
- `logs/combined.log` (all logs)

Each request is assigned a unique request ID for correlation.

## Database

The application uses MongoDB with Mongoose. Connection pooling and retry logic are configured for reliability.

### Indexes

The following indexes are configured for optimal query performance:
- User: `clerkId` (unique), `emailAddress`
- Product: `category`, `isActive`, text search
- Order: `user`, `status`, `orderDate`, `orderNumber` (unique)
- Cart: `user` (unique)
- Review: `product`, `user`, `createdAt`

## Error Handling

Errors are handled centrally through the error handler middleware. Error messages are sanitized in production to prevent information disclosure.

## Environment Variables

All required environment variables are validated on startup. Missing variables will cause the application to exit with an error message.

## Development

The application uses:
- **nodemon** for auto-reload in development
- **ES Modules** (ESM) instead of CommonJS
- **Express 5** with async/await support

## Deployment

### Docker (Recommended)

```bash
docker build -t nubian-api .
docker run -p 5000:5000 --env-file .env nubian-api
```

### Manual Deployment

1. Set environment variables on your hosting platform
2. Build and run: `npm start`
3. Ensure MongoDB is accessible
4. Configure CORS origins for your frontend domain

## Monitoring

- Health check: `GET /health`
- Readiness check: `GET /ready`
- Logs are written to files and console
- Request ID tracking for debugging

## License

ISC

## Support

For issues and questions, please contact the development team.

