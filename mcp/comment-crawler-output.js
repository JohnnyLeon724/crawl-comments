'use strict';

const fs = require('node:fs');
const path = require('node:path');

const runner = require('../script/crawl-comments-playwright.js');

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload || { state: {}, config: {}, results: [] }));
}

async function writeCommentRunOutput(input) {
  const runId = input.runId || runner.createRunId();
  const outDir = input.outDir || path.join('output', runId);
  const payload = clonePayload(input.payload);
  const sourceUrl = input.sourceUrl || payload.source_url || '';
  const startedAt = input.startedAt || new Date().toISOString();
  const finishedAt = input.finishedAt || new Date().toISOString();
  const status = input.status || 'success';
  const errors = Array.isArray(input.errors) ? input.errors : [];
  const outputPaths = runner.buildOutputPaths(outDir);

  payload.source_url = sourceUrl;
  fs.mkdirSync(outDir, { recursive: true });

  writeJson(outputPaths.rawJson, payload);
  fs.writeFileSync(outputPaths.rawCsv, runner.payloadToCsv(payload));

  if (input.page && typeof input.page.screenshot === 'function') {
    try {
      await input.page.screenshot({ path: outputPaths.screenshot, fullPage: true });
    } catch (error) {
      errors.push(`screenshot: ${error.message}`);
    }
  }

  writeJson(outputPaths.manifest, runner.buildManifest({
    runId,
    platform: runner.detectPlatform(sourceUrl),
    sourceUrl,
    startedAt,
    finishedAt,
    status,
    payload,
    outputFiles: {
      manifest: outputPaths.manifest,
      rawJson: outputPaths.rawJson,
      rawCsv: outputPaths.rawCsv,
      screenshot: outputPaths.screenshot
    },
    errors
  }));

  return {
    status,
    runId,
    outDir,
    rawCommentCount: Array.isArray(payload.results) ? payload.results.length : 0,
    outputFiles: {
      manifest: outputPaths.manifest,
      rawJson: outputPaths.rawJson,
      rawCsv: outputPaths.rawCsv,
      screenshot: outputPaths.screenshot
    },
    errors
  };
}

module.exports = {
  writeJson,
  clonePayload,
  writeCommentRunOutput
};
