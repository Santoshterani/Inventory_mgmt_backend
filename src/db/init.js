// One-time setup: applies schema.sql and seed.sql against DB_NAME, then
// creates a bootstrap ADMIN user if none exists yet (section 3.4: accounts
// are created by an authorized administrator, so something has to create
// the very first one). Run with: npm run db:init
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const env = require('../config/env');
const logger = require('../config/logger');

async function run() {
  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  logger.info(`Creating database \`${env.db.name}\` if it does not exist…`);
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE \`${env.db.name}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  logger.info('Applying schema.sql…');
  await connection.query(schema);

  const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
  logger.info('Applying seed.sql…');
  await connection.query(seed);

  const [existingAdmins] = await connection.query(
    "SELECT id FROM users WHERE role_id = 1 LIMIT 1"
  );

  if (existingAdmins.length === 0) {
    const passwordHash = await bcrypt.hash(env.bootstrapAdmin.password, 12);
    // must_change_password = 0 here only because this password was chosen
    // deliberately via .env, not auto-generated — every other account
    // created afterwards (via POST /api/users) defaults to 1.
    await connection.query(
      `INSERT INTO users (name, username, service_id, password_hash, role_id, base_id, can_create_users, is_active, must_change_password)
       VALUES (?, ?, ?, ?, 1, NULL, 1, 1, 0)`,
      [env.bootstrapAdmin.name, env.bootstrapAdmin.username, env.bootstrapAdmin.serviceId, passwordHash]
    );
    logger.info(
      `Bootstrap admin created — username: "${env.bootstrapAdmin.username}". Sign in and change the password.`
    );
  } else {
    logger.info('An admin user already exists; skipping bootstrap admin creation.');
  }

  await connection.end();
  logger.info('Database initialization complete.');
}

run().catch((err) => {
  logger.error('Database initialization failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
