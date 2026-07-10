#!/usr/bin/env node
'use strict';

const implementation = require('../src/normalize/validate-comment-ai-review.js');

if (require.main === module && typeof implementation.main === 'function') {
  Promise.resolve(implementation.main()).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = implementation;
