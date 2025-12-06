import express from 'express'
import { autoConfirmClaimedOrders, getAutoConfirmStats } from '../controllers/auto-confirm.controller.js'
import { verifyToken } from '../middleware/verifyToken.js'

const router = express.Router()

// Manual trigger for auto-confirmation (admin only)
router.post('/trigger', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    console.log('🔄 Manual auto-confirmation triggered by admin:', req.user.name)
    const io = req.app.get('io');
    await autoConfirmClaimedOrders(io);
    
    res.json({ 
      success: true, 
      message: 'Auto-confirmation process completed successfully' 
    })
  } catch (error) {
    console.error('Error in manual auto-confirmation:', error)
    res.status(500).json({ 
      error: 'Failed to run auto-confirmation process',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

// Get statistics about orders that will be auto-confirmed
router.get('/stats', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const stats = await getAutoConfirmStats()
    res.json({ success: true, data: stats })
  } catch (error) {
    console.error('Error getting auto-confirm stats:', error)
    res.status(500).json({ 
      error: 'Failed to get auto-confirmation statistics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

export default router
