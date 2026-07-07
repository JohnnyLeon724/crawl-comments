(function initCommentExpander(global) {
  'use strict';

  const DEFAULT_CONFIG = {
    maxRuntimeMs: 10 * 60 * 1000,
    maxClicks: 3000,
    maxRounds: 1000,
    maxIdleRounds: 8,
    batchSize: 8,
    clickGapMs: 120,
    clickSettleMs: 80,
    afterBatchWaitMs: 800,
    scrollWaitMs: 900,
    scrollStepRatio: 0.85,
    minScrollStepPx: 360,
    maxRetryPerButton: 3,
    maxButtonTextLength: 24,
    minCommentTextLength: 2,
    maxCommentTextLength: 500,
    extractComments: true,
    logEveryRound: true
  };

  const EXPAND_TEXT_PATTERNS = [
    /^展开更多(?:回复|评论)?$/,
    /^展开(?:全部)?\d+条?回复$/,
    /^展开\d+回复$/,
    /^查看(?:全部|更多)?\d+条?回复$/,
    /^查看(?:全部|更多)?回复$/,
    /^查看更多回复$/,
    /^更多回复$/
  ];

  const REJECT_TEXT_PATTERNS = [
    /展开全文/,
    /收起/,
    /商品/,
    /详情/
  ];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const mergeConfig = config => Object.assign({}, DEFAULT_CONFIG, config || {});

  const nowIso = () => new Date().toISOString();

  const normalizeText = value => {
    const raw = typeof value === 'string'
      ? value
      : value && typeof value.textContent === 'string'
        ? value.textContent
        : '';

    return String(raw).replace(/\s+/g, '').trim();
  };

  const normalizeReadableText = value => {
    const raw = typeof value === 'string'
      ? value
      : value && typeof value.textContent === 'string'
        ? value.textContent
        : '';

    return String(raw).replace(/\s+/g, ' ').trim();
  };

  const isExpandText = value => {
    const text = normalizeText(value);

    if (!text || text.length > DEFAULT_CONFIG.maxButtonTextLength) return false;
    if (REJECT_TEXT_PATTERNS.some(pattern => pattern.test(text))) return false;

    return EXPAND_TEXT_PATTERNS.some(pattern => pattern.test(text));
  };

  const isElementVisible = el => {
    if (!el) return false;
    if (el.disabled) return false;
    if (String(el.getAttribute && el.getAttribute('aria-disabled')) === 'true') return false;

    let rect = null;
    if (typeof el.getBoundingClientRect === 'function') {
      rect = el.getBoundingClientRect();
    }

    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) {
      return false;
    }

    if (el.offsetParent === null && (!rect || (rect.width === 0 && rect.height === 0))) {
      return false;
    }

    if (rect && (rect.width <= 0 || rect.height <= 0)) {
      return false;
    }

    const ownerWindow = el.ownerDocument && el.ownerDocument.defaultView;
    if (ownerWindow && typeof ownerWindow.getComputedStyle === 'function') {
      const style = ownerWindow.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.pointerEvents === 'none' ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
    }

    return true;
  };

  const getDomPath = (el, maxDepth = 8) => {
    const parts = [];
    let current = el;

    while (current && current.nodeType === 1 && parts.length < maxDepth) {
      let index = 1;
      let prev = current.previousElementSibling;

      while (prev) {
        if (prev.tagName === current.tagName) index++;
        prev = prev.previousElementSibling;
      }

      parts.unshift(`${current.tagName}:nth-of-type(${index})`);
      current = current.parentElement;
    }

    return parts.join('>');
  };

  const getButtonKey = el => `${getDomPath(el)}::${normalizeText(el)}`;

  const stripCommentUiText = value => {
    let text = normalizeReadableText(value);

    text = text
      .replace(/\s*(?:展开更多(?:回复|评论)?|展开(?:全部)?\d+\s*条?回复|展开\d+\s*回复)\s*/g, ' ')
      .replace(/\s*(?:查看(?:全部|更多)?\d+\s*条?回复|查看(?:全部|更多)?回复|查看更多回复|更多回复)\s*/g, ' ')
      .replace(/\s*(?:回复|点赞|赞|分享|收藏|举报|评论)(?:\s*\d+)?\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return text;
  };

  const isActionOnlyText = text => {
    const compact = normalizeText(text);
    if (!compact) return true;
    if (isExpandText(compact)) return true;

    return /^(回复|点赞|赞|分享|收藏|举报|评论|\d+)$/.test(compact);
  };

  const getElementMarker = el => {
    if (!el) return '';

    return [
      el.id || '',
      el.className || '',
      el.getAttribute && el.getAttribute('data-e2e') || '',
      el.getAttribute && el.getAttribute('data-testid') || '',
      el.getAttribute && el.getAttribute('aria-label') || ''
    ].join(' ').toLowerCase();
  };

  const isLikelyCommentElement = (el, userConfig = {}) => {
    const config = mergeConfig(userConfig);
    if (!el || el.nodeType !== 1) return false;
    if (/^(SCRIPT|STYLE|NOSCRIPT|BUTTON|A|SVG|PATH|IMG|VIDEO|CANVAS)$/.test(el.tagName)) return false;
    if (!isElementVisible(el)) return false;

    const text = stripCommentUiText(el);
    if (text.length < config.minCommentTextLength || text.length > config.maxCommentTextLength) return false;
    if (isActionOnlyText(text)) return false;

    const marker = getElementMarker(el);
    const hasCommentMarker = /comment|reply|评论|回复/.test(marker);
    const hasReadablePunctuation = /[：:，,。.!！？?]/.test(text);

    return hasCommentMarker || hasReadablePunctuation;
  };

  const inferRowType = el => {
    const marker = getElementMarker(el);
    const text = normalizeReadableText(el);

    if (/reply|回复/.test(marker) || /^↳/.test(text)) {
      return 'level2';
    }

    return 'level1';
  };

  const getCommentKey = text => normalizeText(text).slice(0, 240);

  const extractVisibleComments = (root, userConfig = {}) => {
    const config = mergeConfig(userConfig);
    const doc = root && root.body ? root : null;
    const source = doc || root;
    const elements = [];
    const seenElements = new Set();

    const addElement = el => {
      if (!el || seenElements.has(el)) return;
      seenElements.add(el);
      elements.push(el);
    };

    if (source && typeof source.querySelectorAll === 'function') {
      const selector = [
        '[data-e2e*="comment"]',
        '[data-e2e*="reply"]',
        '[data-testid*="comment"]',
        '[data-testid*="reply"]',
        '[class*="comment"]',
        '[class*="reply"]',
        '[class*="Comment"]',
        '[class*="Reply"]',
        '[class*="评论"]',
        '[class*="回复"]',
        'article',
        'li',
        'div',
        'p',
        'span'
      ].join(',');

      try {
        Array.from(source.querySelectorAll(selector)).forEach(addElement);
      } catch (_error) {
        try {
          Array.from(source.querySelectorAll('*')).forEach(addElement);
        } catch (_innerError) {
          // Keep the roots already collected.
        }
      }
    }

    const seenText = new Set();
    const comments = [];

    for (const el of elements) {
      if (!isLikelyCommentElement(el, config)) continue;

      const text = stripCommentUiText(el);
      const key = getCommentKey(text);
      if (!key || seenText.has(key)) continue;
      seenText.add(key);

      comments.push({
        row_type: inferRowType(el),
        text,
        dom_path: getDomPath(el),
        captured_at: nowIso()
      });
    }

    return comments;
  };

  const mergeExtractedComments = (targetMap, comments) => {
    let added = 0;

    for (const item of comments) {
      const key = getCommentKey(item.text);
      if (!key || targetMap.has(key)) continue;
      targetMap.set(key, item);
      added += 1;
    }

    return added;
  };

  const escapeCsvCell = value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;

  const formatResultsAsCsv = comments => {
    const columns = ['row_type', 'text', 'dom_path', 'captured_at'];
    const rows = [columns.join(',')];

    for (const item of comments) {
      rows.push(columns.map(column => escapeCsvCell(item[column])).join(','));
    }

    return `\ufeff${rows.join('\n')}`;
  };

  const formatResultsAsJson = comments => JSON.stringify(comments, null, 2);

  const hasMatchingDescendant = el => {
    if (!el || typeof el.querySelectorAll !== 'function') return false;

    try {
      return Array.from(el.querySelectorAll('*')).some(child => {
        const text = normalizeText(child);
        return text.length <= DEFAULT_CONFIG.maxButtonTextLength && isExpandText(text) && isElementVisible(child);
      });
    } catch (_error) {
      return false;
    }
  };

  const selectExpandCandidates = (root, attempts = new Map(), userConfig = {}) => {
    const config = mergeConfig(userConfig);
    const elements = Array.from(root.querySelectorAll('button,[role="button"],a,span,div'));
    const seenKeys = new Set();
    const candidates = [];

    for (const el of elements) {
      const text = normalizeText(el);
      if (text.length > config.maxButtonTextLength) continue;
      if (!isExpandText(text)) continue;
      if (hasMatchingDescendant(el)) continue;
      if (!isElementVisible(el)) continue;

      const key = getButtonKey(el);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      if ((attempts.get(key) || 0) >= config.maxRetryPerButton) continue;

      candidates.push(el);
      if (candidates.length >= config.batchSize) break;
    }

    return candidates;
  };

  const scoreScrollContainer = el => {
    if (!el || !isElementVisible(el)) return 0;

    const scrollHeight = Number(el.scrollHeight) || 0;
    const clientHeight = Number(el.clientHeight) || 0;
    const overflow = scrollHeight - clientHeight;

    if (overflow <= 40 || clientHeight < 120) return 0;

    const marker = `${el.id || ''} ${el.className || ''}`.toLowerCase();
    let score = overflow;

    if (/comment|reply|评论|回复/.test(marker)) score += 1000;
    if (/list|panel|content|container|drawer|modal/.test(marker)) score += 150;
    if (clientHeight >= 240) score += 100;

    if (typeof el.querySelectorAll === 'function') {
      try {
        const hasExpandButton = Array.from(el.querySelectorAll('button,[role="button"],a,span,div'))
          .some(child => {
            const text = normalizeText(child);
            return text.length <= DEFAULT_CONFIG.maxButtonTextLength && isExpandText(text);
          });

        if (hasExpandButton) score += 500;
      } catch (_error) {
        // Ignore live DOM query failures and keep the base score.
      }
    }

    return score;
  };

  const findScrollTarget = doc => {
    const fallback = doc.scrollingElement || doc.documentElement || doc.body;
    let best = fallback;
    let bestScore = scoreScrollContainer(fallback);

    const selectors = [
      '[class*="comment"]',
      '[class*="reply"]',
      '[class*="Comment"]',
      '[class*="Reply"]',
      'section',
      'main',
      'aside',
      'div',
      'ul',
      'ol'
    ].join(',');

    const elements = Array.from(doc.querySelectorAll(selectors));

    for (const el of elements) {
      const score = scoreScrollContainer(el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }

    return best || fallback;
  };

  const getScrollTop = (target, win) => {
    if (!target) return 0;
    if (target === win.document.body || target === win.document.documentElement || target === win.document.scrollingElement) {
      return win.scrollY || target.scrollTop || 0;
    }

    return target.scrollTop || 0;
  };

  const scrollForward = (target, win, userConfig = {}) => {
    const config = mergeConfig(userConfig);
    const before = getScrollTop(target, win);
    const clientHeight = Number(target && target.clientHeight) || Number(win.innerHeight) || 800;
    const step = Math.max(Math.floor(clientHeight * config.scrollStepRatio), config.minScrollStepPx);

    if (
      target === win.document.body ||
      target === win.document.documentElement ||
      target === win.document.scrollingElement
    ) {
      win.scrollBy({ top: step, left: 0, behavior: 'auto' });
    } else {
      const maxScrollTop = Math.max(0, (Number(target.scrollHeight) || 0) - clientHeight);
      target.scrollTop = Math.min(maxScrollTop, before + step);

      try {
        target.dispatchEvent(new Event('scroll', { bubbles: true }));
      } catch (_error) {
        // Some synthetic environments do not allow constructing Event.
      }

      if (typeof win.WheelEvent === 'function') {
        try {
          target.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: step,
            clientX: 1,
            clientY: Math.max(1, Math.floor(clientHeight / 2))
          }));
        } catch (_error) {
          // WheelEvent is a best-effort nudge for virtualized lists.
        }
      }
    }

    const after = getScrollTop(target, win);
    return {
      before,
      after,
      changed: after !== before
    };
  };

  const createMutationCounter = doc => {
    let count = 0;
    let observer = null;

    if (typeof MutationObserver !== 'undefined' && (doc.body || doc.documentElement)) {
      observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          count += mutation.addedNodes.length + mutation.removedNodes.length;
        }
      });

      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true
      });
    }

    return {
      get count() {
        return count;
      },
      disconnect() {
        if (observer) observer.disconnect();
      }
    };
  };

  const fireMouse = (win, target, type, x, y) => {
    if (typeof win.MouseEvent !== 'function') return;

    target.dispatchEvent(new win.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: win,
      clientX: x,
      clientY: y,
      buttons: type === 'mousedown' ? 1 : 0
    }));
  };

  const firePointer = (win, target, type, x, y) => {
    if (typeof win.PointerEvent !== 'function') return;

    target.dispatchEvent(new win.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons: type === 'pointerdown' ? 1 : 0
    }));
  };

  const clickLikeUser = async (el, win, userConfig = {}) => {
    const config = mergeConfig(userConfig);
    const doc = win.document;

    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await sleep(40);
    }

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = typeof doc.elementFromPoint === 'function'
      ? doc.elementFromPoint(x, y) || el
      : el;

    firePointer(win, target, 'pointerdown', x, y);
    fireMouse(win, target, 'mousedown', x, y);

    await sleep(config.clickSettleMs);

    firePointer(win, target, 'pointerup', x, y);
    fireMouse(win, target, 'mouseup', x, y);
    fireMouse(win, target, 'click', x, y);

    if (typeof el.click === 'function') {
      el.click();
    }
  };

  const shouldStop = (state, userConfig = {}) => {
    return getStopReason(state, userConfig) !== '';
  };

  const getStopReason = (state, userConfig = {}) => {
    const config = mergeConfig(userConfig);

    if (state.idleRounds >= config.maxIdleRounds) return 'idle';
    if (state.round >= config.maxRounds) return 'max-rounds';
    if (state.totalClicks >= config.maxClicks) return 'max-clicks';
    if (state.elapsedMs >= config.maxRuntimeMs) return 'max-runtime';

    return '';
  };

  const isMeaningfulProgress = info => {
    return (
      info.clickedThisRound > 0 ||
      info.addedComments > 0 ||
      Boolean(info.scrollResult && info.scrollResult.changed)
    );
  };

  const createRunner = (win, userConfig = {}) => {
    const config = mergeConfig(userConfig);
    const doc = win.document;
    const attempts = new Map();
    const resultsByKey = new Map();
    const mutationCounter = createMutationCounter(doc);
    const startedAt = Date.now();
    const state = {
      round: 0,
      totalClicks: 0,
      totalComments: 0,
      totalErrors: 0,
      idleRounds: 0,
      elapsedMs: 0,
      stopped: false,
      stopReason: ''
    };

    const log = (...args) => console.log('[comment-expander-v1]', ...args);
    const warn = (...args) => console.warn('[comment-expander-v1]', ...args);

    const stop = reason => {
      state.stopped = true;
      state.stopReason = reason || 'manual';
    };

    const captureVisibleComments = () => {
      if (!config.extractComments) return 0;

      const added = mergeExtractedComments(resultsByKey, extractVisibleComments(doc, config));
      state.totalComments = resultsByKey.size;
      return added;
    };

    const getResults = () => Array.from(resultsByKey.values());

    const getPayload = () => ({
      state: Object.assign({}, state),
      config: Object.assign({}, config),
      results: getResults()
    });

    const downloadText = (filename, text, type) => {
      if (typeof win.Blob !== 'function' || !doc.createElement || !doc.body) {
        throw new Error('当前浏览器环境不支持自动下载，请改用 getPayload() 或 getResults()。');
      }

      const blob = new win.Blob([text], { type });
      const url = win.URL.createObjectURL(blob);
      const link = doc.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      doc.body.appendChild(link);
      link.click();
      link.remove();
      win.URL.revokeObjectURL(url);
    };

    const downloadJson = (filename = `comments-${Date.now()}.json`) => {
      downloadText(filename, formatResultsAsJson(getResults()), 'application/json;charset=utf-8');
    };

    const downloadCsv = (filename = `comments-${Date.now()}.csv`) => {
      downloadText(filename, formatResultsAsCsv(getResults()), 'text/csv;charset=utf-8');
    };

    const start = async () => {
      log('开始展开评论。手动停止：window.__commentExpanderV1.stop()');
      captureVisibleComments();

      while (!state.stopped) {
        state.elapsedMs = Date.now() - startedAt;
        const stopReason = getStopReason(state, config);
        if (stopReason) {
          state.stopReason = state.stopReason || stopReason;
          break;
        }

        state.round += 1;

        const beforeMutationCount = mutationCounter.count;
        const candidates = selectExpandCandidates(doc, attempts, config);
        let clickedThisRound = 0;

        for (const el of candidates) {
          if (state.totalClicks >= config.maxClicks || state.stopped) break;

          const key = getButtonKey(el);
          attempts.set(key, (attempts.get(key) || 0) + 1);

          try {
            await clickLikeUser(el, win, config);
            clickedThisRound += 1;
            state.totalClicks += 1;
          } catch (error) {
            state.totalErrors += 1;
            warn('点击失败，跳过这个展开按钮：', normalizeText(el), error);
          }

          await sleep(config.clickGapMs);
        }

        if (clickedThisRound > 0) {
          await sleep(config.afterBatchWaitMs);
        }

        const scrollTarget = findScrollTarget(doc);
        const scrollResult = scrollForward(scrollTarget, win, config);

        await sleep(config.scrollWaitMs);

        const mutationDelta = mutationCounter.count - beforeMutationCount;
        const addedComments = captureVisibleComments();
        const progressed = isMeaningfulProgress({
          clickedThisRound,
          mutationDelta,
          scrollResult,
          addedComments
        });

        state.idleRounds = progressed ? 0 : state.idleRounds + 1;
        state.elapsedMs = Date.now() - startedAt;

        if (config.logEveryRound || clickedThisRound > 0 || state.idleRounds > 0) {
          log(
            `轮次 ${state.round}`,
            `本轮点击 ${clickedThisRound}`,
            `总点击 ${state.totalClicks}`,
            `新增评论 ${addedComments}`,
            `候选评论 ${state.totalComments}`,
            `DOM变化 ${mutationDelta}`,
            `滚动 ${scrollResult.before}->${scrollResult.after}`,
            `空转 ${state.idleRounds}/${config.maxIdleRounds}`
          );
        }
      }

      mutationCounter.disconnect();

      log(
        `结束：${state.stopReason || 'complete'}`,
        `总点击 ${state.totalClicks}`,
        `候选评论 ${state.totalComments}`,
        `轮次 ${state.round}`,
        `错误 ${state.totalErrors}`,
        `耗时 ${Math.round(state.elapsedMs / 1000)}s`
      );

      return Object.assign({}, state);
    };

    return {
      config,
      start,
      stop,
      getState: () => Object.assign({}, state),
      getResults,
      getPayload,
      downloadJson,
      downloadCsv
    };
  };

  const api = {
    DEFAULT_CONFIG,
    normalizeText,
    isExpandText,
    isElementVisible,
    getDomPath,
    getButtonKey,
    stripCommentUiText,
    isLikelyCommentElement,
    extractVisibleComments,
    formatResultsAsCsv,
    formatResultsAsJson,
    selectExpandCandidates,
    scoreScrollContainer,
    findScrollTarget,
    scrollForward,
    shouldStop,
    getStopReason,
    isMeaningfulProgress,
    createRunner
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }

  if (!global || !global.document) {
    return;
  }

  if (global.__commentExpanderV1 && typeof global.__commentExpanderV1.stop === 'function') {
    global.__commentExpanderV1.stop('replaced');
  }

  const runner = createRunner(global, global.__COMMENT_EXPANDER_CONFIG__ || {});

  global.__commentExpanderV1 = Object.assign({}, api, runner);
  runner.start().catch(error => {
    console.error('[comment-expander-v1] 运行失败：', error);
  });
})(typeof window !== 'undefined' ? window : globalThis);
