'use strict';

const crypto = require('node:crypto');

function normalizeSpaces(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function compact(value) {
  return normalizeSpaces(value).replace(/\s+/g, '');
}

function extractXiaohongshuNoteId(sourceUrl) {
  const raw = String(sourceUrl || '').trim();
  const notePattern = /\/(?:explore|note|search_result|discovery\/item)\/([a-f0-9]+)|\/user\/profile\/[^/?#]+\/([a-f0-9]+)/i;

  try {
    const parsed = new URL(raw);
    const queryId = parsed.searchParams.get('note_id') || parsed.searchParams.get('noteId');
    if (queryId) return queryId;

    const match = parsed.pathname.match(notePattern);
    return match ? (match[1] || match[2]) : '';
  } catch (_error) {
    const match = raw.match(notePattern);
    if (match) return match[1] || match[2];
    return /^[a-f0-9]+$/i.test(raw) ? raw : '';
  }
}

function parseXiaohongshuLikeCountText(value) {
  const integerRe = /^(?:\d+|\d{1,3}(?:[,，]\d{3})+)\+?$/u;
  const shortformRe = /^((?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d+)?)([wWkK万千])\+?$/u;
  const raw = String(value ?? '').replace(/\s+/g, '');

  if (!raw) return 0;
  if (integerRe.test(raw)) return Number(raw.replace(/[,+，]/g, ''));

  const short = raw.match(shortformRe);
  if (!short) return 0;

  const numeric = Number(short[1].replace(/[,，]/g, ''));
  if (!Number.isFinite(numeric)) return 0;

  const unit = short[2].toLowerCase();
  const multiplier = unit === 'w' || unit === '万' ? 10000 : 1000;
  return Math.round(numeric * multiplier);
}

function parseLikeCount(raw) {
  if (raw && raw.likes != null) {
    if (typeof raw.likes === 'number' && Number.isFinite(raw.likes)) return raw.likes;
    return parseXiaohongshuLikeCountText(raw.likes);
  }

  const match = normalizeSpaces(raw && raw.text).match(/(?:点赞|赞)\s*([\d,.，]+(?:\.\d+)?\s*[wWkK万千]?\+?)$/u);
  return match ? parseXiaohongshuLikeCountText(match[1]) : 0;
}

function stripTrailingActions(text) {
  let current = normalizeSpaces(text);
  let previous = '';

  while (current && current !== previous) {
    previous = current;
    current = current
      .replace(/\s*(?:回复|点赞|赞|收藏|分享|举报|评论)(?:\s*[\d,.，]+(?:\.\d+)?\s*[wWkK万千]?\+?)?\s*$/gu, '')
      .trim();
  }

  return current;
}

function stripXiaohongshuUiText(text) {
  const withoutExpanders = normalizeSpaces(text)
    .replace(/\s*(?:展开|查看)(?:更多|全部)?\s*\d*\s*条?回复\s*/g, ' ')
    .replace(/\s*(?:查看更多回复|展开更多回复|展开回复|更多回复)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripTrailingActions(withoutExpanders);
}

function splitAuthorPrefix(text) {
  const cleaned = stripXiaohongshuUiText(text);
  const match = cleaned.match(/^([^：:]{1,32})[：:](.+)$/);

  if (!match) {
    return {
      userName: '',
      text: cleaned
    };
  }

  return {
    userName: normalizeSpaces(match[1]),
    text: normalizeSpaces(match[2])
  };
}

function buildRowKey(parts) {
  return crypto
    .createHash('sha1')
    .update(parts.map(part => compact(part)).join('|'))
    .digest('hex');
}

function normalizeRow(raw, options) {
  const sourceUrl = options.sourceUrl || '';
  const rowType = raw.row_type === 'level2' || raw.is_reply === true ? 'level2' : 'level1';
  const originalText = normalizeSpaces(raw.text);
  const authorFromCli = normalizeSpaces(raw.author || raw.user_name);
  const authorAndText = authorFromCli
    ? { userName: authorFromCli, text: stripXiaohongshuUiText(originalText) }
    : splitAuthorPrefix(originalText);
  const text = authorAndText.text;

  if (!text) return null;

  const noteId = extractXiaohongshuNoteId(sourceUrl);
  const rowKey = buildRowKey([
    'xiaohongshu',
    sourceUrl,
    rowType,
    authorAndText.userName,
    text
  ]);

  return {
    row_key: rowKey,
    platform: 'xiaohongshu',
    source_url: sourceUrl,
    post_id: noteId,
    row_type: rowType,
    comment_id: '',
    root_comment_id: rowType === 'level1' ? rowKey : '',
    parent_comment_id: '',
    user_name: authorAndText.userName,
    text,
    created_at: normalizeSpaces(raw.time || raw.captured_at),
    like_count: parseLikeCount(raw),
    reply_to_user_name: normalizeSpaces(raw.reply_to || raw.reply_to_user_name),
    root_text: rowType === 'level1' ? text : normalizeSpaces(raw.root_text),
    raw: Object.assign({}, raw)
  };
}

function normalizeXiaohongshuPayload(payload, options = {}) {
  const sourceUrl = options.sourceUrl || payload.source_url || payload.pageUrl || payload.page_url || '';
  const seen = new Set();
  const rows = [];
  const results = Array.isArray(payload && payload.results) ? payload.results : [];

  for (const item of results) {
    const row = normalizeRow(item || {}, { sourceUrl });
    if (!row || seen.has(row.row_key)) continue;
    seen.add(row.row_key);
    rows.push(row);
  }

  return rows;
}

module.exports = {
  normalizeXiaohongshuPayload,
  normalizeRow,
  extractXiaohongshuNoteId,
  parseXiaohongshuLikeCountText,
  stripXiaohongshuUiText,
  splitAuthorPrefix,
  buildRowKey
};
