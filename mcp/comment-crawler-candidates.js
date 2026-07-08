'use strict';

const crypto = require('node:crypto');

const DEFAULT_MAX_CANDIDATES = 80;
const DEFAULT_MAX_CHARS_PER_CANDIDATE = 2500;
const BASE_CANDIDATE_SELECTORS = Object.freeze([
  '[data-e2e*="comment"]',
  '[data-e2e*="reply"]',
  '[data-testid*="comment"]',
  '[data-testid*="reply"]',
  '[class*="comment"]',
  '[class*="reply"]',
  '[class*="Comment"]',
  '[class*="Reply"]',
  '[class*="评论"]',
  '[class*="回复"]'
]);
const PLATFORM_CANDIDATE_SELECTORS = Object.freeze({
  douyin: Object.freeze([
    '[data-e2e*="comment-item"]',
    '[data-e2e*="reply-item"]',
    '[data-e2e*="video-comment"]',
    '[class*="CommentItem"]',
    '[class*="comment-item"]',
    '[class*="reply-item"]'
  ]),
  xiaohongshu: Object.freeze([
    '[class*="comments-el"]',
    '[class*="comment-item"]',
    '[class*="parent-comment"]',
    '[class*="reply-container"]',
    '[data-testid*="comment-item"]',
    '[data-testid*="reply"]'
  ])
});

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeCandidateOptions(options = {}) {
  return {
    taskId: options.taskId || '',
    batchId: options.batchId || '',
    platform: options.platform || 'unknown',
    sourceUrl: options.sourceUrl || '',
    maxCandidates: toPositiveInteger(options.maxCandidates, DEFAULT_MAX_CANDIDATES),
    maxCharsPerCandidate: toPositiveInteger(options.maxCharsPerCandidate, DEFAULT_MAX_CHARS_PER_CANDIDATE),
    includeHtml: options.includeHtml !== false,
    includeText: options.includeText !== false,
    viewportHeight: toNonNegativeNumber(options.viewportHeight),
    documentHeight: toNonNegativeNumber(options.documentHeight),
    beforeTop: toNonNegativeNumber(options.beforeTop),
    afterTop: toNonNegativeNumber(options.afterTop),
    seenCandidateHashes: Array.isArray(options.seenCandidateHashes)
      ? options.seenCandidateHashes.map(value => String(value))
      : []
  };
}

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function getCandidateSelector(platform = 'unknown') {
  const platformSelectors = PLATFORM_CANDIDATE_SELECTORS[String(platform || '').toLowerCase()] || [];
  return Array.from(new Set([...platformSelectors, ...BASE_CANDIDATE_SELECTORS])).join(',');
}

function stripUnsafeHtml(value) {
  return cleanText(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, '')
    .replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseText(value) {
  const text = cleanText(value);
  if (!text) return true;

  return [
    /沪ICP备|营业执照|公网安备|增值电信业务|违法不良信息|互联网药品信息服务/,
    /©\s*2014-2026|电话：?9501-3888|地址：?上海市黄浦区/,
    /00:00.*倍速|2K\s*高帧率|1080P\s*高清|请刷新试试/,
    /精选推荐搜索关注|下载抖音|内容由AI生成|章节要点/,
    /手机号登录|获取验证码|用户协议|隐私政策|登录后推荐/,
    /播放\s*\d{2}:\d{2}.*全屏/
  ].some(pattern => pattern.test(text));
}

function getElementMarker(el) {
  if (!el) return '';

  return [
    el.id || '',
    el.className || '',
    el.getAttribute && el.getAttribute('data-e2e') || '',
    el.getAttribute && el.getAttribute('data-testid') || '',
    el.getAttribute && el.getAttribute('aria-label') || ''
  ].join(' ').toLowerCase();
}

function getRoleHint(el) {
  const marker = getElementMarker(el);
  if (/reply|回复/.test(marker)) return 'reply_candidate';
  if (/comment|评论/.test(marker)) return 'comment_candidate';
  return 'unknown';
}

function isNoiseMarker(value) {
  const marker = cleanText(value).toLowerCase();
  if (!marker) return false;

  return [
    /footer|copyright|license|beian|icp/,
    /login|modal|passport|captcha|verify/,
    /nav|navbar|sidebar|toolbar|header/,
    /player|video-control|control-bar|progress/,
    /download|recommend|search|suggest/,
    /广告|登录|验证码|导航|搜索|推荐|页脚/
  ].some(pattern => pattern.test(marker));
}

function getDomPath(el, maxDepth = 8) {
  const parts = [];
  let current = el;

  while (current && current.nodeType !== 9 && parts.length < maxDepth) {
    const tagName = current.tagName || 'NODE';
    let index = 1;
    let prev = current.previousElementSibling;

    while (prev) {
      if (prev.tagName === tagName) index += 1;
      prev = prev.previousElementSibling;
    }

    parts.unshift(`${tagName}:nth-of-type(${index})`);
    current = current.parentElement;
  }

  return parts.join('>');
}

function getNearbyButtons(el) {
  if (!el || typeof el.querySelectorAll !== 'function') return [];

  return Array.from(el.querySelectorAll('button,[role="button"],a'))
    .map(button => cleanText(button.textContent))
    .filter(Boolean)
    .slice(0, 8);
}

function getRect(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    return { top: 0, left: 0, width: 0, height: 0 };
  }

  const rect = el.getBoundingClientRect();
  return {
    top: Number(rect.top) || 0,
    left: Number(rect.left) || 0,
    width: Number(rect.width) || 0,
    height: Number(rect.height) || 0
  };
}

function isVisibleRect(rect, viewportHeight) {
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (!viewportHeight) return true;
  return rect.top + rect.height >= 0 && rect.top <= viewportHeight;
}

function buildCandidateHash(input) {
  const basis = [
    cleanText(input.roleHint || ''),
    cleanText(input.innerText || '').slice(0, 500)
  ].join('::');
  return crypto.createHash('sha1').update(basis).digest('hex');
}

function isCandidateElement(el, options) {
  if (!el) return false;
  const rect = getRect(el);
  if (!isVisibleRect(rect, options.viewportHeight)) return false;

  const text = cleanText(el.innerText || el.textContent);
  if (isNoiseText(text)) return false;
  if (isNoiseMarker(getElementMarker(el))) return false;

  const roleHint = getRoleHint(el);
  return roleHint === 'comment_candidate' || roleHint === 'reply_candidate';
}

function isSupportedRoleHint(roleHint) {
  return roleHint === 'comment_candidate' || roleHint === 'reply_candidate';
}

function toScrollValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return toNonNegativeNumber(value, fallback);
}

function buildCommentDomBatchFromRecords(records, options = {}) {
  const normalized = normalizeCandidateOptions(options);
  const capturedAt = options.capturedAt || new Date().toISOString();
  const scroll = options.scroll || {};
  const seen = new Set(normalized.seenCandidateHashes);
  const candidates = [];
  let eligibleUnseenCount = 0;

  for (const record of Array.from(records || [])) {
    const roleHint = String(record && record.role_hint || '');
    const rawText = cleanText(record && record.inner_text);
    const marker = cleanText(record && record.marker);
    const rect = Object.assign({
      top: 0,
      left: 0,
      width: 0,
      height: 0
    }, record && record.rect);

    if (!isSupportedRoleHint(roleHint)) continue;
    if (!isVisibleRect(rect, normalized.viewportHeight)) continue;
    if (isNoiseText(rawText)) continue;
    if (isNoiseMarker(marker)) continue;

    const innerText = normalized.includeText
      ? rawText.slice(0, normalized.maxCharsPerCandidate)
      : '';
    const html = normalized.includeHtml
      ? stripUnsafeHtml(record && record.html || '').slice(0, normalized.maxCharsPerCandidate)
      : '';
    const candidateHash = buildCandidateHash({
      roleHint,
      innerText: rawText
    });

    if (!innerText && !html) continue;
    if (seen.has(candidateHash)) continue;

    eligibleUnseenCount += 1;
    if (candidates.length >= normalized.maxCandidates) continue;

    seen.add(candidateHash);
    candidates.push({
      candidate_id: `candidate_${String(candidates.length + 1).padStart(6, '0')}`,
      candidate_hash: candidateHash,
      dom_path: String(record && record.dom_path || ''),
      role_hint: roleHint,
      inner_text: innerText,
      html,
      nearby_buttons: Array.isArray(record && record.nearby_buttons)
        ? record.nearby_buttons.map(cleanText).filter(Boolean).slice(0, 8)
        : [],
      rect,
      captured_at: String(record && record.captured_at || capturedAt)
    });
  }

  return {
    schema_version: 'comment-dom-batch-v1',
    batch_id: normalized.batchId,
    task_id: normalized.taskId,
    platform: normalized.platform,
    source_url: normalized.sourceUrl,
    captured_at: capturedAt,
    scroll: {
      before_top: toScrollValue(scroll.before_top, normalized.beforeTop),
      after_top: toScrollValue(scroll.after_top, normalized.afterTop),
      viewport_height: toScrollValue(scroll.viewport_height, normalized.viewportHeight),
      document_height: toScrollValue(scroll.document_height, normalized.documentHeight)
    },
    state: {
      new_candidate_count: candidates.length,
      seen_candidate_count: seen.size,
      has_more: eligibleUnseenCount > candidates.length,
      stop_reason: eligibleUnseenCount > candidates.length ? 'max_candidates' : ''
    },
    limits: {
      maxCandidates: normalized.maxCandidates,
      maxCharsPerCandidate: normalized.maxCharsPerCandidate
    },
    candidates
  };
}

function buildCommentDomBatchFromElements(elements, options = {}) {
  const normalized = normalizeCandidateOptions(options);
  const capturedAt = options.capturedAt || new Date().toISOString();
  const seen = new Set(normalized.seenCandidateHashes);
  const candidates = [];
  let eligibleUnseenCount = 0;

  for (const el of Array.from(elements || [])) {
    if (!isCandidateElement(el, normalized)) continue;

    const roleHint = getRoleHint(el);
    const innerText = normalized.includeText
      ? cleanText(el.innerText || el.textContent).slice(0, normalized.maxCharsPerCandidate)
      : '';
    const html = normalized.includeHtml
      ? stripUnsafeHtml(el.outerHTML || '').slice(0, normalized.maxCharsPerCandidate)
      : '';
    const candidateHash = buildCandidateHash({
      roleHint,
      innerText: cleanText(el.innerText || el.textContent)
    });

    if (!innerText && !html) continue;
    if (seen.has(candidateHash)) continue;

    eligibleUnseenCount += 1;
    if (candidates.length >= normalized.maxCandidates) continue;

    seen.add(candidateHash);
    candidates.push({
      candidate_id: `candidate_${String(candidates.length + 1).padStart(6, '0')}`,
      candidate_hash: candidateHash,
      dom_path: getDomPath(el),
      role_hint: roleHint,
      inner_text: innerText,
      html,
      nearby_buttons: getNearbyButtons(el),
      rect: getRect(el),
      captured_at: capturedAt
    });
  }

  return {
    schema_version: 'comment-dom-batch-v1',
    batch_id: normalized.batchId,
    task_id: normalized.taskId,
    platform: normalized.platform,
    source_url: normalized.sourceUrl,
    captured_at: capturedAt,
    scroll: {
      before_top: normalized.beforeTop,
      after_top: normalized.afterTop,
      viewport_height: normalized.viewportHeight,
      document_height: normalized.documentHeight
    },
    state: {
      new_candidate_count: candidates.length,
      seen_candidate_count: seen.size,
      has_more: eligibleUnseenCount > candidates.length,
      stop_reason: eligibleUnseenCount > candidates.length ? 'max_candidates' : ''
    },
    limits: {
      maxCandidates: normalized.maxCandidates,
      maxCharsPerCandidate: normalized.maxCharsPerCandidate
    },
    candidates
  };
}

async function captureCommentCandidateBatch(page, options = {}) {
  const normalized = normalizeCandidateOptions(options);
  const scrollAfterCapture = Boolean(options.scrollAfterCapture);
  const parsedScrollStepRatio = Number(options.scrollStepRatio);
  const scrollStepRatio = Number.isFinite(parsedScrollStepRatio) && parsedScrollStepRatio > 0
    ? parsedScrollStepRatio
    : 0.85;

  const pageSnapshot = await page.evaluate(config => {
    const nowIso = () => new Date().toISOString();
    const cleanText = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const stripUnsafeHtml = value => cleanText(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, '')
      .replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, '')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const isNoiseText = value => {
      const text = cleanText(value);
      if (!text) return true;

      return [
        /沪ICP备|营业执照|公网安备|增值电信业务|违法不良信息|互联网药品信息服务/,
        /©\s*2014-2026|电话：?9501-3888|地址：?上海市黄浦区/,
        /00:00.*倍速|2K\s*高帧率|1080P\s*高清|请刷新试试/,
        /精选推荐搜索关注|下载抖音|内容由AI生成|章节要点/,
        /手机号登录|获取验证码|用户协议|隐私政策|登录后推荐/,
        /播放\s*\d{2}:\d{2}.*全屏/
      ].some(pattern => pattern.test(text));
    };
    const elementMarker = el => [
      el.id || '',
      el.className || '',
      el.getAttribute && el.getAttribute('data-e2e') || '',
      el.getAttribute && el.getAttribute('data-testid') || '',
      el.getAttribute && el.getAttribute('aria-label') || ''
    ].join(' ').toLowerCase();
    const isNoiseMarker = value => {
      const marker = cleanText(value).toLowerCase();
      if (!marker) return false;

      return [
        /footer|copyright|license|beian|icp/,
        /login|modal|passport|captcha|verify/,
        /nav|navbar|sidebar|toolbar|header/,
        /player|video-control|control-bar|progress/,
        /download|recommend|search|suggest/,
        /广告|登录|验证码|导航|搜索|推荐|页脚/
      ].some(pattern => pattern.test(marker));
    };
    const getScrollTop = () => Number(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0);
    const getDocumentHeight = () => Math.max(
      Number(document.body && document.body.scrollHeight) || 0,
      Number(document.documentElement && document.documentElement.scrollHeight) || 0
    );
    const getDomPath = (el, maxDepth = 8) => {
      const parts = [];
      let current = el;

      while (current && current.nodeType === 1 && parts.length < maxDepth) {
        let index = 1;
        let prev = current.previousElementSibling;

        while (prev) {
          if (prev.tagName === current.tagName) index += 1;
          prev = prev.previousElementSibling;
        }

        parts.unshift(`${current.tagName}:nth-of-type(${index})`);
        current = current.parentElement;
      }

      return parts.join('>');
    };
    const roleHint = el => {
      const marker = elementMarker(el);

      if (/reply|回复/.test(marker)) return 'reply_candidate';
      if (/comment|评论/.test(marker)) return 'comment_candidate';
      return 'unknown';
    };
    const nearbyButtons = el => {
      if (!el || typeof el.querySelectorAll !== 'function') return [];
      return Array.from(el.querySelectorAll('button,[role="button"],a'))
        .map(button => cleanText(button.textContent))
        .filter(Boolean)
        .slice(0, 8);
    };
    const toRect = el => {
      const rect = el.getBoundingClientRect();
      return {
        top: Number(rect.top) || 0,
        left: Number(rect.left) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0
      };
    };
    const isVisibleRect = rect => {
      const viewportHeight = Number(window.innerHeight || document.documentElement.clientHeight || 0);
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (!viewportHeight) return true;
      return rect.top + rect.height >= 0 && rect.top <= viewportHeight;
    };
    const selector = config.candidateSelector;
    const beforeTop = getScrollTop();
    const viewportHeight = Number(window.innerHeight || document.documentElement.clientHeight || 0);
    const records = [];

    for (const el of Array.from(document.querySelectorAll(selector))) {
      const marker = elementMarker(el);
      if (isNoiseMarker(marker)) continue;

      const role = roleHint(el);
      if (role !== 'comment_candidate' && role !== 'reply_candidate') continue;

      const rect = toRect(el);
      if (!isVisibleRect(rect)) continue;

      const innerText = cleanText(el.innerText || el.textContent);
      if (isNoiseText(innerText)) continue;

      records.push({
        dom_path: getDomPath(el),
        role_hint: role,
        marker,
        inner_text: config.includeText ? innerText : '',
        html: config.includeHtml ? stripUnsafeHtml(el.outerHTML || '') : '',
        nearby_buttons: nearbyButtons(el),
        rect,
        captured_at: nowIso()
      });
    }

    if (config.scrollAfterCapture) {
      const step = Math.max(360, Math.round(viewportHeight * config.scrollStepRatio));
      window.scrollBy(0, step);
    }

    return {
      records,
      scroll: {
        before_top: beforeTop,
        after_top: getScrollTop(),
        viewport_height: viewportHeight,
        document_height: getDocumentHeight()
      }
    };
  }, {
    ...normalized,
    candidateSelector: getCandidateSelector(normalized.platform),
    scrollAfterCapture,
    scrollStepRatio
  });

  return buildCommentDomBatchFromRecords(pageSnapshot && pageSnapshot.records, {
    ...normalized,
    capturedAt: options.capturedAt,
    scroll: pageSnapshot && pageSnapshot.scroll
  });
}

module.exports = {
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_MAX_CHARS_PER_CANDIDATE,
  toPositiveInteger,
  normalizeCandidateOptions,
  cleanText,
  getCandidateSelector,
  stripUnsafeHtml,
  isNoiseText,
  isNoiseMarker,
  getRoleHint,
  getDomPath,
  getRect,
  isVisibleRect,
  buildCandidateHash,
  buildCommentDomBatchFromRecords,
  buildCommentDomBatchFromElements,
  captureCommentCandidateBatch
};
