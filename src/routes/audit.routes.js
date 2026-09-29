const { Router } = require('express');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const controller = require('../controllers/audit.controller');

const router = Router();

router.use(authenticate, authorize('ADMIN'));
router.get('/', controller.list);

module.exports = router;
