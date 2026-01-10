/**
 * Authentication Middleware
 *
 * Extracts and validates storeId from JWT token.
 * Enforces multi-tenant isolation at the authentication layer.
 *
 * CRITICAL SECURITY:
 * - storeId is extracted from JWT (server-side signed token)
 * - Client-provided storeId in request body is IGNORED
 * - No defaults, no fallbacks
 * - Fail fast with clear errors
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * Middleware: Authenticate and extract storeId from JWT
 *
 * Expected JWT payload:
 * {
 *   storeId: "NJWeedWizard",
 *   storeName: "NJ Weed Wizard",
 *   email: "owner@njweedwizard.com",
 *   role: "owner",
 *   iat: 1736469000,
 *   exp: 1736555400
 * }
 *
 * Usage:
 *   app.post('/snapshot/generate', authenticateStore, handler);
 */
export function authenticateStore(req, res, next) {
  try {
    // 1. Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized',
        message: 'Missing Authorization header. Provide: Authorization: Bearer <token>'
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized',
        message: 'Invalid Authorization header format. Expected: Bearer <token>'
      });
    }

    // 2. Verify JWT signature
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          ok: false,
          error: 'Token expired',
          message: 'JWT token has expired. Please re-authenticate.'
        });
      } else if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          ok: false,
          error: 'Invalid token',
          message: 'JWT token is invalid or malformed.'
        });
      } else {
        throw err;
      }
    }

    // 3. Validate storeId exists in token
    if (!decoded.storeId || typeof decoded.storeId !== 'string') {
      return res.status(401).json({
        ok: false,
        error: 'Invalid token',
        message: 'JWT token missing required field: storeId'
      });
    }

    // 4. Attach user context to request (TRUSTED source)
    req.user = {
      storeId: decoded.storeId,
      storeName: decoded.storeName || decoded.storeId,
      email: decoded.email,
      role: decoded.role || 'user',
      tokenIssuedAt: new Date(decoded.iat * 1000).toISOString(),
      tokenExpiresAt: new Date(decoded.exp * 1000).toISOString()
    };

    console.log('[Auth] Authenticated request', {
      storeId: req.user.storeId,
      email: req.user.email,
      path: req.path
    });

    next();
  } catch (err) {
    console.error('[Auth] Authentication error:', err);
    return res.status(500).json({
      ok: false,
      error: 'Authentication failed',
      message: 'Internal error during authentication'
    });
  }
}

/**
 * Middleware: Require admin role
 *
 * Use after authenticateStore:
 *   app.get('/admin/metrics', authenticateStore, requireAdmin, handler);
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      ok: false,
      error: 'Forbidden',
      message: 'Admin role required'
    });
  }

  next();
}

/**
 * Generate JWT token for a store
 *
 * Used for:
 * - Initial authentication (login)
 * - Token refresh
 * - Testing
 *
 * @param {object} payload - { storeId, storeName, email, role }
 * @param {number} expiresIn - Expiration in seconds (default: 24 hours)
 * @returns {string} - JWT token
 */
export function generateToken(payload, expiresIn = 24 * 60 * 60) {
  const { storeId, storeName, email, role = 'owner' } = payload;

  if (!storeId || !email) {
    throw new Error('storeId and email are required to generate token');
  }

  return jwt.sign(
    {
      storeId,
      storeName: storeName || storeId,
      email,
      role
    },
    JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Development-only: Create test tokens
 *
 * DO NOT USE IN PRODUCTION
 */
export function createTestTokens() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot create test tokens in production');
  }

  return {
    njWeedWizard: generateToken({
      storeId: 'NJWeedWizard',
      storeName: 'NJ Weed Wizard',
      email: 'owner@njweedwizard.com',
      role: 'owner'
    }),
    caliCannabis: generateToken({
      storeId: 'CaliCannabis',
      storeName: 'California Cannabis Co',
      email: 'admin@calicannabis.com',
      role: 'owner'
    }),
    admin: generateToken({
      storeId: 'ADMIN',
      storeName: 'Admin',
      email: 'admin@omen.com',
      role: 'admin'
    })
  };
}

/**
 * Validate storeId format
 *
 * Rules:
 * - Alphanumeric + underscores only
 * - 3-50 characters
 * - No spaces, special chars
 *
 * Prevents path traversal attacks via storeId
 */
export function validateStoreId(storeId) {
  if (!storeId || typeof storeId !== 'string') {
    return { valid: false, error: 'storeId must be a non-empty string' };
  }

  if (storeId.length < 3 || storeId.length > 50) {
    return { valid: false, error: 'storeId must be 3-50 characters' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(storeId)) {
    return { valid: false, error: 'storeId can only contain letters, numbers, and underscores' };
  }

  return { valid: true };
}
