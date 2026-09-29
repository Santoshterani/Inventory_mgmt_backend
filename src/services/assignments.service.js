const ApiError = require('../utils/ApiError');
const { pool, withTransaction } = require('../db/pool');
const { resolveReadBaseId, assertWritableBase } = require('../middleware/baseScope');
const auditService = require('./audit.service');

async function list(user, { baseId, status, page = 1, pageSize = 10 }) {
  const effectiveBaseId = resolveReadBaseId(user, baseId);
  const where = [];
  const params = [];
  if (effectiveBaseId) { where.push('a.base_id = ?'); params.push(effectiveBaseId); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT a.id, a.base_id AS baseId, b.name AS baseName,
            a.equipment_type_id AS equipmentTypeId, et.name AS equipmentTypeName,
            a.quantity, a.personnel_name AS personnelName, a.status,
            a.assigned_by AS assignedBy, u.name AS assignedByName,
            a.assigned_at AS assignedAt, a.returned_at AS returnedAt
     FROM assignments a
     JOIN bases b ON b.id = a.base_id
     JOIN equipment_types et ON et.id = a.equipment_type_id
     JOIN users u ON u.id = a.assigned_by
     ${whereSql}
     ORDER BY a.assigned_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM assignments a ${whereSql}`,
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

async function getById(user, id) {
  const [rows] = await pool.query(
    `SELECT a.id, a.base_id AS baseId, b.name AS baseName,
            a.equipment_type_id AS equipmentTypeId, et.name AS equipmentTypeName,
            a.quantity, a.personnel_name AS personnelName, a.status,
            a.assigned_by AS assignedBy, u.name AS assignedByName, a.assigned_at AS assignedAt
     FROM assignments a
     JOIN bases b ON b.id = a.base_id
     JOIN equipment_types et ON et.id = a.equipment_type_id
     JOIN users u ON u.id = a.assigned_by
     WHERE a.id = ?`,
    [id]
  );
  const assignment = rows[0];
  if (!assignment) throw ApiError.notFound('Assignment not found.');
  const scoped = resolveReadBaseId(user, assignment.baseId);
  if (scoped && String(scoped) !== String(assignment.baseId)) throw ApiError.forbidden();
  return assignment;
}

// FR-06: check available stock, then assign atomically.
async function create(user, { baseId, equipmentTypeId, quantity, personnelName }) {
  if (!baseId || !equipmentTypeId || !quantity || quantity <= 0 || !personnelName?.trim()) {
    throw ApiError.badRequest('baseId, equipmentTypeId, a positive quantity, and personnelName are required.');
  }
  assertWritableBase(user, baseId);

  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT total_quantity AS total, assigned_quantity AS assigned, reserved_quantity AS reserved
       FROM inventory WHERE base_id = ? AND equipment_type_id = ? FOR UPDATE`,
      [baseId, equipmentTypeId]
    );
    const inv = rows[0];
    const available = inv ? inv.total - inv.assigned - inv.reserved : 0;
    if (quantity > available) {
      throw ApiError.conflict(`Insufficient available stock (available: ${available}).`);
    }

    const [result] = await conn.query(
      `INSERT INTO assignments (base_id, equipment_type_id, quantity, personnel_name, assigned_by, status)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
      [baseId, equipmentTypeId, quantity, personnelName.trim(), user.id]
    );

    await conn.query(
      `UPDATE inventory SET assigned_quantity = assigned_quantity + ?
       WHERE base_id = ? AND equipment_type_id = ?`,
      [quantity, baseId, equipmentTypeId]
    );

    await auditService.log(
      { actorId: user.id, action: 'ASSIGNMENT_CREATED', entityType: 'assignment', entityId: result.insertId, details: { baseId, equipmentTypeId, quantity, personnelName } },
      conn
    );

    return getById(user, result.insertId);
  });
}

module.exports = { list, getById, create };
