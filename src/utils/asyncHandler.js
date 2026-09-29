// Wraps an async Express handler so thrown errors / rejected promises reach
// the central error handler instead of crashing the process.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
