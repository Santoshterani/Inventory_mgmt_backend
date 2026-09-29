const { pool } = require('../db/pool');
const { resolveReadBaseId } = require('../middleware/baseScope');

function baseFilterSql(effectiveBaseId, column) {
  return effectiveBaseId ? `AND ${column} = ${pool.escape(effectiveBaseId)}` : '';
}

// section 9: net movement = purchases + completed transfers in − completed
// transfers out, over [from, to]. Closing = opening + net − expended.
// Opening is derived, not stored, so it's always reproducible from history.
async function getMetrics(user, { from, to, baseId, equipmentTypeId }) {
  const effectiveBaseId = resolveReadBaseId(user, baseId);
  const typeFilter = equipmentTypeId ? `AND equipment_type_id = ${pool.escape(equipmentTypeId)}` : '';

  const [[{ purchases }]] = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0) AS purchases FROM purchases
     WHERE purchase_date BETWEEN ? AND ? ${baseFilterSql(effectiveBaseId, 'base_id')} ${typeFilter}`,
    [from, to]
  );

  const [[{ transfersIn }]] = await pool.query(
    `SELECT COALESCE(SUM(ti.quantity), 0) AS transfersIn
     FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id
     WHERE t.status = 'COMPLETED' AND DATE(t.updated_at) BETWEEN ? AND ?
     ${baseFilterSql(effectiveBaseId, 't.destination_base_id')}
     ${equipmentTypeId ? `AND ti.equipment_type_id = ${pool.escape(equipmentTypeId)}` : ''}`,
    [from, to]
  );

  const [[{ transfersOut }]] = await pool.query(
    `SELECT COALESCE(SUM(ti.quantity), 0) AS transfersOut
     FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id
     WHERE t.status = 'COMPLETED' AND DATE(t.updated_at) BETWEEN ? AND ?
     ${baseFilterSql(effectiveBaseId, 't.source_base_id')}
     ${equipmentTypeId ? `AND ti.equipment_type_id = ${pool.escape(equipmentTypeId)}` : ''}`,
    [from, to]
  );

  const [[{ expended }]] = await pool.query(
    `SELECT COALESCE(SUM(e.quantity), 0) AS expended
     FROM expenditures e JOIN assignments a ON a.id = e.assignment_id
     WHERE DATE(e.expended_at) BETWEEN ? AND ? ${baseFilterSql(effectiveBaseId, 'a.base_id')}
     ${equipmentTypeId ? `AND a.equipment_type_id = ${pool.escape(equipmentTypeId)}` : ''}`,
    [from, to]
  );

  const [[{ totalHoldings }]] = await pool.query(
    `SELECT COALESCE(SUM(total_quantity), 0) AS totalHoldings FROM inventory
     WHERE 1=1 ${baseFilterSql(effectiveBaseId, 'base_id')} ${typeFilter}`
  );
  const [[{ assignedAssets }]] = await pool.query(
    `SELECT COALESCE(SUM(assigned_quantity), 0) AS assignedAssets FROM inventory
     WHERE 1=1 ${baseFilterSql(effectiveBaseId, 'base_id')} ${typeFilter}`
  );

  const netMovement = purchases + transfersIn - transfersOut;
  const closingBalance = totalHoldings; // current holdings, as of now
  const openingBalance = closingBalance - netMovement + expended;

  const [bases] = await pool.query(
    effectiveBaseId
      ? 'SELECT id, name FROM bases WHERE id = ?'
      : 'SELECT id, name FROM bases WHERE is_active = 1 ORDER BY name',
    effectiveBaseId ? [effectiveBaseId] : []
  );
  const [equipmentTypes] = await pool.query(
    'SELECT id, name FROM equipment_types WHERE is_active = 1 ORDER BY name'
  );

  return {
    openingBalance,
    closingBalance,
    netMovement,
    purchases,
    transfersIn,
    transfersOut,
    assignedAssets,
    expendedAssets: expended,
    bases,
    equipmentTypes,
  };
}

// FR-02 bonus: net-movement drill-down for the dialog.
async function getNetMovementDetails(user, { from, to, baseId, equipmentTypeId }) {
  const effectiveBaseId = resolveReadBaseId(user, baseId);
  const typeFilter = equipmentTypeId ? `AND p.equipment_type_id = ${pool.escape(equipmentTypeId)}` : '';

  const [purchaseRows] = await pool.query(
    `SELECT p.id, p.purchase_date AS date, 'PURCHASE' AS type, et.name AS equipmentTypeName, p.quantity
     FROM purchases p JOIN equipment_types et ON et.id = p.equipment_type_id
     WHERE p.purchase_date BETWEEN ? AND ? ${baseFilterSql(effectiveBaseId, 'p.base_id')} ${typeFilter}
     ORDER BY p.purchase_date DESC`,
    [from, to]
  );

  const [transferRows] = await pool.query(
    `SELECT t.id, DATE(t.updated_at) AS date,
            IF(t.destination_base_id = ${effectiveBaseId ? pool.escape(effectiveBaseId) : 't.destination_base_id'}, 'TRANSFER_IN', 'TRANSFER_OUT') AS type,
            et.name AS equipmentTypeName, ti.quantity
     FROM transfers t
     JOIN transfer_items ti ON ti.transfer_id = t.id
     JOIN equipment_types et ON et.id = ti.equipment_type_id
     WHERE t.status = 'COMPLETED' AND DATE(t.updated_at) BETWEEN ? AND ?
     ${effectiveBaseId ? `AND (t.source_base_id = ${pool.escape(effectiveBaseId)} OR t.destination_base_id = ${pool.escape(effectiveBaseId)})` : ''}
     ${equipmentTypeId ? `AND ti.equipment_type_id = ${pool.escape(equipmentTypeId)}` : ''}
     ORDER BY t.updated_at DESC`,
    [from, to]
  );

  const entries = [
    ...purchaseRows.map((r) => ({ id: `p${r.id}`, date: r.date, type: r.type, equipmentTypeName: r.equipmentTypeName, quantity: r.quantity })),
    ...transferRows.map((r) => ({ id: `t${r.id}`, date: r.date, type: r.type, equipmentTypeName: r.equipmentTypeName, quantity: r.quantity })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const totals = {
    purchases: purchaseRows.reduce((s, r) => s + r.quantity, 0),
    transfersIn: transferRows.filter((r) => r.type === 'TRANSFER_IN').reduce((s, r) => s + r.quantity, 0),
    transfersOut: transferRows.filter((r) => r.type === 'TRANSFER_OUT').reduce((s, r) => s + r.quantity, 0),
  };

  return { entries, totals };
}

module.exports = { getMetrics, getNetMovementDetails };
