#!/usr/bin/env node
'use strict';

// Legacy compatibility wrapper. Implementation moved to ../src/browser/weibo-comment-profile.js.
const { readWeiboCommentProfile } = require('../src/browser/weibo-comment-profile.js');

function parseArgs(argv) {
  let profilePath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--profile') {
      profilePath = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      return { help: true, profilePath: '' };
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!profilePath) throw new Error('--profile is required');
  return { help: false, profilePath };
}

function printUsage() {
  console.log('Usage: node script/validate-weibo-comment-profile.js --profile <path>');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return null;
  }

  const profile = readWeiboCommentProfile(args.profilePath);
  console.log(JSON.stringify(profile, null, 2));
  return profile;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  main,
  printUsage,
  readWeiboCommentProfile
};
