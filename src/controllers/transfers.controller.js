const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const transfersService = require('../services/transfers.service');

const list = asyncHandler(async (req, res) => {
  const { status, page, pageSize } = req.query;
  const data = await transfersService.list(req.user, {
    status,
    page: parseInt(page, 10) || 1,
    pageSize: parseInt(pageSize, 10) || 10,
  });
  res.json(data);
});

const getById = asyncHandler(async (req, res) => {
  const transfer = await transfersService.getById(req.user, req.params.id);
  res.json(transfer);
});

const create = asyncHandler(async (req, res) => {
  const transfer = await transfersService.create(req.user, req.body);
  res.status(201).json(transfer);
});

const changeStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) throw ApiError.badRequest('status is required.');
  const transfer = await transfersService.changeStatus(req.user, req.params.id, status);
  res.json(transfer);
});

module.exports = { list, getById, create, changeStatus };
