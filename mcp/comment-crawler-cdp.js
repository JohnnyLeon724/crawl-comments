'use strict';

const runner = require('../script/crawl-comments-playwright.js');

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

async function connectToCdp(options = {}) {
  const playwright = options.playwright || runner.loadPlaywright();
  const endpoint = options.cdpEndpoint || DEFAULT_CDP_ENDPOINT;
  const timeout = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : DEFAULT_CDP_TIMEOUT_MS;
  const browser = await playwright.chromium.connectOverCDP(endpoint, { timeout });
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
  connectToCdp
};
