const asyncHandler = require('../utils/asyncHandler');
const assignmentsService = require('../services/assignments.service');

const list = asyncHandler(async (req, res) => {
  const { baseId, status, page, pageSize } = req.query;
  const data = await assignmentsService.list(req.user, {
    baseId,
    status,
    page: parseInt(page, 10) || 1,
    pageSize: parseInt(pageSize, 10) || 10,
  });
  res.json(data);
});

const getById = asyncHandler(async (req, res) => {
  const assignment = await assignmentsService.getById(req.user, req.params.id);
  res.json(assignment);
});

const create = asyncHandler(async (req, res) => {
  const assignment = await assignmentsService.create(req.user, req.body);
  res.status(201).json(assignment);
});

module.exports = { list, getById, create };
