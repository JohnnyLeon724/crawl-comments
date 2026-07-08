'use strict';

const path = require('node:path');

const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  'douyin.com',
  'xiaohongshu.com'
]);

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveOutputPath(projectRoot, targetPath = 'output') {
  const root = path.resolve(projectRoot || path.join(__dirname, '..'));
  const outputRoot = path.join(root, 'output');
  const resolved = path.isAbsolute(String(targetPath || ''))
    ? path.resolve(String(targetPath))
    : path.resolve(root, String(targetPath || 'output'));

  if (!isPathInside(outputRoot, resolved)) {
    throw new Error('MCP 输出路径必须位于项目 output 目录内');
  }

  return resolved;
}

function getUrlHost(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch (_error) {
    return '';
  }
}

function isAllowedPageUrl(url, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  const host = getUrlHost(url);
  if (!host) return false;

  return allowedHosts.some(allowedHost => {
    const normalized = String(allowedHost || '').toLowerCase();
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}

function assertAllowedPageUrl(url, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  if (!isAllowedPageUrl(url, allowedHosts)) {
    throw new Error(`暂不允许通过 MCP 处理这个页面：${url || '(empty url)'}`);
  }

  return true;
}

module.exports = {
  DEFAULT_ALLOWED_HOSTS,
  isPathInside,
  resolveOutputPath,
  getUrlHost,
  isAllowedPageUrl,
  assertAllowedPageUrl
};
