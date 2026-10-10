const asyncHandler = require('../utils/asyncHandler');
const equipmentTypesService = require('../services/equipmentTypes.service');

const list = asyncHandler(async (req, res) => {
  const items = await equipmentTypesService.list();
  res.json({ items });
});

const create = asyncHandler(async (req, res) => {
  const equipmentType = await equipmentTypesService.create(req.user, req.body);
  res.status(201).json(equipmentType);
});

const update = asyncHandler(async (req, res) => {
  const equipmentType = await equipmentTypesService.update(req.user, req.params.id, req.body || {});
  res.json(equipmentType);
});

module.exports = { list, create, update };
