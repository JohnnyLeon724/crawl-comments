'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const toolsPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-tools.js');
const serverPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-server.js');
const cdpPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-cdp.js');
const outputPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-output.js');
const securityPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-security.js');

test('stage 2 exposes a comment crawler status tool', async () => {
  assert.equal(fs.existsSync(toolsPath), true);

  const tools = require(toolsPath);
  const projectRoot = '/tmp/comment-crawler-demo';
  const listed = tools.listTools();
  const toolNames = listed.map(tool => tool.name);

  assert.deepEqual(tools.getCommentCrawlerStatus({ projectRoot }), {
    status: 'ok',
    version: 'mcp-v1',
    projectRoot,
    tools: toolNames
  });

  const statusTool = listed.find(tool => tool.name === 'get_comment_crawler_status');
  assert.ok(statusTool);
  assert.equal(statusTool.inputSchema.type, 'object');
  assert.ok(toolNames.includes('capture_current_comment_dom_snapshot'));
  assert.ok(toolNames.slice(0, 4).includes('capture_current_comment_dom_snapshot'));

  const result = await tools.callTool('get_comment_crawler_status', {}, { projectRoot });
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    status: 'ok',
    version: 'mcp-v1',
    projectRoot,
    tools: toolNames
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

test('stage 5 saves the current page comment payload to CLI-compatible output files', async () => {
  assert.equal(fs.existsSync(outputPath), true);

  const tools = require(toolsPath);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const outDir = path.join(projectRoot, 'output', 'run_001');
  const calls = [];
  const payload = {
    state: {
      stopReason: 'idle',
      totalComments: 2,
      totalClicks: 3,
      round: 4,
      totalErrors: 0
    },
    config: {
      maxIdleRounds: 8
    },
    results: [
      {
        row_type: 'level1',
        text: '第一条评论',
        dom_path: 'DIV:nth-of-type(1)',
        captured_at: '2026-07-08T00:00:00.000Z'
      },
      {
        row_type: 'level1',
        text: '第二条评论',
        dom_path: 'DIV:nth-of-type(2)',
        captured_at: '2026-07-08T00:00:01.000Z'
      }
    ]
  };
  const page = {
    url: () => 'https://www.douyin.com/video/123',
    evaluate: async () => {
      calls.push(['payload']);
      return payload;
    },
    screenshot: async options => {
      calls.push(['screenshot', path.basename(options.path)]);
      fs.writeFileSync(options.path, 'PNG');
    }
  };

  const result = await tools.callTool('save_current_page_comments', {
    outDir,
    runId: 'run_test_001'
  }, {
    connectToCdp: async options => {
      calls.push(['connect', options.timeoutMs]);
      return {
        page,
        close: async () => calls.push(['close'])
      };
    },
    projectRoot
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.runId, 'run_test_001');
  assert.equal(result.structuredContent.rawCommentCount, 2);
  assert.equal(result.structuredContent.outDir, outDir);

  const rawPath = path.join(outDir, 'raw-comments.json');
  const csvPath = path.join(outDir, 'raw-comments.csv');
  const manifestPath = path.join(outDir, 'manifest.json');
  const screenshotPath = path.join(outDir, 'final-page.png');

  assert.equal(fs.existsSync(rawPath), true);
  assert.equal(fs.existsSync(csvPath), true);
  assert.equal(fs.existsSync(manifestPath), true);
  assert.equal(fs.existsSync(screenshotPath), true);

  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  assert.equal(raw.source_url, 'https://www.douyin.com/video/123');
  assert.equal(raw.results.length, 2);
  assert.equal(fs.readFileSync(csvPath, 'utf8').charCodeAt(0), 0xfeff);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.run_id, 'run_test_001');
  assert.equal(manifest.platform, 'douyin');
  assert.equal(manifest.status, 'success');
  assert.equal(manifest.raw_comment_count, 2);

  assert.deepEqual(calls, [
    ['connect', 30000],
    ['payload'],
    ['screenshot', 'final-page.png'],
    ['close']
  ]);
});

test('stage 6 normalizes a saved comment run through the MCP tool', async () => {
  const tools = require(toolsPath);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const runDir = path.join(projectRoot, 'output', 'run_001');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'raw-comments.json'), `${JSON.stringify({
    source_url: 'https://www.douyin.com/video/123',
    results: [
      {
        row_type: 'level1',
        text: '用户A：第一条评论 点赞 2',
        dom_path: 'DIV:nth-of-type(1)',
        captured_at: '2026-07-08T00:00:00.000Z'
      }
    ]
  }, null, 2)}\n`);

  const result = await tools.callTool('normalize_comment_run', {
    runDir,
    platform: 'douyin'
  }, {
    projectRoot
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.platform, 'douyin');
  assert.equal(result.structuredContent.rowCount, 1);
  assert.equal(result.structuredContent.out, path.join(runDir, 'normalized-comments.jsonl'));

  const normalized = fs.readFileSync(path.join(runDir, 'normalized-comments.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].platform, 'douyin');
  assert.equal(normalized[0].post_id, '123');
  assert.equal(normalized[0].user_name, '用户A');
  assert.equal(normalized[0].text, '第一条评论');
});

test('stage 7 enforces project output paths and supported platform hosts', () => {
  assert.equal(fs.existsSync(securityPath), true);

  const security = require(securityPath);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));

  assert.equal(
    security.resolveOutputPath(projectRoot, 'output/run_001'),
    path.join(projectRoot, 'output', 'run_001')
  );
  assert.equal(
    security.resolveOutputPath(projectRoot, path.join(projectRoot, 'output', 'run_002')),
    path.join(projectRoot, 'output', 'run_002')
  );
  assert.throws(
    () => security.resolveOutputPath(projectRoot, path.join(projectRoot, 'not-output', 'run')),
    /output/
  );
  assert.throws(
    () => security.resolveOutputPath(projectRoot, path.join(os.tmpdir(), 'outside-run')),
    /output/
  );

  assert.equal(security.isAllowedPageUrl('https://www.douyin.com/video/123'), true);
  assert.equal(security.isAllowedPageUrl('https://www.xiaohongshu.com/explore/abc'), true);
  assert.equal(security.isAllowedPageUrl('https://example.com/post/123'), false);
  assert.throws(
    () => security.assertAllowedPageUrl('https://example.com/post/123'),
    /暂不允许/
  );
});

test('stage 10 captures current page comment DOM snapshot through the MCP tool', async () => {
  const tools = require(toolsPath);
  const listed = tools.listTools();
  assert.ok(listed.find(tool => tool.name === 'capture_current_comment_dom_snapshot'));

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const outDir = path.join(projectRoot, 'output', 'run_snapshot_001');
  const snapshot = {
    schema_version: 'comment-dom-snapshot-v1',
    platform: 'douyin',
    source_url: 'https://www.douyin.com/video/123',
    captured_at: '2026-07-08T04:00:00.000Z',
    limits: {
      maxChunks: 2,
      maxCharsPerChunk: 1000
    },
    truncated: false,
    chunks: [
      {
        chunk_id: 'chunk_0001',
        dom_path: 'HTML:nth-of-type(1)>BODY:nth-of-type(1)>DIV:nth-of-type(1)',
        role_hint: 'comment_candidate',
        inner_text: '用户A评论内容3月前江苏2',
        html: '<div>用户A评论内容3月前江苏2</div>',
        nearby_buttons: ['回复'],
        captured_at: '2026-07-08T04:00:00.000Z'
      }
    ]
  };
  const calls = [];

  const result = await tools.callTool('capture_current_comment_dom_snapshot', {
    outDir,
    runId: 'run_snapshot_001',
    maxChunks: 2,
    maxCharsPerChunk: 1000
  }, {
    connectToCdp: async options => {
      calls.push(['connect', options.timeoutMs]);
      return {
        page: {
          url: () => 'https://www.douyin.com/video/123'
        },
        close: async () => calls.push(['close'])
      };
    },
    captureCommentDomSnapshot: async (_page, options) => {
      calls.push(['capture', options.maxChunks, options.maxCharsPerChunk]);
      return snapshot;
    },
    projectRoot
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.runId, 'run_snapshot_001');
  assert.equal(result.structuredContent.outDir, outDir);
  assert.equal(result.structuredContent.platform, 'douyin');
  assert.equal(result.structuredContent.url, 'https://www.douyin.com/video/123');
  assert.equal(result.structuredContent.chunkCount, 1);

  const snapshotFile = path.join(outDir, 'comment-dom-snapshot.json');
  assert.equal(result.structuredContent.snapshotFile, snapshotFile);
  assert.equal(fs.existsSync(snapshotFile), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(snapshotFile, 'utf8')), snapshot);
  assert.deepEqual(calls, [
    ['connect', 30000],
    ['capture', 2, 1000],
    ['close']
  ]);
});

test('stage 9 rejects unsupported page hosts before injecting expander', async () => {
  const tools = require(toolsPath);
  const calls = [];
  const page = {
    url: () => 'https://example.com/post/123',
    evaluate: async value => {
      calls.push(['evaluate', typeof value]);
      return null;
    },
    waitForFunction: async () => calls.push(['wait'])
  };

  await assert.rejects(
    () => tools.expandCurrentPageComments({}, {
      connectToCdp: async () => ({
        page,
        close: async () => calls.push(['close'])
      }),
      expanderScript: '/* should not inject */',
      projectRoot: '/tmp/comment-crawler-demo'
    }),
    /暂不允许/
  );

  assert.deepEqual(calls, [
    ['close']
  ]);
});

test('stage 9 reports missing expander payload when saving current page comments', async () => {
  const tools = require(toolsPath);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const calls = [];
  const page = {
    url: () => 'https://www.douyin.com/video/123',
    evaluate: async () => {
      calls.push(['payload']);
      return null;
    },
    screenshot: async () => calls.push(['screenshot'])
  };

  await assert.rejects(
    () => tools.saveCurrentPageComments({
      outDir: 'output/run_001'
    }, {
      connectToCdp: async () => ({
        page,
        close: async () => calls.push(['close'])
      }),
      projectRoot
    }),
    /请先运行 expand_current_page_comments/
  );

  assert.deepEqual(calls, [
    ['payload'],
    ['close']
  ]);
});

test('stage 9 maps CDP connection failures to JSON-RPC internal errors', async () => {
  const server = require(serverPath);

  const response = await server.handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: {
      name: 'expand_current_page_comments',
      arguments: {}
    }
  }, {
    connectToCdp: async () => {
      throw new Error('CDP endpoint is unavailable');
    },
    projectRoot: '/tmp/comment-crawler-demo'
  });

  assert.equal(response.id, 9);
  assert.equal(response.error.code, -32603);
  assert.match(response.error.message, /CDP endpoint is unavailable/);
});

test('stage 9 validates normalize_comment_run arguments and output boundary', () => {
  const tools = require(toolsPath);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const runDir = path.join(projectRoot, 'output', 'run_001');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'raw-comments.json'), '{"results":[]}\n');

  assert.throws(
    () => tools.normalizeCommentRun({ platform: 'douyin' }, { projectRoot }),
    /runDir/
  );
  assert.throws(
    () => tools.normalizeCommentRun({ runDir }, { projectRoot }),
    /platform/
  );
  assert.throws(
    () => tools.normalizeCommentRun({
      runDir,
      platform: 'douyin',
      out: path.join(os.tmpdir(), 'outside-normalized.jsonl')
    }, {
      projectRoot
    }),
    /output/
  );
});
