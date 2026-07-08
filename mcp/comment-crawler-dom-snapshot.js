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

async function captureCommentDomSnapshot(page, options = {}) {
  const normalized = normalizeSnapshotOptions(options);

  const pageSnapshot = await page.evaluate(config => {
    const nowIso = () => new Date().toISOString();
    const cleanText = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
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
      if (!config.includeHtml || !el || typeof el.cloneNode !== 'function') return '';
      const clone = el.cloneNode(true);
      if (typeof clone.querySelectorAll === 'function') {
        clone.querySelectorAll('script,style,svg,canvas,video,noscript').forEach(node => node.remove());
      }
      return cleanText(clone.outerHTML || '').slice(0, config.maxCharsPerChunk);
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

    for (const el of elements) {
      if (chunks.length >= config.maxChunks) break;

      const innerText = config.includeText
        ? cleanText(el.innerText || el.textContent).slice(0, config.maxCharsPerChunk)
        : '';
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
      truncated: elements.length > chunks.length
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
  captureCommentDomSnapshot
};
