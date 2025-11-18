const { verifyToken } = require('../utils/jwt');

/**
 * Authentication middleware to verify JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function authenticateToken(req, res, next) {
  // Get token from Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      message: 'Please provide a valid authentication token'
    });
  }

  try {
    // Verify the token
    const decoded = verifyToken(token);
    
    // Attach user information to request object
    req.user = {
      email: decoded.email,
      adminId: decoded.adminId,
      type: decoded.type
    };
    
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Your session has expired. Please login again.'
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Invalid authentication token. Please login again.'
      });
    } else {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Token verification failed. Please login again.'
      });
    }
  }
}

/**
 * Optional authentication middleware - doesn't fail if no token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyToken(token);
      req.user = {
        email: decoded.email,
        adminId: decoded.adminId,
        type: decoded.type
      };
    } catch (error) {
      // Token is invalid, but we don't fail the request
      console.warn('Optional auth failed:', error.message);
    }
  }
  
  next();
}

module.exports = {
  authenticateToken,
  optionalAuth
};




