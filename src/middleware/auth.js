const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { pool } = require('../db/pool');

// Verifies the bearer token, then re-checks the user is still active on
// every request (section 3.5: every protected API is enforced server-side;
// FR-01: inactive accounts cannot log in — this also stops an inactive
// account from continuing to use a token issued before deactivation).
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized();
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.secret);
  } catch (err) {
    throw ApiError.unauthorized('Your session is invalid or has expired.');
  }

  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.username, u.base_id AS baseId, u.can_create_users AS canCreateUsers,
            u.is_active AS isActive, r.code AS role, b.name AS baseName
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN bases b ON b.id = u.base_id
     WHERE u.id = ?`,
    [payload.sub]
  );

  const user = rows[0];
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Your account is no longer active.');
  }

  req.user = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    baseId: user.baseId,
    baseName: user.baseName,
    canCreateUsers: Boolean(user.canCreateUsers),
  };
  next();
});

module.exports = authenticate;
