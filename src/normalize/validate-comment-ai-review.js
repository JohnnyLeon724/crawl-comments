#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SENTIMENTS = new Set(['负面', '正面', '中性']);
const THEMES = new Set([
  '',
  '产品体验',
  '质量问题',
  '售后服务',
  '价格质疑',
  '营销反感',
  '品牌嘲讽',
  '功能问题',
  '内容质疑',
  '其他负面'
]);

function printUsage() {
  console.log(`
用法：
  node script/validate-comment-ai-review.js --comments all-normalized-comments.jsonl --ai-review ai-review-input --out semantic-qa-summary.json

参数：
  --comments   必填，规范评论 JSONL
  --ai-review  必填，审阅结果 JSON 数组、manifest.json 或其目录
  --out        必填，语义 QA 汇总 JSON
  --help       查看帮助
`.trim());
}

function readFlagValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要一个值`);
  return value;
}

function parseArgs(argv) {
  const args = { comments: '', aiReview: '', out: '', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--comments') {
      args.comments = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--ai-review') {
      args.aiReview = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--out') {
      args.out = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${token}`);
  }
  if (args.help) return args;
  if (!args.comments) throw new Error('必须提供 --comments');
  if (!args.aiReview) throw new Error('必须提供 --ai-review');
  if (!args.out) throw new Error('必须提供 --out');
  return args;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function readJsonArray(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`审阅输出必须是 JSON 数组：${filePath}`);
  return value;
}

function resolvePath(baseDir, value) {
  const rawPath = String(value || '');
  if (path.isAbsolute(rawPath)) return rawPath;
  if (fs.existsSync(rawPath)) return rawPath;
  return path.join(baseDir, rawPath);
}

function readReviewRows(inputPath) {
  const resolved = path.resolve(inputPath);
  const manifestPath = fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'manifest.json')
    : resolved;
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (!Array.isArray(parsed.batches)) {
    throw new Error(`审阅输入不是 JSON 数组或 manifest：${inputPath}`);
  }
  const baseDir = path.dirname(manifestPath);
  return parsed.batches.flatMap(batch => readJsonArray(resolvePath(baseDir, batch.output_file)));
}

function validateCommentAiReview(commentRows, reviewRows) {
  const errors = [];
  const comments = Array.isArray(commentRows) ? commentRows : [];
  const reviews = Array.isArray(reviewRows) ? reviewRows : [];
  const expected = new Set(comments
    .filter(row => row && row.row_key && row.text)
    .map(row => String(row.row_key)));
  const seen = new Set();

  for (const row of reviews) {
    const key = String(row?.row_key || '');
    if (!key || !expected.has(key)) errors.push({ code: 'unexpected_row_key', row_key: key });
    if (seen.has(key)) errors.push({ code: 'duplicate_row_key', row_key: key });
    seen.add(key);
    if (!SENTIMENTS.has(row?.sentiment)) errors.push({ code: 'invalid_sentiment', row_key: key });
    if (!THEMES.has(row?.negative_theme)) errors.push({ code: 'invalid_negative_theme', row_key: key });
    if (row?.sentiment !== '负面' && row?.negative_theme !== '') {
      errors.push({ code: 'theme_requires_negative', row_key: key });
    }
    if (row?.sentiment === '负面' && !row?.negative_theme) {
      errors.push({ code: 'missing_negative_theme', row_key: key });
    }
  }

  for (const key of expected) {
    if (!seen.has(key)) errors.push({ code: 'missing_row_key', row_key: key });
  }

  return {
    status: errors.length ? 'failed' : 'ok',
    summary: {
      expected_count: expected.size,
      review_count: reviews.length,
      error_count: errors.length
    },
    errors
  };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
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

  try {
    const result = validateCommentAiReview(readJsonl(args.comments), readReviewRows(args.aiReview));
    writeJson(args.out, result);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'failed') process.exitCode = 1;
    return result;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  SENTIMENTS,
  THEMES,
  parseArgs,
  readJsonl,
  readReviewRows,
  validateCommentAiReview,
  main
};
