'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const toolsPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-tools.js');
const serverPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-server.js');
const cdpPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-cdp.js');

test('stage 2 exposes a comment crawler status tool', async () => {
  assert.equal(fs.existsSync(toolsPath), true);

  const tools = require(toolsPath);
  const projectRoot = '/tmp/comment-crawler-demo';

  assert.deepEqual(tools.getCommentCrawlerStatus({ projectRoot }), {
    status: 'ok',
    version: 'mcp-v1',
    projectRoot,
    tools: ['get_comment_crawler_status']
  });

  const listed = tools.listTools();
  const statusTool = listed.find(tool => tool.name === 'get_comment_crawler_status');
  assert.ok(statusTool);
  assert.equal(statusTool.inputSchema.type, 'object');

  const result = await tools.callTool('get_comment_crawler_status', {}, { projectRoot });
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    status: 'ok',
    version: 'mcp-v1',
    projectRoot,
    tools: ['get_comment_crawler_status']
  });
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /"status": "ok"/);
});

test('stage 2 handles initialize, tools/list, and tools/call JSON-RPC messages', async () => {
  assert.equal(fs.existsSync(serverPath), true);

  const server = require(serverPath);
  const context = { projectRoot: '/tmp/comment-crawler-demo' };

  const initialized = await server.handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  }, context);

  assert.equal(initialized.id, 1);
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  assert.deepEqual(initialized.result.capabilities, {
    tools: { listChanged: false }
  });
  assert.equal(initialized.result.serverInfo.name, 'comment-crawler-mcp');

  const notification = await server.handleJsonRpcMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }, context);
  assert.equal(notification, null);

  const listed = await server.handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  }, context);

  assert.equal(listed.result.tools[0].name, 'get_comment_crawler_status');

  const called = await server.handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'get_comment_crawler_status',
      arguments: {}
    }
  }, context);

  assert.equal(called.result.isError, false);
  assert.equal(called.result.structuredContent.projectRoot, context.projectRoot);
});

test('stage 2 reports unknown MCP tools as JSON-RPC parameter errors', async () => {
  assert.equal(fs.existsSync(serverPath), true);

  const server = require(serverPath);
  const response = await server.handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'missing_tool',
      arguments: {}
    }
  }, { projectRoot: '/tmp/comment-crawler-demo' });

  assert.equal(response.id, 4);
  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /Unknown tool/);
});

test('stage 3 connects to Chrome CDP and disconnects without closing Chrome', async () => {
  assert.equal(fs.existsSync(cdpPath), true);

  const cdp = require(cdpPath);
  const calls = [];
  const targetPage = {
    url: () => 'https://www.douyin.com/video/123',
    title: async () => 'Douyin video',
    evaluate: async () => '页面正文'
  };
  const browser = {
    contexts: () => [
      {
        pages: () => [
          { url: () => 'chrome://new-tab-page' },
          targetPage
        ]
      }
    ],
    disconnect: () => calls.push('disconnect'),
    close: async () => calls.push('close')
  };
  const playwright = {
    chromium: {
      connectOverCDP: async (endpoint, options) => {
        calls.push(['connect', endpoint, options.timeout]);
        return browser;
      }
    }
  };

  const session = await cdp.connectToCdp({
    cdpEndpoint: 'http://127.0.0.1:9333',
    timeoutMs: 1234,
    playwright
  });

  assert.equal(session.page, targetPage);
  assert.deepEqual(calls[0], ['connect', 'http://127.0.0.1:9333', 1234]);

  await session.close();
  assert.deepEqual(calls.slice(1), ['disconnect']);
});

test('stage 3 selects the latest HTTP page and reads a page snapshot', async () => {
  assert.equal(fs.existsSync(cdpPath), true);

  const cdp = require(cdpPath);
  const pages = [
    { url: () => 'about:blank' },
    { url: () => 'https://www.xiaohongshu.com/explore/abc' },
    { url: () => 'https://www.douyin.com/video/123' }
  ];
  const selected = await cdp.selectCurrentPage({
    contexts: () => [
      { pages: () => pages }
    ]
  });

  assert.equal(selected, pages[2]);

  const snapshot = await cdp.readPageSnapshot({
    url: () => 'https://www.douyin.com/video/123',
    title: async () => '标题',
    evaluate: async () => '正文'
  });

  assert.deepEqual(snapshot, {
    url: 'https://www.douyin.com/video/123',
    title: '标题',
    text: '正文'
  });
});

test('stage 4 expands comments on the current CDP page and returns a summary', async () => {
  const tools = require(toolsPath);
  const listed = tools.listTools();
  assert.ok(listed.find(tool => tool.name === 'expand_current_page_comments'));

  const calls = [];
  const payload = {
    state: {
      stopReason: 'idle',
      totalClicks: 5,
      round: 8,
      totalErrors: 0
    },
    results: [
      { text: '第一条评论' },
      { text: '第二条评论' }
    ]
  };
  const page = {
    url: () => 'https://www.douyin.com/video/123',
    evaluate: async value => {
      if (typeof value === 'string') {
        calls.push(['inject', value]);
        return undefined;
      }

      calls.push(['payload']);
      return payload;
    },
    waitForFunction: async (_predicate, _arg, options) => {
      calls.push(['waitForStop', options.timeout]);
    }
  };
  const session = {
    page,
    close: async () => calls.push(['close'])
  };

  const result = await tools.callTool('expand_current_page_comments', {
    timeoutMs: 4321
  }, {
    connectToCdp: async options => {
      calls.push(['connect', options.timeoutMs]);
      return session;
    },
    expanderScript: '/* expander script */',
    projectRoot: '/tmp/comment-crawler-demo'
  });

  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    status: 'success',
    platform: 'douyin',
    url: 'https://www.douyin.com/video/123',
    stopReason: 'idle',
    rawCommentCount: 2,
    totalClicks: 5,
    rounds: 8,
    totalErrors: 0
  });
  assert.deepEqual(calls, [
    ['connect', 30000],
    ['inject', '/* expander script */'],
    ['waitForStop', 4321],
    ['payload'],
    ['close']
  ]);
});

test('stage 4 exposes expand_current_page_comments through JSON-RPC tools/call', async () => {
  const server = require(serverPath);
  const response = await server.handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'expand_current_page_comments',
      arguments: {
        timeoutMs: 1000
      }
    }
  }, {
    connectToCdp: async () => ({
      page: {
        url: () => 'https://www.xiaohongshu.com/explore/abc',
        evaluate: async value => {
          if (typeof value === 'string') return undefined;
          return {
            state: {
              stopReason: 'idle',
              totalClicks: 1,
              round: 2,
              totalErrors: 0
            },
            results: [{ text: '评论' }]
          };
        },
        waitForFunction: async () => {}
      },
      close: async () => {}
    }),
    expanderScript: '/* expander script */',
    projectRoot: '/tmp/comment-crawler-demo'
  });

  assert.equal(response.id, 5);
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.platform, 'xiaohongshu');
  assert.equal(response.result.structuredContent.rawCommentCount, 1);
});
