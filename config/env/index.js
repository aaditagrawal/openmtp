const { IS_PROD } = require('../../app/constants/env');
const PORT_PROD = require('./env.prod').PORT;
const PORT_DEV = require('./env.dev').PORT;
const port = Number(process.env.PORT || (IS_PROD ? PORT_PROD : PORT_DEV));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
module.exports.PORT = port;
