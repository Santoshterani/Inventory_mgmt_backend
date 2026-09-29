const app = require('./app');
const env = require('./config/env');
const { pool } = require('./db/pool');

async function start() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('Unable to connect to the database. Check your .env settings.'); // eslint-disable-line no-console
    console.error(err.message); // eslint-disable-line no-console
    process.exit(1);
  }

  app.listen(env.port, () => {
    console.log(`Asset Management API listening on port ${env.port} (${env.nodeEnv})`); // eslint-disable-line no-console
  });
}

start();
