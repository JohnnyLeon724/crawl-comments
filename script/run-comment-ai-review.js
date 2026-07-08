#!/usr/bin/env node
'use strict';

// Legacy compatibility wrapper. Implementation moved to ../src/normalize/run-comment-ai-review.js.
const implementation = require('../src/normalize/run-comment-ai-review.js');

if (require.main === module && typeof implementation.main === 'function') {
  Promise.resolve(implementation.main()).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = implementation;
