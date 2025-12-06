import { pool } from '../database/db.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import { emitDataRefresh, emitAdminDataRefresh } from '../utils/socket-helper.js';

// ✅ Get all users with status management
export const getAllUsersWithStatus = async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT 
        u.id, 
        u.student_id, 
        u.name, 
        u.email, 
        u.first_name,
        u.last_name,
        u.middle_name,
        u.suffix,
        u.degree,
        u.year_level,
        u.section,
        u.status,
        u.role,
        u.is_active,
        u.profile_image,
        u.created_at,
        u.contact_number,
        COALESCE((SELECT COUNT(*) FROM degree_shifts WHERE user_id = u.id), 0) as shift_count,
        (SELECT previous_degree FROM degree_shifts WHERE user_id = u.id ORDER BY shift_date DESC LIMIT 1) as previous_degree
       FROM users u
       WHERE u.is_active = 1
       ORDER BY u.created_at DESC`
    );

    res.json({ users });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Get users error:', error.message);
    }
    // If degree_shifts table doesn't exist yet, fall back to basic query
    if (error.code === 'ER_NO_SUCH_TABLE' || error.message.includes('degree_shifts')) {
      if (process.env.NODE_ENV === 'development') {
        console.log('⚠️  degree_shifts table not found, using basic query. Run migration to enable shift tracking.');
      }
      const [users] = await pool.query(
        `SELECT 
          id, 
          student_id, 
          name, 
          email, 
          first_name,
          last_name,
          middle_name,
          suffix,
          degree,
          year_level,
          section,
          status,
          role,
          is_active,
          profile_image,
          created_at,
          contact_number,
          0 as shift_count,
          NULL as previous_degree
         FROM users 
         WHERE is_active = 1
         ORDER BY created_at DESC`
      );
      return res.json({ users });
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Toggle user status (active/inactive)
export const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean value' });
    }

    // Check if user exists
    const [users] = await pool.query('SELECT id, name, role FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Prevent admin from deactivating themselves
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    // Update user status
    await pool.query(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [is_active, userId]
    );

    res.status(200).json({ 
      message: `User ${user.name} ${is_active ? 'activated' : 'deactivated'} successfully`,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        is_active: is_active
      }
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Toggle user status error:', error.message);
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Update user profile image
export const updateUserProfileImage = async (req, res) => {
  try {
    // Defensive check for req.user
    if (!req.user) {
      if (process.env.NODE_ENV === 'development') {
        console.log('❌ updateUserProfileImage - req.user is undefined');
      }
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { id } = req.user;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    // Update user profile image
    await pool.query(
      'UPDATE users SET profile_image = ? WHERE id = ?',
      [imageUrl, id]
    );

    res.status(200).json({ 
      message: 'Profile image updated successfully',
      profile_image: imageUrl
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Update profile image error:', error.message);
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Get user profile
export const getUserProfile = async (req, res) => {
  try {
    // Defensive check for req.user
    if (!req.user) {
      if (process.env.NODE_ENV === 'development') {
        console.log('❌ getUserProfile - req.user is undefined');
      }
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { id } = req.user;

    const [users] = await pool.query(
      `SELECT 
        id, 
        student_id, 
        name, 
        email, 
        first_name,
        last_name,
        middle_name,
        suffix,
        degree,
        status,
        role,
        is_active,
        profile_image,
        contact_number,
        created_at
       FROM users 
       WHERE id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: users[0] });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Get user profile error:', error.message);
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Update user profile
export const updateUserProfile = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Profile update request:', { user: req.user, body: req.body });
    }
    
    // Defensive check for req.user
    if (!req.user) {
      console.log('❌ updateUserProfile - req.user is undefined');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { id } = req.user;
    const { name, contact_number, email } = req.body;

    if (!name && !contact_number && !email) {
      return res.status(400).json({ error: 'At least one field must be provided' });
    }

    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name.trim());
    }

    if (contact_number !== undefined) {
      updateFields.push('contact_number = ?');
      updateValues.push(contact_number?.trim() || null);
    }

    if (email !== undefined) {
      // Check if email is already taken by another user
      const [existingUsers] = await pool.query(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email.trim(), id]
      );
      
      if (existingUsers.length > 0) {
        return res.status(409).json({ error: 'Email is already taken by another user' });
      }
      
      updateFields.push('email = ?');
      updateValues.push(email.trim());
    }

    updateValues.push(id);

    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Update profile error:', error.message);
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Admin update user (for admin panel)
export const updateUser = async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { id } = req.params;
    const { name, email, student_id, year_level, section, degree, status } = req.body;

    if (!name && !email && !student_id && !year_level && !section && !degree && !status) {
      await connection.rollback();
      return res.status(400).json({ error: 'At least one field must be provided' });
    }

    // Fetch current user data once at the beginning (optimization)
    const [currentUserData] = await connection.query(
      'SELECT degree, year_level, section FROM users WHERE id = ?',
      [id]
    );

    if (currentUserData.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    const currentDegree = currentUserData[0].degree;
    const currentYearLevel = currentUserData[0].year_level;
    const currentSection = currentUserData[0].section;

    const updateFields = [];
    const updateValues = [];

    // Handle name update
    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name?.trim() || null);
    }

    // Handle email update
    if (email !== undefined) {
      // Validate email format and empty strings
      const trimmedEmail = email?.trim();
      if (trimmedEmail === '') {
        await connection.rollback();
        return res.status(400).json({ error: 'Email cannot be empty' });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (trimmedEmail && !emailRegex.test(trimmedEmail)) {
        await connection.rollback();
        return res.status(400).json({ error: 'Invalid email format' });
      }

      // Check if email is already taken by another user
      if (trimmedEmail) {
        const [existing] = await connection.query(
          'SELECT id FROM users WHERE email = ? AND id != ?',
          [trimmedEmail, id]
        );
        if (existing.length > 0) {
          await connection.rollback();
          return res.status(409).json({ error: 'Email already taken' });
        }
      }

      updateFields.push('email = ?');
      updateValues.push(trimmedEmail || null);
    }

    // Handle student_id update
    if (student_id !== undefined) {
      // Validate empty strings
      const trimmedStudentId = student_id?.trim();
      
      // Check if student_id is already taken by another user
      if (trimmedStudentId) {
        const [existing] = await connection.query(
          'SELECT id FROM users WHERE student_id = ? AND id != ?',
          [trimmedStudentId, id]
        );
        if (existing.length > 0) {
          await connection.rollback();
          return res.status(409).json({ error: 'Student ID already taken' });
        }
      }

      updateFields.push('student_id = ?');
      updateValues.push(trimmedStudentId || null);
    }

    if (year_level !== undefined) {
      // Validate year level and empty strings
      const trimmedYearLevel = year_level?.trim();
      if (trimmedYearLevel === '') {
        await connection.rollback();
        return res.status(400).json({ error: 'Year level cannot be empty' });
      }
      
      const validYearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
      if (trimmedYearLevel && !validYearLevels.includes(trimmedYearLevel)) {
        await connection.rollback();
        return res.status(400).json({ 
          error: 'Invalid year level. Must be one of: 1st Year, 2nd Year, 3rd Year, 4th Year' 
        });
      }

      // Prevent downgrading from 4th Year to lower year unless shifting degree
      const newDegree = (degree !== undefined && degree?.trim()) ? degree.trim() : currentDegree;
      
      if (currentYearLevel === '4th Year' && trimmedYearLevel && trimmedYearLevel !== '4th Year') {
        const yearLevelOrder = { '1st Year': 1, '2nd Year': 2, '3rd Year': 3, '4th Year': 4 };
        const currentOrder = yearLevelOrder[currentYearLevel];
        const newOrder = yearLevelOrder[trimmedYearLevel];

        // If trying to downgrade (new year is lower than current)
        if (newOrder < currentOrder) {
          // Check if degree is also being changed (program shift) - validate empty strings
          const isShiftingDegree = (degree !== undefined && degree?.trim() && currentDegree && degree.trim() !== currentDegree);
          
          if (!isShiftingDegree) {
            await connection.rollback();
            return res.status(400).json({ 
              error: 'Cannot downgrade from 4th Year to a lower year level. Students can only go back to lower years when shifting to a different degree program.' 
            });
          }
        }
      }

      updateFields.push('year_level = ?');
      updateValues.push(trimmedYearLevel || null);
    }

    if (section !== undefined) {
      updateFields.push('section = ?');
      updateValues.push(section?.trim() || null);
    }

    if (degree !== undefined) {
      // Validate degree and empty strings
      const trimmedDegree = degree?.trim();
      if (trimmedDegree === '') {
        await connection.rollback();
        return res.status(400).json({ error: 'Degree cannot be empty' });
      }
      
      const validDegrees = ['BEED', 'BSED', 'BSIT', 'BSHM'];
      if (trimmedDegree && !validDegrees.includes(trimmedDegree)) {
        await connection.rollback();
        return res.status(400).json({ 
          error: 'Invalid degree. Must be one of: BEED, BSED, BSIT, BSHM' 
        });
      }
      
      // If degree is changing, log the shift
      if (currentDegree && trimmedDegree && currentDegree !== trimmedDegree) {
        const adminId = req.user?.id || null;
        
        try {
          await connection.query(
            `INSERT INTO degree_shifts 
             (user_id, previous_degree, new_degree, previous_year_level, new_year_level, previous_section, new_section, created_by) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              currentDegree,
              trimmedDegree,
              currentYearLevel || null,
              (year_level !== undefined && year_level?.trim()) ? year_level.trim() : currentYearLevel || null,
              currentSection || null,
              (section !== undefined && section?.trim()) ? section.trim() : currentSection || null,
              adminId
            ]
          );
          // Only log in development
          if (process.env.NODE_ENV === 'development') {
            console.log(`📝 Logged degree shift: User ${id} from ${currentDegree} to ${trimmedDegree}`);
          }
        } catch (shiftError) {
          // If table doesn't exist, log warning but don't fail the update
          if (shiftError.code === 'ER_NO_SUCH_TABLE' || shiftError.message.includes('degree_shifts')) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('⚠️  degree_shifts table not found. Degree shift not logged. Run migration to enable shift tracking.');
            }
          } else {
            // Always log errors for degree shift logging failures
            console.error('Error logging degree shift:', shiftError.message);
          }
        }
      }
      
      updateFields.push('degree = ?');
      updateValues.push(trimmedDegree || null);
    }

    if (status !== undefined) {
      // Validate status and empty strings
      const trimmedStatus = status?.trim();
      if (trimmedStatus === '') {
        await connection.rollback();
        return res.status(400).json({ error: 'Status cannot be empty' });
      }
      
      const validStatuses = ['regular', 'irregular'];
      if (trimmedStatus && !validStatuses.includes(trimmedStatus)) {
        await connection.rollback();
        return res.status(400).json({ 
          error: 'Invalid status. Must be one of: regular, irregular' 
        });
      }
      updateFields.push('status = ?');
      updateValues.push(trimmedStatus || null);
    }

    // Only update if there are fields to update
    if (updateFields.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updateValues.push(id);

    await connection.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    await connection.commit();

    // Emit refresh signals
    const io = req.app.get('io');
    if (io) {
      emitDataRefresh(io, 'users', { action: 'updated', userId: id });
      emitAdminDataRefresh(io, 'users', { action: 'updated', userId: id });
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    await connection.rollback();
    if (process.env.NODE_ENV === 'development') {
      console.error('Update user error:', error.message);
    }
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    connection.release();
  }
};

// ✅ Bulk promote students to next year level
export const bulkPromoteYearLevel = async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { fromYearLevel, toYearLevel, degree, section } = req.body;

    // Validate year levels and empty strings
    const trimmedFromYearLevel = fromYearLevel?.trim();
    const trimmedToYearLevel = toYearLevel?.trim();
    
    if (!trimmedFromYearLevel || trimmedFromYearLevel === '') {
      await connection.rollback();
      return res.status(400).json({ 
        error: 'From year level is required' 
      });
    }
    
    if (!trimmedToYearLevel || trimmedToYearLevel === '') {
      await connection.rollback();
      return res.status(400).json({ 
        error: 'To year level is required' 
      });
    }
    
    const validYearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
    if (!validYearLevels.includes(trimmedFromYearLevel)) {
      await connection.rollback();
      return res.status(400).json({ 
        error: 'Invalid from year level. Must be one of: 1st Year, 2nd Year, 3rd Year, 4th Year' 
      });
    }

    if (!validYearLevels.includes(trimmedToYearLevel)) {
      await connection.rollback();
      return res.status(400).json({ 
        error: 'Invalid to year level. Must be one of: 1st Year, 2nd Year, 3rd Year, 4th Year' 
      });
    }

    // Check if trying to bulk downgrade from 4th Year to lower year
    // (Bulk operations should only promote forward, not backward from 4th year)
    if (trimmedFromYearLevel === '4th Year' && trimmedToYearLevel !== '4th Year') {
      const yearLevelOrder = { '1st Year': 1, '2nd Year': 2, '3rd Year': 3, '4th Year': 4 };
      const fromOrder = yearLevelOrder[trimmedFromYearLevel];
      const toOrder = yearLevelOrder[trimmedToYearLevel];

      // If trying to downgrade (to year is lower than from year)
      if (toOrder < fromOrder) {
        await connection.rollback();
        return res.status(200).json({ 
          message: 'Note: Bulk downgrade from 4th Year to a lower year level is not allowed. Students can only go back to lower years when individually shifting to a different degree program through the edit user function.',
          count: 0,
          fromYearLevel: trimmedFromYearLevel,
          toYearLevel: trimmedToYearLevel
        });
      }
    }

    // Build WHERE clause based on filters
    let whereConditions = ['year_level = ?', 'is_active = 1', 'role = "student"'];
    let queryParams = [trimmedFromYearLevel];

    if (degree && degree.trim()) {
      const trimmedDegree = degree.trim();
      // Validate degree
      const validDegrees = ['BEED', 'BSED', 'BSIT', 'BSHM'];
      if (!validDegrees.includes(trimmedDegree)) {
        await connection.rollback();
        return res.status(400).json({ 
          error: 'Invalid degree. Must be one of: BEED, BSED, BSIT, BSHM' 
        });
      }
      whereConditions.push('degree = ?');
      queryParams.push(trimmedDegree);
    }

    if (section && section.trim()) {
      whereConditions.push('section = ?');
      queryParams.push(section.trim());
    }

    // Get count of students to be promoted
    const [countResult] = await connection.query(
      `SELECT COUNT(*) as count FROM users WHERE ${whereConditions.join(' AND ')}`,
      queryParams
    );
    const studentCount = countResult[0].count;

    if (studentCount === 0) {
      await connection.rollback();
      return res.status(200).json({ 
        message: 'No students found matching the criteria',
        count: 0,
        fromYearLevel: trimmedFromYearLevel,
        toYearLevel: trimmedToYearLevel
      });
    }

    // Update year level with explicit error handling
    try {
      const [result] = await connection.query(
        `UPDATE users SET year_level = ? WHERE ${whereConditions.join(' AND ')}`,
        [trimmedToYearLevel, ...queryParams]
      );

      await connection.commit();

      // Emit refresh signals
      const io = req.app.get('io');
      if (io) {
        emitDataRefresh(io, 'users', { action: 'bulk-promoted', count: studentCount });
        emitAdminDataRefresh(io, 'users', { action: 'bulk-promoted', count: studentCount });
      }

      res.json({ 
        message: `Successfully promoted ${studentCount} student(s) from ${trimmedFromYearLevel} to ${trimmedToYearLevel}`,
        count: studentCount,
        fromYearLevel: trimmedFromYearLevel,
        toYearLevel: trimmedToYearLevel
      });
    } catch (updateError) {
      await connection.rollback();
      throw updateError; // Re-throw to be caught by outer catch
    }
  } catch (error) {
    await connection.rollback();
    if (process.env.NODE_ENV === 'development') {
      console.error('Bulk promote error:', error.message);
    }
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    connection.release();
  }
};

// ✅ Get degree shift history for a user
export const getUserDegreeShifts = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [shifts] = await pool.query(
      `SELECT 
        ds.id,
        ds.previous_degree,
        ds.new_degree,
        ds.previous_year_level,
        ds.new_year_level,
        ds.previous_section,
        ds.new_section,
        ds.shift_date,
        ds.notes,
        ds.created_by,
        u.name as created_by_name
       FROM degree_shifts ds
       LEFT JOIN users u ON ds.created_by = u.id
       WHERE ds.user_id = ?
       ORDER BY ds.shift_date DESC`,
      [id]
    );

    res.json({ shifts });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Get degree shifts error:', error.message);
    }
    // If table doesn't exist, return empty array
    if (error.code === 'ER_NO_SUCH_TABLE' || error.message.includes('degree_shifts')) {
      return res.json({ shifts: [] });
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ Delete user (soft delete by setting is_active to false)
export const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user exists
    const [users] = await pool.query('SELECT id, name, role FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Prevent admin from deleting themselves
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // Soft delete by setting is_active to false
    await pool.query(
      'UPDATE users SET is_active = 0 WHERE id = ?',
      [userId]
    );

    // Emit refresh signals
    const io = req.app.get('io');
    if (io) {
      emitDataRefresh(io, 'users', { action: 'deleted', userId });
      emitAdminDataRefresh(io, 'users', { action: 'deleted', userId });
    }

    res.status(200).json({ 
      message: `User ${user.name} deleted successfully`,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        is_active: false
      }
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Delete user error:', error.message);
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

