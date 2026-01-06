# Clerk Backend Configuration Check

## Current Setup

The backend uses `@clerk/express` which should automatically read `CLERK_SECRET_KEY` from environment variables. However, there are a few things to verify:

## Required Environment Variables

### Backend (nubian-auth)
- ✅ `CLERK_SECRET_KEY` - Secret key (starts with `sk_test_` or `sk_live_`)
- ✅ `CLERK_WEBHOOK_SECRET` - Webhook secret (starts with `whsec_`)

### Frontend (nubian-dashboard)
- ✅ `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Publishable key (starts with `pk_test_` or `pk_live_`)

## Important: Key Matching

**CRITICAL**: The frontend publishable key and backend secret key must be from the **same Clerk application**:

- Frontend: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...`
- Backend: `CLERK_SECRET_KEY=sk_live_...`

Both should be:
- Either both `test` keys (for development)
- Or both `live` keys (for production)

## Verification Steps

### 1. Check Backend Environment Variables

In your backend deployment (Render/other platform), verify:
```bash
# These should be set
CLERK_SECRET_KEY=sk_live_... (or sk_test_...)
CLERK_WEBHOOK_SECRET=whsec_...
```

### 2. Check Frontend Environment Variables

In your frontend deployment, verify:
```bash
# This MUST be set at BUILD TIME
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_... (or pk_test_...)
```

### 3. Verify Keys Match

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Select your application
3. Go to **API Keys**
4. Verify:
   - **Publishable Key** matches `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in frontend
   - **Secret Key** matches `CLERK_SECRET_KEY` in backend

## Common Issues

### Issue 1: Keys Don't Match

**Symptom**: Frontend can authenticate but backend rejects tokens

**Solution**: 
- Ensure both keys are from the same Clerk application
- Check that you're using production keys in production, test keys in development

### Issue 2: Backend Can't Verify Tokens

**Symptom**: Backend returns 401 Unauthorized even with valid tokens

**Possible Causes**:
1. `CLERK_SECRET_KEY` not set in backend environment
2. Wrong secret key (from different application)
3. Backend not reading environment variables correctly

**Solution**:
- Check backend logs for Clerk initialization errors
- Verify `CLERK_SECRET_KEY` is set in production
- Restart backend after setting environment variables

### Issue 3: Webhooks Not Working

**Symptom**: User creation/updates not syncing to database

**Possible Causes**:
1. `CLERK_WEBHOOK_SECRET` not set or incorrect
2. Webhook URL not configured in Clerk Dashboard
3. Webhook endpoint not accessible from Clerk's servers

**Solution**:
- Verify webhook secret in Clerk Dashboard → Webhooks
- Check webhook endpoint is publicly accessible
- Verify webhook URL in Clerk Dashboard matches your backend URL

## Backend Clerk Initialization

The backend uses `@clerk/express` which automatically initializes with `CLERK_SECRET_KEY` from environment variables. No explicit initialization needed.

However, if you're seeing issues, you can verify initialization by checking:

1. **Backend logs** - Should show successful startup
2. **Environment validation** - Should pass on startup
3. **API requests** - Should authenticate properly

## Testing Backend Clerk Connection

### Test 1: Health Check
```bash
curl https://your-backend-url/health
```

### Test 2: Authenticated Request
```bash
# Get token from frontend after login
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://your-backend-url/api/users/me
```

### Test 3: Check Backend Logs
Look for:
- ✅ "Environment variables validated successfully"
- ✅ "Server started on port..."
- ❌ Any Clerk-related errors

## Frontend-Backend Integration

The frontend sends authentication tokens in the `Authorization` header:
```
Authorization: Bearer <clerk_session_token>
```

The backend's `clerkMiddleware` automatically:
1. Validates the token
2. Extracts user information
3. Makes it available via `req.auth`

## Troubleshooting Checklist

- [ ] Backend `CLERK_SECRET_KEY` is set and correct
- [ ] Frontend `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set at build time
- [ ] Both keys are from the same Clerk application
- [ ] Both keys are same type (test/test or live/live)
- [ ] Backend environment variables are set in production
- [ ] Frontend environment variable is set before build
- [ ] Webhook secret is configured if using webhooks
- [ ] CORS is configured to allow frontend domain
- [ ] Backend logs show successful startup
- [ ] No Clerk errors in backend logs

## Next Steps

If frontend Clerk SDK is not loading:
1. Check frontend environment variable is set at build time
2. Check browser console for specific errors
3. Check Network tab for failed Clerk requests
4. Verify CSP headers allow Clerk domains

If backend authentication fails:
1. Check backend `CLERK_SECRET_KEY` is set
2. Verify keys match between frontend and backend
3. Check backend logs for Clerk errors
4. Test with a known valid token

