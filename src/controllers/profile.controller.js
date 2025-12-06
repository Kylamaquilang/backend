import { pool } from '../database/db.js'

// 👤 Get current user's profile
export const getProfile = async (req, res) => {
  const userId = req.user.id

  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, student_id, role, contact_number FROM users WHERE id = ?',
      [userId]
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json(rows[0])
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ✏️ Update profile info (without address)
export const updateProfile = async (req, res) => {
  const userId = req.user.id
  const { name, email, contact_number } = req.body

  try {
    const [result] = await pool.query(
      `UPDATE users
       SET name = ?, email = ?, contact_number = ?
       WHERE id = ?`,
      [name, email, contact_number, userId]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found or nothing to update' })
    }

    res.json({ message: 'Profile updated successfully' })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
