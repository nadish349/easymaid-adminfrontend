const jwt = require('jsonwebtoken');

// JWT Secret - In production, this should be in environment variables
const JWT_SECRET = 'homeclean-admin-secret-key-2024';
const JWT_EXPIRES_IN = '24h';

/**
 * Generate a JWT token with the given payload
 * @param {Object} payload - The data to encode in the token
 * @returns {string} JWT token
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Object} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Decode a JWT token without verification (for debugging)
 * @param {string} token - The JWT token to decode
 * @returns {Object} Decoded token payload
 */
function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = {
  generateToken,
  verifyToken,
  decodeToken,
  JWT_SECRET,
  JWT_EXPIRES_IN
};




