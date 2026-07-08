'use strict';

const DEFAULT_MAX_CHUNKS = 80;
const DEFAULT_MAX_CHARS_PER_CHUNK = 4000;

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeSnapshotOptions(options = {}) {
  return {
    platform: options.platform || 'unknown',
    sourceUrl: options.sourceUrl || '',
    maxChunks: toPositiveInteger(options.maxChunks, DEFAULT_MAX_CHUNKS),
    maxCharsPerChunk: toPositiveInteger(options.maxCharsPerChunk, DEFAULT_MAX_CHARS_PER_CHUNK),
    includeHtml: options.includeHtml !== false,
    includeText: options.includeText !== false
  };
}

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
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

function isNoiseText(value) {
  const text = cleanText(value);
  if (!text) return true;

  return [
    /沪ICP备|营业执照|公网安备|增值电信业务|违法不良信息|互联网药品信息服务/,
    /©\s*2014-2026|电话：?9501-3888|地址：?上海市黄浦区/,
    /00:00.*倍速|2K\s*高帧率|1080P\s*高清|请刷新试试/,
    /精选推荐搜索关注|下载抖音|内容由AI生成|章节要点/,
    /播放\s*\d{2}:\d{2}.*全屏/
  ].some(pattern => pattern.test(text));
}

function getDomPath(el, maxDepth = 8) {
  const parts = [];
  let current = el;

  while (current && current.nodeType === 1 && parts.length < maxDepth) {
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

function getRoleHint(el) {
  const marker = getElementMarker(el);
  if (/comment|reply|评论|回复/.test(marker)) return 'comment_candidate';
  return 'unknown';
}

function getNearbyButtons(el) {
  if (!el || typeof el.querySelectorAll !== 'function') return [];

  return Array.from(el.querySelectorAll('button,[role="button"],a'))
    .map(button => cleanText(button.textContent))
    .filter(Boolean)
    .slice(0, 8);
}

function isCandidateElement(el) {
  if (!el) return false;
  const text = cleanText(el.innerText || el.textContent);
  if (isNoiseText(text)) return false;
  return getRoleHint(el) === 'comment_candidate';
}

function buildCommentDomSnapshotFromElements(elements, options = {}) {
  const normalized = normalizeSnapshotOptions(options);
  const capturedAt = options.capturedAt || new Date().toISOString();
  const candidates = Array.from(elements || []).filter(isCandidateElement);
  const chunks = [];
  const seen = new Set();

  for (const el of candidates) {
    if (chunks.length >= normalized.maxChunks) break;

    const innerText = normalized.includeText
      ? cleanText(el.innerText || el.textContent).slice(0, normalized.maxCharsPerChunk)
      : '';
    const html = normalized.includeHtml
      ? stripUnsafeHtml(el.outerHTML || '').slice(0, normalized.maxCharsPerChunk)
      : '';
    const key = `${getDomPath(el)}::${innerText.slice(0, 120)}`;

    if (!innerText && !html) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    chunks.push({
      chunk_id: `chunk_${String(chunks.length + 1).padStart(4, '0')}`,
      dom_path: getDomPath(el),
      role_hint: getRoleHint(el),
      inner_text: innerText,
      html,
      nearby_buttons: getNearbyButtons(el),
      captured_at: capturedAt
    });
  }

  return {
    schema_version: 'comment-dom-snapshot-v1',
    platform: normalized.platform,
    source_url: normalized.sourceUrl,
    captured_at: capturedAt,
    expander_state: options.expanderState || {},
    limits: {
      maxChunks: normalized.maxChunks,
      maxCharsPerChunk: normalized.maxCharsPerChunk
    },
    truncated: candidates.length > chunks.length,
    chunks
  };
}

async function captureCommentDomSnapshot(page, options = {}) {
  const normalized = normalizeSnapshotOptions(options);

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
        /播放\s*\d{2}:\d{2}.*全屏/
      ].some(pattern => pattern.test(text));
    };
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
    const sanitizeHtml = el => {
      if (!config.includeHtml || !el) return '';
      return stripUnsafeHtml(el.outerHTML || '').slice(0, config.maxCharsPerChunk);
    };
    const roleHint = el => {
      const marker = [
        el.id || '',
        el.className || '',
        el.getAttribute && el.getAttribute('data-e2e') || '',
        el.getAttribute && el.getAttribute('data-testid') || '',
        el.getAttribute && el.getAttribute('aria-label') || ''
      ].join(' ').toLowerCase();

      if (/comment|reply|评论|回复/.test(marker)) return 'comment_candidate';
      return 'unknown';
    };
    const nearbyButtons = el => {
      if (!el || typeof el.querySelectorAll !== 'function') return [];
      return Array.from(el.querySelectorAll('button,[role="button"],a'))
        .map(button => cleanText(button.textContent))
        .filter(Boolean)
        .slice(0, 8);
    };
    const selector = [
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
    ].join(',');
    const elements = Array.from(document.querySelectorAll(selector));
    const chunks = [];
    const seen = new Set();
    let candidateCount = 0;

    for (const el of elements) {
      const innerText = config.includeText
        ? cleanText(el.innerText || el.textContent).slice(0, config.maxCharsPerChunk)
        : '';
      if (isNoiseText(innerText)) continue;
      if (roleHint(el) !== 'comment_candidate') continue;

      candidateCount += 1;
      if (chunks.length >= config.maxChunks) continue;

      const html = sanitizeHtml(el);
      const key = `${getDomPath(el)}::${innerText.slice(0, 120)}`;

      if (!innerText && !html) continue;
      if (seen.has(key)) continue;
      seen.add(key);

      chunks.push({
        chunk_id: `chunk_${String(chunks.length + 1).padStart(4, '0')}`,
        dom_path: getDomPath(el),
        role_hint: roleHint(el),
        inner_text: innerText,
        html,
        nearby_buttons: nearbyButtons(el),
        captured_at: nowIso()
      });
    }

    return {
      expander_state: window.__commentExpanderV1?.getState?.() || {},
      chunks,
      truncated: candidateCount > chunks.length
    };
  }, normalized);

  return {
    schema_version: 'comment-dom-snapshot-v1',
    platform: normalized.platform,
    source_url: normalized.sourceUrl,
    captured_at: new Date().toISOString(),
    expander_state: pageSnapshot.expander_state || {},
    limits: {
      maxChunks: normalized.maxChunks,
      maxCharsPerChunk: normalized.maxCharsPerChunk
    },
    truncated: Boolean(pageSnapshot.truncated),
    chunks: Array.isArray(pageSnapshot.chunks) ? pageSnapshot.chunks : []
  };
}

module.exports = {
  DEFAULT_MAX_CHUNKS,
  DEFAULT_MAX_CHARS_PER_CHUNK,
  toPositiveInteger,
  normalizeSnapshotOptions,
  cleanText,
  stripUnsafeHtml,
  isNoiseText,
  buildCommentDomSnapshotFromElements,
  captureCommentDomSnapshot
};
