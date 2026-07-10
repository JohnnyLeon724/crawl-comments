'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PLATFORM_PROFILES = {
  douyin: {
    commentRootSelector: '.comment-mainContent',
    commentItemSelector: '.Eh0a5CD4',
    replyContainerSelector: '.replyContainer',
    endTexts: ['暂时没有更多评论']
  }
};

const SAFE_EXPAND_PATTERNS = [
  /^展开更多(?:回复|评论)?$/,
  /^展开\s*\d+\s*条?回复$/,
  /^展开\s*\d+\s*回复$/,
  /^查看更多回复$/,
  /^查看全部\s*\d+\s*条回复$/
];

const REJECT_EXPAND_PATTERNS = [/收起/, /展开全文/, /商品/, /详情/];
const CAPTURE_SORT_MODES = new Set(['hot', 'time']);
const COMPOSITE_EVIDENCE_FIELDS = [
  'source_author_uid_href',
  'source_comment_text',
  'source_comment_timestamp',
  'source_reply_context',
  'source_root_context'
];

function normalizeControlText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function isSafeExpandLabel(value) {
  const text = normalizeControlText(value);
  return Boolean(text) &&
    !REJECT_EXPAND_PATTERNS.some(pattern => pattern.test(text)) &&
    SAFE_EXPAND_PATTERNS.some(pattern => pattern.test(text));
}

function listSafeExpandLabels(controls) {
  return [...new Set((controls || [])
    .filter(control => control && control.visible !== false && !control.disabled)
    .map(control => normalizeControlText(control.text))
    .filter(isSafeExpandLabel))];
}

function createCandidateHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizeSourceCaptureBatchIds(value) {
  const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return [...new Set(values.map(normalizeControlText).filter(Boolean))];
}

function normalizeEvidence(raw) {
  const evidence = {};
  for (const name of COMPOSITE_EVIDENCE_FIELDS) {
    evidence[name] = normalizeControlText(raw?.[name]);
  }
  return evidence;
}

function isCompleteCompositeEvidence(evidence, roleHint) {
  const hasRequiredBaseEvidence = [
    evidence.source_author_uid_href,
    evidence.source_comment_text,
    evidence.source_comment_timestamp,
    evidence.source_root_context
  ].every(Boolean);
  return hasRequiredBaseEvidence && (
    roleHint !== 'reply_candidate' || Boolean(evidence.source_reply_context)
  );
}

function createCompositeFingerprint(evidence) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(
    COMPOSITE_EVIDENCE_FIELDS.map(name => evidence[name] || '')
  )).digest('hex')}`;
}

function normalizeStreamState(input = {}) {
  return {
    verified: Boolean(input.verified),
    stop_reason: normalizeControlText(input.stop_reason),
    end_signal: normalizeControlText(input.end_signal),
    unique_level1_count: nonNegativeInteger(input.unique_level1_count),
    unique_reply_count: nonNegativeInteger(input.unique_reply_count),
    remaining_expand_count: nonNegativeInteger(input.remaining_expand_count)
  };
}

function toCommentCandidate(raw, index = 1, capturedAt = new Date().toISOString()) {
  const safeRaw = raw || {};
  const innerText = safeRaw.inner_text || [safeRaw.author, safeRaw.content, safeRaw.time]
    .filter(Boolean)
    .map(value => normalizeControlText(value))
    .join(' ');
  const roleHint = safeRaw.role_hint || (safeRaw.type === 'reply'
    ? 'reply_candidate'
    : 'comment_candidate');
  const rect = safeRaw.rect || { top: 0, left: 0, width: 0, height: 0 };
  const sourceCommentId = normalizeControlText(safeRaw.source_comment_id);
  const sourceParentCommentId = normalizeControlText(safeRaw.source_parent_comment_id);
  const sourceRootCommentId = normalizeControlText(safeRaw.source_root_comment_id);
  const evidence = normalizeEvidence(safeRaw);
  const hasCompositeEvidence = isCompleteCompositeEvidence(evidence, roleHint);
  const sourceCompositeFingerprint = hasCompositeEvidence
    ? (normalizeControlText(safeRaw.source_composite_fingerprint) ||
      createCompositeFingerprint(evidence))
    : '';
  const captureSortMode = normalizeControlText(safeRaw.capture_sort_mode);
  const candidateId = sourceCommentId
    ? `weibo:${sourceCommentId}`
    : (sourceCompositeFingerprint
      ? `weibo:fp:${sourceCompositeFingerprint}`
      : (safeRaw.candidate_id || `candidate_${String(index).padStart(6, '0')}`));

  const candidate = {
    candidate_id: candidateId,
    candidate_hash: safeRaw.candidate_hash || createCandidateHash(
      `${roleHint}|${safeRaw.dom_path || ''}|${innerText}`
    ),
    dom_path: safeRaw.dom_path || '',
    role_hint: roleHint,
    inner_text: innerText,
    html: safeRaw.html || '',
    nearby_buttons: Array.isArray(safeRaw.nearby_buttons) ? safeRaw.nearby_buttons : [],
    rect: {
      top: Number(rect.top) || 0,
      left: Number(rect.left) || 0,
      width: Math.max(0, Number(rect.width) || 0),
      height: Math.max(0, Number(rect.height) || 0)
    },
    captured_at: safeRaw.captured_at || capturedAt
  };

  if (sourceCommentId) {
    candidate.identity_mode = 'dom_id';
  } else if (sourceCompositeFingerprint) {
    candidate.identity_mode = 'composite_fingerprint';
  }
  if (CAPTURE_SORT_MODES.has(captureSortMode)) {
    candidate.capture_sort_mode = captureSortMode;
  }

  Object.assign(candidate, {
    source_comment_id: sourceCommentId,
    source_parent_comment_id: sourceParentCommentId,
    source_root_comment_id: sourceRootCommentId,
    source_composite_fingerprint: sourceCompositeFingerprint,
    source_author_uid_href: evidence.source_author_uid_href,
    source_comment_text: evidence.source_comment_text,
    source_comment_timestamp: evidence.source_comment_timestamp,
    source_reply_context: evidence.source_reply_context,
    source_root_context: evidence.source_root_context,
    source_capture_batch_ids: normalizeSourceCaptureBatchIds(safeRaw.source_capture_batch_ids)
  });

  return candidate;
}

function buildCaptureState(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const seenCandidateHashes = [...new Set(
    Array.isArray(input.seen_candidate_hashes)
      ? input.seen_candidate_hashes
      : candidates.map(candidate => candidate.candidate_hash).filter(Boolean)
  )];
  const declaredCommentCount = nonNegativeInteger(input.declared_comment_count);
  const capturedRecordCount = nonNegativeInteger(
    input.captured_record_count,
    candidates.length
  );
  const remainingExpandCount = nonNegativeInteger(input.remaining_expand_count);
  const scroll = input.scroll || {};
  const endSignal = normalizeControlText(input.end_signal);
  const stopReason = input.stop_reason || (endSignal ? 'page_end' : 'in_progress');
  const streams = input.streams || {};

  return {
    schema_version: 'chrome-comment-capture-v1',
    platform: input.platform || 'unknown',
    root_selector: input.root_selector || '',
    round: nonNegativeInteger(input.round),
    declared_comment_count: declaredCommentCount,
    captured_record_count: capturedRecordCount,
    remaining_expand_count: remainingExpandCount,
    scroll_top: Math.max(0, Number(scroll.top) || 0),
    scroll_height: Math.max(0, Number(scroll.scrollHeight) || 0),
    client_height: Math.max(0, Number(scroll.clientHeight) || 0),
    end_signal: endSignal,
    count_gap: Math.max(0, declaredCommentCount - capturedRecordCount),
    stop_reason: stopReason,
    seen_candidate_hashes: seenCandidateHashes,
    new_candidate_count: nonNegativeInteger(input.new_candidate_count, candidates.length),
    seen_candidate_count: nonNegativeInteger(input.seen_candidate_count, seenCandidateHashes.length),
    has_more: typeof input.has_more === 'boolean'
      ? input.has_more
      : !endSignal && remainingExpandCount > 0,
    partial_reasons: [...new Set((input.partial_reasons || [])
      .map(normalizeControlText)
      .filter(Boolean))],
    streams: {
      hot: normalizeStreamState(streams.hot),
      time: normalizeStreamState(streams.time)
    }
  };
}

function batchState(state = {}) {
  return {
    new_candidate_count: nonNegativeInteger(state.new_candidate_count),
    seen_candidate_count: nonNegativeInteger(state.seen_candidate_count),
    has_more: Boolean(state.has_more),
    stop_reason: state.stop_reason || '',
    declared_comment_count: nonNegativeInteger(state.declared_comment_count),
    captured_record_count: nonNegativeInteger(state.captured_record_count),
    remaining_expand_count: nonNegativeInteger(state.remaining_expand_count),
    end_signal: normalizeControlText(state.end_signal),
    count_gap: nonNegativeInteger(state.count_gap),
    partial_reasons: [...new Set((state.partial_reasons || [])
      .map(normalizeControlText)
      .filter(Boolean))]
  };
}

function buildCommentDomBatch(input = {}) {
  const scroll = input.scroll || {};
  return {
    schema_version: 'comment-dom-batch-v1',
    batch_id: input.batch_id || '',
    task_id: input.task_id || '',
    platform: input.platform || 'unknown',
    batch_kind: input.batch_kind || 'capture',
    source_url: input.source_url || '',
    captured_at: input.captured_at || new Date().toISOString(),
    scroll: {
      before_top: Math.max(0, Number(scroll.before_top) || 0),
      after_top: Math.max(0, Number(scroll.after_top) || 0),
      viewport_height: Math.max(0, Number(scroll.viewport_height) || 0),
      document_height: Math.max(0, Number(scroll.document_height) || 0)
    },
    state: batchState(input.state),
    limits: Object.assign({ maxCandidates: 500, maxCharsPerCandidate: 8000 }, input.limits),
    candidates: Array.isArray(input.candidates) ? input.candidates : []
  };
}

function resolveProfile(profileOrName) {
  const profile = typeof profileOrName === 'string'
    ? PLATFORM_PROFILES[profileOrName]
    : profileOrName;
  if (!profile || !profile.commentRootSelector || !profile.commentItemSelector) {
    throw new Error('A safe profile with commentRootSelector and commentItemSelector is required');
  }
  return Object.assign({ endTexts: [] }, profile);
}

function getPlaywright(tab) {
  if (!tab || !tab.playwright || typeof tab.playwright.locator !== 'function') {
    throw new Error('Expected a Chrome tab with playwright.locator');
  }
  return tab.playwright;
}

async function requireUniqueRoot(tab, rootSelector) {
  const root = getPlaywright(tab).locator(rootSelector);
  const count = await root.count();
  if (count !== 1) {
    throw new Error(`Expected exactly one comment root for ${rootSelector}, found ${count}`);
  }
  return root;
}

async function controlCanBeClicked(control) {
  if (typeof control.isVisible === 'function' && !await control.isVisible()) return false;
  if (typeof control.isDisabled === 'function' && await control.isDisabled()) return false;
  return true;
}

async function controlStillMatchesLabel(control, label) {
  if (typeof control.innerText !== 'function') return true;
  const currentText = normalizeControlText(await control.innerText());
  return currentText === label && isSafeExpandLabel(currentText);
}

async function expandExactLabel(tabOrRoot, rootSelectorOrLabel, labelMaybe) {
  const directRoot = tabOrRoot && typeof tabOrRoot.getByText === 'function';
  const root = directRoot
    ? tabOrRoot
    : await requireUniqueRoot(tabOrRoot, rootSelectorOrLabel);
  const label = directRoot ? rootSelectorOrLabel : labelMaybe;

  if (!isSafeExpandLabel(label)) {
    throw new Error(`Unsafe expansion label: ${normalizeControlText(label)}`);
  }

  const exactControls = root.getByText(normalizeControlText(label), { exact: true });
  const count = await exactControls.count();
  const controls = typeof exactControls.all === 'function' ? await exactControls.all() : [];
  let clicked = 0;

  for (let index = controls.length - 1; index >= 0; index -= 1) {
    const control = controls[index];
    if (!await controlCanBeClicked(control)) continue;
    if (!await controlStillMatchesLabel(control, normalizeControlText(label))) continue;
    await control.click();
    clicked += 1;
  }

  return { label: normalizeControlText(label), matched: count, clicked };
}

async function switchWeiboCommentSort(tab, profile, mode) {
  if (!CAPTURE_SORT_MODES.has(mode)) {
    throw new Error(`Unsupported Weibo sort mode: ${mode}`);
  }

  const spec = profile?.sorts?.[mode];
  const label = normalizeControlText(spec?.label);
  const selectedAttribute = normalizeControlText(spec?.selectedAttribute);
  const selectedValue = normalizeControlText(spec?.selectedValue);
  if (!label || !selectedAttribute || !selectedValue) {
    throw new Error(`Invalid Weibo ${mode} sort profile`);
  }

  const scope = await requireUniqueRoot(tab, profile?.sortScopeSelector);
  const control = scope.getByText(label, { exact: true });
  const matched = await control.count();

  if (matched !== 1) {
    throw new Error(`Expected one ${mode} sort control`);
  }
  if (!await controlCanBeClicked(control)) {
    throw new Error(`Weibo ${mode} sort control is not clickable`);
  }
  if (normalizeControlText(await control.innerText()) !== label) {
    throw new Error('Weibo sort label changed');
  }

  await control.click();
  const selected = await control.getAttribute(selectedAttribute);
  return {
    mode,
    label,
    matched,
    clicked: 1,
    verified: selected === selectedValue
  };
}

function inspectCommentRoot(root, profile) {
  const config = {
    commentItemSelector: profile.commentItemSelector,
    replyContainerSelector: profile.replyContainerSelector || '',
    endTexts: profile.endTexts || [],
    declaredCountSelector: profile.declaredCountSelector || '',
    identityMode: profile.identityMode || '',
    identityAttributes: profile.identityAttributes || {
      comment: [],
      parent: [],
      root: []
    },
    compositeIdentity: profile.compositeIdentity || {
      authorHrefSelector: '',
      commentTextSelector: '',
      timestampSelector: ''
    }
  };

  return root.evaluate((element, options) => {
    const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = node => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const domPath = node => {
      const parts = [];
      let current = node;
      while (current && current.nodeType === 1 && current !== element.parentElement) {
        let position = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) position += 1;
          sibling = sibling.previousElementSibling;
        }
        parts.unshift(`${current.tagName}:nth-of-type(${position})`);
        if (current === element) break;
        current = current.parentElement;
      }
      return parts.join('>');
    };
    const textWithoutReplies = (node, replySelector) => {
      const pieces = [];
      const visit = current => {
        for (const child of current.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            pieces.push(child.textContent || '');
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (replySelector && child.matches(replySelector)) continue;
            visit(child);
          }
        }
      };
      visit(node);
      return compact(pieces.join(' '));
    };
    const readConfiguredAttribute = (node, attributeNames) => {
      for (const name of attributeNames || []) {
        const value = compact(node && node.getAttribute(name));
        if (value) return value;
      }
      return '';
    };
    const readConfiguredText = (node, selector) => {
      if (!node || !selector) return '';
      const match = node.querySelector(selector);
      return compact(match && match.textContent);
    };
    const readConfiguredHref = (node, selector) => {
      if (!node || !selector) return '';
      const match = node.querySelector(selector);
      return compact(match && match.getAttribute('href'));
    };
    const findCommentAncestor = node => {
      let current = node && node.parentElement;
      while (current && current !== element) {
        if (current.matches(options.commentItemSelector)) return current;
        current = current.parentElement;
      }
      return null;
    };
    const findRootComment = node => {
      let rootComment = node;
      let ancestor = findCommentAncestor(rootComment);
      while (ancestor) {
        rootComment = ancestor;
        ancestor = findCommentAncestor(rootComment);
      }
      return rootComment;
    };
    const records = Array.from(element.querySelectorAll(options.commentItemSelector))
      .filter(visible)
      .map(node => {
        const rect = node.getBoundingClientRect();
        const authorLink = node.querySelector('a');
        const isReply = Boolean(options.replyContainerSelector && node.closest(options.replyContainerSelector));
        const parentComment = isReply ? findCommentAncestor(node) : null;
        const rootComment = isReply ? (parentComment && findRootComment(node)) : node;
        const identityAttributes = options.identityAttributes || {};
        const sourceCommentId = options.identityMode === 'dom_id'
          ? readConfiguredAttribute(node, identityAttributes.comment)
          : '';
        const sourceParentCommentId = options.identityMode === 'dom_id'
          ? (readConfiguredAttribute(node, identityAttributes.parent) ||
            readConfiguredAttribute(parentComment, identityAttributes.comment))
          : '';
        const sourceRootCommentId = options.identityMode === 'dom_id'
          ? (readConfiguredAttribute(node, identityAttributes.root) ||
            readConfiguredAttribute(rootComment, identityAttributes.comment))
          : '';
        const compositeIdentity = options.compositeIdentity || {};
        const sourceAuthorUidHref = options.identityMode === 'composite'
          ? readConfiguredHref(node, compositeIdentity.authorHrefSelector)
          : '';
        const sourceCommentText = options.identityMode === 'composite'
          ? readConfiguredText(node, compositeIdentity.commentTextSelector)
          : '';
        const sourceCommentTimestamp = options.identityMode === 'composite'
          ? readConfiguredText(node, compositeIdentity.timestampSelector)
          : '';
        const sourceReplyContext = isReply && parentComment
          ? textWithoutReplies(parentComment, options.replyContainerSelector)
          : '';
        const sourceRootContext = rootComment
          ? textWithoutReplies(rootComment, options.replyContainerSelector)
          : '';
        return {
          type: isReply ? 'reply' : 'comment',
          author: compact(authorLink && authorLink.textContent),
          content: textWithoutReplies(node, options.replyContainerSelector),
          time: sourceCommentTimestamp,
          dom_path: domPath(node),
          html: String(node.outerHTML || '').slice(0, 8000),
          source_comment_id: sourceCommentId,
          source_parent_comment_id: sourceParentCommentId,
          source_root_comment_id: sourceRootCommentId,
          source_author_uid_href: sourceAuthorUidHref,
          source_comment_text: sourceCommentText,
          source_comment_timestamp: sourceCommentTimestamp,
          source_reply_context: sourceReplyContext,
          source_root_context: sourceRootContext,
          nearby_buttons: Array.from(node.querySelectorAll('button,[role="button"]'))
            .map(button => compact(button.textContent))
            .filter(Boolean)
            .slice(0, 10),
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        };
      });
    const controls = Array.from(element.querySelectorAll('*'))
      .filter(node => visible(node))
      .map(node => ({
        text: compact(node.childElementCount === 0 ? node.textContent : ''),
        visible: true,
        disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true')
      }))
      .filter(control => control.text);
    const rootText = compact(element.innerText || element.textContent);
    const declaredElement = options.declaredCountSelector
      ? element.querySelector(options.declaredCountSelector)
      : null;
    const declaredMatch = compact(declaredElement && declaredElement.textContent).match(/\d+/);
    let scrollNode = element;
    let current = element;
    while (current && current.parentElement) {
      if (current.scrollHeight > current.clientHeight + 40) {
        scrollNode = current;
        break;
      }
      current = current.parentElement;
    }
    const scrollRect = scrollNode.getBoundingClientRect();

    return {
      records,
      controls,
      declared_comment_count: declaredMatch ? Number(declaredMatch[0]) : 0,
      end_signal: options.endTexts.find(text => rootText.includes(text)) || '',
      scroll: {
        top: Math.max(0, scrollNode.scrollTop || 0),
        scrollHeight: Math.max(0, scrollNode.scrollHeight || 0),
        clientHeight: Math.max(0, scrollNode.clientHeight || 0),
        rect: {
          top: scrollRect.top,
          left: scrollRect.left,
          width: scrollRect.width,
          height: scrollRect.height
        }
      }
    };
  }, config);
}

async function captureScopedRecords(tab, profileOrName, options = {}) {
  const profile = resolveProfile(profileOrName);
  const root = await requireUniqueRoot(tab, profile.commentRootSelector);
  const observed = await inspectCommentRoot(root, profile);
  const capturedAt = options.captured_at || new Date().toISOString();
  const startIndex = nonNegativeInteger(options.start_index, 0) + 1;
  const candidates = observed.records.map((record, index) => toCommentCandidate(
    Object.assign({}, record, {
      capture_sort_mode: options.capture_sort_mode || record.capture_sort_mode,
      source_capture_batch_ids: options.source_capture_batch_ids || record.source_capture_batch_ids
    }),
    startIndex + index,
    capturedAt
  ));
  const partialReasons = [...new Set([
    ...(observed.partial_reasons || []).map(normalizeControlText).filter(Boolean),
    ...(profile.identityMode && candidates.some(candidate => !candidate.identity_mode)
      ? ['missing_identity_evidence']
      : [])
  ])];

  return Object.assign({}, observed, {
    root_selector: profile.commentRootSelector,
    declared_comment_count: options.declared_comment_count == null
      ? observed.declared_comment_count
      : nonNegativeInteger(options.declared_comment_count),
    candidates,
    partial_reasons: partialReasons
  });
}

async function expandVisibleReplies(tab, profileOrName, options = {}) {
  const profile = resolveProfile(profileOrName);
  const maxRounds = Math.max(1, nonNegativeInteger(options.max_rounds, 1));
  const clicks = [];
  let observation = await captureScopedRecords(tab, profile, options);

  for (let round = 0; round < maxRounds; round += 1) {
    const labels = listSafeExpandLabels(observation.controls);
    if (labels.length === 0) break;
    for (const label of labels) {
      clicks.push(await expandExactLabel(tab, profile.commentRootSelector, label));
    }
    observation = await captureScopedRecords(tab, profile, options);
  }

  return Object.assign({ clicks }, observation);
}

async function scrollCommentContainer(tab, profileOrName, options = {}) {
  const profile = resolveProfile(profileOrName);
  const before = await captureScopedRecords(tab, profile, options);
  const rect = before.scroll.rect;
  if (!tab || !tab.cua || typeof tab.cua.scroll !== 'function') {
    throw new Error('Expected a Chrome tab with cua.scroll');
  }
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    throw new Error('Comment scroll container is not visible');
  }
  const scrollY = Math.max(1, Number(options.scroll_y) || Math.floor(before.scroll.clientHeight * 0.85));
  await tab.cua.scroll({
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + Math.min(rect.height / 2, Math.max(1, rect.height - 8))),
    scrollX: 0,
    scrollY
  });
  const after = await captureScopedRecords(tab, profile, options);
  return { before, after, changed: after.scroll.top !== before.scroll.top };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeCaptureArtifacts(runDir, batch, state) {
  if (!runDir) throw new Error('runDir is required');
  if (!batch || !batch.batch_id) throw new Error('batch.batch_id is required');
  const batchPath = path.join(runDir, 'batches', batch.batch_id, 'comment-dom-batch.json');
  const statePath = path.join(runDir, 'capture-state.json');
  writeJson(batchPath, batch);
  writeJson(statePath, state);
  return { batch_path: batchPath, state_path: statePath };
}

module.exports = {
  PLATFORM_PROFILES,
  normalizeControlText,
  isSafeExpandLabel,
  listSafeExpandLabels,
  createCandidateHash,
  toCommentCandidate,
  buildCaptureState,
  buildCommentDomBatch,
  expandExactLabel,
  switchWeiboCommentSort,
  expandVisibleReplies,
  inspectCommentRoot,
  captureScopedRecords,
  scrollCommentContainer,
  writeCaptureArtifacts
};
