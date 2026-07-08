'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const toolsPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-tools.js');
const serverPath = path.join(__dirname, '..', 'mcp', 'comment-crawler-server.js');

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
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'get_comment_crawler_status');
  assert.equal(listed[0].inputSchema.type, 'object');

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
