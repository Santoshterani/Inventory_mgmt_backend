const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const { pool } = require('./db/pool');

async function start() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    logger.error('Unable to connect to the database. Check your .env settings.', { error: err.message });
    process.exit(1);
  }

  app.listen(env.port, () => {
    logger.info(`Asset Management API listening on port ${env.port} (${env.nodeEnv})`);
  });
}

start();
