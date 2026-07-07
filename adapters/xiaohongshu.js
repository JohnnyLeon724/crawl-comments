'use strict';

const crypto = require('node:crypto');

function normalizeSpaces(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function compact(value) {
  return normalizeSpaces(value).replace(/\s+/g, '');
}

function extractXiaohongshuNoteId(sourceUrl) {
  const raw = String(sourceUrl || '');

  try {
    const parsed = new URL(raw);
    const queryId = parsed.searchParams.get('note_id') || parsed.searchParams.get('noteId');
    if (queryId) return queryId;

    const match = parsed.pathname.match(/\/(?:explore|discovery\/item)\/([^/?#]+)/);
    return match ? match[1] : '';
  } catch (_error) {
    const match = raw.match(/\/(?:explore|discovery\/item)\/([^/?#]+)/);
    return match ? match[1] : '';
  }
}

function parseLikeCount(text) {
  const match = normalizeSpaces(text).match(/(?:点赞|赞)\s*(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function stripTrailingActions(text) {
  let current = normalizeSpaces(text);
  let previous = '';

  while (current && current !== previous) {
    previous = current;
    current = current
      .replace(/\s*(?:回复|点赞|赞|收藏|分享|举报|评论)(?:\s*\d+)?\s*$/g, '')
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
  const rowType = raw.row_type === 'level2' ? 'level2' : 'level1';
  const originalText = normalizeSpaces(raw.text);
  const authorAndText = splitAuthorPrefix(originalText);
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
    created_at: normalizeSpaces(raw.captured_at),
    like_count: parseLikeCount(originalText),
    reply_to_user_name: '',
    root_text: rowType === 'level1' ? text : '',
    raw: Object.assign({}, raw)
  };
}

function normalizeXiaohongshuPayload(payload, options = {}) {
  const sourceUrl = options.sourceUrl || payload.source_url || '';
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
  stripXiaohongshuUiText,
  splitAuthorPrefix,
  buildRowKey
};
