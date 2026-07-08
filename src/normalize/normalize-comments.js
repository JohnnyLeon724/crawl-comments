#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const douyin = require('../adapters/douyin.js');
const xiaohongshu = require('../adapters/xiaohongshu.js');

const ADAPTERS = {
  douyin: douyin.normalizeDouyinPayload,
  xiaohongshu: xiaohongshu.normalizeXiaohongshuPayload
};

function printUsage() {
  console.log(`
用法：
  node script/normalize-comments.js --run-dir output/run_001 --platform douyin
  node script/normalize-comments.js --input raw-comments.json --out normalized-comments.jsonl --platform douyin --source-url <url>

参数：
  --run-dir      可选，包含 raw-comments.json 的运行目录
  --input        可选，raw-comments.json 路径；与 --run-dir 二选一
  --out          可选，normalized-comments.jsonl 输出路径
  --platform     必填，当前支持 douyin、xiaohongshu
  --source-url   可选，源 URL；未传时优先读取 raw payload 的 source_url
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

function parseArgs(argv) {
  const args = {
    runDir: '',
    input: '',
    out: '',
    platform: '',
    sourceUrl: '',
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

    if (token === '--input') {
      args.input = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--out') {
      args.out = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--platform') {
      args.platform = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--source-url') {
      args.sourceUrl = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    throw new Error(`未知参数：${token}`);
  }

  if (args.help) return args;

  if (args.runDir && args.input) {
    throw new Error('不能同时使用 --run-dir 和 --input');
  }

  if (!args.runDir && !args.input) {
    throw new Error('必须提供 --run-dir 或 --input');
  }

  if (!args.platform) {
    throw new Error('必须提供 --platform');
  }

  if (!ADAPTERS[args.platform]) {
    throw new Error(`暂不支持平台：${args.platform}`);
  }

  if (args.runDir) {
    args.input = path.join(args.runDir, 'raw-comments.json');
    args.out = args.out || path.join(args.runDir, 'normalized-comments.jsonl');
  }

  if (!args.out) {
    throw new Error('必须提供 --out');
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePayload(payload, options) {
  const platform = options.platform;
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    throw new Error(`暂不支持平台：${platform}`);
  }

  return adapter(payload, {
    sourceUrl: options.sourceUrl || payload.source_url || ''
  });
}

function rowsToJsonl(rows) {
  if (!rows.length) return '';
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
}

function normalizeFile(args) {
  const payload = readJson(args.input);
  const rows = normalizePayload(payload, args);
  const outDir = path.dirname(args.out);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, rowsToJsonl(rows));

  return {
    status: 'success',
    platform: args.platform,
    input: args.input,
    out: args.out,
    rowCount: rows.length
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

  const summary = normalizeFile(args);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  normalizePayload,
  rowsToJsonl,
  normalizeFile,
  main
};
