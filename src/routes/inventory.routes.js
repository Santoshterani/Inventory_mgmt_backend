const { Router } = require('express');
const authenticate = require('../middleware/auth');
const controller = require('../controllers/inventory.controller');

const router = Router();

router.use(authenticate);
router.get('/', controller.list);

module.exports = router;
