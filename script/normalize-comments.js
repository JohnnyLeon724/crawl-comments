#!/usr/bin/env node
'use strict';

// Legacy compatibility wrapper. Implementation moved to ../src/normalize/normalize-comments.js.
const implementation = require('../src/normalize/normalize-comments.js');

if (require.main === module && typeof implementation.main === 'function') {
  Promise.resolve(implementation.main()).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = implementation;
