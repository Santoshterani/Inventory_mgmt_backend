const { Router } = require('express');

const router = Router();

router.use('/auth', require('./auth.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/inventory', require('./inventory.routes'));
router.use('/purchases', require('./purchases.routes'));
router.use('/transfers', require('./transfers.routes'));
router.use('/assignments', require('./assignments.routes'));
router.use('/expenditures', require('./expenditures.routes'));
router.use('/users', require('./users.routes'));
router.use('/audit-logs', require('./audit.routes'));

module.exports = router;
