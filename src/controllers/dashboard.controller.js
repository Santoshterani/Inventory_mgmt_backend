const asyncHandler = require('../utils/asyncHandler');
const dashboardService = require('../services/dashboard.service');

function normalizeFilters(query) {
  const to = query.to || new Date().toISOString().slice(0, 10);
  const from = query.from || new Date(new Date(to).getFullYear(), new Date(to).getMonth(), 1).toISOString().slice(0, 10);
  return { from, to, baseId: query.baseId, equipmentTypeId: query.equipmentTypeId };
}

const getMetrics = asyncHandler(async (req, res) => {
  const data = await dashboardService.getMetrics(req.user, normalizeFilters(req.query));
  res.json(data);
});

const getNetMovementDetails = asyncHandler(async (req, res) => {
  const data = await dashboardService.getNetMovementDetails(req.user, normalizeFilters(req.query));
  res.json(data);
});

module.exports = { getMetrics, getNetMovementDetails };
