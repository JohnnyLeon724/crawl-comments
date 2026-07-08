#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const report = require('./build-comment-excel-report.js');

const DEFAULT_SAMPLE_SIZE = 30;

function printUsage() {
  console.log(`
用法：
  node script/build-comment-qa-sample.js --run-dir output/run_001 --sample-size 30
  node script/build-comment-qa-sample.js --comments normalized-comments.jsonl --ai-review ai-review-input --out qa-sample.jsonl
  node script/build-comment-qa-sample.js --audit qa-sample-reviewed.jsonl --out qa-mismatches.json

参数：
  --run-dir      可选，自动推导 normalized-comments.jsonl、ai-review-input、qa-sample.jsonl
  --comments     可选，normalized-comments.jsonl 路径
  --ai-review    可选，AI 审阅 JSON 文件或目录
  --out          必填，sample 模式输出 JSONL；audit 模式输出 JSON
  --sample-size  可选，抽样数量，默认 30
  --audit        可选，进入审计模式，读取人工填好的 qa-sample JSONL
  --help         查看帮助
`.trim());
}

function readFlagValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 需要一个值`);
  }
  return value;
}

function parsePositiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    runDir: '',
    comments: '',
    aiReview: '',
    out: '',
    audit: '',
    sampleSize: DEFAULT_SAMPLE_SIZE,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--run-dir') {
      args.runDir = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--comments') {
      args.comments = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--ai-review') {
      args.aiReview = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--out') {
      args.out = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--sample-size') {
      args.sampleSize = parsePositiveInt(readFlagValue(argv, i, token), token);
      i += 1;
      continue;
    }

    if (token === '--audit') {
      args.audit = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    throw new Error(`未知参数：${token}`);
  }

  if (args.help) return args;

  if (args.runDir && !args.audit) {
    args.comments = args.comments || path.join(args.runDir, 'normalized-comments.jsonl');
    args.aiReview = args.aiReview || path.join(args.runDir, 'ai-review-input');
    args.out = args.out || path.join(args.runDir, 'qa-sample.jsonl');
  }

  if (args.runDir && args.audit && !args.out) {
    args.out = path.join(args.runDir, 'qa-mismatches.json');
  }

  if (args.audit) {
    if (!args.out) throw new Error('审计模式必须提供 --out');
    return args;
  }

  if (!args.comments) throw new Error('必须提供 --comments 或 --run-dir');
  if (!args.aiReview) throw new Error('必须提供 --ai-review 或 --run-dir');
  if (!args.out) throw new Error('必须提供 --out 或 --run-dir');

  return args;
}

function rowValue(row, field) {
  return String(row && row[field] != null ? row[field] : '');
}

function buildReviewIndex(reviewRows) {
  const index = new Map();

  for (const row of reviewRows) {
    if (!row || !row.row_key) continue;
    index.set(String(row.row_key), row);
  }

  return index;
}

function sampleRank(row) {
  if (row.ai_sentiment === '负面') return 0;
  if (row.ai_confidence === 'low') return 1;
  if (!row.ai_sentiment) return 2;
  if (row.ai_confidence === 'medium') return 3;
  return 4;
}

function buildQaRow(comment, review) {
  return {
    row_key: rowValue(comment, 'row_key'),
    source_url: rowValue(comment, 'source_url'),
    row_type: rowValue(comment, 'row_type'),
    user_name: rowValue(comment, 'user_name'),
    text: rowValue(comment, 'text'),
    root_text: rowValue(comment, 'root_text'),
    reply_to_user_name: rowValue(comment, 'reply_to_user_name'),
    ai_sentiment: rowValue(review, 'sentiment'),
    ai_negative_theme: rowValue(review, 'negative_theme'),
    ai_reason: rowValue(review, 'reason'),
    ai_confidence: rowValue(review, 'confidence'),
    human_sentiment: '',
    human_negative_theme: '',
    issue_type: '',
    qa_note: ''
  };
}

function buildQaSample(commentRows, reviewRows, sampleSize = DEFAULT_SAMPLE_SIZE) {
  const reviewIndex = buildReviewIndex(reviewRows);

  return commentRows
    .map(row => buildQaRow(row, reviewIndex.get(String(row.row_key || ''))))
    .filter(row => row.row_key && row.text)
    .sort((a, b) => {
      const rankDiff = sampleRank(a) - sampleRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.row_key.localeCompare(b.row_key);
    })
    .slice(0, sampleSize);
}

function detectIssueType(row) {
  const humanSentiment = rowValue(row, 'human_sentiment');
  const humanTheme = rowValue(row, 'human_negative_theme');
  const aiSentiment = rowValue(row, 'ai_sentiment');
  const aiTheme = rowValue(row, 'ai_negative_theme');

  if (!humanSentiment && !humanTheme) return '';
  if (!aiSentiment) return '缺少AI结果';
  if (humanSentiment && humanSentiment !== aiSentiment) return '情感误判';
  if (humanSentiment === '负面' && humanTheme && humanTheme !== aiTheme) return '负面主题误判';
  return '';
}

function buildQaAudit(sampleRows) {
  const reviewedRows = sampleRows.filter(row => rowValue(row, 'human_sentiment') || rowValue(row, 'human_negative_theme'));
  const mismatches = reviewedRows
    .map(row => Object.assign({}, row, { issue_type: detectIssueType(row) }))
    .filter(row => row.issue_type);

  return {
    summary: {
      total_rows: sampleRows.length,
      reviewed_rows: reviewedRows.length,
      mismatch_count: mismatches.length,
      sentiment_mismatch_count: mismatches.filter(row => row.issue_type === '情感误判').length,
      theme_mismatch_count: mismatches.filter(row => row.issue_type === '负面主题误判').length,
      missing_ai_count: mismatches.filter(row => row.issue_type === '缺少AI结果').length
    },
    mismatches
  };
}

function rowsToJsonl(rows) {
  if (!rows.length) return '';
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeQaSample(args) {
  const comments = report.readJsonl(args.comments);
  const reviews = report.readAiReviewRows(args.aiReview);
  const sample = buildQaSample(comments, reviews, args.sampleSize || DEFAULT_SAMPLE_SIZE);

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, rowsToJsonl(sample));

  return {
    status: 'success',
    mode: 'sample',
    out: args.out,
    sampleCount: sample.length
  };
}

function writeQaAudit(args) {
  const sampleRows = report.readJsonl(args.audit);
  const audit = buildQaAudit(sampleRows);

  writeJson(args.out, audit);

  return {
    status: 'success',
    mode: 'audit',
    out: args.out,
    summary: audit.summary
  };
}

async function main(argv = process.argv.slice(2)) {
  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return null;
  }

  if (args.help) {
    printUsage();
    return null;
  }

  const result = args.audit ? writeQaAudit(args) : writeQaSample(args);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  buildQaSample,
  buildQaAudit,
  rowsToJsonl,
  writeQaSample,
  writeQaAudit,
  main
};
