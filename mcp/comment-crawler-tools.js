'use strict';

const fs = require('node:fs');
const path = require('node:path');

const runner = require('../src/browser/crawl-comments-playwright.js');
const normalizer = require('../src/normalize/normalize-comments.js');
const cdp = require('./comment-crawler-cdp.js');
const candidateBatch = require('./comment-crawler-candidates.js');
const domSnapshot = require('./comment-crawler-dom-snapshot.js');
const output = require('./comment-crawler-output.js');
const security = require('./comment-crawler-security.js');

const MCP_VERSION = 'mcp-v1';
const STATUS_TOOL_NAME = 'get_comment_crawler_status';
const EXPAND_TOOL_NAME = 'expand_current_page_comments';
const SAVE_TOOL_NAME = 'save_current_page_comments';
const NORMALIZE_TOOL_NAME = 'normalize_comment_run';
const CAPTURE_DOM_TOOL_NAME = 'capture_current_comment_dom_snapshot';
const CAPTURE_CANDIDATE_BATCH_TOOL_NAME = 'capture_comment_candidate_batch';
const DEFAULT_EXPAND_TIMEOUT_MS = 10 * 60 * 1000;

function resolveProjectRoot(options = {}) {
  return path.resolve(options.projectRoot || path.join(__dirname, '..'));
}

function getCommentCrawlerStatus(options = {}) {
  return {
    status: 'ok',
    version: MCP_VERSION,
    projectRoot: resolveProjectRoot(options),
    tools: listTools().map(tool => tool.name)
  };
}

function listTools() {
  const tools = [
    {
      name: STATUS_TOOL_NAME,
      title: 'Comment Crawler Status',
      description: 'Return the local comment crawler MCP server status and project root.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          version: { type: 'string' },
          projectRoot: { type: 'string' },
          tools: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['status', 'version', 'projectRoot', 'tools']
      }
    },
    {
      name: EXPAND_TOOL_NAME,
      title: 'Expand Current Page Comments',
      description: 'Connect to Chrome CDP, inject the page comment expander, wait for completion, and return a crawl summary.',
      inputSchema: {
        type: 'object',
        properties: {
          cdpEndpoint: {
            type: 'string',
            description: 'Chrome DevTools Protocol endpoint. Defaults to http://127.0.0.1:9222.'
          },
          connectTimeoutMs: {
            type: 'number',
            description: 'Timeout for connecting to Chrome CDP.'
          },
          timeoutMs: {
            type: 'number',
            description: 'Timeout for waiting until the page expander stops.'
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          platform: { type: 'string' },
          url: { type: 'string' },
          stopReason: { type: 'string' },
          rawCommentCount: { type: 'number' },
          totalClicks: { type: 'number' },
          rounds: { type: 'number' },
          totalErrors: { type: 'number' }
        },
        required: ['status', 'platform', 'url', 'stopReason', 'rawCommentCount', 'totalClicks', 'rounds', 'totalErrors']
      }
    },
    {
      name: SAVE_TOOL_NAME,
      title: 'Save Current Page Comments',
      description: 'Read the current page expander payload and save CLI-compatible raw output files under a run directory.',
      inputSchema: {
        type: 'object',
        properties: {
          cdpEndpoint: {
            type: 'string',
            description: 'Chrome DevTools Protocol endpoint. Defaults to http://127.0.0.1:9222.'
          },
          connectTimeoutMs: {
            type: 'number',
            description: 'Timeout for connecting to Chrome CDP.'
          },
          outDir: {
            type: 'string',
            description: 'Output run directory. Defaults to output/<run_id>.'
          },
          runId: {
            type: 'string',
            description: 'Optional run id for deterministic output.'
          },
          closePageAfter: {
            type: 'boolean',
            description: 'Close the selected Chrome tab after the output is saved. Useful when running tasks one by one to avoid selecting the previous task page.'
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          runId: { type: 'string' },
          outDir: { type: 'string' },
          rawCommentCount: { type: 'number' },
          outputFiles: { type: 'object' },
          errors: {
            type: 'array',
            items: { type: 'string' }
          },
          closedPage: { type: 'boolean' },
          closePageError: { type: 'string' }
        },
        required: ['status', 'runId', 'outDir', 'rawCommentCount', 'outputFiles', 'errors']
      }
    },
    {
      name: NORMALIZE_TOOL_NAME,
      title: 'Normalize Comment Run',
      description: 'Normalize raw comment output in a run directory using the existing platform adapter.',
      inputSchema: {
        type: 'object',
        properties: {
          runDir: {
            type: 'string',
            description: 'Run directory containing raw-comments.json.'
          },
          platform: {
            type: 'string',
            enum: ['douyin', 'xiaohongshu'],
            description: 'Comment platform adapter to use.'
          },
          sourceUrl: {
            type: 'string',
            description: 'Optional source URL override.'
          },
          out: {
            type: 'string',
            description: 'Optional normalized JSONL output path.'
          }
        },
        required: ['runDir', 'platform'],
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          platform: { type: 'string' },
          input: { type: 'string' },
          out: { type: 'string' },
          rowCount: { type: 'number' }
        },
        required: ['status', 'platform', 'input', 'out', 'rowCount']
      }
    },
    {
      name: CAPTURE_DOM_TOOL_NAME,
      title: 'Capture Current Comment DOM Snapshot',
      description: 'Connect to Chrome CDP, capture bounded comment-area DOM chunks, and save a comment-dom-snapshot.json file for AI extraction.',
      inputSchema: {
        type: 'object',
        properties: {
          cdpEndpoint: {
            type: 'string',
            description: 'Chrome DevTools Protocol endpoint. Defaults to http://127.0.0.1:9222.'
          },
          connectTimeoutMs: {
            type: 'number',
            description: 'Timeout for connecting to Chrome CDP.'
          },
          outDir: {
            type: 'string',
            description: 'Output run directory. Defaults to output/<run_id>.'
          },
          runId: {
            type: 'string',
            description: 'Optional run id for deterministic output.'
          },
          maxChunks: {
            type: 'number',
            description: 'Maximum DOM chunks to return.'
          },
          maxCharsPerChunk: {
            type: 'number',
            description: 'Maximum text/html characters per chunk.'
          },
          includeHtml: {
            type: 'boolean',
            description: 'Whether to include sanitized local HTML in chunks.'
          },
          includeText: {
            type: 'boolean',
            description: 'Whether to include visible text in chunks.'
          },
          closePageAfter: {
            type: 'boolean',
            description: 'Close the selected Chrome tab after the DOM snapshot is saved. Use on the final per-task MCP step before moving to the next URL.'
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          runId: { type: 'string' },
          outDir: { type: 'string' },
          snapshotFile: { type: 'string' },
          platform: { type: 'string' },
          url: { type: 'string' },
          chunkCount: { type: 'number' },
          truncated: { type: 'boolean' },
          closedPage: { type: 'boolean' },
          closePageError: { type: 'string' },
          chunks: {
            type: 'array',
            items: { type: 'object' }
          }
        },
        required: ['status', 'runId', 'outDir', 'snapshotFile', 'platform', 'url', 'chunkCount', 'truncated', 'chunks']
      }
    },
    {
      name: CAPTURE_CANDIDATE_BATCH_TOOL_NAME,
      title: 'Capture Comment Candidate Batch',
      description: 'Connect to Chrome CDP, capture visible comment candidate DOM records into a bounded batch file, update capture-state.json, and optionally scroll the page for the next batch.',
      inputSchema: {
        type: 'object',
        properties: {
          cdpEndpoint: {
            type: 'string',
            description: 'Chrome DevTools Protocol endpoint. Defaults to http://127.0.0.1:9222.'
          },
          connectTimeoutMs: {
            type: 'number',
            description: 'Timeout for connecting to Chrome CDP.'
          },
          outDir: {
            type: 'string',
            description: 'Task output directory under project output, for example output/project/runs/task_0001.'
          },
          runId: {
            type: 'string',
            description: 'Optional run id when outDir is omitted.'
          },
          taskId: {
            type: 'string',
            description: 'Task id written into the batch file.'
          },
          batchId: {
            type: 'string',
            description: 'Batch id such as batch_0001. Defaults to capture-state next_batch_id or batch_0001.'
          },
          stateFile: {
            type: 'string',
            description: 'Optional capture state path under project output. Defaults to <outDir>/capture-state.json.'
          },
          maxCandidates: {
            type: 'number',
            description: 'Maximum candidates captured in this batch.'
          },
          maxCharsPerCandidate: {
            type: 'number',
            description: 'Maximum text/html characters per candidate.'
          },
          includeHtml: {
            type: 'boolean',
            description: 'Whether to include sanitized local HTML for AI extraction.'
          },
          includeText: {
            type: 'boolean',
            description: 'Whether to include visible text for AI extraction.'
          },
          scrollAfterCapture: {
            type: 'boolean',
            description: 'Scroll the current page after capturing this batch.'
          },
          scrollStepRatio: {
            type: 'number',
            description: 'Scroll step as a ratio of viewport height. Defaults to 0.85.'
          },
          closePageAfter: {
            type: 'boolean',
            description: 'Close the selected Chrome tab after the batch is saved.'
          }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          runId: { type: 'string' },
          outDir: { type: 'string' },
          batchDir: { type: 'string' },
          batchFile: { type: 'string' },
          stateFile: { type: 'string' },
          platform: { type: 'string' },
          url: { type: 'string' },
          taskId: { type: 'string' },
          batchId: { type: 'string' },
          nextBatchId: { type: 'string' },
          candidateCount: { type: 'number' },
          hasMore: { type: 'boolean' },
          closedPage: { type: 'boolean' },
          closePageError: { type: 'string' }
        },
        required: ['status', 'runId', 'outDir', 'batchDir', 'batchFile', 'stateFile', 'platform', 'url', 'taskId', 'batchId', 'nextBatchId', 'candidateCount', 'hasMore']
      }
    }
  ];

  const priority = [
    STATUS_TOOL_NAME,
    EXPAND_TOOL_NAME,
    CAPTURE_CANDIDATE_BATCH_TOOL_NAME,
    CAPTURE_DOM_TOOL_NAME,
    SAVE_TOOL_NAME,
    NORMALIZE_TOOL_NAME
  ];

  return priority
    .map(name => tools.find(tool => tool.name === name))
    .filter(Boolean);
}

function buildToolResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ],
    structuredContent: value,
    isError: false
  };
}

function readExpanderScript(projectRoot) {
  return fs.readFileSync(path.join(projectRoot, 'src', 'browser', 'expand-comments-v1.js'), 'utf8');
}

function getPageUrl(page) {
  try {
    return typeof page.url === 'function' ? String(page.url() || '') : '';
  } catch (_error) {
    return '';
  }
}

function detectPlatformSafe(url) {
  try {
    return runner.detectPlatform(url);
  } catch (_error) {
    return 'unknown';
  }
}

function buildExpandSummary(payload, pageUrl) {
  const state = payload && payload.state ? payload.state : {};
  const results = payload && Array.isArray(payload.results) ? payload.results : [];
  const url = String((payload && payload.source_url) || pageUrl || '');

  return {
    status: 'success',
    platform: detectPlatformSafe(url),
    url,
    stopReason: String(state.stopReason || ''),
    rawCommentCount: results.length,
    totalClicks: Number(state.totalClicks) || 0,
    rounds: Number(state.round) || 0,
    totalErrors: Number(state.totalErrors) || 0
  };
}

async function closePageIfRequested(page, args = {}) {
  if (!args.closePageAfter) {
    return {};
  }

  if (!page || typeof page.close !== 'function') {
    return {
      closedPage: false,
      closePageError: '当前 CDP page 不支持 close()'
    };
  }

  try {
    await page.close({ runBeforeUnload: false });
    return { closedPage: true };
  } catch (error) {
    return {
      closedPage: false,
      closePageError: error && error.message ? error.message : String(error)
    };
  }
}

function formatBatchId(index) {
  const parsed = Number(index);
  const safeIndex = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  return `batch_${String(safeIndex).padStart(4, '0')}`;
}

function getBatchIndex(batchId) {
  const match = String(batchId || '').match(/^batch_(\d+)$/);
  if (!match) return 0;
  return Number(match[1]) || 0;
}

function readCaptureState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function getSeenCandidateHashes(state) {
  if (Array.isArray(state && state.seen_candidate_hashes)) {
    return state.seen_candidate_hashes.map(value => String(value));
  }

  if (Array.isArray(state && state.seenCandidateHashes)) {
    return state.seenCandidateHashes.map(value => String(value));
  }

  return [];
}

function resolveBatchId(args = {}, state = {}) {
  if (args.batchId) return String(args.batchId);
  if (state.next_batch_id) return String(state.next_batch_id);
  if (state.nextBatchId) return String(state.nextBatchId);
  return formatBatchId(1);
}

function buildNextBatchId(batchId) {
  const currentIndex = getBatchIndex(batchId);
  return formatBatchId(currentIndex + 1);
}

function updateCaptureState(input) {
  const previous = input.previousState || {};
  const seen = new Set(getSeenCandidateHashes(previous));
  const candidates = Array.isArray(input.batch && input.batch.candidates)
    ? input.batch.candidates
    : [];

  for (const candidate of candidates) {
    if (candidate && candidate.candidate_hash) {
      seen.add(String(candidate.candidate_hash));
    }
  }

  const batches = Array.isArray(previous.batches) ? previous.batches.slice() : [];
  batches.push({
    batch_id: input.batchId,
    batch_file: input.batchFile,
    candidate_count: candidates.length,
    captured_at: input.batch && input.batch.captured_at || new Date().toISOString()
  });

  return {
    schema_version: 'capture-state-v1',
    task_id: input.taskId,
    platform: input.platform,
    source_url: input.sourceUrl,
    updated_at: new Date().toISOString(),
    last_batch_id: input.batchId,
    next_batch_id: input.nextBatchId,
    seen_candidate_hashes: Array.from(seen),
    batches
  };
}

async function expandCurrentPageComments(args = {}, context = {}) {
  const projectRoot = resolveProjectRoot(context);
  const connectToCdp = context.connectToCdp || cdp.connectToCdp;
  const session = await connectToCdp({
    cdpEndpoint: args.cdpEndpoint,
    timeoutMs: Number.isFinite(Number(args.connectTimeoutMs))
      ? Number(args.connectTimeoutMs)
      : cdp.DEFAULT_CDP_TIMEOUT_MS,
    playwright: context.playwright
  });

  try {
    const page = session.page;
    security.assertAllowedPageUrl(getPageUrl(page), context.allowedHosts);

    const expanderScript = context.expanderScript || readExpanderScript(projectRoot);
    const timeoutMs = Number.isFinite(Number(args.timeoutMs))
      ? Number(args.timeoutMs)
      : DEFAULT_EXPAND_TIMEOUT_MS;

    await page.evaluate(expanderScript);
    await page.waitForFunction(() => {
      const state = window.__commentExpanderV1?.getState?.();
      return Boolean(state && state.stopReason);
    }, null, { timeout: timeoutMs });

    const payload = await page.evaluate(() => window.__commentExpanderV1.getPayload());
    if (payload && !payload.source_url) {
      payload.source_url = getPageUrl(page);
    }

    return buildExpandSummary(payload, getPageUrl(page));
  } finally {
    if (session && typeof session.close === 'function') {
      await session.close();
    }
  }
}

async function readCurrentPagePayload(page) {
  const payload = await page.evaluate(() => window.__commentExpanderV1?.getPayload?.() || null);
  if (!payload) {
    throw new Error('当前页面未找到 comment expander payload，请先运行 expand_current_page_comments');
  }

  if (!payload.source_url) {
    payload.source_url = getPageUrl(page);
  }

  return payload;
}

async function saveCurrentPageComments(args = {}, context = {}) {
  const projectRoot = resolveProjectRoot(context);
  const connectToCdp = context.connectToCdp || cdp.connectToCdp;
  const session = await connectToCdp({
    cdpEndpoint: args.cdpEndpoint,
    timeoutMs: Number.isFinite(Number(args.connectTimeoutMs))
      ? Number(args.connectTimeoutMs)
      : cdp.DEFAULT_CDP_TIMEOUT_MS,
    playwright: context.playwright
  });

  try {
    const page = session.page;
    const payload = await readCurrentPagePayload(page);
    const sourceUrl = payload.source_url || getPageUrl(page);
    security.assertAllowedPageUrl(sourceUrl, context.allowedHosts);

    const runId = args.runId || runner.createRunId();
    const outDir = security.resolveOutputPath(
      projectRoot,
      args.outDir || path.join('output', runId)
    );

    const result = await output.writeCommentRunOutput({
      payload,
      page,
      sourceUrl,
      outDir,
      runId
    });
    const closeResult = await closePageIfRequested(page, args);
    return {
      ...result,
      ...closeResult
    };
  } finally {
    if (session && typeof session.close === 'function') {
      await session.close();
    }
  }
}

function normalizeCommentRun(args = {}, context = {}) {
  if (!args.runDir) {
    throw new Error('normalize_comment_run 需要 runDir');
  }

  if (!args.platform) {
    throw new Error('normalize_comment_run 需要 platform');
  }

  const projectRoot = resolveProjectRoot(context);
  const runDir = security.resolveOutputPath(projectRoot, args.runDir);

  return normalizer.normalizeFile({
    input: path.join(runDir, 'raw-comments.json'),
    out: args.out
      ? security.resolveOutputPath(projectRoot, args.out)
      : path.join(runDir, 'normalized-comments.jsonl'),
    platform: args.platform,
    sourceUrl: args.sourceUrl || ''
  });
}

async function captureCurrentCommentDomSnapshot(args = {}, context = {}) {
  const projectRoot = resolveProjectRoot(context);
  const connectToCdp = context.connectToCdp || cdp.connectToCdp;
  const session = await connectToCdp({
    cdpEndpoint: args.cdpEndpoint,
    timeoutMs: Number.isFinite(Number(args.connectTimeoutMs))
      ? Number(args.connectTimeoutMs)
      : cdp.DEFAULT_CDP_TIMEOUT_MS,
    playwright: context.playwright
  });

  try {
    const page = session.page;
    const sourceUrl = getPageUrl(page);
    security.assertAllowedPageUrl(sourceUrl, context.allowedHosts);

    const runId = args.runId || runner.createRunId();
    const outDir = security.resolveOutputPath(
      projectRoot,
      args.outDir || path.join('output', runId)
    );
    const captureSnapshot = context.captureCommentDomSnapshot || domSnapshot.captureCommentDomSnapshot;
    const snapshot = await captureSnapshot(page, {
      platform: detectPlatformSafe(sourceUrl),
      sourceUrl,
      maxChunks: args.maxChunks,
      maxCharsPerChunk: args.maxCharsPerChunk,
      includeHtml: args.includeHtml,
      includeText: args.includeText
    });
    const snapshotFile = path.join(outDir, 'comment-dom-snapshot.json');

    fs.mkdirSync(outDir, { recursive: true });
    output.writeJson(snapshotFile, snapshot);

    const result = {
      status: 'success',
      runId,
      outDir,
      snapshotFile,
      platform: snapshot.platform || detectPlatformSafe(sourceUrl),
      url: snapshot.source_url || sourceUrl,
      chunkCount: Array.isArray(snapshot.chunks) ? snapshot.chunks.length : 0,
      truncated: Boolean(snapshot.truncated),
      chunks: Array.isArray(snapshot.chunks) ? snapshot.chunks : []
    };
    const closeResult = await closePageIfRequested(page, args);
    return {
      ...result,
      ...closeResult
    };
  } finally {
    if (session && typeof session.close === 'function') {
      await session.close();
    }
  }
}

async function captureCurrentCommentCandidateBatch(args = {}, context = {}) {
  const projectRoot = resolveProjectRoot(context);
  const connectToCdp = context.connectToCdp || cdp.connectToCdp;
  const session = await connectToCdp({
    cdpEndpoint: args.cdpEndpoint,
    timeoutMs: Number.isFinite(Number(args.connectTimeoutMs))
      ? Number(args.connectTimeoutMs)
      : cdp.DEFAULT_CDP_TIMEOUT_MS,
    playwright: context.playwright
  });

  try {
    const page = session.page;
    const sourceUrl = getPageUrl(page);
    security.assertAllowedPageUrl(sourceUrl, context.allowedHosts);

    const runId = args.runId || runner.createRunId();
    const outDir = security.resolveOutputPath(
      projectRoot,
      args.outDir || path.join('output', runId)
    );
    const stateFile = security.resolveOutputPath(
      projectRoot,
      args.stateFile || path.join(outDir, 'capture-state.json')
    );
    const previousState = readCaptureState(stateFile);
    const taskId = String(args.taskId || previousState.task_id || runId);
    const batchId = resolveBatchId(args, previousState);
    const nextBatchId = buildNextBatchId(batchId);
    const batchDir = path.join(outDir, 'batches', batchId);
    const batchFile = path.join(batchDir, 'comment-dom-batch.json');
    const captureBatch = context.captureCommentCandidateBatch || candidateBatch.captureCommentCandidateBatch;
    const platform = detectPlatformSafe(sourceUrl);
    const batch = await captureBatch(page, {
      taskId,
      batchId,
      platform,
      sourceUrl,
      maxCandidates: args.maxCandidates,
      maxCharsPerCandidate: args.maxCharsPerCandidate,
      includeHtml: args.includeHtml,
      includeText: args.includeText,
      scrollAfterCapture: args.scrollAfterCapture,
      scrollStepRatio: args.scrollStepRatio,
      seenCandidateHashes: getSeenCandidateHashes(previousState)
    });

    fs.mkdirSync(batchDir, { recursive: true });
    output.writeJson(batchFile, batch);

    const state = updateCaptureState({
      previousState,
      taskId,
      platform: batch.platform || platform,
      sourceUrl: batch.source_url || sourceUrl,
      batchId,
      nextBatchId,
      batch,
      batchFile
    });
    output.writeJson(stateFile, state);

    const result = {
      status: 'success',
      runId,
      outDir,
      batchDir,
      batchFile,
      stateFile,
      platform: batch.platform || platform,
      url: batch.source_url || sourceUrl,
      taskId,
      batchId,
      nextBatchId,
      candidateCount: Array.isArray(batch.candidates) ? batch.candidates.length : 0,
      hasMore: Boolean(batch.state && batch.state.has_more)
    };
    const closeResult = await closePageIfRequested(page, args);
    return {
      ...result,
      ...closeResult
    };
  } finally {
    if (session && typeof session.close === 'function') {
      await session.close();
    }
  }
}

async function callTool(name, args = {}, context = {}) {
  if (name === STATUS_TOOL_NAME) {
    return buildToolResult(getCommentCrawlerStatus({
      projectRoot: args.projectRoot || context.projectRoot
    }));
  }

  if (name === EXPAND_TOOL_NAME) {
    return buildToolResult(await expandCurrentPageComments(args, context));
  }

  if (name === SAVE_TOOL_NAME) {
    return buildToolResult(await saveCurrentPageComments(args, context));
  }

  if (name === NORMALIZE_TOOL_NAME) {
    return buildToolResult(normalizeCommentRun(args, context));
  }

  if (name === CAPTURE_DOM_TOOL_NAME) {
    return buildToolResult(await captureCurrentCommentDomSnapshot(args, context));
  }

  if (name === CAPTURE_CANDIDATE_BATCH_TOOL_NAME) {
    return buildToolResult(await captureCurrentCommentCandidateBatch(args, context));
  }

  throw new Error(`Unknown tool: ${name}`);
}

module.exports = {
  MCP_VERSION,
  STATUS_TOOL_NAME,
  EXPAND_TOOL_NAME,
  SAVE_TOOL_NAME,
  NORMALIZE_TOOL_NAME,
  CAPTURE_DOM_TOOL_NAME,
  CAPTURE_CANDIDATE_BATCH_TOOL_NAME,
  DEFAULT_EXPAND_TIMEOUT_MS,
  getCommentCrawlerStatus,
  listTools,
  buildToolResult,
  readExpanderScript,
  closePageIfRequested,
  formatBatchId,
  getBatchIndex,
  readCaptureState,
  getSeenCandidateHashes,
  resolveBatchId,
  buildNextBatchId,
  updateCaptureState,
  buildExpandSummary,
  expandCurrentPageComments,
  readCurrentPagePayload,
  saveCurrentPageComments,
  normalizeCommentRun,
  captureCurrentCommentDomSnapshot,
  captureCurrentCommentCandidateBatch,
  callTool
};
