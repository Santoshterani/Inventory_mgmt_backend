const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { verifyPassword } = require('../utils/password');
const { pool } = require('../db/pool');
const auditService = require('./audit.service');

async function login(username, password, meta = {}) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.username, u.password_hash AS passwordHash, u.is_active AS isActive,
            u.base_id AS baseId, u.can_create_users AS canCreateUsers, r.code AS role, b.name AS baseName
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN bases b ON b.id = u.base_id
     WHERE u.username = ?`,
    [username]
  );
  const record = rows[0];

  // Same generic message whether the username doesn't exist or the password
  // is wrong, so login doesn't leak which usernames are valid.
  if (!record) throw ApiError.unauthorized('Invalid username or password.');

  const passwordOk = await verifyPassword(password, record.passwordHash);
  if (!passwordOk) {
    await auditService.log({
      actorId: record.id,
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: record.id,
      details: { username, ip: meta.ip },
    });
    throw ApiError.unauthorized('Invalid username or password.');
  }

  if (!record.isActive) {
    throw ApiError.forbidden('This account is inactive. Contact your administrator.');
  }

  const token = jwt.sign({ sub: record.id, role: record.role }, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
  });

  await auditService.log({
    actorId: record.id,
    action: 'LOGIN',
    entityType: 'user',
    entityId: record.id,
    details: { ip: meta.ip },
  });

  return {
    token,
    user: {
      id: record.id,
      name: record.name,
      username: record.username,
      role: record.role,
      baseId: record.baseId,
      baseName: record.baseName,
      canCreateUsers: Boolean(record.canCreateUsers),
    },
  };
}

module.exports = { login };
