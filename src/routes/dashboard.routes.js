const { Router } = require('express');
const authenticate = require('../middleware/auth');
const controller = require('../controllers/dashboard.controller');

const router = Router();

router.use(authenticate);
router.get('/', controller.getMetrics);
router.get('/net-movement-details', controller.getNetMovementDetails);

module.exports = router;
