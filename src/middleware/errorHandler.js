const ApiError = require('../utils/ApiError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }

  // MySQL constraint violations -> useful 4xx instead of a raw 500.
  if (err && err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'A record with these details already exists.' });
  }
  if (err && (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_NO_REFERENCED_ROW_2')) {
    return res.status(409).json({ message: 'This action conflicts with related records.' });
  }
  if (err && err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return res.status(409).json({ message: 'This would result in invalid inventory quantities.' });
  }

  // NFR-02: avoid exposing internals in responses/logs beyond what's needed.
  console.error(err); // eslint-disable-line no-console
  return res.status(500).json({ message: 'An unexpected error occurred.' });
}

function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Endpoint not found.' });
}

module.exports = { errorHandler, notFoundHandler };
