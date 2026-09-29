const { pool } = require('../db/pool');

// Inserts an audit record. Accepts an optional `conn` so callers can log
// within the same DB transaction as the business write it documents
// (NFR-04: "audit logging should be committed consistently with the
// business transaction where possible").
async function log({ actorId, action, entityType, entityId, details }, conn = pool) {
  await conn.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`,
    [actorId ?? null, action, entityType, entityId != null ? String(entityId) : null, JSON.stringify(details ?? {})]
  );
}

async function list({ page = 1, pageSize = 20, entityType, actorId }) {
  const where = [];
  const params = [];
  if (entityType) {
    where.push('entity_type = ?');
    params.push(entityType);
  }
  if (actorId) {
    where.push('actor_id = ?');
    params.push(actorId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT al.id, al.action, al.entity_type AS entityType, al.entity_id AS entityId,
            al.details, al.created_at AS createdAt, u.name AS actorName
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     ${whereSql}
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM audit_logs al ${whereSql}`,
    params
  );

  return { items: rows, total };
}

module.exports = { log, list };
