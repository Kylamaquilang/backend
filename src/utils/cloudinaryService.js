import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Check if Cloudinary is configured
 */
export const isCloudinaryConfigured = () => {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
};

/**
 * Upload image to Cloudinary
 * @param {string} filePath - Local file path
 * @param {string} folder - Cloudinary folder name (e.g., 'products', 'profiles')
 * @returns {Promise<{url: string, public_id: string}>}
 */
export const uploadToCloudinary = async (filePath, folder = 'products') => {
  try {
    if (!isCloudinaryConfigured()) {
      throw new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file');
    }

    const result = await cloudinary.uploader.upload(filePath, {
      folder: `capstone/${folder}`,
      resource_type: 'auto',
      transformation: [
        { width: 1000, height: 1000, crop: 'limit' }, // Limit max size
        { quality: 'auto' }, // Auto quality optimization
        { fetch_format: 'auto' } // Auto format conversion
      ]
    });

    return {
      url: result.secure_url,
      public_id: result.public_id
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error(`Failed to upload image to Cloudinary: ${error.message}`);
  }
};

/**
 * Delete image from Cloudinary
 * @param {string} publicId - Cloudinary public_id
 * @returns {Promise<void>}
 */
export const deleteFromCloudinary = async (publicId) => {
  try {
    if (!isCloudinaryConfigured()) {
      console.warn('Cloudinary is not configured. Skipping deletion.');
      return;
    }

    await cloudinary.uploader.destroy(publicId);
    console.log(`✅ Deleted image from Cloudinary: ${publicId}`);
  } catch (error) {
    console.error('Cloudinary deletion error:', error);
    // Don't throw error on deletion failure, just log it
  }
};

/**
 * Upload buffer to Cloudinary (for direct uploads without saving to disk)
 * @param {Buffer} buffer - Image buffer
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<{url: string, public_id: string}>}
 */
export const uploadBufferToCloudinary = async (buffer, folder = 'products') => {
  try {
    if (!isCloudinaryConfigured()) {
      throw new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file');
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `capstone/${folder}`,
          resource_type: 'auto',
          transformation: [
            { width: 1000, height: 1000, crop: 'limit' },
            { quality: 'auto' },
            { fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve({
              url: result.secure_url,
              public_id: result.public_id
            });
          }
        }
      );

      uploadStream.end(buffer);
    });
  } catch (error) {
    console.error('Cloudinary buffer upload error:', error);
    throw new Error(`Failed to upload image to Cloudinary: ${error.message}`);
  }
};

export default cloudinary;





