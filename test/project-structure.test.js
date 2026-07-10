'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const projectRoot = path.join(__dirname, '..');

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('core crawler modules are grouped under src with legacy wrappers', () => {
  const pairs = [
    ['src/browser/expand-comments-v1.js', 'script/expand-comments-v1.js', '../src/browser/expand-comments-v1.js'],
    ['src/browser/crawl-comments-playwright.js', 'script/crawl-comments-playwright.js', '../src/browser/crawl-comments-playwright.js'],
    ['src/browser/comment-crawler-config.js', 'script/comment-crawler-config.js', '../src/browser/comment-crawler-config.js'],
    ['src/browser/comment-crawler-log.js', 'script/comment-crawler-log.js', '../src/browser/comment-crawler-log.js'],
    ['src/browser/weibo-comment-profile.js', 'script/validate-weibo-comment-profile.js', '../src/browser/weibo-comment-profile.js'],
    ['src/normalize/normalize-comments.js', 'script/normalize-comments.js', '../src/normalize/normalize-comments.js'],
    ['src/normalize/normalize-ai-comment-extraction.js', 'script/normalize-ai-comment-extraction.js', '../src/normalize/normalize-ai-comment-extraction.js'],
    ['src/normalize/build-comment-excel-report.js', 'script/build-comment-excel-report.js', '../src/normalize/build-comment-excel-report.js'],
    ['src/normalize/build-comment-qa-sample.js', 'script/build-comment-qa-sample.js', '../src/normalize/build-comment-qa-sample.js'],
    ['src/normalize/prepare-comment-ai-review.js', 'script/prepare-comment-ai-review.js', '../src/normalize/prepare-comment-ai-review.js'],
    ['src/normalize/prepare-comment-extraction-batches.js', 'script/prepare-comment-extraction-batches.js', '../src/normalize/prepare-comment-extraction-batches.js'],
    ['src/normalize/run-comment-ai-extraction.js', 'script/run-comment-ai-extraction.js', '../src/normalize/run-comment-ai-extraction.js'],
    ['src/normalize/run-comment-ai-review.js', 'script/run-comment-ai-review.js', '../src/normalize/run-comment-ai-review.js'],
    ['src/adapters/douyin.js', 'adapters/douyin.js', '../src/adapters/douyin.js'],
    ['src/adapters/xiaohongshu.js', 'adapters/xiaohongshu.js', '../src/adapters/xiaohongshu.js'],
    ['src/adapters/weibo.js', 'adapters/weibo.js', '../src/adapters/weibo.js']
  ];

  for (const [sourcePath, legacyPath, requirePath] of pairs) {
    assert.equal(exists(sourcePath), true, `${sourcePath} should exist`);
    assert.match(read(legacyPath), /Legacy compatibility wrapper/);
    assert.match(read(legacyPath), new RegExp(requirePath.replace(/[./-]/g, match => `\\${match}`)));
  }
});

test('mcp injects the browser expander from the src browser module', () => {
  const tools = read('mcp/comment-crawler-tools.js');

  assert.match(tools, /src['"], ['"]browser['"], ['"]expand-comments-v1\.js/);
  assert.doesNotMatch(tools, /script['"], ['"]expand-comments-v1\.js/);
});

test('documentation directories and cleanup checklist exist', () => {
  for (const relativePath of [
    'docs/active/.gitkeep',
    'docs/archive/.gitkeep',
    'docs/examples/manual-douyin-expand-comments-console.js'
  ]) {
    assert.equal(exists(relativePath), true, `${relativePath} should exist`);
  }

  const checklist = read('docs/project-structure-cleanup-checklist.md');
  assert.match(checklist, /MediaCrawler/);
  assert.match(checklist, /\.pw-profile/);
  assert.match(checklist, /manual-douyin-expand-comments-console\.js/);

  const gitignore = read('.gitignore');
  assert.match(gitignore, /\.DS_Store/);
  assert.match(gitignore, /MediaCrawler\//);
  assert.match(gitignore, /output\//);
});
