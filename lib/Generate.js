const crypto = require('crypto');

module.exports = {
  generateAPIKey: () => crypto.randomBytes(32).toString('hex'),
  generateDeviceID: () => crypto.randomBytes(4).toString('hex'),
};