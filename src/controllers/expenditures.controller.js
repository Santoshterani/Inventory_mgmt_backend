const asyncHandler = require('../utils/asyncHandler');
const expendituresService = require('../services/expenditures.service');

const list = asyncHandler(async (req, res) => {
  const { baseId, page, pageSize } = req.query;
  const data = await expendituresService.list(req.user, {
    baseId,
    page: parseInt(page, 10) || 1,
    pageSize: parseInt(pageSize, 10) || 10,
  });
  res.json(data);
});

const create = asyncHandler(async (req, res) => {
  const expenditure = await expendituresService.create(req.user, req.body);
  res.status(201).json(expenditure);
});

module.exports = { list, create };
