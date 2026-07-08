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
const CAPTURE_CANDIDATE_BATCHES_TOOL_NAME = 'capture_comment_candidate_batches_until_idle';
const EXPAND_CAPTURE_TOOL_NAME = 'expand_and_capture_comment_batches';
const DEFAULT_EXPAND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_EXPAND_CAPTURE_CONFIG = Object.freeze({
  maxRuntimeMs: 30 * 60 * 1000,
  maxRounds: 800,
  maxBatches: 300,
  maxIdleRounds: 8,
  maxClicksPerRound: 3,
  expandWaitMsMin: 1000,
  expandWaitMsMax: 1800,
  scrollWaitMsMin: 1500,
  scrollWaitMsMax: 2500,
  scrollStepRatioMin: 0.55,
  scrollStepRatioMax: 0.7
});
const DEFAULT_CLICK_PROFILE = Object.freeze({
  clickMode: 'coordinate',
  fallbackClickMode: 'dom-click',
  clickJitterPx: 4,
  mouseMoveStepsMin: 4,
  mouseMoveStepsMax: 9,
  clickDownMsMin: 60,
  clickDownMsMax: 160,
  clickGapMsMin: 300,
  clickGapMsMax: 900
});

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
    },
    {
      name: CAPTURE_CANDIDATE_BATCHES_TOOL_NAME,
      title: 'Capture Comment Candidate Batches Until Idle',
      description: 'Connect to Chrome CDP once, repeatedly capture bounded visible comment candidate batches, update capture-state.json after each batch, and stop after consecutive empty batches or maxBatches.',
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
            description: 'Task output directory under project output.'
          },
          runId: {
            type: 'string',
            description: 'Optional run id when outDir is omitted.'
          },
          taskId: {
            type: 'string',
            description: 'Task id written into each batch file.'
          },
          stateFile: {
            type: 'string',
            description: 'Optional capture state path under project output. Defaults to <outDir>/capture-state.json.'
          },
          maxBatches: {
            type: 'number',
            description: 'Maximum batches to capture before stopping.'
          },
          maxIdleBatches: {
            type: 'number',
            description: 'Stop after this many consecutive batches with zero new candidates.'
          },
          maxCandidates: {
            type: 'number',
            description: 'Maximum candidates captured in each batch.'
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
          scrollStepRatio: {
            type: 'number',
            description: 'Scroll step as a ratio of viewport height. Defaults to 0.85.'
          },
          closePageAfter: {
            type: 'boolean',
            description: 'Close the selected Chrome tab after the loop stops.'
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
          stateFile: { type: 'string' },
          platform: { type: 'string' },
          url: { type: 'string' },
          taskId: { type: 'string' },
          batchCount: { type: 'number' },
          candidateCount: { type: 'number' },
          stopReason: { type: 'string' },
          lastBatchId: { type: 'string' },
          nextBatchId: { type: 'string' },
          batchFiles: {
            type: 'array',
            items: { type: 'string' }
          },
          closedPage: { type: 'boolean' },
          closePageError: { type: 'string' }
        },
        required: ['status', 'runId', 'outDir', 'stateFile', 'platform', 'url', 'taskId', 'batchCount', 'candidateCount', 'stopReason', 'lastBatchId', 'nextBatchId', 'batchFiles']
      }
    },
    {
      name: EXPAND_CAPTURE_TOOL_NAME,
      title: 'Expand And Capture Comment Batches',
      description: 'Main coverage workflow: expand visible replies, capture current DOM candidates before scrolling, save bounded batches, and stop after idle or configured limits.',
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
            description: 'Task output directory under project output.'
          },
          runId: {
            type: 'string',
            description: 'Optional run id when outDir is omitted.'
          },
          taskId: {
            type: 'string',
            description: 'Task id written into each batch file.'
          },
          stateFile: {
            type: 'string',
            description: 'Optional capture state path under project output. Defaults to <outDir>/capture-state.json.'
          },
          maxRuntimeMs: {
            type: 'number',
            description: 'Maximum runtime before stopping. Defaults to 1800000ms.'
          },
          maxRounds: {
            type: 'number',
            description: 'Maximum expand/capture/scroll rounds. Defaults to 800.'
          },
          maxBatches: {
            type: 'number',
            description: 'Maximum non-empty batch files to write. Defaults to 300.'
          },
          maxIdleRounds: {
            type: 'number',
            description: 'Stop after this many rounds without new candidates, clicks, or scroll progress. Defaults to 8.'
          },
          maxClicksPerRound: {
            type: 'number',
            description: 'Maximum visible expand buttons clicked in each round. Defaults to 3.'
          },
          expandWaitMsMin: {
            type: 'number',
            description: 'Minimum wait after expand clicks.'
          },
          expandWaitMsMax: {
            type: 'number',
            description: 'Maximum wait after expand clicks.'
          },
          scrollWaitMsMin: {
            type: 'number',
            description: 'Minimum wait after scrolling.'
          },
          scrollWaitMsMax: {
            type: 'number',
            description: 'Maximum wait after scrolling.'
          },
          scrollStepRatioMin: {
            type: 'number',
            description: 'Minimum scroll step as a ratio of viewport height.'
          },
          scrollStepRatioMax: {
            type: 'number',
            description: 'Maximum scroll step as a ratio of viewport height.'
          },
          maxCandidates: {
            type: 'number',
            description: 'Maximum candidates captured in each non-empty batch.'
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
          closePageAfter: {
            type: 'boolean',
            description: 'Close the selected Chrome tab after the loop stops.'
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
          stateFile: { type: 'string' },
          platform: { type: 'string' },
          url: { type: 'string' },
          taskId: { type: 'string' },
          stopReason: { type: 'string' },
          roundCount: { type: 'number' },
          batchCount: { type: 'number' },
          candidateCount: { type: 'number' },
          totalClicks: { type: 'number' },
          totalErrors: { type: 'number' },
          idleRounds: { type: 'number' },
          lastBatchId: { type: 'string' },
          nextBatchId: { type: 'string' },
          batchFiles: {
            type: 'array',
            items: { type: 'string' }
          },
          closedPage: { type: 'boolean' },
          closePageError: { type: 'string' }
        },
        required: ['status', 'runId', 'outDir', 'stateFile', 'platform', 'url', 'taskId', 'stopReason', 'roundCount', 'batchCount', 'candidateCount', 'totalClicks', 'totalErrors', 'idleRounds', 'lastBatchId', 'nextBatchId', 'batchFiles']
      }
    }
  ];

  const priority = [
    STATUS_TOOL_NAME,
    EXPAND_CAPTURE_TOOL_NAME,
    EXPAND_TOOL_NAME,
    CAPTURE_DOM_TOOL_NAME,
    CAPTURE_CANDIDATE_BATCH_TOOL_NAME,
    CAPTURE_CANDIDATE_BATCHES_TOOL_NAME,
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

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < 0) return 0;
  return parsed;
}

function normalizeRange(minValue, maxValue, fallbackMin, fallbackMax) {
  const parsedMin = Number(minValue);
  const parsedMax = Number(maxValue);
  const min = Number.isFinite(parsedMin) && parsedMin >= 0 ? parsedMin : fallbackMin;
  const max = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : fallbackMax;

  return min <= max
    ? { min, max }
    : { min: max, max: min };
}

function normalizeClickMode(value, fallback) {
  const mode = String(value || '').trim();
  if (mode === 'coordinate' || mode === 'dom-click' || mode === 'auto') return mode;
  return fallback;
}

function normalizeClickProfile(args = {}) {
  return {
    clickMode: normalizeClickMode(args.clickMode, DEFAULT_CLICK_PROFILE.clickMode),
    fallbackClickMode: normalizeClickMode(args.fallbackClickMode, DEFAULT_CLICK_PROFILE.fallbackClickMode),
    clickJitterPx: toNonNegativeInteger(args.clickJitterPx, DEFAULT_CLICK_PROFILE.clickJitterPx),
    mouseMoveSteps: normalizeRange(
      args.mouseMoveStepsMin,
      args.mouseMoveStepsMax,
      DEFAULT_CLICK_PROFILE.mouseMoveStepsMin,
      DEFAULT_CLICK_PROFILE.mouseMoveStepsMax
    ),
    clickDownMs: normalizeRange(
      args.clickDownMsMin,
      args.clickDownMsMax,
      DEFAULT_CLICK_PROFILE.clickDownMsMin,
      DEFAULT_CLICK_PROFILE.clickDownMsMax
    ),
    clickGapMs: normalizeRange(
      args.clickGapMsMin,
      args.clickGapMsMax,
      DEFAULT_CLICK_PROFILE.clickGapMsMin,
      DEFAULT_CLICK_PROFILE.clickGapMsMax
    )
  };
}

function pickRangeValue(range, random = Math.random) {
  if (!range || range.min === range.max) return range ? range.min : 0;
  return Math.round(range.min + (range.max - range.min) * random());
}

function pickRatioValue(range, random = Math.random) {
  if (!range || range.min === range.max) return range ? range.min : 0;
  return range.min + (range.max - range.min) * random();
}

function normalizeExpandCaptureConfig(args = {}) {
  return {
    maxRuntimeMs: toPositiveInteger(args.maxRuntimeMs, DEFAULT_EXPAND_CAPTURE_CONFIG.maxRuntimeMs),
    maxRounds: toPositiveInteger(args.maxRounds, DEFAULT_EXPAND_CAPTURE_CONFIG.maxRounds),
    maxBatches: toPositiveInteger(args.maxBatches, DEFAULT_EXPAND_CAPTURE_CONFIG.maxBatches),
    maxIdleRounds: toPositiveInteger(args.maxIdleRounds, DEFAULT_EXPAND_CAPTURE_CONFIG.maxIdleRounds),
    maxClicksPerRound: toPositiveInteger(args.maxClicksPerRound, DEFAULT_EXPAND_CAPTURE_CONFIG.maxClicksPerRound),
    expandWaitMs: normalizeRange(
      args.expandWaitMsMin,
      args.expandWaitMsMax,
      DEFAULT_EXPAND_CAPTURE_CONFIG.expandWaitMsMin,
      DEFAULT_EXPAND_CAPTURE_CONFIG.expandWaitMsMax
    ),
    scrollWaitMs: normalizeRange(
      args.scrollWaitMsMin,
      args.scrollWaitMsMax,
      DEFAULT_EXPAND_CAPTURE_CONFIG.scrollWaitMsMin,
      DEFAULT_EXPAND_CAPTURE_CONFIG.scrollWaitMsMax
    ),
    scrollStepRatio: normalizeRange(
      args.scrollStepRatioMin,
      args.scrollStepRatioMax,
      DEFAULT_EXPAND_CAPTURE_CONFIG.scrollStepRatioMin,
      DEFAULT_EXPAND_CAPTURE_CONFIG.scrollStepRatioMax
    ),
    click: normalizeClickProfile(args)
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function expandVisibleCommentsOnce(page, options = {}) {
  const maxClicksPerRound = toPositiveInteger(options.maxClicksPerRound, DEFAULT_EXPAND_CAPTURE_CONFIG.maxClicksPerRound);

  return page.evaluate(config => {
    const normalizeText = value => String(value == null ? '' : value).replace(/\s+/g, '').trim();
    const patterns = [
      /^展开更多(?:回复|评论)?$/,
      /^展开(?:全部)?\d+条?回复$/,
      /^展开\d+回复$/,
      /^查看(?:全部|更多)?\d+条?回复$/,
      /^查看(?:全部|更多)?回复$/,
      /^查看更多回复$/,
      /^更多回复$/
    ];
    const rejectPatterns = [
      /展开全文/,
      /收起/,
      /商品/,
      /详情/
    ];
    const isExpandText = value => {
      const text = normalizeText(value);
      if (!text || text.length > 24) return false;
      if (rejectPatterns.some(pattern => pattern.test(text))) return false;
      return patterns.some(pattern => pattern.test(text));
    };
    const isVisible = el => {
      if (!el) return false;
      if (el.disabled) return false;
      if (String(el.getAttribute && el.getAttribute('aria-disabled')) === 'true') return false;
      if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
      const rect = typeof el.getBoundingClientRect === 'function'
        ? el.getBoundingClientRect()
        : null;
      if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
      if (el.offsetParent === null && (!rect || (rect.width === 0 && rect.height === 0))) return false;
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.pointerEvents === 'none' ||
        Number(style.opacity) === 0
      )) {
        return false;
      }
      return true;
    };
    const hasMatchingDescendant = el => {
      if (!el || typeof el.querySelectorAll !== 'function') return false;
      return Array.from(el.querySelectorAll('*')).some(child => child !== el && isVisible(child) && isExpandText(child.textContent));
    };
    const candidates = [];

    for (const el of Array.from(document.querySelectorAll('button,[role="button"],a,span,div'))) {
      if (candidates.length >= config.maxClicksPerRound) break;
      if (!isVisible(el)) continue;
      if (!isExpandText(el.textContent)) continue;
      if (hasMatchingDescendant(el)) continue;
      candidates.push(el);
    }

    let clicked = 0;
    let errors = 0;

    for (const el of candidates) {
      try {
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', inline: 'center' });
        }
        if (typeof el.click === 'function') {
          el.click();
          clicked += 1;
        }
      } catch (_error) {
        errors += 1;
      }
    }

    return {
      clicked,
      errors,
      available: candidates.length
    };
  }, {
    maxClicksPerRound
  });
}

async function scrollCommentContainer(page, options = {}) {
  const parsedRatio = Number(options.scrollStepRatio);
  const scrollStepRatio = Number.isFinite(parsedRatio) && parsedRatio > 0 ? parsedRatio : DEFAULT_EXPAND_CAPTURE_CONFIG.scrollStepRatioMin;

  return page.evaluate(config => {
    const isVisible = el => {
      if (!el) return false;
      const rect = typeof el.getBoundingClientRect === 'function'
        ? el.getBoundingClientRect()
        : null;
      if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
      if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
      return true;
    };
    const scoreScrollContainer = el => {
      if (!el || !isVisible(el)) return 0;
      const scrollHeight = Number(el.scrollHeight) || 0;
      const clientHeight = Number(el.clientHeight) || 0;
      const overflow = scrollHeight - clientHeight;
      if (overflow <= 40 || clientHeight < 120) return 0;
      const marker = `${el.id || ''} ${el.className || ''}`.toLowerCase();
      let score = overflow;
      if (/comment|reply|评论|回复/.test(marker)) score += 1000;
      if (/list|panel|content|container|drawer|modal/.test(marker)) score += 150;
      if (clientHeight >= 240) score += 100;
      return score;
    };
    const fallback = document.scrollingElement || document.documentElement || document.body;
    const selector = [
      '[class*="comment"]',
      '[class*="reply"]',
      '[class*="Comment"]',
      '[class*="Reply"]',
      'section',
      'main',
      'aside',
      'div',
      'ul',
      'ol'
    ].join(',');
    let target = fallback;
    let bestScore = scoreScrollContainer(fallback);

    for (const el of Array.from(document.querySelectorAll(selector))) {
      const score = scoreScrollContainer(el);
      if (score > bestScore) {
        target = el;
        bestScore = score;
      }
    }

    const isWindowTarget = target === document.body || target === document.documentElement || target === document.scrollingElement;
    const getTop = () => isWindowTarget
      ? Number(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0)
      : Number(target.scrollTop || 0);
    const clientHeight = Number(target && target.clientHeight) || Number(window.innerHeight) || 800;
    const step = Math.max(240, Math.round(clientHeight * config.scrollStepRatio));
    const before = getTop();

    if (isWindowTarget) {
      window.scrollBy({ top: step, left: 0, behavior: 'auto' });
    } else {
      target.scrollTop = Math.min(Math.max(0, Number(target.scrollHeight || 0) - clientHeight), before + step);
      try {
        target.dispatchEvent(new Event('scroll', { bubbles: true }));
      } catch (_error) {
        // Best effort event nudge for virtualized lists.
      }
    }

    const after = getTop();
    const maxTop = isWindowTarget
      ? Math.max(0, Number(document.documentElement.scrollHeight || document.body.scrollHeight || 0) - Number(window.innerHeight || clientHeight))
      : Math.max(0, Number(target.scrollHeight || 0) - clientHeight);

    return {
      before,
      after,
      changed: after !== before,
      atBottom: maxTop > 0 && after >= maxTop - 8,
      viewportHeight: Number(window.innerHeight || clientHeight) || 0,
      documentHeight: Math.max(
        Number(document.body && document.body.scrollHeight) || 0,
        Number(document.documentElement && document.documentElement.scrollHeight) || 0
      )
    };
  }, {
    scrollStepRatio
  });
}

function decorateCaptureState(state, progress) {
  return Object.assign({}, state || {}, {
    schema_version: 'capture-state-v1',
    task_id: progress.taskId,
    platform: progress.platform,
    source_url: progress.sourceUrl,
    updated_at: new Date().toISOString(),
    last_batch_id: progress.lastBatchId,
    next_batch_id: progress.nextBatchId,
    round: progress.roundCount,
    total_clicks: progress.totalClicks,
    total_candidates: progress.candidateCount,
    idle_rounds: progress.idleRounds,
    stop_reason: progress.stopReason || ''
  });
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

async function captureCurrentCommentCandidateBatchesUntilIdle(args = {}, context = {}) {
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
    const captureBatch = context.captureCommentCandidateBatch || candidateBatch.captureCommentCandidateBatch;
    const platform = detectPlatformSafe(sourceUrl);
    const maxBatches = toPositiveInteger(args.maxBatches, 20);
    const maxIdleBatches = toPositiveInteger(args.maxIdleBatches, 2);
    const batchFiles = [];
    let previousState = readCaptureState(stateFile);
    const taskId = String(args.taskId || previousState.task_id || runId);
    let batchCount = 0;
    let candidateCount = 0;
    let idleBatches = 0;
    let lastBatchId = '';
    let nextBatchId = resolveBatchId({}, previousState);
    let stopReason = 'max_batches';

    while (batchCount < maxBatches) {
      const batchId = resolveBatchId({}, previousState);
      nextBatchId = buildNextBatchId(batchId);
      const batchDir = path.join(outDir, 'batches', batchId);
      const batchFile = path.join(batchDir, 'comment-dom-batch.json');
      const batch = await captureBatch(page, {
        taskId,
        batchId,
        platform,
        sourceUrl,
        maxCandidates: args.maxCandidates,
        maxCharsPerCandidate: args.maxCharsPerCandidate,
        includeHtml: args.includeHtml,
        includeText: args.includeText,
        scrollAfterCapture: true,
        scrollStepRatio: args.scrollStepRatio,
        seenCandidateHashes: getSeenCandidateHashes(previousState)
      });
      const currentCandidates = Array.isArray(batch && batch.candidates) ? batch.candidates.length : 0;

      fs.mkdirSync(batchDir, { recursive: true });
      output.writeJson(batchFile, batch);
      batchFiles.push(batchFile);
      previousState = updateCaptureState({
        previousState,
        taskId,
        platform: batch.platform || platform,
        sourceUrl: batch.source_url || sourceUrl,
        batchId,
        nextBatchId,
        batch,
        batchFile
      });
      output.writeJson(stateFile, previousState);

      batchCount += 1;
      candidateCount += currentCandidates;
      lastBatchId = batchId;
      idleBatches = currentCandidates > 0 ? 0 : idleBatches + 1;

      if (idleBatches >= maxIdleBatches) {
        stopReason = 'idle';
        break;
      }
    }

    const result = {
      status: 'success',
      runId,
      outDir,
      stateFile,
      platform,
      url: sourceUrl,
      taskId,
      batchCount,
      candidateCount,
      stopReason,
      lastBatchId,
      nextBatchId,
      batchFiles
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

async function expandAndCaptureCommentBatches(args = {}, context = {}) {
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
    const config = normalizeExpandCaptureConfig(args);
    const random = typeof context.random === 'function' ? context.random : Math.random;
    const wait = context.sleep || sleep;
    const expandStep = context.expandVisibleCommentsOnce || expandVisibleCommentsOnce;
    const captureBatch = context.captureCommentCandidateBatch || candidateBatch.captureCommentCandidateBatch;
    const scrollStep = context.scrollCommentContainer || scrollCommentContainer;
    const platform = detectPlatformSafe(sourceUrl);
    let previousState = readCaptureState(stateFile);
    const taskId = String(args.taskId || previousState.task_id || runId);
    const startedAt = Date.now();
    const existingBatches = Array.isArray(previousState.batches) ? previousState.batches : [];
    const batchFiles = existingBatches.map(batch => String(batch && batch.batch_file || '')).filter(Boolean);
    let roundCount = Number(previousState.round) || 0;
    let batchCount = existingBatches.length;
    let candidateCount = Number(previousState.total_candidates) || 0;
    let totalClicks = Number(previousState.total_clicks) || 0;
    let totalErrors = Number(previousState.total_errors) || 0;
    let idleRounds = Number(previousState.idle_rounds) || 0;
    let lastBatchId = String(previousState.last_batch_id || '');
    let nextBatchId = resolveBatchId({}, previousState);
    let stopReason = '';

    fs.mkdirSync(outDir, { recursive: true });

    while (!stopReason) {
      if (Date.now() - startedAt >= config.maxRuntimeMs) {
        stopReason = 'max-runtime';
        break;
      }
      if (roundCount >= config.maxRounds) {
        stopReason = 'max-rounds';
        break;
      }
      if (batchCount >= config.maxBatches) {
        stopReason = 'max-batches';
        break;
      }

      roundCount += 1;

      const expandResult = await expandStep(page, {
        maxClicksPerRound: config.maxClicksPerRound
      });
      const clickedThisRound = Number(expandResult && expandResult.clicked) || 0;
      totalClicks += clickedThisRound;
      totalErrors += Number(expandResult && expandResult.errors) || 0;

      await wait(pickRangeValue(config.expandWaitMs, random));

      const batchId = resolveBatchId({}, previousState);
      const batchDir = path.join(outDir, 'batches', batchId);
      const batchFile = path.join(batchDir, 'comment-dom-batch.json');
      const batch = await captureBatch(page, {
        taskId,
        batchId,
        platform,
        sourceUrl,
        maxCandidates: args.maxCandidates,
        maxCharsPerCandidate: args.maxCharsPerCandidate,
        includeHtml: args.includeHtml,
        includeText: args.includeText,
        scrollAfterCapture: false,
        seenCandidateHashes: getSeenCandidateHashes(previousState)
      });
      const currentCandidates = Array.isArray(batch && batch.candidates) ? batch.candidates.length : 0;

      if (currentCandidates > 0) {
        nextBatchId = buildNextBatchId(batchId);
        fs.mkdirSync(batchDir, { recursive: true });
        output.writeJson(batchFile, batch);
        batchFiles.push(batchFile);
        previousState = updateCaptureState({
          previousState,
          taskId,
          platform: batch.platform || platform,
          sourceUrl: batch.source_url || sourceUrl,
          batchId,
          nextBatchId,
          batch,
          batchFile
        });
        batchCount += 1;
        candidateCount += currentCandidates;
        lastBatchId = batchId;
      } else {
        nextBatchId = resolveBatchId({}, previousState);
      }

      const scrollRatio = pickRatioValue(config.scrollStepRatio, random);
      const scrollResult = await scrollStep(page, {
        scrollStepRatio: scrollRatio
      });

      await wait(pickRangeValue(config.scrollWaitMs, random));

      const progressed = currentCandidates > 0 || clickedThisRound > 0 || Boolean(scrollResult && scrollResult.changed);
      idleRounds = progressed ? 0 : idleRounds + 1;

      if (idleRounds >= config.maxIdleRounds) {
        stopReason = 'idle';
      } else if (batchCount >= config.maxBatches) {
        stopReason = 'max-batches';
      } else if (roundCount >= config.maxRounds) {
        stopReason = 'max-rounds';
      } else if (Date.now() - startedAt >= config.maxRuntimeMs) {
        stopReason = 'max-runtime';
      } else if (Boolean(scrollResult && scrollResult.atBottom) && idleRounds >= config.maxIdleRounds) {
        stopReason = 'bottom-idle';
      }

      previousState = decorateCaptureState(previousState, {
        taskId,
        platform,
        sourceUrl,
        lastBatchId,
        nextBatchId,
        roundCount,
        totalClicks,
        candidateCount,
        idleRounds,
        stopReason,
        totalErrors
      });
      previousState.total_errors = totalErrors;
      output.writeJson(stateFile, previousState);
    }

    const result = {
      status: 'success',
      runId,
      outDir,
      stateFile,
      platform,
      url: sourceUrl,
      taskId,
      stopReason,
      roundCount,
      batchCount,
      candidateCount,
      totalClicks,
      totalErrors,
      idleRounds,
      lastBatchId,
      nextBatchId,
      batchFiles
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

  if (name === CAPTURE_CANDIDATE_BATCHES_TOOL_NAME) {
    return buildToolResult(await captureCurrentCommentCandidateBatchesUntilIdle(args, context));
  }

  if (name === EXPAND_CAPTURE_TOOL_NAME) {
    return buildToolResult(await expandAndCaptureCommentBatches(args, context));
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
  CAPTURE_CANDIDATE_BATCHES_TOOL_NAME,
  EXPAND_CAPTURE_TOOL_NAME,
  DEFAULT_EXPAND_TIMEOUT_MS,
  DEFAULT_EXPAND_CAPTURE_CONFIG,
  DEFAULT_CLICK_PROFILE,
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
  toPositiveInteger,
  toNonNegativeInteger,
  normalizeClickMode,
  normalizeClickProfile,
  normalizeExpandCaptureConfig,
  expandVisibleCommentsOnce,
  scrollCommentContainer,
  decorateCaptureState,
  buildExpandSummary,
  expandCurrentPageComments,
  readCurrentPagePayload,
  saveCurrentPageComments,
  normalizeCommentRun,
  captureCurrentCommentDomSnapshot,
  captureCurrentCommentCandidateBatch,
  captureCurrentCommentCandidateBatchesUntilIdle,
  expandAndCaptureCommentBatches,
  callTool
};
