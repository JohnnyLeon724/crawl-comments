#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const path = require('node:path');

const tools = require('./comment-crawler-tools.js');

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = {
  name: 'comment-crawler-mcp',
  title: 'Comment Crawler MCP',
  version: '0.1.0'
};

function success(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

function failure(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;

  return {
    jsonrpc: '2.0',
    id,
    error
  };
}

function getRequestId(message) {
  return message && Object.prototype.hasOwnProperty.call(message, 'id')
    ? message.id
    : null;
}

async function handleJsonRpcMessage(message, context = {}) {
  const id = getRequestId(message);

  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return failure(id, -32600, 'Invalid Request');
  }

  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    return null;
  }

  try {
    if (message.method === 'initialize') {
      return success(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: SERVER_INFO,
        instructions: 'Use tools to run the local comment crawler workflow from the current project.'
      });
    }

    if (message.method === 'ping') {
      return success(id, {});
    }

    if (message.method === 'tools/list') {
      return success(id, {
        tools: tools.listTools()
      });
    }

    if (message.method === 'tools/call') {
      const params = message.params || {};
      const result = await tools.callTool(params.name, params.arguments || {}, context);
      return success(id, result);
    }

    return failure(id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    if (/^Unknown tool:/.test(error.message)) {
      return failure(id, -32602, error.message);
    }

    return failure(id, -32603, error.message);
  }
}

function parseJsonLine(line) {
  try {
    return {
      ok: true,
      value: JSON.parse(line)
    };
  } catch (error) {
    return {
      ok: false,
      error
    };
  }
}

function startStdioServer(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const errorOutput = options.errorOutput || process.stderr;
  const context = Object.assign({
    projectRoot: path.resolve(__dirname, '..')
  }, options.context || {});
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  rl.on('line', async line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parsed = parseJsonLine(trimmed);
    let response;

    if (!parsed.ok) {
      response = failure(null, -32700, 'Parse error');
    } else {
      response = await handleJsonRpcMessage(parsed.value, context);
    }

    if (response) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  });

  rl.on('error', error => {
    errorOutput.write(`[comment-crawler-mcp] ${error.message}\n`);
  });

  return rl;
}

if (require.main === module) {
  startStdioServer();
}

module.exports = {
  PROTOCOL_VERSION,
  SERVER_INFO,
  success,
  failure,
  handleJsonRpcMessage,
  parseJsonLine,
  startStdioServer
};
