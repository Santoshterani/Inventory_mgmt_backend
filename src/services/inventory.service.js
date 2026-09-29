const { pool } = require('../db/pool');
const { resolveReadBaseId } = require('../middleware/baseScope');

async function list(user, { baseId, equipmentTypeId, page = 1, pageSize = 10 }) {
  const effectiveBaseId = resolveReadBaseId(user, baseId);
  const where = [];
  const params = [];
  if (effectiveBaseId) {
    where.push('i.base_id = ?');
    params.push(effectiveBaseId);
  }
  if (equipmentTypeId) {
    where.push('i.equipment_type_id = ?');
    params.push(equipmentTypeId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT i.id, i.base_id AS baseId, b.name AS baseName,
            i.equipment_type_id AS equipmentTypeId, et.name AS equipmentTypeName,
            i.total_quantity AS totalHoldings, i.assigned_quantity AS assigned,
            (i.total_quantity - i.assigned_quantity - i.reserved_quantity) AS availableStock
     FROM inventory i
     JOIN bases b ON b.id = i.base_id
     JOIN equipment_types et ON et.id = i.equipment_type_id
     ${whereSql}
     ORDER BY b.name, et.name
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventory i ${whereSql}`,
    params
  );

  const [bases] = await pool.query(
    effectiveBaseId
      ? 'SELECT id, name FROM bases WHERE id = ? AND is_active = 1'
      : 'SELECT id, name FROM bases WHERE is_active = 1 ORDER BY name',
    effectiveBaseId ? [effectiveBaseId] : []
  );
  const [equipmentTypes] = await pool.query(
    'SELECT id, name FROM equipment_types WHERE is_active = 1 ORDER BY name'
  );

  return { items: rows, total, bases, equipmentTypes };
}

module.exports = { list };
