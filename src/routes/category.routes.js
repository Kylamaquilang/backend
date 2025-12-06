import express from 'express'
import {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory
} from '../controllers/category.controller.js'
import { verifyToken, isAdmin } from '../middleware/verifyToken.js'

const router = express.Router()

router.post('/', verifyToken, isAdmin, createCategory)
router.get('/', getCategories)
router.put('/:id', verifyToken, isAdmin, updateCategory)
router.delete('/:id', verifyToken, isAdmin, deleteCategory)

export default router
