const asyncHandler = require('../utils/asyncHandler');
const auditService = require('../services/audit.service');

const list = asyncHandler(async (req, res) => {
  const { page, pageSize, entityType, actorId } = req.query;
  const data = await auditService.list({
    page: parseInt(page, 10) || 1,
    pageSize: parseInt(pageSize, 10) || 20,
    entityType,
    actorId,
  });
  res.json(data);
});

module.exports = { list };
