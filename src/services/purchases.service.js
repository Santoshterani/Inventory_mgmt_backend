const ApiError = require('../utils/ApiError');
const { pool, withTransaction } = require('../db/pool');
const { resolveReadBaseId, assertWritableBase } = require('../middleware/baseScope');
const auditService = require('./audit.service');

async function list(user, { baseId, equipmentTypeId, from, to, page = 1, pageSize = 10 }) {
  const effectiveBaseId = resolveReadBaseId(user, baseId);
  const where = [];
  const params = [];
  if (effectiveBaseId) { where.push('p.base_id = ?'); params.push(effectiveBaseId); }
  if (equipmentTypeId) { where.push('p.equipment_type_id = ?'); params.push(equipmentTypeId); }
  if (from) { where.push('p.purchase_date >= ?'); params.push(from); }
  if (to) { where.push('p.purchase_date <= ?'); params.push(to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT p.id, p.base_id AS baseId, b.name AS baseName,
            p.equipment_type_id AS equipmentTypeId, et.name AS equipmentTypeName,
            p.quantity, p.purchase_date AS purchaseDate,
            p.created_by AS createdBy, u.name AS createdByName, p.created_at AS createdAt
     FROM purchases p
     JOIN bases b ON b.id = p.base_id
     JOIN equipment_types et ON et.id = p.equipment_type_id
     JOIN users u ON u.id = p.created_by
     ${whereSql}
     ORDER BY p.purchase_date DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM purchases p ${whereSql}`,
    params
  );

  const [bases] = await pool.query(
    effectiveBaseId
      ? 'SELECT id, name FROM bases WHERE id = ?'
      : 'SELECT id, name FROM bases WHERE is_active = 1 ORDER BY name',
    effectiveBaseId ? [effectiveBaseId] : []
  );
  const [equipmentTypes] = await pool.query(
    'SELECT id, name FROM equipment_types WHERE is_active = 1 ORDER BY name'
  );

  return { items: rows, total, bases, equipmentTypes };
}

async function getById(user, id, executor = pool) {
  const [rows] = await executor.query(
    `SELECT p.id, p.base_id AS baseId, b.name AS baseName,
            p.equipment_type_id AS equipmentTypeId, et.name AS equipmentTypeName,
            p.quantity, p.purchase_date AS purchaseDate,
            p.created_by AS createdBy, u.name AS createdByName, p.created_at AS createdAt
     FROM purchases p
     JOIN bases b ON b.id = p.base_id
     JOIN equipment_types et ON et.id = p.equipment_type_id
     JOIN users u ON u.id = p.created_by
     WHERE p.id = ?`,
    [id]
  );
  const purchase = rows[0];
  if (!purchase) throw ApiError.notFound('Purchase not found.');

  const scoped = resolveReadBaseId(user, purchase.baseId);
  if (scoped && String(scoped) !== String(purchase.baseId)) {
    throw ApiError.forbidden();
  }
  return purchase;
}

// FR-04: recording a purchase and updating inventory must be atomic.
async function create(user, { baseId, equipmentTypeId, quantity, purchaseDate }) {
  if (!baseId || !equipmentTypeId || !quantity || quantity <= 0 || !purchaseDate) {
    throw ApiError.badRequest('baseId, equipmentTypeId, a positive quantity, and purchaseDate are required.');
  }
  assertWritableBase(user, baseId);

  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO purchases (base_id, equipment_type_id, quantity, purchase_date, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [baseId, equipmentTypeId, quantity, purchaseDate, user.id]
    );

    await conn.query(
      `INSERT INTO inventory (base_id, equipment_type_id, total_quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE total_quantity = total_quantity + VALUES(total_quantity)`,
      [baseId, equipmentTypeId, quantity]
    );

    await auditService.log(
      {
        actorId: user.id,
        action: 'PURCHASE_CREATED',
        entityType: 'purchase',
        entityId: result.insertId,
        details: { baseId, equipmentTypeId, quantity, purchaseDate },
      },
      conn
    );

    return getById(user, result.insertId, conn);
  });
}

module.exports = { list, getById, create };
