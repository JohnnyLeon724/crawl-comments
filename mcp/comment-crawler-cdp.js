'use strict';

const fs = require('node:fs');

const runner = require('../src/browser/crawl-comments-playwright.js');

const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
const DEFAULT_CDP_TIMEOUT_MS = 30000;

function safePageUrl(page) {
  try {
    return typeof page.url === 'function' ? String(page.url() || '') : '';
  } catch (_error) {
    return '';
  }
}

function getAllPages(browser) {
  const contexts = browser && typeof browser.contexts === 'function'
    ? browser.contexts()
    : [];
  const pages = [];

  for (const context of contexts) {
    if (!context || typeof context.pages !== 'function') continue;
    pages.push(...context.pages());
  }

  return {
    contexts,
    pages
  };
}

function isHttpPage(page) {
  return /^https?:\/\//i.test(safePageUrl(page));
}

async function selectCurrentPage(browser) {
  const { contexts, pages } = getAllPages(browser);
  const httpPages = pages.filter(isHttpPage);

  if (httpPages.length) {
    return httpPages[httpPages.length - 1];
  }

  if (pages.length) {
    return pages[pages.length - 1];
  }

  const firstContext = contexts[0];
  if (firstContext && typeof firstContext.newPage === 'function') {
    return firstContext.newPage();
  }

  throw new Error('CDP browser has no available pages');
}

async function readPageSnapshot(page) {
  const title = page && typeof page.title === 'function'
    ? await page.title()
    : '';
  const text = page && typeof page.evaluate === 'function'
    ? await page.evaluate(() => document.body?.innerText || '')
    : '';

  return {
    url: safePageUrl(page),
    title: String(title || ''),
    text: String(text || '')
  };
}

function isContextManagementUnsupportedError(error) {
  const message = error && error.message ? error.message : String(error || '');
  return /Browser\.setDownloadBehavior/.test(message)
    && /Browser context management is not supported/.test(message);
}

function normalizeHttpEndpoint(endpoint) {
  const raw = String(endpoint || DEFAULT_CDP_ENDPOINT);
  const url = new URL(raw);

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/';
    url.search = '';
    url.hash = '';
  }

  return url.toString().replace(/\/$/, '');
}

async function fetchJson(url, timeoutMs = DEFAULT_CDP_TIMEOUT_MS) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`CDP HTTP ${response.status}: ${url}`);
  }

  return response.json();
}

async function listRawCdpTargets(endpoint, timeoutMs = DEFAULT_CDP_TIMEOUT_MS) {
  const base = normalizeHttpEndpoint(endpoint);
  return fetchJson(`${base}/json/list`, timeoutMs);
}

function selectRawCdpTarget(targets) {
  const pages = Array.isArray(targets)
    ? targets.filter(target => target && target.type === 'page' && target.webSocketDebuggerUrl)
    : [];
  const httpPages = pages.filter(target => /^https?:\/\//i.test(String(target.url || '')));

  if (httpPages.length) return httpPages[httpPages.length - 1];
  if (pages.length) return pages[pages.length - 1];
  throw new Error('CDP raw fallback found no page targets');
}

class RawCdpClient {
  constructor(wsUrl, timeoutMs = DEFAULT_CDP_TIMEOUT_MS) {
    this.wsUrl = wsUrl;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    if (typeof WebSocket !== 'function') {
      throw new Error('当前 Node.js 运行时不支持 WebSocket，无法启用 raw CDP fallback');
    }

    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`连接 raw CDP websocket 超时：${this.wsUrl}`)), this.timeoutMs);

      this.ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', event => {
        clearTimeout(timeout);
        reject(new Error(`连接 raw CDP websocket 失败：${event.message || this.wsUrl}`));
      }, { once: true });
    });

    this.ws.addEventListener('message', event => {
      this.handleMessage(event.data);
    });
    this.ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('raw CDP websocket 已关闭'));
      }
      this.pending.clear();
    });

    return this;
  }

  handleMessage(data) {
    let payload;
    try {
      payload = JSON.parse(String(data));
    } catch (_error) {
      return;
    }

    if (!payload || !payload.id || !this.pending.has(payload.id)) return;

    const pending = this.pending.get(payload.id);
    this.pending.delete(payload.id);
    clearTimeout(pending.timeout);

    if (payload.error) {
      pending.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      return;
    }

    pending.resolve(payload.result || {});
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`raw CDP command timeout: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

function remoteObjectToValue(remoteObject = {}) {
  if (Object.prototype.hasOwnProperty.call(remoteObject, 'value')) return remoteObject.value;
  if (Object.prototype.hasOwnProperty.call(remoteObject, 'unserializableValue')) {
    const value = remoteObject.unserializableValue;
    if (value === 'NaN') return NaN;
    if (value === 'Infinity') return Infinity;
    if (value === '-Infinity') return -Infinity;
  }
  return undefined;
}

function buildEvaluationExpression(pageFunction, arg) {
  if (typeof pageFunction === 'function') {
    return `(${pageFunction.toString()})(${JSON.stringify(arg)})`;
  }

  return String(pageFunction || '');
}

function createRawCdpPage(client, target) {
  const currentUrl = String(target.url || '');
  let mouseX = 0;
  let mouseY = 0;
  const page = {
    url: () => currentUrl
  };

  page.mouse = {
    move: async (x, y, options = {}) => {
      const targetX = Number(x);
      const targetY = Number(y);
      const steps = Number.isInteger(Number(options.steps)) && Number(options.steps) > 0
        ? Number(options.steps)
        : 1;
      const startX = mouseX;
      const startY = mouseY;

      for (let step = 1; step <= steps; step += 1) {
        const nextX = startX + ((targetX - startX) * step) / steps;
        const nextY = startY + ((targetY - startY) * step) / steps;
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: nextX,
          y: nextY,
          button: 'none'
        });
      }

      mouseX = targetX;
      mouseY = targetY;
    },
    down: async (options = {}) => {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: mouseX,
        y: mouseY,
        button: options.button || 'left',
        buttons: 1,
        clickCount: 1
      });
    },
    up: async (options = {}) => {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: mouseX,
        y: mouseY,
        button: options.button || 'left',
        buttons: 0,
        clickCount: 1
      });
    }
  };

  page.evaluate = async (pageFunction, arg) => {
    const expression = buildEvaluationExpression(pageFunction, arg);
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });

    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text || 'raw CDP Runtime.evaluate failed';
      throw new Error(text);
    }

    return remoteObjectToValue(result.result);
  };

  page.title = async () => {
    const value = await page.evaluate(() => document.title);
    return String(value || '');
  };

  page.waitForFunction = async (pageFunction, arg, options = {}) => {
    const timeoutMs = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : DEFAULT_CDP_TIMEOUT_MS;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const value = await page.evaluate(pageFunction, arg);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw new Error(`raw CDP waitForFunction timeout after ${timeoutMs}ms`);
  };

  page.screenshot = async (options = {}) => {
    if (!options.path) throw new Error('raw CDP screenshot 需要 path');
    await client.send('Page.enable');
    const result = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: Boolean(options.fullPage)
    });
    fs.writeFileSync(options.path, Buffer.from(result.data || '', 'base64'));
  };

  page.close = async () => {
    try {
      await client.send('Page.close');
    } catch (_error) {
      try {
        await client.send('Runtime.evaluate', { expression: 'window.close()', awaitPromise: true });
      } catch (__error) {
        // The websocket close below still releases our session even if the target refuses to close.
      }
    }
    await client.close();
  };

  return page;
}

async function rawCdpConnect(options = {}) {
  const endpoint = options.cdpEndpoint || DEFAULT_CDP_ENDPOINT;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : DEFAULT_CDP_TIMEOUT_MS;
  const targets = await listRawCdpTargets(endpoint, timeoutMs);
  const target = selectRawCdpTarget(targets);
  const client = await new RawCdpClient(target.webSocketDebuggerUrl, timeoutMs).connect();
  const page = createRawCdpPage(client, target);

  return {
    browser: null,
    page,
    cdpEndpoint: endpoint,
    rawCdp: true,
    close: async () => client.close()
  };
}

async function connectToCdp(options = {}) {
  const playwright = options.playwright || runner.loadPlaywright();
  const endpoint = options.cdpEndpoint || DEFAULT_CDP_ENDPOINT;
  const timeout = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : DEFAULT_CDP_TIMEOUT_MS;
  let browser;

  try {
    browser = await playwright.chromium.connectOverCDP(endpoint, { timeout });
  } catch (error) {
    if (!isContextManagementUnsupportedError(error)) throw error;
    const fallbackConnect = options.rawCdpConnect || rawCdpConnect;
    return fallbackConnect({
      cdpEndpoint: endpoint,
      timeoutMs: timeout
    });
  }

  const page = await selectCurrentPage(browser);

  return {
    browser,
    page,
    cdpEndpoint: endpoint,
    close: async () => runner.closeCdpBrowser(browser)
  };
}

module.exports = {
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_CDP_TIMEOUT_MS,
  safePageUrl,
  getAllPages,
  isHttpPage,
  selectCurrentPage,
  readPageSnapshot,
  isContextManagementUnsupportedError,
  normalizeHttpEndpoint,
  listRawCdpTargets,
  selectRawCdpTarget,
  RawCdpClient,
  createRawCdpPage,
  rawCdpConnect,
  connectToCdp
};
