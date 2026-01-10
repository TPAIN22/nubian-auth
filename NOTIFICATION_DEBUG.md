# Notification Debugging Guide

## Issue: Notifications Not Reaching Mobile App

### Quick Test Endpoint

1. **Test notification endpoint**: `POST /api/notifications/test`
   - Requires authentication (logged in user)
   - Returns debug information about tokens and notification status
   - Automatically sends a test notification to the current user

### Common Issues and Solutions

#### 1. Push Tokens Not Linked to User

**Problem**: Push tokens are saved without `userId`, so they can't be found when sending notifications.

**Check**:
- Call test endpoint: `POST /api/notifications/test`
- Look at response: `activeTokensCount` should be > 0
- Check `tokens` array: `hasUserId` should be `true` and `matchesRecipient` should be `true`

**Fix**: 
- Ensure app calls `registerPushTokenWithAuth()` when user logs in
- Check that `NotificationProvider` is re-registering tokens after login

#### 2. Preferences Disabled

**Problem**: Push notifications are disabled for the notification type in user preferences.

**Check**:
- Call test endpoint and check logs for: "Notification channel disabled by user preferences"
- Check user preferences: `GET /api/notifications/preferences`

**Fix**:
- Update preferences via mobile app or API
- Test endpoint uses `FLASH_SALE` type which has push enabled by default

#### 3. Expo Push API Errors

**Problem**: Expo API is rejecting push notifications (invalid tokens, API errors).

**Check**:
- Backend logs will show: "Expo push notification error" with error details
- Check Expo token format: Should start with `ExponentPushToken[`

**Fix**:
- Verify Expo project configuration
- Check if tokens are valid Expo push tokens
- Review Expo API response in logs

#### 4. No Active Push Tokens

**Problem**: User has no active push tokens registered.

**Check**:
- Test endpoint returns: `activeTokensCount: 0`
- Check `tokens` array in response
- Verify `isActive: true` and `expiresAt` is in the future

**Fix**:
- Re-register push token from mobile app
- Ensure app requests notification permissions
- Check device is a real device (not simulator)

### Debugging Steps

1. **Check if user has push tokens**:
   ```bash
   POST /api/notifications/test
   ```
   Look for `activeTokensCount` and `tokens` array

2. **Check notification was created**:
   ```bash
   GET /api/notifications?limit=5
   ```
   Should show the test notification

3. **Check notification status**:
   - Status should be `sent` if push notification was sent
   - Status will be `failed` if no tokens found
   - Status will be `pending` if still processing

4. **Check backend logs**:
   - Look for: "Push notification sent successfully"
   - Look for: "No active push tokens found"
   - Look for: "Expo push notification error"
   - Look for: "Notification channel disabled"

5. **Check mobile app**:
   - Verify notification permissions are granted
   - Check Expo push token is being registered
   - Verify app is running on a real device (not simulator)

### Backend Logs to Monitor

- `Push token saved` - Token registration
- `Fetching push tokens for user` - Token lookup
- `Found push tokens for broadcast` - Token query results
- `Sending push notification chunk to Expo` - Expo API calls
- `Expo push notification error` - Expo API errors
- `Push notification sent successfully` - Success confirmation
- `No active push tokens found` - Token lookup failed

### Mobile App Checklist

- [ ] Notification permissions granted
- [ ] Push token registered after login
- [ ] `NotificationProvider` calls `registerPushTokenWithAuth` when user logs in
- [ ] App is running on a real device (iOS/Android)
- [ ] Expo project ID is configured correctly
- [ ] Network connection is available

### API Test Commands

**Send test notification**:
```bash
curl -X POST https://nubian-lne4.onrender.com/api/notifications/test \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Check preferences**:
```bash
curl -X GET https://nubian-lne4.onrender.com/api/notifications/preferences \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Get notifications**:
```bash
curl -X GET https://nubian-lne4.onrender.com/api/notifications \
  -H "Authorization: Bearer YOUR_TOKEN"
```
