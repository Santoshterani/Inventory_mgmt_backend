const asyncHandler = require('../utils/asyncHandler');
const purchasesService = require('../services/purchases.service');

const list = asyncHandler(async (req, res) => {
  const { baseId, equipmentTypeId, from, to, page, pageSize } = req.query;
  const data = await purchasesService.list(req.user, {
    baseId,
    equipmentTypeId,
    from,
    to,
    page: parseInt(page, 10) || 1,
    pageSize: parseInt(pageSize, 10) || 10,
  });
  res.json(data);
});

const getById = asyncHandler(async (req, res) => {
  const purchase = await purchasesService.getById(req.user, req.params.id);
  res.json(purchase);
});

const create = asyncHandler(async (req, res) => {
  const purchase = await purchasesService.create(req.user, req.body);
  res.status(201).json(purchase);
});

module.exports = { list, getById, create };
