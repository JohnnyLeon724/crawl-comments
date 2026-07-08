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

test('stage 3 falls back to raw CDP when Playwright cannot manage browser contexts', async () => {
  const cdp = require(cdpPath);
  const calls = [];
  const rawSession = {
    page: { url: () => 'https://www.douyin.com/video/123' },
    close: async () => calls.push(['rawClose'])
  };

  const session = await cdp.connectToCdp({
    cdpEndpoint: 'http://127.0.0.1:9222',
    timeoutMs: 1234,
    playwright: {
      chromium: {
        connectOverCDP: async () => {
          calls.push(['playwrightConnect']);
          throw new Error('browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.');
        }
      }
    },
    rawCdpConnect: async options => {
      calls.push(['rawConnect', options.cdpEndpoint, options.timeoutMs]);
      return rawSession;
    }
  });

  assert.equal(session, rawSession);
  await session.close();
  assert.deepEqual(calls, [
    ['playwrightConnect'],
    ['rawConnect', 'http://127.0.0.1:9222', 1234],
    ['rawClose']
  ]);
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

test('normalizes coordinate click configuration with safe defaults and clamped ranges', () => {
  const tools = require(toolsPath);

  assert.equal(tools.normalizeClickMode('coordinate', 'dom-click'), 'coordinate');
  assert.equal(tools.normalizeClickMode('dom-click', 'coordinate'), 'dom-click');
  assert.equal(tools.normalizeClickMode('auto', 'coordinate'), 'auto');
  assert.equal(tools.normalizeClickMode('missing', 'coordinate'), 'coordinate');

  const profile = tools.normalizeClickProfile({
    clickMode: 'coordinate',
    fallbackClickMode: 'dom-click',
    clickJitterPx: -9,
    mouseMoveStepsMin: 12,
    mouseMoveStepsMax: 4,
    clickDownMsMin: 200,
    clickDownMsMax: 60,
    clickGapMsMin: 900,
    clickGapMsMax: 300
  });

  assert.deepEqual(profile, {
    clickMode: 'coordinate',
    fallbackClickMode: 'dom-click',
    clickJitterPx: 0,
    mouseMoveSteps: { min: 4, max: 12 },
    clickDownMs: { min: 60, max: 200 },
    clickGapMs: { min: 300, max: 900 }
  });

  const config = tools.normalizeExpandCaptureConfig({
    clickMode: 'auto',
    fallbackClickMode: 'dom-click',
    clickJitterPx: 3
  });

  assert.equal(config.click.clickMode, 'auto');
  assert.equal(config.click.fallbackClickMode, 'dom-click');
  assert.equal(config.click.clickJitterPx, 3);
});

test('findVisibleExpandTargets returns innermost visible expand controls with bounded click points', async () => {
  const tools = require(toolsPath);

  const page = {
    evaluate: async (_pageFunction, config) => {
      const makeElement = input => ({
        tagName: input.tagName || 'BUTTON',
        textContent: input.text,
        disabled: Boolean(input.disabled),
        previousElementSibling: null,
        parentElement: input.parent || null,
        nodeType: 1,
        getAttribute: name => input.attrs && input.attrs[name] || '',
        getClientRects: () => input.visible === false ? [] : [{}],
        getBoundingClientRect: () => input.rect,
        querySelectorAll: () => input.children || [],
        offsetParent: input.visible === false ? null : {}
      });
      const child = makeElement({
        tagName: 'SPAN',
        text: '展开5条回复',
        rect: { left: 20, top: 30, width: 80, height: 20, bottom: 50 }
      });
      const parent = makeElement({
        tagName: 'BUTTON',
        text: '展开5条回复',
        rect: { left: 10, top: 20, width: 120, height: 40, bottom: 60 },
        children: [child]
      });
      child.parentElement = parent;
      const rejected = makeElement({
        text: '展开全文',
        rect: { left: 10, top: 80, width: 100, height: 20, bottom: 100 }
      });
      const hidden = makeElement({
        text: '展开2条回复',
        visible: false,
        rect: { left: 10, top: 120, width: 100, height: 20, bottom: 140 }
      });
      const elements = [parent, child, rejected, hidden];
      global.window = {
        innerHeight: 800,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', pointerEvents: 'auto', opacity: '1' })
      };
      global.document = { querySelectorAll: () => elements };
      try {
        return _pageFunction(config);
      } finally {
        delete global.window;
        delete global.document;
      }
    }
  };

  const targets = await tools.findVisibleExpandTargets(page, {
    maxClicksPerRound: 3,
    clickJitterPx: 4,
    random: () => 0.75
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].text, '展开5条回复');
  assert.equal(targets[0].rect.left, 20);
  assert.ok(targets[0].click_point.x >= 20);
  assert.ok(targets[0].click_point.x <= 100);
  assert.ok(targets[0].click_point.y >= 30);
  assert.ok(targets[0].click_point.y <= 50);
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

test('save_current_page_comments can close the selected page after saving output', async () => {
  const tools = require(toolsPath);
  const listed = tools.listTools();
  const saveTool = listed.find(tool => tool.name === 'save_current_page_comments');
  assert.equal(saveTool.inputSchema.properties.closePageAfter.type, 'boolean');

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const outDir = path.join(projectRoot, 'output', 'run_close_001');
  const calls = [];
  const page = {
    url: () => 'https://www.douyin.com/video/123',
    evaluate: async () => ({
      state: { stopReason: 'idle' },
      config: {},
      results: [{ row_type: 'level1', text: '评论' }]
    }),
    screenshot: async () => calls.push(['screenshot']),
    close: async options => calls.push(['pageClose', options.runBeforeUnload])
  };

  const result = await tools.callTool('save_current_page_comments', {
    outDir,
    runId: 'run_close_001',
    closePageAfter: true
  }, {
    connectToCdp: async () => ({
      page,
      close: async () => calls.push(['sessionClose'])
    }),
    projectRoot
  });

  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.closedPage, true);
  assert.deepEqual(calls, [
    ['screenshot'],
    ['pageClose', false],
    ['sessionClose']
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

test('capture_current_comment_dom_snapshot can close the selected page after writing snapshot', async () => {
  const tools = require(toolsPath);
  const listed = tools.listTools();
  const captureTool = listed.find(tool => tool.name === 'capture_current_comment_dom_snapshot');
  assert.equal(captureTool.inputSchema.properties.closePageAfter.type, 'boolean');

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const outDir = path.join(projectRoot, 'output', 'run_snapshot_close_001');
  const calls = [];
  const page = {
    url: () => 'https://www.douyin.com/video/123',
    close: async options => calls.push(['pageClose', options.runBeforeUnload])
  };

  const result = await tools.callTool('capture_current_comment_dom_snapshot', {
    outDir,
    runId: 'run_snapshot_close_001',
    closePageAfter: true
  }, {
    connectToCdp: async () => ({
      page,
      close: async () => calls.push(['sessionClose'])
    }),
    captureCommentDomSnapshot: async () => {
      calls.push(['capture']);
      return {
        schema_version: 'comment-dom-snapshot-v1',
        platform: 'douyin',
        source_url: 'https://www.douyin.com/video/123',
        captured_at: '2026-07-08T04:00:00.000Z',
        limits: {},
        truncated: false,
        chunks: []
      };
    },
    projectRoot
  });

  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.closedPage, true);
  assert.deepEqual(calls, [
    ['capture'],
    ['pageClose', false],
    ['sessionClose']
  ]);
});

test('capture_comment_candidate_batch is exposed with bounded batch inputs', () => {
  const tools = require(toolsPath);
  const listed = tools.listTools();
  const captureTool = listed.find(tool => tool.name === 'capture_comment_candidate_batch');

  assert.ok(captureTool);
  assert.equal(captureTool.inputSchema.properties.outDir.type, 'string');
  assert.equal(captureTool.inputSchema.properties.taskId.type, 'string');
  assert.equal(captureTool.inputSchema.properties.batchId.type, 'string');
  assert.equal(captureTool.inputSchema.properties.stateFile.type, 'string');
  assert.equal(captureTool.inputSchema.properties.maxCandidates.type, 'number');
  assert.equal(captureTool.inputSchema.properties.maxCharsPerCandidate.type, 'number');
  assert.equal(captureTool.inputSchema.properties.scrollAfterCapture.type, 'boolean');
  assert.equal(captureTool.inputSchema.properties.closePageAfter.type, 'boolean');
});

test('capture_comment_candidate_batch writes a batch file and capture state', async () => {
  const tools = require(toolsPath);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const outDir = path.join(projectRoot, 'output', 'task_0001');
  const calls = [];
  const page = {
    url: () => 'https://www.douyin.com/video/123',
    close: async options => calls.push(['pageClose', options.runBeforeUnload])
  };
  const batch = {
    schema_version: 'comment-dom-batch-v1',
    batch_id: 'batch_0001',
    task_id: 'task_0001',
    platform: 'douyin',
    source_url: 'https://www.douyin.com/video/123',
    captured_at: '2026-07-08T05:00:00.000Z',
    scroll: {
      before_top: 1000,
      after_top: 1600,
      viewport_height: 900,
      document_height: 5000
    },
    state: {
      new_candidate_count: 1,
      seen_candidate_count: 1,
      has_more: false,
      stop_reason: ''
    },
    limits: {
      maxCandidates: 2,
      maxCharsPerCandidate: 1000
    },
    candidates: [
      {
        candidate_id: 'candidate_000001',
        candidate_hash: 'hash-1',
        dom_path: 'DIV:nth-of-type(1)',
        role_hint: 'comment_candidate',
        inner_text: '用户A 评论内容',
        html: '<div>用户A 评论内容</div>',
        nearby_buttons: ['回复'],
        rect: { top: 120, left: 20, width: 300, height: 80 },
        captured_at: '2026-07-08T05:00:00.000Z'
      }
    ]
  };

  const result = await tools.callTool('capture_comment_candidate_batch', {
    outDir,
    taskId: 'task_0001',
    batchId: 'batch_0001',
    maxCandidates: 2,
    maxCharsPerCandidate: 1000,
    scrollAfterCapture: true,
    scrollStepRatio: 0.75,
    closePageAfter: true
  }, {
    connectToCdp: async options => {
      calls.push(['connect', options.timeoutMs]);
      return {
        page,
        close: async () => calls.push(['sessionClose'])
      };
    },
    captureCommentCandidateBatch: async (_page, options) => {
      calls.push([
        'capture',
        options.taskId,
        options.batchId,
        options.maxCandidates,
        options.maxCharsPerCandidate,
        options.scrollAfterCapture,
        options.scrollStepRatio,
        options.seenCandidateHashes.length
      ]);
      return batch;
    },
    projectRoot
  });

  const batchDir = path.join(outDir, 'batches', 'batch_0001');
  const batchFile = path.join(batchDir, 'comment-dom-batch.json');
  const stateFile = path.join(outDir, 'capture-state.json');

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.outDir, outDir);
  assert.equal(result.structuredContent.batchDir, batchDir);
  assert.equal(result.structuredContent.batchFile, batchFile);
  assert.equal(result.structuredContent.stateFile, stateFile);
  assert.equal(result.structuredContent.batchId, 'batch_0001');
  assert.equal(result.structuredContent.nextBatchId, 'batch_0002');
  assert.equal(result.structuredContent.candidateCount, 1);
  assert.equal(result.structuredContent.hasMore, false);
  assert.equal(result.structuredContent.closedPage, true);
  assert.equal(fs.existsSync(batchFile), true);
  assert.equal(fs.existsSync(stateFile), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(batchFile, 'utf8')), batch);

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.task_id, 'task_0001');
  assert.equal(state.last_batch_id, 'batch_0001');
  assert.equal(state.next_batch_id, 'batch_0002');
  assert.deepEqual(state.seen_candidate_hashes, ['hash-1']);
  assert.deepEqual(calls, [
    ['connect', 30000],
    ['capture', 'task_0001', 'batch_0001', 2, 1000, true, 0.75, 0],
    ['pageClose', false],
    ['sessionClose']
  ]);
});

test('capture_comment_candidate_batches_until_idle is exposed with loop controls', () => {
  const tools = require(toolsPath);
  const listed = tools.listTools();
  const captureTool = listed.find(tool => tool.name === 'capture_comment_candidate_batches_until_idle');

  assert.ok(captureTool);
  assert.equal(captureTool.inputSchema.properties.maxBatches.type, 'number');
  assert.equal(captureTool.inputSchema.properties.maxIdleBatches.type, 'number');
  assert.equal(captureTool.inputSchema.properties.closePageAfter.type, 'boolean');
});

test('expand_and_capture_comment_batches is exposed as the main coverage workflow', () => {
  const tools = require(toolsPath);
  const listed = tools.listTools();
  const captureTool = listed.find(tool => tool.name === 'expand_and_capture_comment_batches');

  assert.ok(captureTool);
  assert.equal(captureTool.inputSchema.properties.outDir.type, 'string');
  assert.equal(captureTool.inputSchema.properties.taskId.type, 'string');
  assert.equal(captureTool.inputSchema.properties.maxRounds.type, 'number');
  assert.equal(captureTool.inputSchema.properties.maxBatches.type, 'number');
  assert.equal(captureTool.inputSchema.properties.maxIdleRounds.type, 'number');
  assert.equal(captureTool.inputSchema.properties.maxClicksPerRound.type, 'number');
  assert.equal(captureTool.inputSchema.properties.expandWaitMsMin.type, 'number');
  assert.equal(captureTool.inputSchema.properties.scrollWaitMsMax.type, 'number');
  assert.equal(captureTool.inputSchema.properties.scrollStepRatioMin.type, 'number');
  assert.equal(captureTool.inputSchema.properties.closePageAfter.type, 'boolean');
});

test('expand_and_capture_comment_batches captures before scrolling and stops on idle', async () => {
  const tools = require(toolsPath);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const outDir = path.join(projectRoot, 'output', 'task_0001');
  const calls = [];
  const page = {
    url: () => 'https://www.douyin.com/video/123',
    close: async options => calls.push(['pageClose', options.runBeforeUnload])
  };
  const batchesByRound = [
    {
      schema_version: 'comment-dom-batch-v1',
      batch_id: 'batch_0001',
      task_id: 'task_0001',
      platform: 'douyin',
      source_url: 'https://www.douyin.com/video/123',
      captured_at: '2026-07-08T06:00:00.000Z',
      scroll: {},
      state: { new_candidate_count: 1, seen_candidate_count: 1, has_more: false, stop_reason: '' },
      limits: {},
      candidates: [{ candidate_id: 'candidate_000001', candidate_hash: 'hash-1' }]
    },
    {
      schema_version: 'comment-dom-batch-v1',
      batch_id: 'batch_0002',
      task_id: 'task_0001',
      platform: 'douyin',
      source_url: 'https://www.douyin.com/video/123',
      captured_at: '2026-07-08T06:00:01.000Z',
      scroll: {},
      state: { new_candidate_count: 1, seen_candidate_count: 2, has_more: false, stop_reason: '' },
      limits: {},
      candidates: [{ candidate_id: 'candidate_000001', candidate_hash: 'hash-2' }]
    },
    {
      schema_version: 'comment-dom-batch-v1',
      batch_id: 'batch_0003',
      task_id: 'task_0001',
      platform: 'douyin',
      source_url: 'https://www.douyin.com/video/123',
      captured_at: '2026-07-08T06:00:02.000Z',
      scroll: {},
      state: { new_candidate_count: 0, seen_candidate_count: 2, has_more: false, stop_reason: '' },
      limits: {},
      candidates: []
    },
    {
      schema_version: 'comment-dom-batch-v1',
      batch_id: 'batch_0003',
      task_id: 'task_0001',
      platform: 'douyin',
      source_url: 'https://www.douyin.com/video/123',
      captured_at: '2026-07-08T06:00:03.000Z',
      scroll: {},
      state: { new_candidate_count: 0, seen_candidate_count: 2, has_more: false, stop_reason: '' },
      limits: {},
      candidates: []
    }
  ];
  let round = 0;

  const result = await tools.callTool('expand_and_capture_comment_batches', {
    outDir,
    taskId: 'task_0001',
    maxRounds: 10,
    maxBatches: 5,
    maxIdleRounds: 2,
    maxClicksPerRound: 3,
    maxCandidates: 2,
    maxCharsPerCandidate: 1000,
    expandWaitMsMin: 1,
    expandWaitMsMax: 1,
    scrollWaitMsMin: 1,
    scrollWaitMsMax: 1,
    scrollStepRatioMin: 0.55,
    scrollStepRatioMax: 0.55,
    closePageAfter: true
  }, {
    connectToCdp: async () => ({
      page,
      close: async () => calls.push(['sessionClose'])
    }),
    expandVisibleCommentsOnce: async (_page, options) => {
      calls.push(['expand', options.maxClicksPerRound]);
      return { clicked: round === 0 ? 1 : 0, errors: 0 };
    },
    captureCommentCandidateBatch: async (_page, options) => {
      calls.push(['capture', options.batchId, options.scrollAfterCapture, options.seenCandidateHashes.length]);
      return Object.assign({}, batchesByRound[round], { batch_id: options.batchId });
    },
    scrollCommentContainer: async (_page, options) => {
      calls.push(['scroll', options.scrollStepRatio]);
      round += 1;
      return { before: round * 100, after: round * 100 + 50, changed: round <= 2, atBottom: round > 2 };
    },
    sleep: async ms => calls.push(['sleep', ms]),
    projectRoot
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.stopReason, 'idle');
  assert.equal(result.structuredContent.roundCount, 4);
  assert.equal(result.structuredContent.batchCount, 2);
  assert.equal(result.structuredContent.candidateCount, 2);
  assert.equal(result.structuredContent.totalClicks, 1);
  assert.equal(result.structuredContent.idleRounds, 2);
  assert.equal(result.structuredContent.lastBatchId, 'batch_0002');
  assert.equal(result.structuredContent.nextBatchId, 'batch_0003');
  assert.equal(result.structuredContent.closedPage, true);
  assert.equal(fs.existsSync(path.join(outDir, 'batches', 'batch_0001', 'comment-dom-batch.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'batches', 'batch_0002', 'comment-dom-batch.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'batches', 'batch_0003', 'comment-dom-batch.json')), false);

  const state = JSON.parse(fs.readFileSync(path.join(outDir, 'capture-state.json'), 'utf8'));
  assert.equal(state.round, 4);
  assert.equal(state.total_clicks, 1);
  assert.equal(state.total_candidates, 2);
  assert.equal(state.idle_rounds, 2);
  assert.equal(state.stop_reason, 'idle');
  assert.deepEqual(state.seen_candidate_hashes, ['hash-1', 'hash-2']);
  assert.deepEqual(calls.slice(0, 8), [
    ['expand', 3],
    ['sleep', 1],
    ['capture', 'batch_0001', false, 0],
    ['scroll', 0.55],
    ['sleep', 1],
    ['expand', 3],
    ['sleep', 1],
    ['capture', 'batch_0002', false, 1]
  ]);
  assert.deepEqual(calls.slice(-2), [
    ['pageClose', false],
    ['sessionClose']
  ]);
});

test('capture_comment_candidate_batches_until_idle writes batches until consecutive empty batches', async () => {
  const tools = require(toolsPath);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-mcp-project-'));
  const outDir = path.join(projectRoot, 'output', 'task_0001');
  const calls = [];
  const page = {
    url: () => 'https://www.douyin.com/video/123',
    close: async options => calls.push(['pageClose', options.runBeforeUnload])
  };
  const batchesById = {
    batch_0001: {
      schema_version: 'comment-dom-batch-v1',
      batch_id: 'batch_0001',
      task_id: 'task_0001',
      platform: 'douyin',
      source_url: 'https://www.douyin.com/video/123',
      captured_at: '2026-07-08T05:00:00.000Z',
      scroll: {},
      state: { new_candidate_count: 1, seen_candidate_count: 1, has_more: false, stop_reason: '' },
      limits: {},
      candidates: [{ candidate_id: 'candidate_000001', candidate_hash: 'hash-1' }]
    },
    batch_0002: {
      schema_version: 'comment-dom-batch-v1',
      batch_id: 'batch_0002',
      task_id: 'task_0001',
      platform: 'douyin',
      source_url: 'https://www.douyin.com/video/123',
      captured_at: '2026-07-08T05:00:01.000Z',
      scroll: {},
      state: { new_candidate_count: 0, seen_candidate_count: 1, has_more: false, stop_reason: '' },
      limits: {},
      candidates: []
    },
    batch_0003: {
      schema_version: 'comment-dom-batch-v1',
      batch_id: 'batch_0003',
      task_id: 'task_0001',
      platform: 'douyin',
      source_url: 'https://www.douyin.com/video/123',
      captured_at: '2026-07-08T05:00:02.000Z',
      scroll: {},
      state: { new_candidate_count: 0, seen_candidate_count: 1, has_more: false, stop_reason: '' },
      limits: {},
      candidates: []
    }
  };

  const result = await tools.callTool('capture_comment_candidate_batches_until_idle', {
    outDir,
    taskId: 'task_0001',
    maxBatches: 5,
    maxIdleBatches: 2,
    maxCandidates: 2,
    maxCharsPerCandidate: 1000,
    closePageAfter: true
  }, {
    connectToCdp: async () => ({
      page,
      close: async () => calls.push(['sessionClose'])
    }),
    captureCommentCandidateBatch: async (_page, options) => {
      calls.push(['capture', options.batchId, options.seenCandidateHashes.length]);
      return batchesById[options.batchId];
    },
    projectRoot
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.batchCount, 3);
  assert.equal(result.structuredContent.candidateCount, 1);
  assert.equal(result.structuredContent.stopReason, 'idle');
  assert.equal(result.structuredContent.lastBatchId, 'batch_0003');
  assert.equal(result.structuredContent.nextBatchId, 'batch_0004');
  assert.equal(result.structuredContent.closedPage, true);
  assert.equal(fs.existsSync(path.join(outDir, 'batches', 'batch_0001', 'comment-dom-batch.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'batches', 'batch_0002', 'comment-dom-batch.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'batches', 'batch_0003', 'comment-dom-batch.json')), true);

  const state = JSON.parse(fs.readFileSync(path.join(outDir, 'capture-state.json'), 'utf8'));
  assert.equal(state.last_batch_id, 'batch_0003');
  assert.equal(state.next_batch_id, 'batch_0004');
  assert.deepEqual(state.seen_candidate_hashes, ['hash-1']);
  assert.deepEqual(calls, [
    ['capture', 'batch_0001', 0],
    ['capture', 'batch_0002', 1],
    ['capture', 'batch_0003', 1],
    ['pageClose', false],
    ['sessionClose']
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
