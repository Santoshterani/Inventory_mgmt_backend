const ApiError = require('../utils/ApiError');
const { pool, withTransaction } = require('../db/pool');
const { resolveReadBaseId } = require('../middleware/baseScope');
const auditService = require('./audit.service');

async function list(user, { baseId, page = 1, pageSize = 10 }) {
  const effectiveBaseId = resolveReadBaseId(user, baseId);
  const where = [];
  const params = [];
  if (effectiveBaseId) { where.push('a.base_id = ?'); params.push(effectiveBaseId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT e.id, e.assignment_id AS assignmentId, a.equipment_type_id AS equipmentTypeId,
            et.name AS equipmentTypeName, e.quantity, e.remarks,
            e.recorded_by AS recordedBy, u.name AS recordedByName, e.expended_at AS expendedAt
     FROM expenditures e
     JOIN assignments a ON a.id = e.assignment_id
     JOIN equipment_types et ON et.id = a.equipment_type_id
     JOIN users u ON u.id = e.recorded_by
     ${whereSql}
     ORDER BY e.expended_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM expenditures e JOIN assignments a ON a.id = e.assignment_id ${whereSql}`,
    params
  );

  const [bases] = await pool.query(
    effectiveBaseId
      ? 'SELECT id, name FROM bases WHERE id = ?'
      : 'SELECT id, name FROM bases WHERE is_active = 1 ORDER BY name',
    effectiveBaseId ? [effectiveBaseId] : []
  );

  return { items: rows, total, bases };
}

// FR-07: expenditure must not exceed the quantity available under the
// assignment (assignment quantity minus what's already been expended).
async function create(user, { assignmentId, quantity, remarks }) {
  if (!assignmentId || !quantity || quantity <= 0) {
    throw ApiError.badRequest('assignmentId and a positive quantity are required.');
  }

  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, base_id AS baseId, equipment_type_id AS equipmentTypeId, quantity, status
       FROM assignments WHERE id = ? FOR UPDATE`,
      [assignmentId]
    );
    const assignment = rows[0];
    if (!assignment) throw ApiError.notFound('Assignment not found.');

    const scoped = resolveReadBaseId(user, assignment.baseId);
    if (scoped && String(scoped) !== String(assignment.baseId)) throw ApiError.forbidden();

    const [[{ alreadyExpended }]] = await conn.query(
      `SELECT COALESCE(SUM(quantity), 0) AS alreadyExpended FROM expenditures WHERE assignment_id = ?`,
      [assignmentId]
    );
    const remaining = assignment.quantity - alreadyExpended;
    if (quantity > remaining) {
      throw ApiError.conflict(`Exceeds quantity available under this assignment (remaining: ${remaining}).`);
    }

    const [result] = await conn.query(
      `INSERT INTO expenditures (assignment_id, quantity, recorded_by, remarks)
       VALUES (?, ?, ?, ?)`,
      [assignmentId, quantity, user.id, remarks || null]
    );

    // Expended units leave both total holdings and the assigned pool
    // (section 9: closing balance = opening + net movement − expended).
    await conn.query(
      `UPDATE inventory SET total_quantity = total_quantity - ?, assigned_quantity = assigned_quantity - ?
       WHERE base_id = ? AND equipment_type_id = ?`,
      [quantity, quantity, assignment.baseId, assignment.equipmentTypeId]
    );

    // Note: expenditure is consumption, not a return — the assignment's
    // ACTIVE/RETURNED status is reserved for the (not-yet-implemented)
    // returns workflow from section 13, Q4, and is left untouched here.

    await auditService.log(
      { actorId: user.id, action: 'EXPENDITURE_RECORDED', entityType: 'expenditure', entityId: result.insertId, details: { assignmentId, quantity, remarks } },
      conn
    );

    const [[created]] = await conn.query(
      `SELECT e.id, e.assignment_id AS assignmentId, e.quantity, e.remarks,
              e.recorded_by AS recordedBy, e.expended_at AS expendedAt
       FROM expenditures e WHERE e.id = ?`,
      [result.insertId]
    );
    return created;
  });
}

module.exports = { list, create };
