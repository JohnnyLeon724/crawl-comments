'use strict';

const SHEET_NAMES = Object.freeze([
  '总结',
  '按帖子楼层展示',
  '负面评论',
  '正面评论',
  '全部评论语义明细',
]);

function text(value) {
  return value == null ? '' : String(value);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function postGroupKey(row) {
  return [row.phase, row.source_url, row.source_excel_row, row.source_index]
    .map(text)
    .join('|');
}

function postTitle(row) {
  return `博主：${text(row.creator_name) || '未提供'}｜阶段：${text(row.phase) || '未提供'}｜互动量：${number(row.source_engagement_count)}｜链接：${text(row.source_url)}`;
}

function displayText(row) {
  return row.row_type === 'level2' ? `↳ ${text(row.text)}` : text(row.text);
}

function compareText(left, right) {
  const a = text(left);
  const b = text(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareNumberThenText(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftIsNumber = Number.isFinite(leftNumber) && text(left) !== '';
  const rightIsNumber = Number.isFinite(rightNumber) && text(right) !== '';

  if (leftIsNumber && rightIsNumber && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return compareText(left, right);
}

function comparePostGroups(left, right) {
  let comparison = compareText(left.row.phase, right.row.phase);
  if (comparison) return comparison;
  comparison = compareText(left.row.source_url, right.row.source_url);
  if (comparison) return comparison;
  comparison = compareNumberThenText(left.row.source_excel_row, right.row.source_excel_row);
  if (comparison) return comparison;
  comparison = compareNumberThenText(left.row.source_index, right.row.source_index);
  if (comparison) return comparison;
  return left.firstIndex - right.firstIndex;
}

function reviewIndex(reviewRows) {
  return new Map(reviewRows.map(row => [text(row && row.row_key), row]));
}

function mergeCommentWithReview(comment, review) {
  return {
    ...comment,
    raw: comment && comment.raw && typeof comment.raw === 'object' ? { ...comment.raw } : {},
    sentiment: text(review.sentiment),
    negative_theme: text(review.negative_theme),
    reason: text(review.reason),
    confidence: text(review.confidence),
  };
}

function createCounts(rows) {
  const totalComments = rows.length;
  const level1Comments = rows.filter(row => row.row_type === 'level1').length;
  const level2Replies = rows.filter(row => row.row_type === 'level2').length;
  const positiveComments = rows.filter(row => row.sentiment === '正面').length;
  const negativeComments = rows.filter(row => row.sentiment === '负面').length;
  const neutralComments = rows.filter(row => row.sentiment === '中性').length;

  return {
    total_comments: totalComments,
    level1_comments: level1Comments,
    level2_replies: level2Replies,
    positive_comments: positiveComments,
    negative_comments: negativeComments,
    neutral_comments: neutralComments,
    negative_rate: totalComments ? negativeComments / totalComments : 0,
  };
}

function groupMergedRows(mergedRows) {
  const groups = new Map();

  for (const [index, row] of mergedRows.entries()) {
    const key = postGroupKey(row);
    let group = groups.get(key);
    if (!group) {
      group = { key, row, rows: [], firstIndex: index };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  return [...groups.values()].sort(comparePostGroups);
}

function buildPhaseRows(groups) {
  const phaseGroups = new Map();

  for (const group of groups) {
    const phase = text(group.row.phase);
    let phaseGroup = phaseGroups.get(phase);
    if (!phaseGroup) {
      phaseGroup = { phase, post_count: 0, rows: [] };
      phaseGroups.set(phase, phaseGroup);
    }
    phaseGroup.post_count += 1;
    phaseGroup.rows.push(...group.rows);
  }

  return [...phaseGroups.values()]
    .sort((left, right) => compareText(left.phase, right.phase))
    .map(phaseGroup => ({
      phase: phaseGroup.phase,
      post_count: phaseGroup.post_count,
      ...createCounts(phaseGroup.rows),
    }));
}

function buildPostRows(groups) {
  return groups.map(group => ({
    post_group_key: group.key,
    post_title: postTitle(group.row),
    phase: text(group.row.phase),
    source_url: text(group.row.source_url),
    source_excel_row: group.row.source_excel_row == null ? '' : group.row.source_excel_row,
    source_index: text(group.row.source_index),
    creator_name: text(group.row.creator_name),
    source_engagement_count: number(group.row.source_engagement_count),
    ...createCounts(group.rows),
  }));
}

function buildThemeRows(mergedRows) {
  const themes = new Map();

  for (const row of mergedRows) {
    if (row.sentiment !== '负面') continue;
    const theme = text(row.negative_theme);
    themes.set(theme, (themes.get(theme) || 0) + 1);
  }

  return [...themes.entries()]
    .map(([negative_theme, comment_count]) => ({ negative_theme, comment_count }))
    .sort((left, right) => right.comment_count - left.comment_count || compareText(left.negative_theme, right.negative_theme));
}

function floorCommentRow(row, group) {
  return {
    record_type: 'comment',
    post_group_key: group.key,
    phase: text(row.phase),
    source_url: text(row.source_url),
    source_excel_row: row.source_excel_row == null ? '' : row.source_excel_row,
    source_index: text(row.source_index),
    row_type: text(row.row_type),
    display_text: displayText(row),
    created_at: text(row.created_at),
    user_name: text(row.user_name),
    reply_to_user_name: text(row.reply_to_user_name),
    root_text: text(row.root_text),
    like_count: number(row.like_count),
    sentiment: text(row.sentiment),
    negative_theme: text(row.negative_theme),
    reason: text(row.reason),
    confidence: text(row.confidence),
    row_key: text(row.row_key),
  };
}

function buildFloorRows(groups) {
  const floorRows = [];

  for (const group of groups) {
    floorRows.push({
      record_type: 'post_header',
      post_group_key: group.key,
      post_title: postTitle(group.row),
      phase: text(group.row.phase),
      source_url: text(group.row.source_url),
      source_excel_row: group.row.source_excel_row == null ? '' : group.row.source_excel_row,
      source_index: text(group.row.source_index),
      creator_name: text(group.row.creator_name),
      source_engagement_count: number(group.row.source_engagement_count),
    });
    floorRows.push(...group.rows.map(row => floorCommentRow(row, group)));
  }

  return floorRows;
}

function buildWeiboHistoryReportModel(commentRows, reviewRows) {
  if (!Array.isArray(commentRows) || !Array.isArray(reviewRows)) {
    throw new TypeError('评论和语义审阅结果必须为数组');
  }

  const reviews = reviewIndex(reviewRows);
  if (commentRows.some(comment => !reviews.has(text(comment && comment.row_key)))) {
    throw new Error('语义审阅未覆盖全部评论');
  }

  const detailRows = commentRows.map(comment => mergeCommentWithReview(
    comment,
    reviews.get(text(comment && comment.row_key)),
  ));
  const groups = groupMergedRows(detailRows);
  const postRows = buildPostRows(groups);
  const summary = {
    post_count: groups.length,
    ...createCounts(detailRows),
  };

  return {
    sheetNames: [...SHEET_NAMES],
    summary,
    phaseRows: buildPhaseRows(groups),
    postRows,
    themeRows: buildThemeRows(detailRows),
    floorRows: buildFloorRows(groups),
    negativeRows: detailRows.filter(row => row.sentiment === '负面'),
    positiveRows: detailRows.filter(row => row.sentiment === '正面'),
    detailRows,
  };
}

module.exports = {
  SHEET_NAMES,
  postGroupKey,
  postTitle,
  displayText,
  buildWeiboHistoryReportModel,
};
