const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const authService = require('../services/auth.service');

const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) throw ApiError.badRequest('username and password are required.');

  const { token, user } = await authService.login(username, password, { ip: req.ip });
  res.json({ token, user });
});

const logout = asyncHandler(async (req, res) => {
  // Stateless JWT: nothing to invalidate server-side in this initial
  // framework. The client is responsible for discarding the token.
  res.status(204).send();
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

module.exports = { login, logout, me };
