'use strict';

const fs = require('node:fs');
const path = require('node:path');

const runner = require('../script/crawl-comments-playwright.js');
const cdp = require('./comment-crawler-cdp.js');
const output = require('./comment-crawler-output.js');

const MCP_VERSION = 'mcp-v1';
const STATUS_TOOL_NAME = 'get_comment_crawler_status';
const EXPAND_TOOL_NAME = 'expand_current_page_comments';
const SAVE_TOOL_NAME = 'save_current_page_comments';
const DEFAULT_EXPAND_TIMEOUT_MS = 10 * 60 * 1000;

function resolveProjectRoot(options = {}) {
  return path.resolve(options.projectRoot || path.join(__dirname, '..'));
}

function getCommentCrawlerStatus(options = {}) {
  return {
    status: 'ok',
    version: MCP_VERSION,
    projectRoot: resolveProjectRoot(options),
    tools: [STATUS_TOOL_NAME]
  };
}

function listTools() {
  return [
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
          }
        },
        required: ['status', 'runId', 'outDir', 'rawCommentCount', 'outputFiles', 'errors']
      }
    }
  ];
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
  return fs.readFileSync(path.join(projectRoot, 'script', 'expand-comments-v1.js'), 'utf8');
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

    return output.writeCommentRunOutput({
      payload,
      page,
      sourceUrl: payload.source_url || getPageUrl(page),
      outDir: args.outDir,
      runId: args.runId
    });
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

  throw new Error(`Unknown tool: ${name}`);
}

module.exports = {
  MCP_VERSION,
  STATUS_TOOL_NAME,
  EXPAND_TOOL_NAME,
  SAVE_TOOL_NAME,
  DEFAULT_EXPAND_TIMEOUT_MS,
  getCommentCrawlerStatus,
  listTools,
  buildToolResult,
  readExpanderScript,
  buildExpandSummary,
  expandCurrentPageComments,
  readCurrentPagePayload,
  saveCurrentPageComments,
  callTool
};
