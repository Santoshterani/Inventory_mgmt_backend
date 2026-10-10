const fs = require('fs');
const path = require('path');
const winston = require('winston');

const env = require('./env');

const logDir = path.resolve(env.logging.dir);
fs.mkdirSync(logDir, { recursive: true });

const logger = winston.createLogger({
  levels: winston.config.npm.levels,
  level: env.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logDir, 'rejections.log') }),
  ],
});

logger.stream = {
  write(message) {
    logger.http(message.trim());
  },
};

module.exports = logger;
