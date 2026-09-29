const asyncHandler = require('../utils/asyncHandler');
const inventoryService = require('../services/inventory.service');

const list = asyncHandler(async (req, res) => {
  const { baseId, equipmentTypeId, page, pageSize } = req.query;
  const data = await inventoryService.list(req.user, {
    baseId,
    equipmentTypeId,
    page: parseInt(page, 10) || 1,
    pageSize: parseInt(pageSize, 10) || 10,
  });
  res.json(data);
});

module.exports = { list };
