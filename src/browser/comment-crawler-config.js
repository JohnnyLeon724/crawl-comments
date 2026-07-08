'use strict';

const fs = require('node:fs');

const DEFAULT_CONFIG = Object.freeze({
  crawler: Object.freeze({
    profile: '.pw-profile',
    timeoutMs: 15 * 60 * 1000,
    postLoadWaitMs: 5000,
    delayMs: 0,
    retries: 0,
    headless: false,
    viewport: Object.freeze({
      width: 1440,
      height: 1000
    })
  }),
  ai: Object.freeze({
    batchSize: 50,
    codexBin: '/Applications/Codex.app/Contents/Resources/codex'
  }),
  output: Object.freeze({
    baseDir: 'output'
  }),
  qa: Object.freeze({
    sampleSize: 30
  })
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  }
  return value;
}

function deepMerge(base, override) {
  const result = clone(base);

  if (!isPlainObject(override)) return result;

  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
      continue;
    }

    result[key] = clone(value);
  }

  return result;
}

function readConfigFile(configPath) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function validateConfig(config) {
  const positiveNumbers = [
    ['crawler.timeoutMs', config.crawler.timeoutMs],
    ['crawler.postLoadWaitMs', config.crawler.postLoadWaitMs],
    ['ai.batchSize', config.ai.batchSize],
    ['qa.sampleSize', config.qa.sampleSize]
  ];
  const nonNegativeNumbers = [
    ['crawler.delayMs', config.crawler.delayMs],
    ['crawler.retries', config.crawler.retries]
  ];

  for (const [name, value] of positiveNumbers) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
      throw new Error(`${name} 必须是正数`);
    }
  }

  for (const [name, value] of nonNegativeNumbers) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new Error(`${name} 必须是非负数`);
    }
  }

  return config;
}

function loadConfig(options = {}) {
  const fileConfig = options.configPath ? readConfigFile(options.configPath) : {};
  const merged = deepMerge(deepMerge(DEFAULT_CONFIG, fileConfig), options.overrides || {});

  return validateConfig(merged);
}

module.exports = {
  DEFAULT_CONFIG,
  clone,
  deepMerge,
  readConfigFile,
  validateConfig,
  loadConfig
};
