import multer from 'multer';
import logger from '../../lib/logger.js';

/**
 * Allowed file types for uploads
 */
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 10;

/**
 * File filter for image uploads
 */
const imageFileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const requestId = req.requestId || 'unknown';
    logger.warn('Invalid file type attempted', {
      requestId,
      mimetype: file.mimetype,
      filename: file.originalname,
    });
    cb(new Error(`Invalid file type. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`), false);
  }
};

/**
 * Multer configuration for image uploads
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(), // Store in memory for processing
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
  fileFilter: imageFileFilter,
});

/**
 * Middleware to validate uploaded files
 */
export const validateFileUpload = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'No files uploaded',
      },
    });
  }

  // Check file count
  if (req.files.length > MAX_FILES) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Maximum ${MAX_FILES} files allowed`,
      },
    });
  }

  // Validate each file
  for (const file of req.files) {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `File ${file.originalname} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        },
      });
    }

    // Check MIME type (additional validation)
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `File ${file.originalname} has invalid type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`,
        },
      });
    }
  }

  next();
};

/**
 * Export constants for use in other validators
 */
export const FILE_UPLOAD_CONSTRAINTS = {
  MAX_FILE_SIZE,
  MAX_FILES,
  ALLOWED_IMAGE_TYPES,
};

