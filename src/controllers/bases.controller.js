const asyncHandler = require('../utils/asyncHandler');
const basesService = require('../services/bases.service');

const list = asyncHandler(async (req, res) => {
  const items = await basesService.list();
  res.json({ items });
});

const update = asyncHandler(async (req, res) => {
  const base = await basesService.update(req.user, req.params.id, req.body || {});
  res.json(base);
});

module.exports = { list, update };
