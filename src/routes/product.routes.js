import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { pool } from '../database/db.js'
import {
  createProduct,
  getAllProducts,
  getAllProductsSimple,
  getProductById,
  getProductByName,
  updateProduct,
  deleteProduct,
  getLowStockProducts,
  getProductStats,
  getInventorySummary,
  updateProductStock,
  getStockMovementHistory,
  getProductSizes
} from '../controllers/product.controller.js'

import { verifyToken, isAdmin } from '../middleware/auth.middleware.js'
import { uploadToCloudinary, isCloudinaryConfigured } from '../utils/cloudinaryService.js'

const router = express.Router()

// Resolve uploads directory relative to this file
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadsDir = path.join(__dirname, '..', '..', 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// Multer storage setup with better file handling
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `product-${uniqueSuffix}${ext}`)
  }
})

// File filter for image validation
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
  const mimetype = allowedTypes.test(file.mimetype)
  
  if (mimetype && extname) {
    return cb(null, true)
  } else {
    cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed!'), false)
  }
}

const upload = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1 // Only one file at a time
  }
})

// ✅ Public read routes first
router.get('/', getAllProductsSimple) // Simple version for frontend
router.get('/detailed', getAllProducts) // Detailed version with pagination

// Debug endpoint to check image data
router.get('/debug-images', async (req, res) => {
  try {
    const [products] = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.image,
        c.name as category
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC
      LIMIT 5
    `);
    
    res.json({
      message: 'Image debug data',
      products: products.map(p => ({
        id: p.id,
        name: p.name,
        raw_image: p.image,
        image_url: p.image, // Return raw filename
        category: p.category
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for serving images
router.get('/proxy-image', (req, res) => {
  try {
    const { path: imagePath } = req.query;
    
    if (!imagePath) {
      return res.status(400).json({ error: 'Image path is required' });
    }
    
    // Security check - only allow paths that start with /uploads/
    if (!imagePath.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Invalid image path' });
    }
    
    // Construct full file path
    const fullPath = path.join(__dirname, '..', '..', imagePath);
    
    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Set appropriate headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    // Stream the file
    const fileStream = fs.createReadStream(fullPath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Proxy image error:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});
router.get('/stats', verifyToken, isAdmin, getProductStats)
router.get('/low-stock', verifyToken, isAdmin, getLowStockProducts)
router.get('/name/:name', getProductByName) // Get product by name
router.get('/:id/sizes', getProductSizes) // Get product sizes (must be before /:id route)
router.get('/:id', getProductById) // Get product by ID (must be last to avoid conflicts)

// ✅ Admin-only below
router.post('/', verifyToken, isAdmin, createProduct)
router.post('/upload-image', verifyToken, isAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        message: 'Please select an image file to upload'
      })
    }

    // Validate file size (additional check)
    if (req.file.size > 5 * 1024 * 1024) {
      // Delete the uploaded file if it's too large
      fs.unlinkSync(req.file.path)
      return res.status(400).json({ 
        error: 'File too large',
        message: 'Image size must be less than 5MB'
      })
    }

    let publicUrl = `/uploads/${req.file.filename}`
    let cloudinaryPublicId = null;

    // Try to upload to Cloudinary if configured
    if (isCloudinaryConfigured()) {
      try {
        console.log('☁️ Uploading image to Cloudinary...');
        const cloudinaryResult = await uploadToCloudinary(req.file.path, 'products');
        publicUrl = cloudinaryResult.url;
        cloudinaryPublicId = cloudinaryResult.public_id;
        
        // Delete the local file after successful Cloudinary upload
        fs.unlinkSync(req.file.path);
        console.log(`✅ Image uploaded to Cloudinary: ${cloudinaryPublicId}`);
      } catch (cloudinaryError) {
        console.error('⚠️ Cloudinary upload failed, falling back to local storage:', cloudinaryError.message);
        // Keep using local file path as fallback
      }
    } else {
      console.log('ℹ️ Cloudinary not configured, using local storage');
    }
    
    res.status(201).json({ 
      success: true,
      url: publicUrl,
      filename: req.file.filename,
      size: req.file.size,
      cloudinary_public_id: cloudinaryPublicId,
      storage: cloudinaryPublicId ? 'cloudinary' : 'local',
      message: 'Image uploaded successfully'
    })
  } catch (error) {
    console.error('❌ Image upload error:', error)
    
    // Clean up file if it was uploaded but error occurred
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'File too large',
        message: 'Image size must be less than 5MB'
      })
    }
    
    if (error.message.includes('Only image files')) {
      return res.status(400).json({ 
        error: 'Invalid file type',
        message: 'Only image files (JPEG, PNG, GIF, WebP) are allowed'
      })
    }
    
    res.status(500).json({ 
      error: 'Upload failed',
      message: 'Failed to upload image. Please try again.'
    })
  }
})
router.put('/:id', verifyToken, isAdmin, updateProduct)
router.delete('/:id', verifyToken, isAdmin, deleteProduct)

// Inventory management routes
router.get('/inventory/summary', verifyToken, isAdmin, getInventorySummary)
router.put('/:id/stock', verifyToken, isAdmin, updateProductStock)
router.get('/inventory/movements', verifyToken, isAdmin, getStockMovementHistory)

export default router
