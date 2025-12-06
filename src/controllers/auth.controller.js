import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../database/db.js';
import { validateEmail, validateStudentId, validatePassword } from '../utils/validation.js';
import { sendPasswordResetEmail, generateVerificationCode, sendWelcomeEmail } from '../utils/emailService.js';
import { transporter } from '../utils/emailService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const DEFAULT_STUDENT_PASSWORD = process.env.DEFAULT_STUDENT_PASSWORD || 'cpc123';

// ⚠️ DEPRECATED: User self-registration is DISABLED
// Users cannot register themselves. Only admins can add users via /students/add endpoint.
// This function is kept for reference but is not exposed via routes.
export const signup = async (req, res) => {
  try {
    const { role, name, student_id, email, password, contact_number } = req.body;

    // Enhanced validation
    if (!role || !name) {
      return res.status(400).json({ 
        error: 'Role and name are required',
        required: ['role', 'name']
      });
    }

    if (role !== 'student' && role !== 'admin') {
      return res.status(400).json({ 
        error: 'Role must be either "student" or "admin"' 
      });
    }

    if (role === 'student' && !student_id) {
      return res.status(400).json({ 
        error: 'Student ID is required for student registration' 
      });
    }

    if (role === 'admin' && !email) {
      return res.status(400).json({ 
        error: 'Email is required for admin registration' 
      });
    }

    // Validate email format if provided
    if (email) {
      try {
        validateEmail(email);
      } catch (validationError) {
        return res.status(400).json({ 
          error: validationError.message 
        });
      }
    }

    // Validate student ID format if provided
    if (student_id) {
      try {
        validateStudentId(student_id);
      } catch (validationError) {
        return res.status(400).json({ 
          error: validationError.message 
        });
      }
    }

    // Generate password if not provided
    const finalPassword = password || (role === 'admin' ? 'admin123' : DEFAULT_STUDENT_PASSWORD);
    
    // Validate password strength
    try {
      validatePassword(finalPassword);
    } catch (validationError) {
      return res.status(400).json({ 
        error: validationError.message 
      });
    }

    const hashedPassword = await bcrypt.hash(finalPassword, SALT_ROUNDS);

    // Check if user already exists
    const checkQuery = role === 'admin'
      ? 'SELECT * FROM users WHERE email = ?'
      : 'SELECT * FROM users WHERE student_id = ?';

    const checkValue = role === 'admin' ? email.trim() : student_id.trim();
    const [existing] = await pool.query(checkQuery, [checkValue]);

    if (existing.length > 0) {
      return res.status(409).json({ 
        error: `${role} already exists with this ${role === 'admin' ? 'email' : 'student ID'}` 
      });
    }

    // Insert new user
    const [result] = await pool.query(
      `INSERT INTO users (student_id, email, name, password, role, contact_number, created_at, is_active, must_change_password) 
       VALUES (?, ?, ?, ?, ?, ?, NOW(), 1, 1)`,
      [
        student_id?.trim() || null,
        email?.trim() || null,
        name.trim(),
        hashedPassword,
        role,
        contact_number?.trim() || null
      ]
    );

    // Send welcome email if user has email and is a student
    if (email && role === 'student') {
      try {
        await sendWelcomeEmail(email.trim(), name.trim(), student_id?.trim(), DEFAULT_STUDENT_PASSWORD);
      } catch (emailError) {
        console.warn('Failed to send welcome email:', emailError.message);
        // Don't fail registration if email fails
      }
    }

    res.status(201).json({ 
      message: `${role} registered successfully`,
      userId: result.insertId,
      role: role
    });
  } catch (error) {
    console.error('Signup error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ SIGNIN for both roles
export const signin = async (req, res) => {
  try {
    const { student_id, email, password } = req.body;

    console.log('🔍 Login attempt:', { student_id, email, hasPassword: !!password });

    // Enhanced validation
    if ((!student_id && !email) || !password) {
      return res.status(400).json({ 
        error: 'Missing credentials',
        required: ['password', 'student_id or email']
      });
    }

    if (password.length < 1) {
      return res.status(400).json({ error: 'Password cannot be empty' });
    }

    // Students must login with student_id; Admins may use email
    let identifier = null;
    let identifierField = null;
    if (student_id) {
      identifier = student_id.trim();
      identifierField = 'student_id';
    } else if (email) {
      identifier = email.trim();
      identifierField = 'email';
    }

    console.log('🔍 Looking for user with:', { identifierField, identifier });

    // Find user
    const [users] = await pool.query(
      `SELECT * FROM users WHERE ${identifierField} = ?`,
      [identifier]
    );

    console.log('🔍 Found users:', users.length);

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    console.log('🔍 User found:', { id: user.id, name: user.name, role: user.role, hasPassword: !!user.password });

    // Prevent students from logging in via email
    if (user.role === 'student' && identifierField === 'email') {
      return res.status(400).json({ error: 'Students must login with student ID' });
    }

    // Check if user is active
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Please contact an administrator.' });
    }

    // Verify password
    console.log('🔍 Verifying password...');
    console.log('🔍 Password details:', { 
      original: `"${password}"`, 
      trimmed: `"${password.trim()}"`, 
      length: password.length,
      trimmedLength: password.trim().length,
      hashStart: user.password.substring(0, 30)
    });
    const isMatch = await bcrypt.compare(password.trim(), user.password);
    console.log('🔍 Password match:', isMatch);
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        role: user.role,
        student_id: user.student_id,
        email: user.email,
        must_change_password: user.must_change_password
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    console.log('✅ Login successful for:', user.name);

    res.status(200).json({ 
      message: 'Login successful', 
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        student_id: user.student_id,
        email: user.email,
        contact_number: user.contact_number,
        must_change_password: user.must_change_password,
        is_active: user.is_active
      }
    });
  } catch (error) {
    console.error('❌ Signin error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ CHANGE PASSWORD
export const changePassword = async (req, res) => {
  const { email, verificationCode, newPassword } = req.body;

  // Enhanced input validation
  if (!email || !verificationCode || !newPassword) {
    return res.status(400).json({ error: 'Email, verification code, and new password are required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate verification code format (should be 6 digits)
  const codeRegex = /^\d{6}$/;
  if (!codeRegex.test(verificationCode)) {
    return res.status(400).json({ error: 'Verification code must be exactly 6 digits' });
  }

  // Enhanced password validation
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  if (newPassword.length > 128) {
    return res.status(400).json({ error: 'Password must be less than 128 characters' });
  }

  try {
    // Get user with additional security checks
    const [users] = await pool.query('SELECT id, name, email, is_active FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found with this email address' });
    }

    const user = users[0];

    // Check if user account is active
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Please contact support.' });
    }

    // Normalize verification code (trim and ensure string)
    const normalizedCode = String(verificationCode).trim();

    // Check if verification code is valid and verified
    // Compare code as string to ensure type consistency
    const [codes] = await pool.query(`
      SELECT * FROM password_reset_codes 
      WHERE user_id = ? AND CAST(code AS CHAR) = ? AND expires_at > NOW() AND verified = 1
      ORDER BY created_at DESC LIMIT 1
    `, [user.id, normalizedCode]);

    if (codes.length === 0) {
      // Check if code exists but is not verified
      const [unverifiedCodes] = await pool.query(`
        SELECT * FROM password_reset_codes 
        WHERE user_id = ? AND CAST(code AS CHAR) = ? AND expires_at > NOW() AND verified = 0
        ORDER BY created_at DESC LIMIT 1
      `, [user.id, normalizedCode]);

      if (unverifiedCodes.length > 0) {
        return res.status(400).json({ error: 'Verification code has not been verified. Please verify the code first.' });
      }

      // Check if code exists but is expired
      const [expiredCodes] = await pool.query(`
        SELECT * FROM password_reset_codes 
        WHERE user_id = ? AND CAST(code AS CHAR) = ? AND expires_at <= NOW()
        ORDER BY created_at DESC LIMIT 1
      `, [user.id, normalizedCode]);

      if (expiredCodes.length > 0) {
        return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
      } else {
        return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
      }
    }

    const validCode = codes[0];

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Start transaction for atomic password update
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Update password
      await connection.query('UPDATE users SET password = ?, must_change_password = 0, updated_at = NOW() WHERE id = ?', [hashedPassword, user.id]);

      // Delete the used verification code and any other codes for this user
      await connection.query('DELETE FROM password_reset_codes WHERE user_id = ?', [user.id]);

      await connection.commit();
      connection.release();

      // Send confirmation email
      const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Changed Successfully - ESSEN Store',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #000C50 0%, #1e40af 100%); color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">ESSEN Store</h1>
            <p style="margin: 10px 0 0 0;">Password Update Confirmation</p>
          </div>
          
          <div style="padding: 30px 20px; background: #f8f9fa;">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name},</h2>
            
            <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 5px; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #155724;">
                ✅ Your password has been successfully changed.
              </p>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              Your account password was updated on ${new Date().toLocaleString()}. If you did not make this change, please contact our support team immediately.
            </p>
            
            <div style="background: #e8f4fd; border-left: 4px solid #000C50; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #333;">
                <strong>Security Reminder:</strong> Keep your password secure and never share it with anyone. Consider using a strong, unique password for your account.
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/auth/login" 
                 style="background: #000C50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Login to Your Account
              </a>
            </div>
          </div>
          
          <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 14px;">
            <p style="margin: 0;">© 2024 ESSEN Store. All rights reserved.</p>
            <p style="margin: 5px 0 0 0;">"Equip yourself for success, find everything you need to thrive in school"</p>
          </div>
        </div>
      `
    };

      await transporter.sendMail(mailOptions);

      res.status(200).json({ 
        message: 'Password changed successfully',
        user: { id: user.id, name: user.name, email }
      });

    } catch (transactionError) {
      await connection.rollback();
      connection.release();
      throw transactionError;
    }

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
};

// ✅ LOGOUT — client handles token removal
export const logout = async (req, res) => {
  try {
    // In a production environment, you might want to blacklist the token
    // For now, we'll just return success and let the client handle it
    res.status(200).json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ REFRESH TOKEN
export const refreshToken = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Generate new token
      const newToken = jwt.sign(
        {
          id: decoded.id,
          name: decoded.name,
          role: decoded.role,
          student_id: decoded.student_id,
          email: decoded.email,
          must_change_password: decoded.must_change_password
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.status(200).json({ 
        message: 'Token refreshed successfully', 
        token: newToken 
      });
    } catch (jwtError) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (error) {
    console.error('Refresh token error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// ✅ REQUEST PASSWORD RESET
export const requestPasswordReset = async (req, res) => {
  try {
    const { email, student_id } = req.body;

    if (!email && !student_id) {
      return res.status(400).json({ 
        error: 'Email or Student ID is required' 
      });
    }

    // Find user by email or student_id
    const lookupField = email ? 'email' : 'student_id';
    const lookupValue = email ? email.trim() : student_id.trim();
    
    const [users] = await pool.query(
      `SELECT id, name, email, student_id FROM users WHERE ${lookupField} = ?`,
      [lookupValue]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Check if user has an email address
    if (!user.email) {
      return res.status(400).json({ 
        error: 'No email address found for this account. Please contact an administrator.' 
      });
    }

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code in database
    await pool.query(
      `INSERT INTO password_reset_codes (user_id, code, expires_at, created_at) 
       VALUES (?, ?, ?, NOW())`,
      [user.id, verificationCode, expiresAt]
    );

    // Send email with verification code
    await sendPasswordResetEmail(user.email, verificationCode, user.name);

    res.status(200).json({ 
      message: 'Password reset verification code sent to your email',
      email: user.email // Return masked email for confirmation
    });
  } catch (error) {
    console.error('Request password reset error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ VERIFY PASSWORD RESET CODE
export const verifyPasswordResetCode = async (req, res) => {
  try {
    const { email, student_id, verificationCode } = req.body;

    // Validate input
    if ((!email && !student_id) || !verificationCode) {
      return res.status(400).json({ 
        error: 'Email/Student ID and verification code are required' 
      });
    }

    // Normalize verification code (trim and ensure string)
    const normalizedCode = String(verificationCode).trim();

    // Validate verification code format (should be 6 digits)
    const codeRegex = /^\d{6}$/;
    if (!codeRegex.test(normalizedCode)) {
      return res.status(400).json({ 
        error: 'Verification code must be exactly 6 digits' 
      });
    }

    // Find user by email or student_id (use parameterized query to prevent SQL injection)
    let users;
    if (email) {
      [users] = await pool.query(
        `SELECT id FROM users WHERE email = ?`,
        [email.trim()]
      );
    } else {
      [users] = await pool.query(
        `SELECT id FROM users WHERE student_id = ?`,
        [student_id.trim()]
      );
    }

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = users[0].id;

    // Check if verification code is valid and not expired
    // Compare code as string to ensure type consistency
    const [codes] = await pool.query(
      `SELECT * FROM password_reset_codes 
       WHERE user_id = ? AND CAST(code AS CHAR) = ? AND expires_at > NOW() 
       ORDER BY created_at DESC LIMIT 1`,
      [userId, normalizedCode]
    );

    if (codes.length === 0) {
      // Check if code exists but is expired
      const [expiredCodes] = await pool.query(
        `SELECT * FROM password_reset_codes 
         WHERE user_id = ? AND CAST(code AS CHAR) = ? AND expires_at <= NOW() 
         ORDER BY created_at DESC LIMIT 1`,
        [userId, normalizedCode]
      );

      if (expiredCodes.length > 0) {
        return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
      }

      return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
    }

    // Generate a temporary reset token (valid for 15 minutes)
    const resetToken = jwt.sign(
      { userId, type: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Mark the code as verified
    // Ensure verified column exists, if not add it
    try {
      await pool.query(
        `UPDATE password_reset_codes SET verified = 1 WHERE id = ?`,
        [codes[0].id]
      );
    } catch (updateError) {
      // If verified column doesn't exist, try to add it
      if (updateError.code === 'ER_BAD_FIELD_ERROR' || updateError.message?.includes('Unknown column')) {
        console.log('⚠️  verified column not found, adding it...');
        try {
          await pool.query(`ALTER TABLE password_reset_codes ADD COLUMN verified BOOLEAN DEFAULT 0`);
          console.log('✅ Added verified column to password_reset_codes table');
          // Retry the update
          await pool.query(
            `UPDATE password_reset_codes SET verified = 1 WHERE id = ?`,
            [codes[0].id]
          );
        } catch (alterError) {
          // If column already exists (race condition), just retry the update
          if (alterError.code === 'ER_DUP_FIELDNAME' || alterError.message?.includes('Duplicate column')) {
            console.log('ℹ️  verified column already exists, retrying update...');
            await pool.query(
              `UPDATE password_reset_codes SET verified = 1 WHERE id = ?`,
              [codes[0].id]
            );
          } else {
            console.error('❌ Error adding verified column:', alterError);
            throw alterError;
          }
        }
      } else {
        console.error('❌ Error updating verified status:', updateError);
        throw updateError;
      }
    }

    res.status(200).json({ 
      message: 'Verification code verified successfully',
      resetToken: resetToken
    });
  } catch (error) {
    console.error('❌ Verify password reset code error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Request body:', req.body);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ RESET PASSWORD WITH TOKEN
export const resetPasswordWithToken = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    console.log('🔄 Password reset request received');
    console.log('🔑 Reset token present:', !!resetToken);
    console.log('🔒 New password present:', !!newPassword);

    if (!resetToken || !newPassword) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ 
        error: 'Reset token and new password are required' 
      });
    }

    // Validate password
    try {
      validatePassword(newPassword);
    } catch (validationError) {
      console.log('❌ Password validation failed:', validationError.message);
      return res.status(400).json({ 
        error: validationError.message 
      });
    }

    // Verify reset token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
      if (decoded.type !== 'password_reset') {
        return res.status(400).json({ error: 'Invalid token type' });
      }
    } catch (jwtError) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword.trim(), SALT_ROUNDS);

    // Update password
    await pool.query(
      `UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?`,
      [hashedPassword, decoded.userId]
    );

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('❌ Reset password with token error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ UPDATE USER PROFILE
export const updateProfile = async (req, res) => {
  try {
    const { id } = req.user; // From JWT token
    const { name, contact_number, email } = req.body;

    if (!name && !contact_number && !email) {
      return res.status(400).json({ 
        error: 'At least one field must be provided for update' 
      });
    }

    // Validate email if provided
    if (email) {
      try {
        validateEmail(email);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }

    // Check if email is already taken by another user
    if (email) {
      const [existing] = await pool.query(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email.trim(), id]
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Email already taken' });
      }
    }

    // Build update query
    const updateFields = [];
    const updateValues = [];

    if (name) {
      updateFields.push('name = ?');
      updateValues.push(name.trim());
    }

    if (contact_number !== undefined) {
      updateFields.push('contact_number = ?');
      updateValues.push(contact_number?.trim() || null);
    }

    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email.trim());
    }

    updateValues.push(id);

    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Send verification code for password change
export const sendVerificationCode = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Check if user exists
    const [users] = await pool.query('SELECT id, name FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found with this email' });
    }

    const user = users[0];
    
    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store verification code with expiration (15 minutes)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
    
    await pool.query(`
      INSERT INTO password_reset_codes (user_id, code, expires_at) 
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE code = VALUES(code), expires_at = VALUES(expires_at)
    `, [user.id, verificationCode, expiresAt]);

    // Send email with verification code
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Change Verification Code - ESSEN Store',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #000C50 0%, #1e40af 100%); color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">ESSEN Store</h1>
            <p style="margin: 10px 0 0 0;">Password Change Verification</p>
          </div>
          
          <div style="padding: 30px 20px; background: #f8f9fa;">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${user.name},</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              You have requested to change your password. Please use the verification code below to complete the process.
            </p>
            
            <div style="background: white; border: 2px solid #000C50; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0;">
              <h3 style="color: #000C50; margin: 0 0 10px 0;">Your Verification Code</h3>
              <div style="font-size: 32px; font-weight: bold; color: #000C50; letter-spacing: 5px; font-family: monospace;">
                ${verificationCode}
              </div>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              This code will expire in <strong>15 minutes</strong>. If you didn't request this password change, please ignore this email.
            </p>
            
            <div style="background: #e8f4fd; border-left: 4px solid #000C50; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #333;">
                <strong>Security Tip:</strong> Never share this verification code with anyone. ESSEN Store staff will never ask for this code.
              </p>
            </div>
          </div>
          
          <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 14px;">
            <p style="margin: 0;">© 2024 ESSEN Store. All rights reserved.</p>
            <p style="margin: 5px 0 0 0;">"Equip yourself for success, find everything you need to thrive in school"</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ 
      message: 'Verification code sent successfully',
      email: email // Return email for confirmation
    });

  } catch (error) {
    console.error('Send verification code error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
};
