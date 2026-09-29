const { Router } = require('express');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const controller = require('../controllers/purchases.controller');

const router = Router();
const CAN_MANAGE = ['ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER'];

router.use(authenticate);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', authorize(...CAN_MANAGE), controller.create);

module.exports = router;
