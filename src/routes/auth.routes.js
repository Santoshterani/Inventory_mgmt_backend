const { Router } = require('express');
const authenticate = require('../middleware/auth');
const controller = require('../controllers/auth.controller');

const router = Router();

router.post('/login', controller.login);
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.me);

module.exports = router;
