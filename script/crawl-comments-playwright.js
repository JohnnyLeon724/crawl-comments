#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const expander = require('./expand-comments-v1.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const DEFAULTS = {
  profile: '.pw-profile',
  outDir: '',
  timeoutMs: 15 * 60 * 1000,
  postLoadWaitMs: 5000,
  delayMs: 0,
  retries: 0,
  headless: false,
  viewportWidth: 1440,
  viewportHeight: 1000
};

function printUsage() {
  console.log(`
用法：
  node script/crawl-comments-playwright.js --url <页面URL> [--cdp <endpoint> | --profile <dir>] [--out-dir <dir>]
  node script/crawl-comments-playwright.js --input urls.txt [--resume] [--retries 2] [--delay-ms 2000]

示例：
  node script/crawl-comments-playwright.js --url "https://www.douyin.com/..." --cdp http://127.0.0.1:9222
  node script/crawl-comments-playwright.js --url "https://www.douyin.com/..." --profile .pw-profile
  node script/crawl-comments-playwright.js --input urls.txt --out-dir output/run_001 --resume

参数：
  --url             必填，目标页面 URL
  --input           可选，批量 URL 文本文件；与 --url 二选一
  --cdp             可选，连接已有 Chrome CDP endpoint，例如 http://127.0.0.1:9222
  --profile         可选，Playwright 持久化 profile 目录；未传 --cdp 时默认 .pw-profile
  --out-dir         可选，输出目录；默认 output/<run_id>
  --timeout-ms      可选，等待页面内脚本结束的超时时间，默认 900000
  --post-load-ms    可选，页面打开后注入脚本前等待时间，默认 5000
  --delay-ms        可选，批量模式下每个 URL 之间的等待时间，默认 0
  --retries         可选，单个 URL 失败后的重试次数，默认 0
  --resume          可选，批量模式下跳过已有成功 manifest 的 URL
  --headless        可选，使用独立 profile 时启用无头模式
  --help            查看帮助
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
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return Math.floor(parsed);
}

function parseArgs(argv) {
  const args = {
    url: '',
    input: '',
    cdp: '',
    profile: '',
    outDir: DEFAULTS.outDir,
    timeoutMs: DEFAULTS.timeoutMs,
    postLoadWaitMs: DEFAULTS.postLoadWaitMs,
    delayMs: DEFAULTS.delayMs,
    retries: DEFAULTS.retries,
    resume: false,
    headless: DEFAULTS.headless,
    viewport: {
      width: DEFAULTS.viewportWidth,
      height: DEFAULTS.viewportHeight
    },
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--headless') {
      args.headless = true;
      continue;
    }

    if (token === '--resume') {
      args.resume = true;
      continue;
    }

    if (token === '--url') {
      args.url = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--input') {
      args.input = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--cdp') {
      args.cdp = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--profile') {
      args.profile = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--out-dir') {
      args.outDir = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--timeout-ms') {
      args.timeoutMs = parsePositiveInt(readFlagValue(argv, i, token), token);
      i += 1;
      continue;
    }

    if (token === '--post-load-ms') {
      args.postLoadWaitMs = parsePositiveInt(readFlagValue(argv, i, token), token);
      i += 1;
      continue;
    }

    if (token === '--delay-ms') {
      args.delayMs = parsePositiveInt(readFlagValue(argv, i, token), token);
      i += 1;
      continue;
    }

    if (token === '--retries') {
      const retries = Number(readFlagValue(argv, i, token));
      if (!Number.isInteger(retries) || retries < 0) {
        throw new Error('--retries 必须是非负整数');
      }
      args.retries = retries;
      i += 1;
      continue;
    }

    throw new Error(`未知参数：${token}`);
  }

  if (args.help) return args;

  if (!args.url && !args.input) {
    throw new Error('必须提供 --url 或 --input');
  }

  if (args.url && args.input) {
    throw new Error('不能同时使用 --url 和 --input');
  }

  if (args.url) {
    try {
      // Validate early so the runner fails before opening a browser.
      new URL(args.url);
    } catch (_error) {
      throw new Error('--url 必须是合法 URL');
    }
  }

  if (args.cdp && args.profile) {
    throw new Error('不能同时使用 --cdp 和 --profile');
  }

  if (!args.cdp && !args.profile) {
    args.profile = DEFAULTS.profile;
  }

  return args;
}

function createRunId(date = new Date()) {
  return `run_${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

function detectPlatform(url) {
  const host = new URL(url).hostname.toLowerCase();

  if (host.includes('douyin.com')) return 'douyin';
  if (host.includes('xiaohongshu.com')) return 'xiaohongshu';
  if (host.includes('weibo.com')) return 'weibo';

  return 'unknown';
}

function hashText(value, length = 10) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, length);
}

function readInputUrls(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function buildBatchItemOutDir(baseOutDir, url, index) {
  const platform = detectPlatform(url);
  let id = '';

  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/(?:video|note)\/([^/?#]+)/);
    id = match ? match[1] : '';
  } catch (_error) {
    id = '';
  }

  if (!id) {
    id = hashText(url);
  }

  return path.join(baseOutDir, `${String(index + 1).padStart(3, '0')}-${platform}-${id}`);
}

function shouldSkipForResume(outDir, resume) {
  if (!resume) return false;

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    return manifest.status === 'success';
  } catch (_error) {
    return false;
  }
}

function buildOutputPaths(outDir) {
  return {
    manifest: path.join(outDir, 'manifest.json'),
    rawJson: path.join(outDir, 'raw-comments.json'),
    rawCsv: path.join(outDir, 'raw-comments.csv'),
    screenshot: path.join(outDir, 'final-page.png')
  };
}

function buildManifest(input) {
  const payload = input.payload || {};
  const state = payload.state || {};
  const results = Array.isArray(payload.results) ? payload.results : [];

  return {
    run_id: input.runId,
    platform: input.platform,
    source_url: input.sourceUrl,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    status: input.status,
    stop_reason: state.stopReason || '',
    raw_comment_count: results.length,
    total_comments: state.totalComments || results.length,
    total_clicks: state.totalClicks || 0,
    rounds: state.round || 0,
    total_errors: state.totalErrors || 0,
    output_files: input.outputFiles || {},
    errors: input.errors || [],
    crawler_config: payload.config || {}
  };
}

function payloadToCsv(payload) {
  return expander.formatResultsAsCsv(Array.isArray(payload.results) ? payload.results : []);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    const hint = '未找到 playwright。请先在项目中安装依赖，例如：npm install playwright';
    error.message = `${hint}\n${error.message}`;
    throw error;
  }
}

async function openBrowser(args) {
  const { chromium } = loadPlaywright();

  if (args.cdp) {
    const browser = await chromium.connectOverCDP(args.cdp, { timeout: 30000 });
    const context = browser.contexts()[0] || await browser.newContext();
    const page = await context.newPage();

    return {
      page,
      close: async () => {
        await browser.close();
      }
    };
  }

  const context = await chromium.launchPersistentContext(args.profile, {
    headless: args.headless,
    viewport: args.viewport
  });
  const page = await context.newPage();

  return {
    page,
    close: async () => {
      await context.close();
    }
  };
}

async function crawlSingleUrl(args) {
  const runId = createRunId();
  const outDir = args.outDir || path.join('output', runId);
  const outputPaths = buildOutputPaths(outDir);
  const startedAt = new Date().toISOString();
  const errors = [];
  let browserSession = null;
  let payload = { state: {}, config: {}, results: [] };
  let status = 'success';

  fs.mkdirSync(outDir, { recursive: true });

  try {
    browserSession = await openBrowser(args);
    const { page } = browserSession;
    const expanderScript = fs.readFileSync(path.join(__dirname, 'expand-comments-v1.js'), 'utf8');

    await page.goto(args.url, {
      waitUntil: 'domcontentloaded',
      timeout: args.timeoutMs
    });
    await page.waitForTimeout(args.postLoadWaitMs);

    await page.evaluate(expanderScript);
    await page.waitForFunction(() => {
      const state = window.__commentExpanderV1?.getState?.();
      return Boolean(state && state.stopReason);
    }, null, { timeout: args.timeoutMs });

    payload = await page.evaluate(() => window.__commentExpanderV1.getPayload());
    payload.source_url = args.url;

    try {
      await page.screenshot({ path: outputPaths.screenshot, fullPage: true });
    } catch (error) {
      errors.push(`screenshot: ${error.message}`);
    }
  } catch (error) {
    status = 'failed';
    errors.push(error.message);
  } finally {
    if (browserSession) {
      try {
        await browserSession.close();
      } catch (error) {
        errors.push(`close browser: ${error.message}`);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const outputFiles = {
    manifest: outputPaths.manifest,
    rawJson: outputPaths.rawJson,
    rawCsv: outputPaths.rawCsv,
    screenshot: outputPaths.screenshot
  };

  writeJson(outputPaths.rawJson, payload);
  fs.writeFileSync(outputPaths.rawCsv, payloadToCsv(payload));
  writeJson(outputPaths.manifest, buildManifest({
    runId,
    platform: detectPlatform(args.url),
    sourceUrl: args.url,
    status,
    startedAt,
    finishedAt,
    payload,
    outputFiles,
    errors
  }));

  return {
    runId,
    status,
    outDir,
    outputFiles,
    payload,
    errors
  };
}

async function crawlWithRetries(args, crawlFn = crawlSingleUrl) {
  const maxAttempts = (args.retries || 0) + 1;
  let lastError = null;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await crawlFn(args);
      lastResult = Object.assign({}, result, { attempts: attempt });

      if (result && result.status === 'success') {
        return lastResult;
      }

      lastError = new Error((result && result.errors && result.errors.join('; ')) || 'crawl failed');
    } catch (error) {
      lastError = error;
      lastResult = {
        status: 'failed',
        attempts: attempt,
        outDir: args.outDir,
        outputFiles: {},
        payload: { results: [] },
        errors: [error.message]
      };
    }
  }

  return Object.assign({}, lastResult, {
    status: 'failed',
    errors: [
      ...((lastResult && lastResult.errors) || []),
      lastError ? lastError.message : 'crawl failed'
    ]
  });
}

function buildBatchManifest(input) {
  const failedCount = input.items.filter(item => item.status === 'failed').length;
  const skippedCount = input.items.filter(item => item.status === 'skipped').length;
  const successCount = input.items.filter(item => item.status === 'success').length;

  return {
    run_id: input.runId,
    status: failedCount > 0 ? 'failed' : 'success',
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    input_file: input.inputFile,
    total_urls: input.items.length,
    success_count: successCount,
    failed_count: failedCount,
    skipped_count: skippedCount,
    items: input.items
  };
}

async function crawlBatch(args, deps = {}) {
  const runId = createRunId();
  const baseOutDir = args.outDir || path.join('output', runId);
  const startedAt = new Date().toISOString();
  const urls = readInputUrls(args.input);
  const items = [];
  const sleepFn = deps.sleep || sleep;
  const crawlFn = deps.crawlSingleUrl || crawlSingleUrl;

  fs.mkdirSync(baseOutDir, { recursive: true });

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const outDir = buildBatchItemOutDir(baseOutDir, url, index);

    if (shouldSkipForResume(outDir, args.resume)) {
      items.push({
        index: index + 1,
        source_url: url,
        out_dir: outDir,
        status: 'skipped',
        attempts: 0,
        errors: []
      });
    } else {
      const result = await crawlWithRetries(Object.assign({}, args, {
        url,
        input: '',
        outDir
      }), crawlFn);

      items.push({
        index: index + 1,
        source_url: url,
        out_dir: outDir,
        status: result.status,
        attempts: result.attempts || 1,
        raw_comment_count: Array.isArray(result.payload && result.payload.results)
          ? result.payload.results.length
          : 0,
        output_files: result.outputFiles || {},
        errors: result.errors || []
      });
    }

    if (args.delayMs > 0 && index < urls.length - 1) {
      await sleepFn(args.delayMs);
    }
  }

  const finishedAt = new Date().toISOString();
  const manifest = buildBatchManifest({
    runId,
    startedAt,
    finishedAt,
    inputFile: args.input,
    items
  });
  const manifestPath = path.join(baseOutDir, 'batch-manifest.json');
  writeJson(manifestPath, manifest);

  return Object.assign({}, manifest, {
    runId,
    outDir: baseOutDir,
    manifestPath
  });
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

  const result = args.input
    ? await crawlBatch(args)
    : await crawlSingleUrl(args);

  if (args.input) {
    console.log(JSON.stringify({
      status: result.status,
      runId: result.runId,
      outDir: result.outDir,
      totalUrls: result.total_urls,
      successCount: result.success_count,
      failedCount: result.failed_count,
      skippedCount: result.skipped_count,
      manifestPath: result.manifestPath
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      status: result.status,
      runId: result.runId,
      outDir: result.outDir,
      rawCommentCount: Array.isArray(result.payload.results) ? result.payload.results.length : 0,
      errors: result.errors
    }, null, 2));
  }

  if (result.status !== 'success') {
    process.exitCode = 1;
  }

  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULTS,
  parseArgs,
  createRunId,
  detectPlatform,
  readInputUrls,
  buildBatchItemOutDir,
  shouldSkipForResume,
  buildOutputPaths,
  buildManifest,
  buildBatchManifest,
  payloadToCsv,
  crawlWithRetries,
  crawlBatch,
  crawlSingleUrl,
  main
};
