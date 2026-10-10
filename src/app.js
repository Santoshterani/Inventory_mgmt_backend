const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const logger = require('./config/logger');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

function isAllowedOrigin(origin) {
  return env.corsOrigins.includes(origin) ||
    (env.corsOrigins.includes('http://localhost:*') && /^http:\/\/localhost:\d+$/.test(origin));
}

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
// HTTP access logs flow through winston (logger.http) instead of straight
// to stdout, so they land in logs/combined.log alongside everything else.
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev', { stream: logger.stream }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
