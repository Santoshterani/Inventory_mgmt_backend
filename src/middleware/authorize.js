const ApiError = require('../utils/ApiError');

// authorize('ADMIN', 'BASE_COMMANDER') -> only those roles may proceed.
// Section 3.5: denied requests return 403; must run after `authenticate`.
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden());
    }
    next();
  };
}

module.exports = authorize;
