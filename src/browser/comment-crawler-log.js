'use strict';

const fs = require('node:fs');
const path = require('node:path');

function serializeData(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || ''
    };
  }

  if (value == null) return {};
  if (typeof value === 'object') return value;

  return {
    value
  };
}

function writeLogEvent(filePath, event) {
  const entry = {
    ts: event.ts || new Date().toISOString(),
    run_id: event.runId || event.run_id || '',
    platform: event.platform || '',
    level: event.level || 'info',
    event: event.event || '',
    message: event.message || '',
    data: serializeData(event.data)
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);

  return entry;
}

function createRunLogger(filePath, defaults = {}) {
  const write = (level, event, message, data) => writeLogEvent(filePath, {
    runId: defaults.runId || defaults.run_id || '',
    platform: defaults.platform || '',
    level,
    event,
    message,
    data
  });

  return {
    debug: (event, message, data = {}) => write('debug', event, message, data),
    info: (event, message, data = {}) => write('info', event, message, data),
    warn: (event, message, data = {}) => write('warn', event, message, data),
    error: (event, message, data = {}) => write('error', event, message, data)
  };
}

module.exports = {
  serializeData,
  writeLogEvent,
  createRunLogger
};
