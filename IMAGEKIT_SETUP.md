# ImageKit Setup for Payment Proof Uploads

## Overview
This document explains how to configure ImageKit for payment proof image uploads in the Nubian mobile app.

## Backend Configuration

### Environment Variables
Add the following environment variables to your `.env` file:

```env
# ImageKit Configuration
IMAGEKIT_PRIVATE_KEY=your_private_key_here
IMAGEKIT_PUBLIC_KEY=your_public_key_here
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your_imagekit_id
```

### Getting Your ImageKit Credentials

1. Log in to your [ImageKit Dashboard](https://imagekit.io/dashboard)
2. Go to **Settings** → **API Keys**
3. Copy the following:
   - **Public Key** → Use for `IMAGEKIT_PUBLIC_KEY`
   - **Private Key** → Use for `IMAGEKIT_PRIVATE_KEY`
4. Go to **Settings** → **URL Endpoint**
5. Copy your URL Endpoint → Use for `IMAGEKIT_URL_ENDPOINT`

### API Endpoint

The backend provides an authenticated endpoint for getting ImageKit upload credentials:

**GET** `/api/upload/imagekit-auth`

**Authentication:** Required (Bearer token)

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "random-token",
    "expire": 1234567890,
    "signature": "hmac-signature",
    "publicKey": "your_public_key",
    "urlEndpoint": "https://ik.imagekit.io/your_id"
  }
}
```

## Mobile App Implementation

### How It Works

1. **User selects payment proof image** → Uses `expo-image-picker`
2. **Image is uploaded to ImageKit** → Before order creation
3. **ImageKit URL is saved** → Stored in order's `transferProof` field
4. **Dashboard displays image** → Shows ImageKit URL

### Upload Flow

```typescript
// 1. User selects image
const result = await ImagePicker.launchImageLibraryAsync({...});
const imageUri = result.assets[0].uri;

// 2. Upload to ImageKit
const imageUrl = await uploadImageToImageKit(imageUri);

// 3. Create order with ImageKit URL
const order = await createOrder({
  ...orderData,
  transferProof: imageUrl
});
```

## Dashboard Display

Payment proof images are displayed in:
- **Order Details Dialog** (`/business/orders`) - Shows full-size image
- **Order Table** - Can be extended to show thumbnail

## Security Notes

- ✅ Private key is **never** exposed to client
- ✅ Upload authentication is **server-side only**
- ✅ Each upload requires **user authentication**
- ✅ Images are stored in `/payment-proofs/` folder
- ✅ Unique file names prevent overwrites

## Troubleshooting

### Error: "ImageKit configuration missing"
- Check that all environment variables are set
- Verify variable names match exactly (case-sensitive)
- Restart backend server after adding variables

### Error: "Failed to upload image"
- Check ImageKit account is active
- Verify API keys have upload permissions
- Check network connectivity
- Review ImageKit dashboard for upload errors

### Images not displaying in dashboard
- Verify `transferProof` field is included in order queries
- Check ImageKit URL is valid and accessible
- Ensure CORS is configured for ImageKit domain

## References

- [ImageKit API Documentation](https://imagekit.io/docs/api-keys)
- [ImageKit Upload API](https://imagekit.io/docs/api-reference/upload-file/upload-file)
