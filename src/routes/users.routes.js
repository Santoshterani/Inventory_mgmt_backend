const { Router } = require('express');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const controller = require('../controllers/users.controller');

const router = Router();
const CAN_MANAGE = ['ADMIN', 'BASE_COMMANDER']; // service layer enforces the finer-grained rules

router.use(authenticate);
router.get('/', authorize(...CAN_MANAGE), controller.list);
router.post('/', authorize(...CAN_MANAGE), controller.create);
router.patch('/:id', authorize(...CAN_MANAGE), controller.update);

module.exports = router;
