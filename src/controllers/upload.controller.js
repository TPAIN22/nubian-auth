import { getAuth } from '@clerk/express';
import { sendSuccess, sendError, sendUnauthorized } from '../lib/response.js';
import logger from '../lib/logger.js';
import crypto from 'crypto';

/**
 * Generate ImageKit upload authentication parameters
 * Based on ImageKit documentation: https://imagekit.io/docs/api-keys
 */
export const getImageKitAuth = async (req, res) => {
  const { userId } = getAuth(req);
  const requestId = req.requestId;

  if (!userId) {
    return sendUnauthorized(res, 'Authentication required', requestId);
  }

  try {
    // Get ImageKit configuration from environment variables
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
    const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;

    // Validate configuration
    if (!privateKey || !publicKey) {
      logger.error('ImageKit configuration missing', {
        requestId,
        hasPrivateKey: !!privateKey,
        hasPublicKey: !!publicKey,
        hasUrlEndpoint: !!urlEndpoint,
      });

      return sendError(
        res,
        {
          message: 'ImageKit configuration missing',
          details: 'Please configure IMAGEKIT_PRIVATE_KEY and IMAGEKIT_PUBLIC_KEY environment variables',
        },
        500,
        requestId
      );
    }

    // Generate authentication parameters
    // Token: Random string for request uniqueness
    const token = crypto.randomBytes(16).toString('hex');
    
    // Expire: Unix timestamp (seconds) - 1 hour from now
    const expire = Math.floor(Date.now() / 1000) + 60 * 60;
    
    // Signature: HMAC SHA-1 hash of (token + expire) using private key
    const signatureString = `${token}${expire}`;
    const signature = crypto
      .createHmac('sha1', privateKey)
      .update(signatureString)
      .digest('hex');

    logger.info('ImageKit auth parameters generated', {
      requestId,
      userId,
      hasUrlEndpoint: !!urlEndpoint,
    });

    return sendSuccess(
      res,
      {
        token,
        expire,
        signature,
        publicKey,
        urlEndpoint: urlEndpoint || undefined,
      },
      200,
      requestId
    );
  } catch (error) {
    logger.error('Error generating ImageKit auth', {
      requestId,
      userId,
      error: error.message,
      stack: error.stack,
    });

    return sendError(
      res,
      {
        message: 'Failed to generate upload authentication',
        details: error.message,
      },
      500,
      requestId
    );
  }
};
