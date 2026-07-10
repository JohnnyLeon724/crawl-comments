'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const capture = require('../src/browser/chrome-comment-capture.js');

test('only accepts exact reply-expansion labels and never accepts collapse controls', () => {
  for (const label of [
    '展开更多',
    '展开更多回复',
    '展开 12 条回复',
    '展开3回复',
    '查看更多回复',
    '查看全部 8 条回复'
  ]) {
    assert.equal(capture.isSafeExpandLabel(label), true, label);
  }

  for (const label of [
    '收起',
    '收起回复',
    '展开全文',
    '展开商品详情',
    '已展开 3 条回复',
    '评论'
  ]) {
    assert.equal(capture.isSafeExpandLabel(label), false, label);
  }
});

test('filters visible, enabled, exact expansion controls before any click', () => {
  assert.deepEqual(capture.listSafeExpandLabels([
    { text: '展开更多', visible: true, disabled: false },
    { text: '收起', visible: true, disabled: false },
    { text: '展开 4 条回复', visible: false, disabled: false },
    { text: '查看更多回复', visible: true, disabled: true },
    { text: '展开3条回复', visible: true, disabled: false }
  ]), ['展开更多', '展开3条回复']);
});

test('clicks only exact labels within the supplied comment root and works bottom-up', async () => {
  const clickLog = [];
  const buttons = [
    { click: async () => clickLog.push('first') },
    { click: async () => clickLog.push('second') }
  ];
  const root = {
    getByText(label, options) {
      assert.equal(label, '展开更多');
      assert.deepEqual(options, { exact: true });
      return {
        async count() { return buttons.length; },
        async all() { return buttons; }
      };
    }
  };

  const result = await capture.expandExactLabel(root, '展开更多');

  assert.equal(result.clicked, 2);
  assert.deepEqual(clickLog, ['second', 'first']);
});

test('refuses unsafe expansion labels before it queries a root locator', async () => {
  const root = {
    getByText() {
      throw new Error('unsafe controls must not be queried');
    }
  };

  await assert.rejects(
    capture.expandExactLabel(root, '收起'),
    /Unsafe expansion label/
  );
});

test('rechecks a control label before clicking so a newly changed collapse control is skipped', async () => {
  const clickLog = [];
  let text = '展开更多';
  const outer = {
    async innerText() { return text; },
    async click() { throw new Error('outer control should be skipped after text changes'); }
  };
  const inner = {
    async innerText() { return text; },
    async click() {
      clickLog.push('inner');
      text = '收起';
    }
  };
  const root = {
    getByText() {
      return {
        async count() { return 2; },
        async all() { return [outer, inner]; }
      };
    }
  };

  const result = await capture.expandExactLabel(root, '展开更多');

  assert.equal(result.clicked, 1);
  assert.deepEqual(clickLog, ['inner']);
});

test('builds a reproducible capture state and DOM batch with count-gap observation', () => {
  const capturedAt = '2026-07-10T10:00:00.000Z';
  const candidate = capture.toCommentCandidate({
    dom_path: 'DIV:nth-of-type(1)',
    role_hint: 'comment_candidate',
    inner_text: '用户A：内容',
    html: '<div>用户A：内容</div>',
    nearby_buttons: ['回复'],
    rect: { top: 1, left: 2, width: 3, height: 4 },
    captured_at: capturedAt
  });
  const state = capture.buildCaptureState({
    platform: 'douyin',
    root_selector: '.comment-mainContent',
    round: 3,
    declared_comment_count: 216,
    candidates: [candidate],
    remaining_expand_count: 0,
    scroll: { top: 100, scrollHeight: 500, clientHeight: 200 },
    end_signal: '暂时没有更多评论',
    stop_reason: 'page_end'
  });
  const batch = capture.buildCommentDomBatch({
    batch_id: 'round-003',
    task_id: 'task-1',
    platform: 'douyin',
    source_url: 'https://www.douyin.com/video/1',
    captured_at: capturedAt,
    scroll: { before_top: 0, after_top: 100, viewport_height: 200, document_height: 500 },
    state,
    candidates: [candidate]
  });

  assert.equal(candidate.candidate_hash.length, 40);
  assert.equal(state.captured_record_count, 1);
  assert.equal(state.count_gap, 215);
  assert.equal(state.end_signal, '暂时没有更多评论');
  assert.equal(batch.schema_version, 'comment-dom-batch-v1');
  assert.equal(batch.state.declared_comment_count, 216);
  assert.equal(batch.candidates[0].candidate_id, candidate.candidate_id);
});

test('preserves deterministic Weibo DOM identity instead of inventing an AI identity', () => {
  const candidate = capture.toCommentCandidate({
    candidate_id: 'weibo:c-100',
    source_comment_id: 'c-100',
    source_parent_comment_id: 'c-10',
    source_root_comment_id: 'c-1',
    capture_sort_mode: 'time',
    inner_text: '用户A 评论正文'
  });

  assert.equal(candidate.candidate_id, 'weibo:c-100');
  assert.equal(candidate.source_comment_id, 'c-100');
  assert.equal(candidate.source_parent_comment_id, 'c-10');
  assert.equal(candidate.source_root_comment_id, 'c-1');
  assert.equal(candidate.capture_sort_mode, 'time');
});

test('uses the complete DOM composite fingerprint when Weibo exposes no comment ID', () => {
  const candidate = capture.toCommentCandidate({
    source_author_uid_href: '/u/123',
    source_comment_text: '  用户A 评论正文  ',
    source_comment_timestamp: '7-10 10:30',
    source_reply_context: '回复 用户B',
    source_root_context: '根评论正文',
    source_composite_fingerprint: 'sha256:example',
    capture_sort_mode: 'hot'
  });

  assert.equal(candidate.candidate_id, 'weibo:fp:sha256:example');
  assert.equal(candidate.identity_mode, 'composite_fingerprint');
  assert.equal(candidate.source_comment_id, '');
  assert.equal(candidate.source_composite_fingerprint, 'sha256:example');
  assert.equal(candidate.source_author_uid_href, '/u/123');
  assert.equal(candidate.source_comment_text, '用户A 评论正文');
});

test('derives a stable composite fingerprint from normalized public DOM evidence', () => {
  const evidence = {
    source_author_uid_href: '/u/123',
    source_comment_text: '用户A 评论正文',
    source_comment_timestamp: '7-10 10:30',
    source_reply_context: '回复 用户B',
    source_root_context: '根评论正文'
  };
  const first = capture.toCommentCandidate(evidence);
  const second = capture.toCommentCandidate({
    ...evidence,
    source_comment_text: '  用户A   评论正文  '
  });

  assert.match(first.source_composite_fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.source_composite_fingerprint, second.source_composite_fingerprint);
  assert.equal(first.candidate_id, `weibo:fp:${first.source_composite_fingerprint}`);
});

test('passes explicit Weibo identity profile fields into scoped root inspection', async () => {
  let receivedOptions;
  const root = {
    evaluate(_callback, options) {
      receivedOptions = options;
      return Promise.resolve({ records: [], controls: [] });
    }
  };
  const profile = {
    commentItemSelector: 'article[data-comment]',
    replyContainerSelector: '[data-replies]',
    endTexts: [],
    identityMode: 'composite',
    identityAttributes: {
      comment: ['data-comment-id'],
      parent: ['data-parent-id'],
      root: ['data-root-id']
    },
    compositeIdentity: {
      authorHrefSelector: 'a[href^="/u/"]',
      commentTextSelector: '.comment-text',
      timestampSelector: '.from'
    }
  };

  await capture.inspectCommentRoot(root, profile);

  assert.equal(receivedOptions.identityMode, 'composite');
  assert.deepEqual(receivedOptions.identityAttributes, profile.identityAttributes);
  assert.deepEqual(receivedOptions.compositeIdentity, profile.compositeIdentity);
});

test('propagates capture sort mode and flags Weibo records without configured identity evidence', async () => {
  const root = {
    async count() { return 1; },
    evaluate() {
      return Promise.resolve({
        records: [{ type: 'comment', inner_text: '匿名评论', dom_path: 'ARTICLE:nth-of-type(1)' }],
        controls: [],
        declared_comment_count: 1,
        end_signal: '',
        scroll: { top: 0, scrollHeight: 0, clientHeight: 0, rect: { top: 0, left: 0, width: 1, height: 1 } }
      });
    }
  };
  const tab = { playwright: { locator() { return root; } } };
  const profile = {
    commentRootSelector: '.comment-root',
    commentItemSelector: 'article[data-comment]',
    replyContainerSelector: '[data-replies]',
    endTexts: [],
    identityMode: 'composite',
    identityAttributes: { comment: [], parent: [], root: [] },
    compositeIdentity: {
      authorHrefSelector: 'a[href^="/u/"]',
      commentTextSelector: '.comment-text',
      timestampSelector: '.from'
    }
  };

  const observation = await capture.captureScopedRecords(tab, profile, {
    capture_sort_mode: 'time'
  });

  assert.equal(observation.candidates[0].capture_sort_mode, 'time');
  assert.deepEqual(observation.partial_reasons, ['missing_identity_evidence']);
});

test('records completed hot and time stream observations', () => {
  const state = capture.buildCaptureState({
    platform: 'weibo',
    streams: {
      hot: { verified: true, stop_reason: 'page_end', unique_level1_count: 20 },
      time: { verified: true, stop_reason: 'page_end', unique_level1_count: 23 }
    },
    partial_reasons: [' missing_identity_evidence ', 'missing_identity_evidence']
  });

  assert.equal(state.streams.hot.verified, true);
  assert.equal(state.streams.hot.stop_reason, 'page_end');
  assert.equal(state.streams.time.unique_level1_count, 23);
  assert.equal(state.streams.time.unique_reply_count, 0);
  assert.deepEqual(state.partial_reasons, ['missing_identity_evidence']);
});
