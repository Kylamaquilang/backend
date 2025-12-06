// src/utils/validation.js

/**
 * Comprehensive Input Validation Utilities
 * Provides consistent validation across the application
 */

import { ValidationError } from './errorHandler.js';

/**
 * Email validation
 */
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    throw new ValidationError('Please provide a valid email address', 'email');
  }
  return email.toLowerCase().trim();
};

/**
 * Password validation
 */
export const validatePassword = (password) => {
  if (!password || password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long', 'password');
  }
  
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  if (!hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
    throw new ValidationError(
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      'password'
    );
  }
  
  return password;
};

/**
 * Name validation
 */
export const validateName = (name, fieldName = 'name') => {
  if (!name || typeof name !== 'string') {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }
  
  const trimmedName = name.trim();
  if (trimmedName.length < 2) {
    throw new ValidationError(`${fieldName} must be at least 2 characters long`, fieldName);
  }
  
  if (trimmedName.length > 100) {
    throw new ValidationError(`${fieldName} must be less than 100 characters`, fieldName);
  }
  
  // Check for valid characters (letters, spaces, hyphens, apostrophes)
  const nameRegex = /^[a-zA-Z\s\-']+$/;
  if (!nameRegex.test(trimmedName)) {
    throw new ValidationError(`${fieldName} can only contain letters, spaces, hyphens, and apostrophes`, fieldName);
  }
  
  return trimmedName;
};

/**
 * Phone number validation
 */
export const validatePhone = (phone) => {
  if (!phone) return null;
  
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Check if it's a valid length (7-15 digits)
  if (cleaned.length < 7 || cleaned.length > 15) {
    throw new ValidationError('Please provide a valid phone number', 'phone');
  }
  
  return cleaned;
};

/**
 * Price validation
 */
export const validatePrice = (price, fieldName = 'price') => {
  if (price === undefined || price === null || price === '') {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }
  
  const numPrice = parseFloat(price);
  if (isNaN(numPrice)) {
    throw new ValidationError(`${fieldName} must be a valid number`, fieldName);
  }
  
  if (numPrice < 0) {
    throw new ValidationError(`${fieldName} must be a positive number`, fieldName);
  }
  
  if (numPrice > 999999.99) {
    throw new ValidationError(`${fieldName} must be less than 1,000,000`, fieldName);
  }
  
  return Math.round(numPrice * 100) / 100; // Round to 2 decimal places
};

/**
 * Stock validation
 */
export const validateStock = (stock, fieldName = 'stock') => {
  if (stock === undefined || stock === null || stock === '') {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }
  
  const numStock = parseInt(stock);
  if (isNaN(numStock)) {
    throw new ValidationError(`${fieldName} must be a valid number`, fieldName);
  }
  
  if (numStock < 0) {
    throw new ValidationError(`${fieldName} must be a positive number`, fieldName);
  }
  
  if (numStock > 999999) {
    throw new ValidationError(`${fieldName} must be less than 1,000,000`, fieldName);
  }
  
  return numStock;
};

/**
 * Quantity validation (for cart items, orders, etc.)
 */
export const validateQuantity = (quantity, fieldName = 'quantity') => {
  if (quantity === undefined || quantity === null || quantity === '') {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }
  
  const numQuantity = parseInt(quantity);
  if (isNaN(numQuantity)) {
    throw new ValidationError(`${fieldName} must be a valid number`, fieldName);
  }
  
  if (numQuantity <= 0) {
    throw new ValidationError(`${fieldName} must be greater than 0`, fieldName);
  }
  
  if (numQuantity > 999) {
    throw new ValidationError(`${fieldName} must be less than 1,000`, fieldName);
  }
  
  return numQuantity;
};

/**
 * ID validation
 */
export const validateId = (id, fieldName = 'id') => {
  if (!id) {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }
  
  const numId = parseInt(id);
  if (isNaN(numId) || numId <= 0) {
    throw new ValidationError(`${fieldName} must be a valid positive number`, fieldName);
  }
  
  return numId;
};

/**
 * Image URL validation
 */
export const validateImageUrl = (imageUrl) => {
  if (!imageUrl) return null;
  
  // Check if it's a valid URL or path
  const urlRegex = /^(https?:\/\/|\/)/;
  if (!urlRegex.test(imageUrl)) {
    throw new ValidationError('Image URL must be a valid URL or path', 'image');
  }
  
  // Check file extension
  const validExtensions = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
  if (!validExtensions.test(imageUrl)) {
    throw new ValidationError('Image must be a valid image file (jpg, jpeg, png, gif, webp, svg)', 'image');
  }
  
  return imageUrl.trim();
};

/**
 * Student ID validation
 */
export const validateStudentId = (studentId) => {
  if (!studentId) return null;
  
  const cleaned = studentId.trim().toUpperCase();
  
  // Basic format validation (adjust based on your school's format)
  const studentIdRegex = /^[A-Z0-9\-]+$/;
  if (!studentIdRegex.test(cleaned)) {
    throw new ValidationError('Student ID can only contain letters, numbers, and hyphens', 'studentId');
  }
  
  if (cleaned.length < 3 || cleaned.length > 20) {
    throw new ValidationError('Student ID must be between 3 and 20 characters', 'studentId');
  }
  
  return cleaned;
};

/**
 * Address validation
 */
export const validateAddress = (address) => {
  if (!address) return null;
  
  const trimmed = address.trim();
  if (trimmed.length > 500) {
    throw new ValidationError('Address must be less than 500 characters', 'address');
  }
  
  return trimmed;
};

/**
 * Description validation
 */
export const validateDescription = (description) => {
  if (!description) return null;
  
  const trimmed = description.trim();
  if (trimmed.length > 1000) {
    throw new ValidationError('Description must be less than 1000 characters', 'description');
  }
  
  return trimmed;
};

/**
 * Category validation
 */
export const validateCategory = (category) => {
  if (!category) return null;
  
  const trimmed = category.trim();
  if (trimmed.length < 2 || trimmed.length > 50) {
    throw new ValidationError('Category must be between 2 and 50 characters', 'category');
  }
  
  return trimmed;
};

/**
 * Size validation
 */
export const validateSize = (size) => {
  if (!size) return null;
  
  const validSizes = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'NONE'];
  const upperSize = size.toUpperCase();
  
  if (!validSizes.includes(upperSize)) {
    throw new ValidationError(`Size must be one of: ${validSizes.join(', ')}`, 'size');
  }
  
  return upperSize;
};

/**
 * Sanitize HTML input
 */
export const sanitizeHtml = (input) => {
  if (!input) return '';
  
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Validate and sanitize text input
 */
export const validateAndSanitizeText = (text, fieldName, maxLength = 255) => {
  if (!text) return null;
  
  const sanitized = sanitizeHtml(text.trim());
  
  if (sanitized.length > maxLength) {
    throw new ValidationError(`${fieldName} must be less than ${maxLength} characters`, fieldName);
  }
  
  return sanitized;
};

/**
 * Validate pagination parameters
 */
export const validatePagination = (page, limit) => {
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  
  if (pageNum < 1) {
    throw new ValidationError('Page must be a positive number', 'page');
  }
  
  if (limitNum < 1 || limitNum > 100) {
    throw new ValidationError('Limit must be between 1 and 100', 'limit');
  }
  
  return { page: pageNum, limit: limitNum };
};

/**
 * Validate date range
 */
export const validateDateRange = (startDate, endDate) => {
  if (!startDate || !endDate) {
    throw new ValidationError('Both start date and end date are required', 'dateRange');
  }
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ValidationError('Please provide valid dates', 'dateRange');
  }
  
  if (start > end) {
    throw new ValidationError('Start date must be before end date', 'dateRange');
  }
  
  return { startDate: start, endDate: end };
};