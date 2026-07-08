'use strict';

const path = require('node:path');

const MCP_VERSION = 'mcp-v1';
const STATUS_TOOL_NAME = 'get_comment_crawler_status';

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

async function callTool(name, args = {}, context = {}) {
  if (name === STATUS_TOOL_NAME) {
    return buildToolResult(getCommentCrawlerStatus({
      projectRoot: args.projectRoot || context.projectRoot
    }));
  }

  throw new Error(`Unknown tool: ${name}`);
}

module.exports = {
  MCP_VERSION,
  STATUS_TOOL_NAME,
  getCommentCrawlerStatus,
  listTools,
  buildToolResult,
  callTool
};
