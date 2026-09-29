const { Router } = require('express');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const controller = require('../controllers/expenditures.controller');

const router = Router();
const CAN_MANAGE = ['ADMIN', 'BASE_COMMANDER'];

router.use(authenticate);
router.get('/', authorize(...CAN_MANAGE), controller.list);
router.post('/', authorize(...CAN_MANAGE), controller.create);

module.exports = router;
