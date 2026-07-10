'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const profile = require('../src/browser/weibo-comment-profile.js');

const validProfile = {
  platform: 'weibo',
  postRootSelector: 'article[data-post-root]',
  commentRootSelector: 'section[data-comment-root]',
  commentItemSelector: 'article[data-comment-id]',
  replyContainerSelector: '[data-reply-list]',
  scrollContainerSelector: '[data-comment-scroll]',
  sortScopeSelector: '[data-comment-sort]',
  sorts: {
    hot: { label: '按热度', selectedAttribute: 'aria-selected', selectedValue: 'true' },
    time: { label: '按时间', selectedAttribute: 'aria-selected', selectedValue: 'true' }
  },
  endTexts: ['没有更多评论了'],
  safeReplyExpandPatterns: ['^展开更多回复$'],
  identityAttributes: {
    comment: ['data-comment-id'],
    parent: ['data-parent-comment-id'],
    root: ['data-root-comment-id']
  }
};

test('accepts a complete explicit Weibo profile', () => {
  assert.deepEqual(profile.validateWeiboCommentProfile(validProfile), []);
});

test('rejects profiles that would force broad DOM discovery or ambiguous sorting', () => {
  const invalid = structuredClone(validProfile);
  invalid.commentRootSelector = '';
  invalid.sorts.time.label = '';
  invalid.identityAttributes.comment = [];
  assert.deepEqual(profile.validateWeiboCommentProfile(invalid), [
    'commentRootSelector is required',
    'sorts.time.label is required',
    'identityAttributes.comment must contain at least one attribute'
  ]);
});

test('rejects unknown profile fields and malformed safe reply patterns', () => {
  const invalid = structuredClone(validProfile);
  invalid.unsafeFallbackSelector = '.anything';
  invalid.safeReplyExpandPatterns = ['['];

  assert.deepEqual(profile.validateWeiboCommentProfile(invalid), [
    'unsafeFallbackSelector is not allowed',
    'safeReplyExpandPatterns[0] must be a valid regular expression'
  ]);
});
