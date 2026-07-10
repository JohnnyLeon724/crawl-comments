'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const profile = require('../src/browser/weibo-comment-profile.js');

const validProfile = {
  platform: 'weibo',
  identityMode: 'dom_id',
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

test('accepts a composite Weibo identity profile without DOM comment IDs', () => {
  const composite = structuredClone(validProfile);
  composite.identityMode = 'composite';
  composite.identityAttributes.comment = [];
  composite.compositeIdentity = {
    authorHrefSelector: 'a[href^="/u/"]',
    commentTextSelector: '.text',
    timestampSelector: '.from'
  };

  assert.deepEqual(profile.validateWeiboCommentProfile(composite), []);
});

test('requires a supported identity mode', () => {
  const missingMode = structuredClone(validProfile);
  delete missingMode.identityMode;
  const unsupportedMode = structuredClone(validProfile);
  unsupportedMode.identityMode = 'text_guess';

  assert.deepEqual(profile.validateWeiboCommentProfile(missingMode), [
    'identityMode is required'
  ]);
  assert.deepEqual(profile.validateWeiboCommentProfile(unsupportedMode), [
    'identityMode must be one of: dom_id, composite'
  ]);
});

test('requires every explicit composite identity selector', () => {
  const invalid = structuredClone(validProfile);
  invalid.identityMode = 'composite';
  invalid.identityAttributes.comment = [];
  invalid.compositeIdentity = {
    authorHrefSelector: '',
    commentTextSelector: '.text',
    timestampSelector: ''
  };

  assert.deepEqual(profile.validateWeiboCommentProfile(invalid), [
    'compositeIdentity.authorHrefSelector is required',
    'compositeIdentity.timestampSelector is required'
  ]);
});

test('rejects unknown nested sort, identity, and composite fields', () => {
  const invalid = structuredClone(validProfile);
  invalid.identityMode = 'composite';
  invalid.identityAttributes.comment = [];
  invalid.compositeIdentity = {
    authorHrefSelector: 'a[href^="/u/"]',
    commentTextSelector: '.text',
    timestampSelector: '.from',
    unsafeFallback: '.reply'
  };
  invalid.sorts.hot.unverifiedState = 'selected';
  invalid.identityAttributes.derivedTextKey = ['author', 'text'];

  assert.deepEqual(profile.validateWeiboCommentProfile(invalid), [
    'sorts.hot.unverifiedState is not allowed',
    'identityAttributes.derivedTextKey is not allowed',
    'compositeIdentity.unsafeFallback is not allowed'
  ]);
});

test('rejects unknown composite fields whenever a composite object is supplied', () => {
  const invalid = structuredClone(validProfile);
  invalid.compositeIdentity = {
    authorHrefSelector: 'a[href^="/u/"]',
    commentTextSelector: '.text',
    timestampSelector: '.from',
    unsafeFallback: '.reply'
  };

  assert.deepEqual(profile.validateWeiboCommentProfile(invalid), [
    'compositeIdentity.unsafeFallback is not allowed'
  ]);
});
