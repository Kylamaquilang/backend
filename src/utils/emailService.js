import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Email configuration - Create transporter dynamically
export const getTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER || 'your-email@gmail.com',
      pass: process.env.EMAIL_PASSWORD || 'your-app-password'
    },
    // Additional Gmail-specific settings
    secure: true,
    port: 465,
    tls: {
      rejectUnauthorized: false
    }
  });
};

// Legacy transporter for backward compatibility
export const transporter = getTransporter();

// Verify email configuration
export const verifyEmailConfig = () => {
  if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your-email@gmail.com') {
    console.warn('EMAIL_USER not configured - email functionality will be disabled');
    return false;
  }
  if (!process.env.EMAIL_PASSWORD || process.env.EMAIL_PASSWORD === 'your-app-password') {
    console.warn('EMAIL_PASSWORD not configured - email functionality will be disabled');
    return false;
  }
  return true;
};

// Generate a random 6-digit verification code
export const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate a secure reset token
export const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Send password reset email with verification code
export const sendPasswordResetEmail = async (email, verificationCode, userName) => {
  try {
    // Verify email configuration before sending
    if (!verifyEmailConfig()) {
      console.log('Email service not configured - skipping password reset email');
      return { success: false, message: 'Email service not configured' };
    }
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'CPC Essen - Password Reset Verification',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: #000C50; color: white; padding: 25px; text-align: center; border-radius: 15px 15px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">CPC Essen</h1>
            <p style="margin: 5px 0 0 0; font-size: 16px;">Password Reset Verification</p>
          </div>
          
          <div style="background-color: white; padding: 35px; border-radius: 0 0 15px 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${userName},</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              You have requested to reset your password for your CPC Essen account. 
              To proceed with the password reset, please use the verification code below:
            </p>
            
            <div style="background-color: #000C50; color: white; padding: 20px; text-align: center; border-radius: 8px; margin: 30px 0;">
              <h3 style="margin: 0; font-size: 32px; letter-spacing: 5px; font-family: monospace;">${verificationCode}</h3>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              <strong>Important:</strong>
            </p>
            <ul style="color: #666; line-height: 1.6; margin-bottom: 20px; padding-left: 20px;">
              <li>This code will expire in 10 minutes</li>
              <li>Do not share this code with anyone</li>
              <li>If you didn't request this reset, please ignore this email</li>
            </ul>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              If you have any questions or need assistance, please contact the system administrator.
            </p>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await getTransporter().sendMail(mailOptions);
    console.log('Password reset email sent successfully to:', email);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    
    // Provide more specific error messages
    if (error.message.includes('EMAIL_USER not configured') || error.message.includes('EMAIL_PASSWORD not configured')) {
      throw new Error('Email service not configured. Please contact administrator.');
    } else if (error.code === 'EAUTH') {
      throw new Error('Email authentication failed. Please check email credentials.');
    } else if (error.code === 'ECONNECTION') {
      throw new Error('Unable to connect to email service. Please try again later.');
    } else {
      throw new Error('Failed to send password reset email. Please try again later.');
    }
  }
};

// Send welcome email for new users
export const sendWelcomeEmail = async (email, userName, studentId, defaultPassword) => {
  try {
    // Verify email configuration before sending
    if (!verifyEmailConfig()) {
      console.log('Email service not configured - skipping welcome email');
      return { success: false, message: 'Email service not configured' };
    }
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Welcome to CPC Essen - Your Account Details',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: #000C50; color: white; padding: 25px; text-align: center; border-radius: 15px 15px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">CPC Essen</h1>
            <p style="margin: 5px 0 0 0; font-size: 16px;">Welcome to Our Platform</p>
          </div>
          
          <div style="background-color: white; padding: 35px; border-radius: 0 0 15px 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 20px;">Welcome ${userName}!</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              Your account has been successfully created. Here are your login details:
            </p>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #000C50;">
              <p style="margin: 5px 0;"><strong>Student ID:</strong> ${studentId}</p>
              <p style="margin: 5px 0;"><strong>Default Password:</strong> ${defaultPassword}</p>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              <strong>Important:</strong> Please change your password after your first login for security purposes.
            </p>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/auth/login" 
                 style="background-color: #000C50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Login to Your Account
              </a>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                If you have any questions, please contact the system administrator.
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await getTransporter().sendMail(mailOptions);
    console.log('Welcome email sent successfully to:', email);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending welcome email:', error);
    
    // Provide more specific error messages
    if (error.message.includes('EMAIL_USER not configured') || error.message.includes('EMAIL_PASSWORD not configured')) {
      throw new Error('Email service not configured. Please contact administrator.');
    } else if (error.code === 'EAUTH') {
      throw new Error('Email authentication failed. Please check email credentials.');
    } else if (error.code === 'ECONNECTION') {
      throw new Error('Unable to connect to email service. Please try again later.');
    } else {
      throw new Error('Failed to send welcome email. Please try again later.');
    }
  }
};

// Send order receipt email
export const sendOrderReceiptEmail = async (email, userName, orderData) => {
  try {
    // Verify email configuration before sending
    if (!verifyEmailConfig()) {
      console.log('Email service not configured - skipping order receipt email');
      return { success: false, message: 'Email service not configured' };
    }
    
    const { orderId, items, totalAmount, paymentMethod, createdAt, status, userName: orderUserName, degree, section } = orderData;
    
    // Use orderUserName if provided, otherwise fall back to userName parameter
    const studentName = (orderUserName || userName || 'N/A').toUpperCase();
    
    // Format course and section
    const courseSection = degree && section 
      ? `${degree} - ${section}`.toUpperCase()
      : degree || section || '';
    
    // Format date
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };
    
    // Calculate subtotal
    const subtotal = items.reduce((sum, item) => sum + (Number(item.total_price) || 0), 0);
    const total = Number(totalAmount) || subtotal;
    
    // Format items for display - matching receipt template
    const itemsHtml = items.map(item => {
      const itemName = (item.product_name || 'Unknown').toUpperCase();
      const unitPrice = Number(item.unit_price || 0).toFixed(2);
      const quantity = item.quantity || 0;
      const itemTotal = Number(item.total_price || 0).toFixed(2);
      
      return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px 8px; color: #111827; font-size: 13px; text-transform: uppercase; word-break: break-word;">${itemName}</td>
          <td style="padding: 12px 8px; text-align: right; color: #111827; font-size: 13px;">₱${unitPrice}</td>
          <td style="padding: 12px 8px; text-align: right; color: #111827; font-size: 13px;">${quantity}</td>
          <td style="padding: 12px 8px; text-align: right; color: #111827; font-size: 13px; font-weight: 600;">₱${itemTotal}</td>
        </tr>
      `;
    }).join('');
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `CPC Essen - Order Receipt #${orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Courier New', monospace; background-color: #ffffff;">
          <div style="max-width: 400px; margin: 0 auto; padding: 30px 20px; background-color: #ffffff;">
            
            <!-- Thin line on top -->
            <div style="border-top: 1px solid #000000; margin-bottom: 25px;"></div>
            
            <!-- Title aligned to right -->
            <div style="text-align: right; margin-bottom: 25px;">
              <div style="font-weight: bold; font-size: 16px; color: #000000; margin-bottom: 2px;">CPC ESSEN</div>
              <div style="font-size: 12px; color: #000000; margin-bottom: 2px;">ONLINE</div>
              <div style="font-size: 12px; color: #000000;">STORE</div>
            </div>
            
            <!-- Separator line -->
            <div style="border-top: 1px solid #000000; margin-bottom: 20px;"></div>
            
            <!-- ISSUED TO and DATE -->
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 11px;">
              <div style="font-weight: bold; color: #000000;">ISSUED TO:</div>
              <div style="font-weight: bold; color: #000000; text-align: right;">DATE: ${formatDate(createdAt)}</div>
            </div>
            
            <!-- Student Name -->
            <div style="margin-bottom: 6px; font-size: 13px; font-weight: bold; color: #000000; text-transform: uppercase;">
              ${studentName}
            </div>
            
            <!-- Course and Section -->
            ${courseSection ? `
            <div style="margin-bottom: 20px; font-size: 11px; color: #000000; text-transform: uppercase;">
              ${courseSection}
            </div>
            ` : '<div style="margin-bottom: 20px;"></div>'}
            
            <!-- Table Header -->
            <div style="margin-bottom: 10px; font-size: 10px; font-weight: bold; color: #000000;">
              <div style="display: flex; justify-content: space-between;">
                <div style="width: 40%;">DESCRIPTION</div>
                <div style="width: 20%; text-align: right;">UNIT PRICE</div>
                <div style="width: 10%; text-align: right;">QTY</div>
                <div style="width: 30%; text-align: right;">TOTAL</div>
              </div>
            </div>
            
            <!-- Separator line -->
            <div style="border-top: 1px solid #000000; margin-bottom: 12px;"></div>
            
            <!-- Items Table -->
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
            
            <!-- Separator line -->
            <div style="border-top: 1px solid #000000; margin-top: 15px; margin-bottom: 15px;"></div>
            
            <!-- Subtotal and Total -->
            <div style="font-size: 12px; margin-bottom: 8px; color: #000000;">
              <div style="display: flex; justify-content: space-between;">
                <div>SUBTOTAL:</div>
                <div style="text-align: right;">₱${subtotal.toFixed(2)}</div>
              </div>
            </div>
            
            <div style="font-size: 13px; font-weight: bold; margin-bottom: 25px; color: #000000;">
              <div style="display: flex; justify-content: space-between;">
                <div>TOTAL:</div>
                <div style="text-align: right;">₱${total.toFixed(2)}</div>
              </div>
            </div>
            
            <!-- Thank You -->
            <div style="text-align: center; font-size: 13px; font-weight: bold; margin-top: 25px; color: #000000;">
              THANK YOU!
            </div>
            
            <!-- Footer -->
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 10px; margin: 0; font-family: Arial, sans-serif;">
                This is an automated receipt. Please do not reply to this email.
              </p>
            </div>
            
          </div>
        </body>
        </html>
      `
    };

    const result = await getTransporter().sendMail(mailOptions);
    console.log('Order receipt email sent successfully to:', email);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending order receipt email:', error);
    
    // Provide more specific error messages
    if (error.message.includes('EMAIL_USER not configured') || error.message.includes('EMAIL_PASSWORD not configured')) {
      throw new Error('Email service not configured. Please contact administrator.');
    } else if (error.code === 'EAUTH') {
      throw new Error('Email authentication failed. Please check email credentials.');
    } else if (error.code === 'ECONNECTION') {
      throw new Error('Unable to connect to email service. Please try again later.');
    } else {
      throw new Error('Failed to send order receipt email. Please try again later.');
    }
  }
};

// Send order received email with thank you button
export const sendOrderReceivedEmail = async (email, userName, orderData) => {
  try {
    // Verify email configuration before sending
    if (!verifyEmailConfig()) {
      console.log('Email service not configured - skipping order received email');
      return { success: false, message: 'Email service not configured' };
    }
    
    const { orderId, items, totalAmount, paymentMethod, createdAt } = orderData;
    
    // Generate order name from items (first product name + count if multiple products)
    const uniqueProducts = [...new Set(items.map(item => item.product_name))];
    const orderName = uniqueProducts.length > 1 
      ? `${uniqueProducts[0]} +${uniqueProducts.length - 1}`
      : uniqueProducts[0] || `Order #${orderId}`;
    
    // Format items for display
    const itemsHtml = items.map(item => `
      <tr style="border-bottom: 1px solid #eee; background-color: white;">
        <td style="padding: 18px 15px; color: #333; font-size: 15px;">${item.quantity}x ${item.product_name}</td>
        <td style="padding: 18px 15px; text-align: right; color: #333; font-size: 15px;">₱${Number(item.unit_price).toFixed(2)}</td>
        <td style="padding: 18px 15px; text-align: right; color: #333; font-weight: bold; font-size: 15px;">₱${Number(item.total_price).toFixed(2)}</td>
      </tr>
    `).join('');
    
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const thankYouUrl = `${clientUrl}/thank-you?orderId=${orderId}`;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `CPC Essen - Order Received: ${orderName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: #000C50; color: white; padding: 25px; text-align: center; border-radius: 15px 15px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">CPC Essen</h1>
            <p style="margin: 5px 0 0 0; font-size: 16px;">Order Received</p>
          </div>
          
          <div style="background-color: white; padding: 35px; border-radius: 0 0 15px 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 25px; font-size: 24px; font-weight: 600;">Thank you for your order, ${userName}!</h2>
            
            <div style="background-color: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <p style="margin: 0; color: #155724; font-weight: bold;">✅ Order Received</p>
              <p style="margin: 5px 0 0 0; color: #155724;">Your order has been successfully received and is being processed. We'll notify you when it's ready for pickup!</p>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 5px solid #000C50; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <p style="margin: 8px 0; font-size: 16px;"><strong>Order Name:</strong> ${orderName}</p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Order Date:</strong> ${new Date(createdAt).toLocaleDateString()}</p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Status:</strong> <span style="color: #17a2b8; font-weight: bold;">Processing</span></p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Payment Method:</strong> ${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</p>
            </div>
            
            <h3 style="color: #333; margin-bottom: 20px; font-size: 20px; font-weight: 600; border-bottom: 2px solid #000C50; padding-bottom: 10px;">Order Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <thead>
                <tr style="background-color: #000C50; color: white;">
                  <th style="padding: 18px 15px; text-align: left; font-weight: bold; font-size: 16px;">Item</th>
                  <th style="padding: 18px 15px; text-align: right; font-weight: bold; font-size: 16px;">Unit Price</th>
                  <th style="padding: 18px 15px; text-align: right; font-weight: bold; font-size: 16px;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
            
            <div style="text-align: right; margin-top: 25px; padding: 20px; background-color: #f8f9fa; border-radius: 8px; border-left: 5px solid #000C50;">
              <p style="font-size: 20px; font-weight: bold; color: #000C50; margin: 0;">
                Total Amount: ₱${Number(totalAmount).toFixed(2)}
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${thankYouUrl}" 
                 style="background-color: #000C50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px;">
                Thank You - View Order Status
              </a>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              We appreciate your business and will process your order as quickly as possible. You'll receive another email when your order is ready for pickup.
            </p>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await getTransporter().sendMail(mailOptions);
    console.log('Order received email sent successfully to:', email);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending order received email:', error);
    
    // Provide more specific error messages
    if (error.message.includes('EMAIL_USER not configured') || error.message.includes('EMAIL_PASSWORD not configured')) {
      throw new Error('Email service not configured. Please contact administrator.');
    } else if (error.code === 'EAUTH') {
      throw new Error('Email authentication failed. Please check email credentials.');
    } else if (error.code === 'ECONNECTION') {
      throw new Error('Unable to connect to email service. Please try again later.');
    } else {
      throw new Error('Failed to send order received email. Please try again later.');
    }
  }
};

// Send ready for pickup email
export const sendReadyForPickupEmail = async (email, userName, orderData) => {
  try {
    // Verify email configuration before sending
    if (!verifyEmailConfig()) {
      console.log('Email service not configured - skipping ready for pickup email');
      return { success: false, message: 'Email service not configured' };
    }
    
    const { orderId, items, totalAmount, paymentMethod, createdAt } = orderData;
    
    // Generate order name from items (first product name + count if multiple products)
    const uniqueProducts = [...new Set(items.map(item => item.product_name))];
    const orderName = uniqueProducts.length > 1 
      ? `${uniqueProducts[0]} +${uniqueProducts.length - 1}`
      : uniqueProducts[0] || `Order #${orderId}`;
    
    // Format items for display
    const itemsHtml = items.map(item => `
      <tr style="border-bottom: 1px solid #eee; background-color: white;">
        <td style="padding: 18px 15px; color: #333; font-size: 15px;">${item.quantity}x ${item.product_name}</td>
        <td style="padding: 18px 15px; text-align: right; color: #333; font-size: 15px;">₱${Number(item.unit_price).toFixed(2)}</td>
        <td style="padding: 18px 15px; text-align: right; color: #333; font-weight: bold; font-size: 15px;">₱${Number(item.total_price).toFixed(2)}</td>
      </tr>
    `).join('');
    
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const apiUrl = process.env.API_URL || 'http://localhost:5000';
    const confirmUrl = `${apiUrl}/api/orders/${orderId}/confirm-receipt`;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `CPC Essen - Order Ready for Pickup: ${orderName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: #000C50; color: white; padding: 25px; text-align: center; border-radius: 15px 15px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">CPC Essen</h1>
            <p style="margin: 5px 0 0 0; font-size: 16px;">Online Receipt</p>
          </div>
          
          <div style="background-color: white; padding: 35px; border-radius: 0 0 15px 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 25px; font-size: 24px; font-weight: 600;">Thank you for your order, ${userName}!</h2>
            
            <div style="background-color: #d4edda; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <p style="margin: 0; color: #155724; font-weight: bold;">✅ Order Ready for Pickup</p>
              <p style="margin: 5px 0 0 0; color: #155724;">Your order is ready for pickup at the accounting office! Please bring a valid ID when collecting your items.</p>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 5px solid #000C50; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <p style="margin: 8px 0; font-size: 16px;"><strong>Order Name:</strong> ${orderName}</p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Order Date:</strong> ${new Date(createdAt).toLocaleDateString()}</p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Status:</strong> <span style="color: #28a745; font-weight: bold;">Ready for Pickup</span></p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Payment Method:</strong> ${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</p>
            </div>
            
            <h3 style="color: #333; margin-bottom: 20px; font-size: 20px; font-weight: 600; border-bottom: 2px solid #000C50; padding-bottom: 10px;">Order Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <thead>
                <tr style="background-color: #000C50; color: white;">
                  <th style="padding: 18px 15px; text-align: left; font-weight: bold; font-size: 16px;">Item</th>
                  <th style="padding: 18px 15px; text-align: right; font-weight: bold; font-size: 16px;">Unit Price</th>
                  <th style="padding: 18px 15px; text-align: right; font-weight: bold; font-size: 16px;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
            
            <div style="text-align: right; margin-top: 25px; padding: 20px; background-color: #f8f9fa; border-radius: 8px; border-left: 5px solid #000C50;">
              <p style="font-size: 20px; font-weight: bold; color: #000C50; margin: 0;">
                Total Amount: ₱${Number(totalAmount).toFixed(2)}
              </p>
            </div>
            
            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <p style="margin: 0; color: #0c5460; font-weight: bold;">📍 Pickup Location</p>
              <p style="margin: 5px 0 0 0; color: #0c5460;">Accounting Office - CPC Essen</p>
              <p style="margin: 5px 0 0 0; color: #0c5460;">Please bring a valid ID for verification</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${confirmUrl}" 
                 style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px; margin-right: 10px;">
                ✅ Received Order
              </a>
              <a href="${clientUrl}/dashboard" 
                 style="background-color: #000C50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px;">
                View Dashboard
              </a>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; color: #856404; font-weight: bold;">📋 Important Instructions</p>
              <p style="margin: 5px 0 0 0; color: #856404;">Please click "Received Order" button after collecting your items to complete your order and receive your thank you message.</p>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              Thank you for choosing CPC Essen! We look forward to serving you again.
            </p>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await getTransporter().sendMail(mailOptions);
    console.log('Ready for pickup email sent successfully to:', email);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending ready for pickup email:', error);
    
    // Provide more specific error messages
    if (error.message.includes('EMAIL_USER not configured') || error.message.includes('EMAIL_PASSWORD not configured')) {
      throw new Error('Email service not configured. Please contact administrator.');
    } else if (error.code === 'EAUTH') {
      throw new Error('Email authentication failed. Please check email credentials.');
    } else if (error.code === 'ECONNECTION') {
      throw new Error('Unable to connect to email service. Please try again later.');
    } else {
      throw new Error('Failed to send ready for pickup email. Please try again later.');
    }
  }
};

// Send delivered order email with thank you message and receipt
export const sendDeliveredOrderEmail = async (email, userName, orderData) => {
  try {
    // Verify email configuration before sending
    if (!verifyEmailConfig()) {
      console.log('Email service not configured - skipping delivered order email');
      return { success: false, message: 'Email service not configured' };
    }
    
    const { orderId, items, totalAmount, paymentMethod, createdAt, deliveredAt } = orderData;
    
    // Generate order name from items (first product name + count if multiple products)
    const uniqueProducts = [...new Set(items.map(item => item.product_name))];
    const orderName = uniqueProducts.length > 1 
      ? `${uniqueProducts[0]} +${uniqueProducts.length - 1}`
      : uniqueProducts[0] || `Order #${orderId}`;
    
    // Format items for display
    const itemsHtml = items.map(item => `
      <tr style="border-bottom: 1px solid #eee; background-color: white;">
        <td style="padding: 18px 15px; color: #333; font-size: 15px;">${item.quantity}x ${item.product_name}${item.size ? ` (${item.size})` : ''}</td>
        <td style="padding: 18px 15px; text-align: right; color: #333; font-size: 15px;">₱${Number(item.unit_price).toFixed(2)}</td>
        <td style="padding: 18px 15px; text-align: right; color: #333; font-weight: bold; font-size: 15px;">₱${Number(item.total_price).toFixed(2)}</td>
      </tr>
    `).join('');
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `CPC Essen - Thank You for Your Order!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
          <div style="background-color: #000C50; color: white; padding: 25px; text-align: center; border-radius: 15px 15px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">CPC Essen</h1>
            <p style="margin: 5px 0 0 0; font-size: 16px;">Order Delivered - Thank You!</p>
          </div>
          
          <div style="background-color: white; padding: 35px; border-radius: 0 0 15px 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 25px; font-size: 24px; font-weight: 600;">Thank you for your order, ${userName}!</h2>
            
            <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <p style="margin: 0; color: #155724; font-weight: bold; font-size: 18px;">🎉 Order Successfully Delivered!</p>
              <p style="margin: 10px 0 0 0; color: #155724; line-height: 1.6;">
                Your order has been successfully delivered and completed. Thank you for choosing CPC Essen! We hope you enjoy your purchase and look forward to serving you again.
              </p>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #000C50;">
              <p style="margin: 5px 0;"><strong>Order Name:</strong> ${orderName}</p>
              <p style="margin: 5px 0;"><strong>Order Date:</strong> ${new Date(createdAt).toLocaleDateString()}</p>
              <p style="margin: 5px 0;"><strong>Delivered Date:</strong> ${deliveredAt ? new Date(deliveredAt).toLocaleDateString() : new Date().toLocaleDateString()}</p>
              <p style="margin: 5px 0;"><strong>Status:</strong> Delivered & Completed</p>
              <p style="margin: 5px 0;"><strong>Payment Method:</strong> ${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</p>
            </div>
            
            <h3 style="color: #333; margin-bottom: 15px;">Order Summary</h3>
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <p style="margin: 0; color: #333; font-size: 16px;">
                <strong>Order Total:</strong> ₱${Number(totalAmount).toFixed(2)}
              </p>
              <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">
                Thank you for your business! A detailed receipt will be sent to you separately.
              </p>
            </div>
            
            <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
              <p style="margin: 0; color: #155724; font-weight: bold; font-size: 16px;">💝 Thank You Message</p>
              <p style="margin: 10px 0 0 0; color: #155724; line-height: 1.6;">
                We sincerely appreciate your business and trust in CPC Essen. Your satisfaction is our priority, and we hope this purchase meets your expectations. 
                We look forward to serving you again soon!
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard" 
                 style="background-color: #000C50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px;">
                Continue Shopping
              </a>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
              If you have any questions about your order or need assistance with future purchases, please don't hesitate to contact our support team. 
              We're here to help!
            </p>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                This is an automated thank you message. Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await getTransporter().sendMail(mailOptions);
    console.log('Delivered order email sent successfully to:', email);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending delivered order email:', error);
    
    // Provide more specific error messages
    if (error.message.includes('EMAIL_USER not configured') || error.message.includes('EMAIL_PASSWORD not configured')) {
      throw new Error('Email service not configured. Please contact administrator.');
    } else if (error.code === 'EAUTH') {
      throw new Error('Email authentication failed. Please check email credentials.');
    } else if (error.code === 'ECONNECTION') {
      throw new Error('Unable to connect to email service. Please try again later.');
    } else {
      throw new Error('Failed to send delivered order email. Please try again later.');
    }
  }
};
