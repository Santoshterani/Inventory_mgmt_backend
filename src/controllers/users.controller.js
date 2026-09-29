const asyncHandler = require('../utils/asyncHandler');
const usersService = require('../services/users.service');

const list = asyncHandler(async (req, res) => {
  const data = await usersService.list(req.user);
  res.json(data);
});

const create = asyncHandler(async (req, res) => {
  const user = await usersService.create(req.user, req.body);
  res.status(201).json(user);
});

const update = asyncHandler(async (req, res) => {
  const user = await usersService.update(req.user, req.params.id, req.body);
  res.json(user);
});

module.exports = { list, create, update };
