const ApiError = require('../utils/ApiError');
const { pool, withTransaction } = require('../db/pool');
const { resolveReadBaseId } = require('../middleware/baseScope');
const auditService = require('./audit.service');

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

// Admin has to be able to add inventory items directly — e.g. an initial
// stock load, or a correction — separate from the purchase/transfer flows.
// mode 'add' increments total_quantity; 'set' overwrites it outright.
// Both run inside a transaction and are audit-logged like every other
// inventory-affecting write (FR-03/NFR-03, FR-09).
async function upsert(user, { baseId, equipmentTypeId, quantity, mode = 'add', reason }) {
  if (!baseId || !equipmentTypeId || quantity == null || quantity < 0) {
    throw ApiError.badRequest('baseId, equipmentTypeId, and a non-negative quantity are required.');
  }
  if (!['add', 'set'].includes(mode)) {
    throw ApiError.badRequest("mode must be 'add' or 'set'.");
  }

  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT total_quantity AS total, assigned_quantity AS assigned, reserved_quantity AS reserved
       FROM inventory WHERE base_id = ? AND equipment_type_id = ? FOR UPDATE`,
      [baseId, equipmentTypeId]
    );
    const existing = rows[0];

    if (mode === 'set') {
      const committed = existing ? existing.assigned + existing.reserved : 0;
      if (quantity < committed) {
        throw ApiError.conflict(
          `Cannot set total below what is already assigned/reserved (${committed}).`
        );
      }
    }

    await conn.query(
      `INSERT INTO inventory (base_id, equipment_type_id, total_quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE total_quantity = ${mode === 'add' ? 'total_quantity + VALUES(total_quantity)' : 'VALUES(total_quantity)'}`,
      [baseId, equipmentTypeId, quantity]
    );

    await auditService.log(
      {
        actorId: user.id,
        action: 'INVENTORY_ADJUSTED',
        entityType: 'inventory',
        entityId: `${baseId}:${equipmentTypeId}`,
        details: { baseId, equipmentTypeId, quantity, mode, reason },
      },
      conn
    );

    const [[updated]] = await conn.query(
      `SELECT i.base_id AS baseId, b.name AS baseName, i.equipment_type_id AS equipmentTypeId,
              et.name AS equipmentTypeName, i.total_quantity AS totalHoldings, i.assigned_quantity AS assigned,
              (i.total_quantity - i.assigned_quantity - i.reserved_quantity) AS availableStock
       FROM inventory i JOIN bases b ON b.id = i.base_id JOIN equipment_types et ON et.id = i.equipment_type_id
       WHERE i.base_id = ? AND i.equipment_type_id = ?`,
      [baseId, equipmentTypeId]
    );
    return updated;
  });
}

module.exports = { list, upsert };
