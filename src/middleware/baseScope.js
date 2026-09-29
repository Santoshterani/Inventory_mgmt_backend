const ApiError = require('../utils/ApiError');

const BASE_SCOPED_ROLES = ['BASE_COMMANDER', 'LOGISTICS_OFFICER'];

function isBaseScoped(role) {
  return BASE_SCOPED_ROLES.includes(role);
}

// Resolves the effective baseId filter for a list/read query.
// - Admins: use whatever baseId was requested (or undefined = all bases).
// - Base-scoped roles: force their own base, regardless of what the client
//   sent, so changing a query param can never leak another base's data.
function resolveReadBaseId(user, requestedBaseId) {
  if (!isBaseScoped(user.role)) return requestedBaseId || undefined;
  return user.baseId;
}

// Validates a baseId supplied in a write payload (create purchase, transfer
// source base, assignment, etc.). Throws 403 if a base-scoped user tries to
// write against a base that isn't their own.
function assertWritableBase(user, baseId) {
  if (!isBaseScoped(user.role)) return;
  if (!baseId || String(baseId) !== String(user.baseId)) {
    throw ApiError.forbidden('You can only act on your assigned base.');
  }
}

module.exports = { isBaseScoped, resolveReadBaseId, assertWritableBase };
