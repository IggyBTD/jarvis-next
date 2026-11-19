const { parseDuration } = require("./duration");

function scheduleIn(str, now = Date.now()) {
  return now + parseDuration(str) * 1000;
}

module.exports = { scheduleIn };
