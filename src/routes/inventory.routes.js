const { Router } = require('express');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const controller = require('../controllers/inventory.controller');

const router = Router();

router.use(authenticate);
router.get('/', controller.list);
// Admin has to add inventory items directly (initial stock load / correction).
router.post('/', authorize('ADMIN'), controller.upsert);

module.exports = router;
