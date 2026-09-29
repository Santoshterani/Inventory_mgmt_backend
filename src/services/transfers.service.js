const ApiError = require('../utils/ApiError');
const { pool, withTransaction } = require('../db/pool');
const { isBaseScoped } = require('../middleware/baseScope');
const auditService = require('./audit.service');

const VALID_STATUSES = ['PENDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'];

// Allowed transitions. Confirm the real lifecycle per requirements.md
// section 13, Q2/Q3 — this is a reasonable default in the meantime.
const TRANSITIONS = {
  PENDING: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

function assertBaseVisible(user, baseId) {
  if (isBaseScoped(user.role) && String(user.baseId) !== String(baseId)) {
    throw ApiError.forbidden();
  }
}

async function list(user, { status, page = 1, pageSize = 10 }) {
  const where = [];
  const params = [];
  if (isBaseScoped(user.role)) {
    where.push('(t.source_base_id = ? OR t.destination_base_id = ?)');
    params.push(user.baseId, user.baseId);
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT t.id, t.source_base_id AS sourceBaseId, sb.name AS sourceBaseName,
            t.destination_base_id AS destinationBaseId, db.name AS destinationBaseName,
            t.status, t.created_at AS createdAt, t.created_by AS createdBy, u.name AS createdByName,
            (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.id) AS itemCount
     FROM transfers t
     JOIN bases sb ON sb.id = t.source_base_id
     JOIN bases db ON db.id = t.destination_base_id
     JOIN users u ON u.id = t.created_by
     ${whereSql}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM transfers t ${whereSql}`,
    params
  );

  const [bases] = await pool.query('SELECT id, name FROM bases WHERE is_active = 1 ORDER BY name');
  const [equipmentTypes] = await pool.query(
    'SELECT id, name FROM equipment_types WHERE is_active = 1 ORDER BY name'
  );

  return { items: rows, total, bases, equipmentTypes };
}

async function getById(user, id) {
  const [rows] = await pool.query(
    `SELECT t.id, t.source_base_id AS sourceBaseId, sb.name AS sourceBaseName,
            t.destination_base_id AS destinationBaseId, db.name AS destinationBaseName,
            t.status, t.created_at AS createdAt, t.created_by AS createdBy, u.name AS createdByName
     FROM transfers t
     JOIN bases sb ON sb.id = t.source_base_id
     JOIN bases db ON db.id = t.destination_base_id
     JOIN users u ON u.id = t.created_by
     WHERE t.id = ?`,
    [id]
  );
  const transfer = rows[0];
  if (!transfer) throw ApiError.notFound('Transfer not found.');
  if (isBaseScoped(user.role) &&
      String(user.baseId) !== String(transfer.sourceBaseId) &&
      String(user.baseId) !== String(transfer.destinationBaseId)) {
    throw ApiError.forbidden();
  }

  const [items] = await pool.query(
    `SELECT ti.id, ti.equipment_type_id AS equipmentTypeId, et.name AS equipmentTypeName, ti.quantity
     FROM transfer_items ti JOIN equipment_types et ON et.id = ti.equipment_type_id
     WHERE ti.transfer_id = ?`,
    [id]
  );
  const [statusHistory] = await pool.query(
    `SELECT tsh.status, tsh.changed_at AS changedAt, u.name AS changedByName
     FROM transfer_status_history tsh JOIN users u ON u.id = tsh.changed_by
     WHERE tsh.transfer_id = ? ORDER BY tsh.changed_at ASC`,
    [id]
  );

  return { ...transfer, items, statusHistory };
}

// FR-05: create transfer + reserve source stock atomically. Reservation
// (not yet a total_quantity change) is what keeps "available stock" honest
// while the transfer is PENDING/IN_TRANSIT, and what lets us guarantee
// available inventory never goes negative.
async function create(user, { sourceBaseId, destinationBaseId, items }) {
  if (!sourceBaseId || !destinationBaseId || sourceBaseId === destinationBaseId) {
    throw ApiError.badRequest('sourceBaseId and destinationBaseId are required and must differ.');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('At least one transfer item is required.');
  }
  for (const item of items) {
    if (!item.equipmentTypeId || !item.quantity || item.quantity <= 0) {
      throw ApiError.badRequest('Each item needs a valid equipmentTypeId and a positive quantity.');
    }
  }
  assertBaseVisible(user, sourceBaseId);

  return withTransaction(async (conn) => {
    for (const item of items) {
      // Row-lock the inventory record so concurrent transfers/assignments
      // against the same (base, type) can't both pass the stock check.
      const [rows] = await conn.query(
        `SELECT total_quantity AS total, assigned_quantity AS assigned, reserved_quantity AS reserved
         FROM inventory WHERE base_id = ? AND equipment_type_id = ? FOR UPDATE`,
        [sourceBaseId, item.equipmentTypeId]
      );
      const inv = rows[0] || { total: 0, assigned: 0, reserved: 0 };
      const available = inv.total - inv.assigned - inv.reserved;
      if (item.quantity > available) {
        throw ApiError.conflict(
          `Insufficient available stock for equipment type ${item.equipmentTypeId} (available: ${available}).`
        );
      }
    }

    const [result] = await conn.query(
      `INSERT INTO transfers (source_base_id, destination_base_id, status, created_by)
       VALUES (?, ?, 'PENDING', ?)`,
      [sourceBaseId, destinationBaseId, user.id]
    );
    const transferId = result.insertId;

    for (const item of items) {
      await conn.query(
        `INSERT INTO transfer_items (transfer_id, equipment_type_id, quantity) VALUES (?, ?, ?)`,
        [transferId, item.equipmentTypeId, item.quantity]
      );
      await conn.query(
        `UPDATE inventory SET reserved_quantity = reserved_quantity + ?
         WHERE base_id = ? AND equipment_type_id = ?`,
        [item.quantity, sourceBaseId, item.equipmentTypeId]
      );
    }

    await conn.query(
      `INSERT INTO transfer_status_history (transfer_id, status, changed_by) VALUES (?, 'PENDING', ?)`,
      [transferId, user.id]
    );
    await auditService.log(
      { actorId: user.id, action: 'TRANSFER_CREATED', entityType: 'transfer', entityId: transferId, details: { sourceBaseId, destinationBaseId, items } },
      conn
    );

    return getById(user, transferId);
  });
}

// FR-05: status changes drive the actual inventory movement, guarded so a
// retried request or a race can never apply the same effect twice — the
// UPDATE ... WHERE status = ? only succeeds once per transition, and we
// check affectedRows before applying any inventory change.
async function changeStatus(user, id, nextStatus) {
  if (!VALID_STATUSES.includes(nextStatus)) {
    throw ApiError.badRequest('Invalid status.');
  }

  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, source_base_id AS sourceBaseId, destination_base_id AS destinationBaseId, status
       FROM transfers WHERE id = ? FOR UPDATE`,
      [id]
    );
    const transfer = rows[0];
    if (!transfer) throw ApiError.notFound('Transfer not found.');
    assertBaseVisible(user, transfer.sourceBaseId);

    const allowed = TRANSITIONS[transfer.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw ApiError.conflict(
        `Cannot move a transfer from ${transfer.status} to ${nextStatus}.`
      );
    }

    // Idempotency guard: only proceed if the row is still in the expected
    // current status at the moment of update (protects against retries and
    // concurrent double-submits applying the same effect twice).
    const [updateResult] = await conn.query(
      `UPDATE transfers SET status = ? WHERE id = ? AND status = ?`,
      [nextStatus, id, transfer.status]
    );
    if (updateResult.affectedRows === 0) {
      throw ApiError.conflict('This transfer was already updated by another request.');
    }

    const [items] = await conn.query(
      `SELECT equipment_type_id AS equipmentTypeId, quantity FROM transfer_items WHERE transfer_id = ?`,
      [id]
    );

    if (nextStatus === 'COMPLETED') {
      for (const item of items) {
        await conn.query(
          `UPDATE inventory SET total_quantity = total_quantity - ?, reserved_quantity = reserved_quantity - ?
           WHERE base_id = ? AND equipment_type_id = ?`,
          [item.quantity, item.quantity, transfer.sourceBaseId, item.equipmentTypeId]
        );
        await conn.query(
          `INSERT INTO inventory (base_id, equipment_type_id, total_quantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE total_quantity = total_quantity + VALUES(total_quantity)`,
          [transfer.destinationBaseId, item.equipmentTypeId, item.quantity]
        );
      }
    } else if (nextStatus === 'CANCELLED') {
      for (const item of items) {
        await conn.query(
          `UPDATE inventory SET reserved_quantity = reserved_quantity - ?
           WHERE base_id = ? AND equipment_type_id = ?`,
          [item.quantity, transfer.sourceBaseId, item.equipmentTypeId]
        );
      }
    }
    // IN_TRANSIT: reservation already in place at creation; no further change.

    await conn.query(
      `INSERT INTO transfer_status_history (transfer_id, status, changed_by) VALUES (?, ?, ?)`,
      [id, nextStatus, user.id]
    );
    await auditService.log(
      { actorId: user.id, action: 'TRANSFER_STATUS_CHANGED', entityType: 'transfer', entityId: id, details: { from: transfer.status, to: nextStatus } },
      conn
    );

    return getById(user, id);
  });
}

module.exports = { list, getById, create, changeStatus };
