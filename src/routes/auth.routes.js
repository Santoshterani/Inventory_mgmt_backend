const { Router } = require('express');
const authenticate = require('../middleware/auth');
const controller = require('../controllers/auth.controller');

const router = Router();

router.post('/login', controller.login);
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.me);
router.patch('/change-password', authenticate, controller.changePassword);

// Forgot/reset password — deliberately unauthenticated (the person can't
// sign in yet, that's the whole point).
router.post('/forgot-password', controller.forgotPassword);
router.post('/reset-password', controller.resetPassword);

module.exports = router;
