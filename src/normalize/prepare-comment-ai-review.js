#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BATCH_SIZE = 80;
const DEFAULT_MAX_CHARS = 24000;

function printUsage() {
  console.log(`
用法：
  node script/prepare-comment-ai-review.js --input normalized-comments.jsonl --out-dir ai-review-input

参数：
  --input       必填，normalized-comments.jsonl
  --out-dir     必填，AI 审阅输入输出目录
  --batch-size  可选，每批评论数量，默认 80
  --max-chars   可选，每批评论与回复上下文的最大字符数，默认 24000
  --help        查看帮助
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
    input: '',
    outDir: '',
    batchSize: DEFAULT_BATCH_SIZE,
    maxChars: DEFAULT_MAX_CHARS,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--input') {
      args.input = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--out-dir') {
      args.outDir = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--batch-size') {
      args.batchSize = parsePositiveInt(readFlagValue(argv, i, token), token);
      i += 1;
      continue;
    }

    if (token === '--max-chars') {
      args.maxChars = parsePositiveInt(readFlagValue(argv, i, token), token);
      i += 1;
      continue;
    }

    throw new Error(`未知参数：${token}`);
  }

  if (args.help) return args;
  if (!args.input) throw new Error('必须提供 --input');
  if (!args.outDir) throw new Error('必须提供 --out-dir');

  return args;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function buildReviewItem(row) {
  return {
    row_key: String(row.row_key || ''),
    row_type: String(row.row_type || ''),
    user_name: String(row.user_name || ''),
    text: String(row.text || ''),
    root_text: String(row.root_text || ''),
    reply_to_user_name: String(row.reply_to_user_name || '')
  };
}

function reviewItemChars(item) {
  return [item.text, item.root_text, item.reply_to_user_name]
    .map(value => String(value || '').length)
    .reduce((sum, length) => sum + length, 0);
}

function splitReviewItems(items, maxItems = DEFAULT_BATCH_SIZE, maxChars = DEFAULT_MAX_CHARS) {
  const chunks = [];
  let current = [];
  let chars = 0;

  for (const item of items) {
    const itemChars = reviewItemChars(item);
    if (current.length && (current.length >= maxItems || chars + itemChars > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += itemChars;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function chunkRows(rows, batchSize) {
  return splitReviewItems(rows, batchSize, Number.POSITIVE_INFINITY);
}

function buildPrompt(rows) {
  return [
    '你是中文社媒评论语义分析员。请基于整段语义判断每条评论对 TCL、TCL电视、TCL产品体验、售后服务、品牌或官方内容的态度。',
    '',
    '规则：',
    '1. 只判断当前评论或回复本身的态度。',
    '2. 历史导入没有微博正文；不得推断或补充微博正文。',
    '3. 二级回复需要结合 root_text 和 reply_to_user_name 理解上下文。',
    '4. 不要用单个关键词机械判断。',
    '5. sentiment 只能是：负面、正面、中性。',
    '6. negative_theme 只在 sentiment=负面 时填写，否则填空字符串。',
    '7. 输出必须严格符合 JSON schema，是一个 JSON 数组，不要输出 Markdown。',
    '',
    'JSON schema 字段：row_key, sentiment, negative_theme, reason, confidence。',
    '',
    '待判断评论 JSON：',
    JSON.stringify(rows, null, 2)
  ].join('\n');
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function prepareReviewBatches(args) {
  const rows = readJsonl(args.input).map(buildReviewItem).filter(row => row.row_key && row.text);
  const batchSize = args.batchSize || DEFAULT_BATCH_SIZE;
  const maxChars = args.maxChars || DEFAULT_MAX_CHARS;
  const chunks = splitReviewItems(rows, batchSize, maxChars);
  const manifest = {
    input: args.input,
    out_dir: args.outDir,
    total_rows: rows.length,
    batch_size: batchSize,
    max_chars: maxChars,
    batch_count: chunks.length,
    batches: []
  };

  fs.mkdirSync(args.outDir, { recursive: true });

  chunks.forEach((chunk, index) => {
    const id = String(index + 1).padStart(3, '0');
    const rowsFile = path.join(args.outDir, `rows_${id}.json`);
    const promptFile = path.join(args.outDir, `prompt_${id}.txt`);

    writeJson(rowsFile, chunk);
    fs.writeFileSync(promptFile, buildPrompt(chunk));

    manifest.batches.push({
      index: index + 1,
      row_count: chunk.length,
      rows_file: rowsFile,
      prompt_file: promptFile,
      output_file: path.join(args.outDir, `review_${id}.json`)
    });
  });

  writeJson(path.join(args.outDir, 'manifest.json'), manifest);

  return {
    status: 'success',
    rowCount: rows.length,
    batchCount: chunks.length,
    outDir: args.outDir,
    manifestPath: path.join(args.outDir, 'manifest.json')
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

  const result = prepareReviewBatches(args);
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
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_CHARS,
  parseArgs,
  readJsonl,
  buildReviewItem,
  reviewItemChars,
  splitReviewItems,
  chunkRows,
  buildPrompt,
  prepareReviewBatches,
  main
};
