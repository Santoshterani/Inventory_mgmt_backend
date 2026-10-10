const { Router } = require('express');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const controller = require('../controllers/equipmentTypes.controller');

const router = Router();

router.use(authenticate);
router.get('/', controller.list);
router.post('/', authorize('ADMIN'), controller.create);
router.patch('/:id', authorize('ADMIN'), controller.update);

module.exports = router;
