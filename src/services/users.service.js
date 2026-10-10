const ApiError = require('../utils/ApiError');
const { pool, withTransaction } = require('../db/pool');
const { hashPassword } = require('../utils/password');
const auditService = require('./audit.service');

const ROLE_IDS = { ADMIN: 1, BASE_COMMANDER: 2, LOGISTICS_OFFICER: 3 };

async function list(user) {
  // Admins see everyone; Base Commanders (even those who can create users)
  // only see users at their own base, never org-wide (section 3.2/3.5).
  const where = user.role === 'ADMIN' ? '' : 'WHERE u.base_id = ?';
  const params = user.role === 'ADMIN' ? [] : [user.baseId];

  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.username, u.service_id AS serviceId, r.code AS role,
            u.base_id AS baseId, b.name AS baseName,
            u.is_active AS isActive, u.must_change_password AS mustChangePassword, u.created_at AS createdAt
     FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN bases b ON b.id = u.base_id
     ${where}
     ORDER BY u.name`,
    params
  );
  const [bases] = await pool.query('SELECT id, name FROM bases WHERE is_active = 1 ORDER BY name');

  return {
    items: rows.map((r) => ({ ...r, isActive: Boolean(r.isActive), mustChangePassword: Boolean(r.mustChangePassword) })),
    bases,
  };
}

// section 3.4/FR-08: Admins can create any role at any base. A Base
// Commander may only create users if `can_create_users` is set on their own
// account, and then only Logistics Officers scoped to their own base.
async function create(user, { name, username, serviceId, password, role, baseId }) {
  if (!name?.trim() || !username?.trim() || !serviceId?.trim() || !password || password.length < 8 || !role) {
    throw ApiError.badRequest(
      'name, username, serviceId, a password of at least 8 characters, and role are required.'
    );
  }
  if (!ROLE_IDS[role]) throw ApiError.badRequest('Invalid role.');

  if (user.role === 'ADMIN') {
    if (role !== 'ADMIN' && !baseId) {
      throw ApiError.badRequest('baseId is required for non-Admin roles.');
    }
  } else if (user.role === 'BASE_COMMANDER') {
    if (!user.canCreateUsers) throw ApiError.forbidden('Your account is not permitted to create users.');
    if (role !== 'LOGISTICS_OFFICER') {
      throw ApiError.forbidden('Base Commanders may only create Logistics Officer accounts.');
    }
    baseId = user.baseId; // force own base regardless of what was sent
  } else {
    throw ApiError.forbidden();
  }

  const passwordHash = await hashPassword(password);

  // Every admin-issued password is a temporary one: must_change_password
  // starts TRUE, so the frontend forces a change-password screen on the
  // new user's first sign-in (see auth.service.js / PATCH /auth/change-password).
  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO users (name, username, service_id, password_hash, role_id, base_id, can_create_users, is_active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)`,
      [name.trim(), username.trim(), serviceId.trim(), passwordHash, ROLE_IDS[role], role === 'ADMIN' ? null : baseId]
    );

    await auditService.log(
      { actorId: user.id, action: 'USER_CREATED', entityType: 'user', entityId: result.insertId, details: { username, serviceId, role, baseId } },
      conn
    );

    const [[created]] = await conn.query(
      `SELECT u.id, u.name, u.username, u.service_id AS serviceId, r.code AS role, u.base_id AS baseId, u.is_active AS isActive
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [result.insertId]
    );
    return { ...created, isActive: Boolean(created.isActive) };
  });
}

// FR-08: update/deactivate. Users cannot escalate their own role or base
// (section 3.4) — this endpoint only ever touches isActive and name here;
// role/base reassignment is intentionally out of scope for the initial
// framework and would need its own explicit admin-only path.
async function update(user, targetId, { isActive, name }) {
  if (String(targetId) === String(user.id) && isActive === false) {
    throw ApiError.badRequest('You cannot deactivate your own account.');
  }

  const [rows] = await pool.query('SELECT id, base_id AS baseId FROM users WHERE id = ?', [targetId]);
  const target = rows[0];
  if (!target) throw ApiError.notFound('User not found.');

  if (user.role === 'BASE_COMMANDER' && String(target.baseId) !== String(user.baseId)) {
    throw ApiError.forbidden('You can only manage users at your own base.');
  }
  if (user.role === 'LOGISTICS_OFFICER') throw ApiError.forbidden();

  const fields = [];
  const params = [];
  if (typeof isActive === 'boolean') { fields.push('is_active = ?'); params.push(isActive); }
  if (typeof name === 'string' && name.trim()) { fields.push('name = ?'); params.push(name.trim()); }
  if (fields.length === 0) throw ApiError.badRequest('Nothing to update.');

  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...params, targetId]);
  await auditService.log({ actorId: user.id, action: 'USER_UPDATED', entityType: 'user', entityId: targetId, details: { isActive, name } });

  const [[updated]] = await pool.query(
    `SELECT u.id, u.name, u.username, r.code AS role, u.base_id AS baseId, u.is_active AS isActive
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [targetId]
  );
  return { ...updated, isActive: Boolean(updated.isActive) };
}

module.exports = { list, create, update };
