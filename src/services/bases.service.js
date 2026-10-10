const ApiError = require('../utils/ApiError');
const { pool, withTransaction } = require('../db/pool');
const auditService = require('./audit.service');

async function list() {
  const [rows] = await pool.query(
    'SELECT id, name, location, is_active FROM bases ORDER BY name'
  );
  return rows;
}

async function update(user, targetId, { name, location, isActive } = {}) {
  if (!Number.isInteger(Number(targetId)) || Number(targetId) <= 0) {
    throw ApiError.badRequest('Valid id is required.');
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    throw ApiError.badRequest('name must be a non-empty string.');
  }
  if (location !== undefined && location !== null && typeof location !== 'string') {
    throw ApiError.badRequest('location must be a string or null.');
  }
  if (isActive !== undefined && typeof isActive !== 'boolean') {
    throw ApiError.badRequest('isActive must be a boolean.');
  }

  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
  if (location !== undefined) { fields.push('location = ?'); values.push(location === null ? null : location.trim()); }
  if (isActive !== undefined) { fields.push('is_active = ?'); values.push(isActive); }
  if (!fields.length) throw ApiError.badRequest('Nothing to update.');

  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `UPDATE bases SET ${fields.join(', ')} WHERE id = ?`,
      [...values, targetId]
    );
    if (result.affectedRows === 0) {
      const [rows] = await conn.query('SELECT id FROM bases WHERE id = ?', [targetId]);
      if (!rows.length) throw ApiError.notFound('Base not found.');
    }

    const [[base]] = await conn.query(
      'SELECT id, name, location, is_active AS isActive FROM bases WHERE id = ?',
      [targetId]
    );
    base.isActive = Boolean(base.isActive);

    await auditService.log(
      {
        actorId: user.id,
        action: 'BASE_UPDATED',
        entityType: 'base',
        entityId: Number(targetId),
        details: { name, location, isActive },
      },
      conn
    );

    return base;
  });
}

module.exports = { list, update };
