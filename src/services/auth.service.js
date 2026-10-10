const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { hashPassword, verifyPassword } = require('../utils/password');
const { pool } = require('../db/pool');
const auditService = require('./audit.service');

async function login(username, password, meta = {}) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.username, u.service_id AS serviceId, u.password_hash AS passwordHash,
            u.is_active AS isActive, u.must_change_password AS mustChangePassword,
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
      serviceId: record.serviceId,
      role: record.role,
      baseId: record.baseId,
      baseName: record.baseName,
      canCreateUsers: Boolean(record.canCreateUsers),
      // Frontend gates all other routes behind a mandatory change-password
      // screen while this is true — see requirements: "temporary password
      // when creating user, how does the user change it".
      mustChangePassword: Boolean(record.mustChangePassword),
    },
  };
}

// Self-service change: requires the *current* password, works both for a
// voluntary change and for clearing must_change_password after a temporary
// password or a completed reset.
async function changePassword(user, currentPassword, newPassword) {
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    throw ApiError.badRequest('currentPassword and a newPassword of at least 8 characters are required.');
  }

  const [rows] = await pool.query('SELECT password_hash AS passwordHash FROM users WHERE id = ?', [user.id]);
  const record = rows[0];
  if (!record) throw ApiError.notFound('User not found.');

  const ok = await verifyPassword(currentPassword, record.passwordHash);
  if (!ok) throw ApiError.unauthorized('Current password is incorrect.');

  const newHash = await hashPassword(newPassword);
  await pool.query(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [newHash, user.id]
  );

  await auditService.log({ actorId: user.id, action: 'PASSWORD_CHANGED', entityType: 'user', entityId: user.id });
}

// --- Forgot password -------------------------------------------------------
// No email/SMS provider is wired up in this initial framework, so the reset
// token is logged server-side (and, outside production, echoed in the API
// response) instead of emailed. Swap `deliverToken` for a real mailer later
// without touching the rest of this flow.
const RESET_TOKEN_BYTES = 32;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function deliverToken(user, token) {
  const resetUrl = `${env.frontendUrl}/reset-password?token=${token}`;
  // Stands in for a real email/SMS integration.
  logger.info('Password reset requested', { userId: user.id, username: user.username, resetUrl });
  return resetUrl;
}

async function forgotPassword(username) {
  const [rows] = await pool.query('SELECT id, username, is_active AS isActive FROM users WHERE username = ?', [username]);
  const user = rows[0];

  // Always respond the same way whether or not the username exists, so this
  // endpoint can't be used to enumerate valid usernames.
  if (!user || !user.isActive) {
    return { message: 'If that account exists, password reset instructions have been generated.' };
  }

  const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + env.passwordReset.tokenExpiryMinutes * 60 * 1000);

  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, hashToken(token), expiresAt]
  );
  await auditService.log({ actorId: user.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'user', entityId: user.id });

  const resetUrl = deliverToken(user, token);

  return {
    message: 'If that account exists, password reset instructions have been generated.',
    // Only surfaced outside production, purely so this is usable without a
    // real mail server configured. Remove once email delivery is wired up.
    ...(env.nodeEnv !== 'production' ? { devResetToken: token, devResetUrl: resetUrl } : {}),
  };
}

async function resetPassword(token, newPassword) {
  if (!token || !newPassword || newPassword.length < 8) {
    throw ApiError.badRequest('token and a newPassword of at least 8 characters are required.');
  }

  const tokenHash = hashToken(token);
  const [rows] = await pool.query(
    `SELECT id, user_id AS userId, expires_at AS expiresAt, used_at AS usedAt
     FROM password_reset_tokens WHERE token_hash = ?`,
    [tokenHash]
  );
  const record = rows[0];
  if (!record || record.usedAt || new Date(record.expiresAt) < new Date()) {
    throw ApiError.badRequest('This reset link is invalid or has expired. Request a new one.');
  }

  const newHash = await hashPassword(newPassword);
  await pool.query(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [newHash, record.userId]
  );
  await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [record.id]);
  await auditService.log({ actorId: record.userId, action: 'PASSWORD_RESET_COMPLETED', entityType: 'user', entityId: record.userId });
}

module.exports = { login, changePassword, forgotPassword, resetPassword };
