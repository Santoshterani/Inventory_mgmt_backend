const ApiError = require('../utils/ApiError');
const { pool, withTransaction } = require('../db/pool');
const auditService = require('./audit.service');

async function list() {
  const [rows] = await pool.query(
    `SELECT id, name, category, unit,is_active
     FROM equipment_types
     ORDER BY name`
  );
  return rows;
}

async function create(user, { name, category, unit = 'unit' }) {
  if (typeof name !== 'string' || !name.trim()) {
    throw ApiError.badRequest('name is required.');
  }
  if (category != null && typeof category !== 'string') {
    throw ApiError.badRequest('category must be a string.');
  }
  if (typeof unit !== 'string' || !unit.trim()) {
    throw ApiError.badRequest('unit must be a non-empty string.');
  }

  const values = {
    name: name.trim(),
    category: typeof category === 'string' && category.trim() ? category.trim() : null,
    unit: unit.trim(),
  };

  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO equipment_types (name, category, unit)
       VALUES (?, ?, ?)`,
      [values.name, values.category, values.unit]
    );
    const [[equipmentType]] = await conn.query(
      `SELECT id, name, category, unit
       FROM equipment_types
       WHERE id = ?`,
      [result.insertId]
    );

    await auditService.log(
      {
        actorId: user.id,
        action: 'EQUIPMENT_TYPE_CREATED',
        entityType: 'equipment_type',
        entityId: result.insertId,
        details: values,
      },
      conn
    );

    return equipmentType;
  });
}

async function update(user, targetId, { name, category, unit, isActive } = {}) {
  if (!Number.isInteger(Number(targetId)) || Number(targetId) <= 0) {
    throw ApiError.badRequest('Valid id is required.');
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    throw ApiError.badRequest('name must be a non-empty string.');
  }
  if (category !== undefined && category !== null && typeof category !== 'string') {
    throw ApiError.badRequest('category must be a string or null.');
  }
  if (unit !== undefined && (typeof unit !== 'string' || !unit.trim())) {
    throw ApiError.badRequest('unit must be a non-empty string.');
  }
  if (isActive !== undefined && typeof isActive !== 'boolean') {
    throw ApiError.badRequest('isActive must be a boolean.');
  }

  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
  if (category !== undefined) {
    fields.push('category = ?');
    values.push(typeof category === 'string' && category.trim() ? category.trim() : null);
  }
  if (unit !== undefined) { fields.push('unit = ?'); values.push(unit.trim()); }
  if (isActive !== undefined) { fields.push('is_active = ?'); values.push(isActive); }
  if (!fields.length) throw ApiError.badRequest('Nothing to update.');

  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `UPDATE equipment_types SET ${fields.join(', ')} WHERE id = ?`,
      [...values, targetId]
    );

    if (result.affectedRows === 0) {
      const [rows] = await conn.query('SELECT id FROM equipment_types WHERE id = ?', [targetId]);
      if (!rows.length) throw ApiError.notFound('Equipment type not found.');
    }

    const [[equipmentType]] = await conn.query(
      `SELECT id, name, category, unit, is_active
       FROM equipment_types
       WHERE id = ?`,
      [targetId]
    );
    equipmentType.is_active = Boolean(equipmentType.is_active);

    await auditService.log(
      {
        actorId: user.id,
        action: 'EQUIPMENT_TYPE_UPDATED',
        entityType: 'equipment_type',
        entityId: Number(targetId),
        details: { name, category, unit, isActive },
      },
      conn
    );

    return equipmentType;
  });
}

module.exports = { list, create, update};
