# MCP Coordinate Click Expander Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add coordinate-based mouse clicking to `comment-crawler-v2.expand_and_capture_comment_batches`, with DOM-click fallback and bounded observability.

**Architecture:** Split expansion into target discovery and click execution. Target discovery runs inside the page and returns visible expand targets; click execution runs in MCP host code through `page.mouse` for Playwright sessions and the same `page.mouse` interface backed by raw CDP for fallback sessions. The existing expand/capture/scroll loop and output directory structure stay unchanged.

**Tech Stack:** Node.js MCP server, Playwright CDP pages, raw Chrome DevTools Protocol `Input.dispatchMouseEvent`, Node `node:test`, existing `comment-crawler-v2` JSON-RPC tool contracts.

## Global Constraints

- Keep `expand_and_capture_comment_batches` as the production tool name and default skill path.
- Default click mode is `coordinate`; fallback click mode is `dom-click`.
- Do not implement or describe techniques intended to bypass platform access controls.
- Stop with clear reasons for login wall, CAPTCHA, verification, page closed, unsupported browser control, or repeated click failures with no DOM changes.
- Preserve existing batch output paths, `capture-state.json`, resume behavior, and Excel pipeline compatibility.
- Use Chinese commit messages in `类型：内容` format.
- Run `node --test --test-reporter=dot test/*.test.js` after JS/MCP changes.

---

## File Structure

- Modify `mcp/comment-crawler-tools.js`
  - Add click profile normalization.
  - Add `findVisibleExpandTargets`.
  - Add DOM-click and coordinate-click executors.
  - Update `expandVisibleCommentsOnce`.
  - Wire click config into `expand_and_capture_comment_batches`.
  - Add click observability to tool result and `capture-state.json`.

- Modify `mcp/comment-crawler-cdp.js`
  - Add a raw-CDP-backed `page.mouse` compatibility object with `move`, `down`, and `up`.
  - Keep the raw page interface compatible with existing tests.

- Modify `test/comment-crawler-mcp.test.js`
  - Add tests for target matching, point generation, click mode behavior, fallback behavior, loop integration, and state fields.

- Modify `test/comment-crawler-mcp.test.js` or existing CDP tests in the same file
  - Add tests for raw CDP mouse event dispatch.

- Modify `.codex/skills/comment-excel-delivery/SKILL.md`
  - Mention that the production MCP path uses coordinate clicking with DOM-click fallback.

- Modify `.codex/skills/comment-excel-delivery/references/workflow.md`
  - Add optional `clickMode` parameters to the per-task MCP example.

---

### Task 1: Normalize Coordinate Click Configuration

**Files:**
- Modify: `mcp/comment-crawler-tools.js`
- Test: `test/comment-crawler-mcp.test.js`

**Interfaces:**
- Consumes: existing `normalizeExpandCaptureConfig(args = {})`.
- Produces:
  - `normalizeClickMode(value, fallback): "coordinate" | "dom-click" | "auto"`
  - `normalizeClickProfile(args = {}): object`
  - `DEFAULT_CLICK_PROFILE`
  - `normalizeExpandCaptureConfig(args = {})` returns a `click` object.

- [x] **Step 1: Write the failing test**

Add this test near the existing expand/capture config tests in `test/comment-crawler-mcp.test.js`:

```js
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
```

- [x] **Step 2: Run the failing test**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: FAIL because `normalizeClickMode` and `normalizeClickProfile` are not exported.

- [x] **Step 3: Add the minimal implementation**

In `mcp/comment-crawler-tools.js`, add this near the current default config:

```js
const DEFAULT_CLICK_PROFILE = Object.freeze({
  clickMode: 'coordinate',
  fallbackClickMode: 'dom-click',
  clickJitterPx: 4,
  mouseMoveStepsMin: 4,
  mouseMoveStepsMax: 9,
  clickDownMsMin: 60,
  clickDownMsMax: 160,
  clickGapMsMin: 300,
  clickGapMsMax: 900
});
```

Add helper functions near `normalizeRange`:

```js
function normalizeClickMode(value, fallback) {
  const mode = String(value || '').trim();
  if (mode === 'coordinate' || mode === 'dom-click' || mode === 'auto') return mode;
  return fallback;
}

function toNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeClickProfile(args = {}) {
  return {
    clickMode: normalizeClickMode(args.clickMode, DEFAULT_CLICK_PROFILE.clickMode),
    fallbackClickMode: normalizeClickMode(args.fallbackClickMode, DEFAULT_CLICK_PROFILE.fallbackClickMode),
    clickJitterPx: toNonNegativeInteger(args.clickJitterPx, DEFAULT_CLICK_PROFILE.clickJitterPx),
    mouseMoveSteps: normalizeRange(
      args.mouseMoveStepsMin,
      args.mouseMoveStepsMax,
      DEFAULT_CLICK_PROFILE.mouseMoveStepsMin,
      DEFAULT_CLICK_PROFILE.mouseMoveStepsMax
    ),
    clickDownMs: normalizeRange(
      args.clickDownMsMin,
      args.clickDownMsMax,
      DEFAULT_CLICK_PROFILE.clickDownMsMin,
      DEFAULT_CLICK_PROFILE.clickDownMsMax
    ),
    clickGapMs: normalizeRange(
      args.clickGapMsMin,
      args.clickGapMsMax,
      DEFAULT_CLICK_PROFILE.clickGapMsMin,
      DEFAULT_CLICK_PROFILE.clickGapMsMax
    )
  };
}
```

Update `normalizeExpandCaptureConfig` so the returned object includes:

```js
click: normalizeClickProfile(args)
```

Export:

```js
DEFAULT_CLICK_PROFILE,
normalizeClickMode,
toNonNegativeInteger,
normalizeClickProfile,
```

- [x] **Step 4: Run the test again**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add mcp/comment-crawler-tools.js test/comment-crawler-mcp.test.js
git commit -m "feat：增加MCP点击配置归一化"
```

---

### Task 2: Add Visible Expand Target Discovery

**Files:**
- Modify: `mcp/comment-crawler-tools.js`
- Test: `test/comment-crawler-mcp.test.js`

**Interfaces:**
- Consumes: `toPositiveInteger`, `normalizeClickProfile`.
- Produces:
  - `findVisibleExpandTargets(page, options = {}): Promise<Array<ExpandTarget>>`
  - `buildExpandTargetScript(config): browser-side target finder`

`ExpandTarget` shape:

```js
{
  text: '展开5条回复',
  dom_path: 'HTML:nth-of-type(1)>BODY:nth-of-type(1)>BUTTON:nth-of-type(1)',
  rect: { left: 10, top: 20, width: 120, height: 30 },
  center: { x: 70, y: 35 },
  click_point: { x: 72, y: 34 }
}
```

- [x] **Step 1: Write the failing test**

Add this test:

```js
test('findVisibleExpandTargets returns innermost visible expand controls with bounded click points', async () => {
  const tools = require(toolsPath);

  const page = {
    evaluate: async (fn, config) => fn({
      querySelectorAll: () => []
    }, config)
  };

  page.evaluate = async (_pageFunction, config) => {
    const makeElement = input => ({
      tagName: input.tagName || 'BUTTON',
      textContent: input.text,
      disabled: Boolean(input.disabled),
      previousElementSibling: null,
      parentElement: input.parent || null,
      getAttribute: name => input.attrs && input.attrs[name] || '',
      getClientRects: () => input.visible === false ? [] : [{}],
      getBoundingClientRect: () => input.rect,
      querySelectorAll: () => input.children || [],
      offsetParent: input.visible === false ? null : {}
    });
    const child = makeElement({
      tagName: 'SPAN',
      text: '展开5条回复',
      rect: { left: 20, top: 30, width: 80, height: 20 }
    });
    const parent = makeElement({
      tagName: 'BUTTON',
      text: '展开5条回复',
      rect: { left: 10, top: 20, width: 120, height: 40 },
      children: [child]
    });
    child.parentElement = parent;
    const rejected = makeElement({
      text: '展开全文',
      rect: { left: 10, top: 80, width: 100, height: 20 }
    });
    const hidden = makeElement({
      text: '展开2条回复',
      visible: false,
      rect: { left: 10, top: 120, width: 100, height: 20 }
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
```

- [x] **Step 2: Run the failing test**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: FAIL because `findVisibleExpandTargets` is not exported.

- [x] **Step 3: Implement target discovery**

Add `findVisibleExpandTargets` to `mcp/comment-crawler-tools.js`. The page function should:

```js
async function findVisibleExpandTargets(page, options = {}) {
  const maxClicksPerRound = toPositiveInteger(options.maxClicksPerRound, DEFAULT_EXPAND_CAPTURE_CONFIG.maxClicksPerRound);
  const clickJitterPx = toNonNegativeInteger(options.clickJitterPx, DEFAULT_CLICK_PROFILE.clickJitterPx);
  const random = typeof options.random === 'function' ? options.random : Math.random;

  return page.evaluate(config => {
    const normalizeText = value => String(value == null ? '' : value).replace(/\s+/g, '').trim();
    const expandPatterns = [
      /^展开更多(?:回复|评论)?$/,
      /^展开(?:全部)?\d+条?回复$/,
      /^展开\d+回复$/,
      /^查看(?:全部|更多)?\d+条?回复$/,
      /^查看(?:全部|更多)?回复$/,
      /^查看更多回复$/,
      /^更多回复$/
    ];
    const rejectPatterns = [/展开全文/, /收起/, /商品/, /详情/];
    const isExpandText = value => {
      const text = normalizeText(value);
      if (!text || text.length > 24) return false;
      if (rejectPatterns.some(pattern => pattern.test(text))) return false;
      return expandPatterns.some(pattern => pattern.test(text));
    };
    const isVisible = el => {
      if (!el) return false;
      if (el.disabled) return false;
      if (String(el.getAttribute && el.getAttribute('aria-disabled')) === 'true') return false;
      if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
      const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      if (rect.bottom < 0 || rect.top > (window.innerHeight || 0)) return false;
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0)) return false;
      return true;
    };
    const getDomPath = el => {
      const parts = [];
      let current = el;
      while (current && current.nodeType !== 9 && parts.length < 8) {
        const tagName = current.tagName || 'NODE';
        let index = 1;
        let prev = current.previousElementSibling;
        while (prev) {
          if (prev.tagName === tagName) index += 1;
          prev = prev.previousElementSibling;
        }
        parts.unshift(`${tagName}:nth-of-type(${index})`);
        current = current.parentElement;
      }
      return parts.join('>');
    };
    const hasMatchingDescendant = el => {
      if (!el || typeof el.querySelectorAll !== 'function') return false;
      return Array.from(el.querySelectorAll('*')).some(child => child !== el && isVisible(child) && isExpandText(child.textContent));
    };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const targets = [];
    for (const el of Array.from(document.querySelectorAll('button,[role="button"],a,span,div'))) {
      if (targets.length >= config.maxClicksPerRound) break;
      if (!isVisible(el)) continue;
      const text = normalizeText(el.textContent);
      if (!isExpandText(text)) continue;
      if (hasMatchingDescendant(el)) continue;
      const rect = el.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const jitterX = config.clickJitterPx ? (config.randomValue - 0.5) * 2 * config.clickJitterPx : 0;
      const jitterY = config.clickJitterPx ? (0.5 - config.randomValue) * 2 * config.clickJitterPx : 0;
      targets.push({
        text,
        dom_path: getDomPath(el),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        center,
        click_point: {
          x: clamp(center.x + jitterX, rect.left + 1, rect.left + rect.width - 1),
          y: clamp(center.y + jitterY, rect.top + 1, rect.top + rect.height - 1)
        }
      });
    }
    return targets;
  }, {
    maxClicksPerRound,
    clickJitterPx,
    randomValue: random()
  });
}
```

Export `findVisibleExpandTargets`.

- [x] **Step 4: Run the test again**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add mcp/comment-crawler-tools.js test/comment-crawler-mcp.test.js
git commit -m "feat：增加展开按钮坐标发现"
```

---

### Task 3: Add Raw CDP Mouse Compatibility

**Files:**
- Modify: `mcp/comment-crawler-cdp.js`
- Test: `test/comment-crawler-mcp.test.js`

**Interfaces:**
- Consumes: `RawCdpClient.send(method, params)`.
- Produces: raw fallback `page.mouse` with:
  - `move(x, y, options = {})`
  - `down(options = {})`
  - `up(options = {})`

- [x] **Step 1: Write the failing test**

Add this test near existing raw CDP tests:

```js
test('raw CDP page exposes Playwright-like mouse methods backed by Input.dispatchMouseEvent', async () => {
  const cdp = require(cdpPath);
  const calls = [];
  const client = {
    send: async (method, params) => {
      calls.push([method, params]);
      if (method === 'Runtime.evaluate') return { result: { value: 'ok' } };
      return {};
    },
    close: async () => {}
  };
  const page = cdp.createRawCdpPage(client, {
    url: 'https://www.douyin.com/video/123'
  });

  await page.mouse.move(100, 200, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();

  assert.equal(calls.filter(call => call[0] === 'Input.dispatchMouseEvent').length, 5);
  assert.deepEqual(calls[0], [
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: 33.333333333333336, y: 66.66666666666667, button: 'none' }
  ]);
  assert.deepEqual(calls[3], [
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: 100, y: 200, button: 'left', buttons: 1, clickCount: 1 }
  ]);
  assert.deepEqual(calls[4], [
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: 100, y: 200, button: 'left', buttons: 0, clickCount: 1 }
  ]);
});
```

- [x] **Step 2: Run the failing test**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: FAIL because `createRawCdpPage` is not exported and raw page has no `mouse`.

- [x] **Step 3: Implement raw mouse support**

In `mcp/comment-crawler-cdp.js`, inside `createRawCdpPage`, track mouse state:

```js
  let mouseX = 0;
  let mouseY = 0;

  page.mouse = {
    move: async (x, y, options = {}) => {
      const steps = Number.isInteger(Number(options.steps)) && Number(options.steps) > 0
        ? Number(options.steps)
        : 1;
      const startX = mouseX;
      const startY = mouseY;
      for (let step = 1; step <= steps; step += 1) {
        const nextX = startX + (Number(x) - startX) * (step / steps);
        const nextY = startY + (Number(y) - startY) * (step / steps);
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: nextX,
          y: nextY,
          button: 'none'
        });
      }
      mouseX = Number(x);
      mouseY = Number(y);
    },
    down: async () => {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: mouseX,
        y: mouseY,
        button: 'left',
        buttons: 1,
        clickCount: 1
      });
    },
    up: async () => {
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: mouseX,
        y: mouseY,
        button: 'left',
        buttons: 0,
        clickCount: 1
      });
    }
  };
```

Export `createRawCdpPage`:

```js
createRawCdpPage,
```

- [x] **Step 4: Run the test again**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add mcp/comment-crawler-cdp.js test/comment-crawler-mcp.test.js
git commit -m "feat：增加raw CDP鼠标事件"
```

---

### Task 4: Implement Coordinate Click Executor With DOM Fallback

**Files:**
- Modify: `mcp/comment-crawler-tools.js`
- Test: `test/comment-crawler-mcp.test.js`

**Interfaces:**
- Consumes:
  - `findVisibleExpandTargets(page, options)`
  - `page.mouse.move/down/up`
  - `sleep(ms)`
  - `pickRangeValue(range, random)`
- Produces:
  - `clickExpandTargets(page, targets, options = {}): Promise<ClickSummary>`
  - `domClickExpandTargets(page, targets, options = {}): Promise<ClickSummary>`
  - `expandVisibleCommentsOnce(page, options = {})` supports `click` profile.

`ClickSummary` shape:

```js
{
  clicked: 2,
  errors: 0,
  available: 2,
  click_mode: 'coordinate',
  fallback_used: false,
  coordinate_click_count: 2,
  dom_click_count: 0,
  fallback_click_count: 0,
  last_click_errors: []
}
```

- [ ] **Step 1: Write the failing tests**

Add:

```js
test('clickExpandTargets uses page.mouse with configured movement and hold timing', async () => {
  const tools = require(toolsPath);
  const calls = [];
  const page = {
    mouse: {
      move: async (x, y, options) => calls.push(['move', x, y, options.steps]),
      down: async () => calls.push(['down']),
      up: async () => calls.push(['up'])
    }
  };
  const sleeps = [];

  const result = await tools.clickExpandTargets(page, [
    { text: '展开5条回复', click_point: { x: 100, y: 200 } },
    { text: '展开1条回复', click_point: { x: 120, y: 260 } }
  ], {
    click: tools.normalizeClickProfile({
      mouseMoveStepsMin: 4,
      mouseMoveStepsMax: 4,
      clickDownMsMin: 60,
      clickDownMsMax: 60,
      clickGapMsMin: 300,
      clickGapMsMax: 300
    }),
    sleep: async ms => sleeps.push(ms),
    random: () => 0
  });

  assert.equal(result.clicked, 2);
  assert.equal(result.errors, 0);
  assert.equal(result.click_mode, 'coordinate');
  assert.equal(result.coordinate_click_count, 2);
  assert.deepEqual(calls, [
    ['move', 100, 200, 4],
    ['down'],
    ['up'],
    ['move', 120, 260, 4],
    ['down'],
    ['up']
  ]);
  assert.deepEqual(sleeps, [60, 300, 60, 300]);
});

test('expandVisibleCommentsOnce falls back to DOM click when coordinate input is unavailable', async () => {
  const tools = require(toolsPath);
  const calls = [];
  const page = {
    evaluate: async () => ({ clicked: 1, errors: 0, available: 1 }),
  };

  const result = await tools.expandVisibleCommentsOnce(page, {
    maxClicksPerRound: 3,
    click: tools.normalizeClickProfile({
      clickMode: 'coordinate',
      fallbackClickMode: 'dom-click'
    }),
    findVisibleExpandTargets: async () => [
      { text: '展开1条回复', click_point: { x: 10, y: 20 } }
    ],
    clickExpandTargets: async () => {
      calls.push('coordinate');
      return {
        clicked: 0,
        errors: 1,
        available: 1,
        click_mode: 'coordinate',
        fallback_used: false,
        coordinate_click_count: 0,
        dom_click_count: 0,
        fallback_click_count: 0,
        last_click_errors: ['page.mouse unavailable']
      };
    },
    domClickExpandTargets: async () => {
      calls.push('dom');
      return {
        clicked: 1,
        errors: 0,
        available: 1,
        click_mode: 'dom-click',
        fallback_used: true,
        coordinate_click_count: 0,
        dom_click_count: 1,
        fallback_click_count: 1,
        last_click_errors: []
      };
    }
  });

  assert.deepEqual(calls, ['coordinate', 'dom']);
  assert.equal(result.clicked, 1);
  assert.equal(result.fallback_used, true);
  assert.equal(result.fallback_click_count, 1);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: FAIL because `clickExpandTargets` is not exported and `expandVisibleCommentsOnce` does not accept injected click helpers.

- [ ] **Step 3: Implement click executors**

Add to `mcp/comment-crawler-tools.js`:

```js
function emptyClickSummary(mode, available = 0) {
  return {
    clicked: 0,
    errors: 0,
    available,
    click_mode: mode,
    fallback_used: false,
    coordinate_click_count: 0,
    dom_click_count: 0,
    fallback_click_count: 0,
    last_click_errors: []
  };
}

async function clickExpandTargets(page, targets = [], options = {}) {
  const click = options.click || normalizeClickProfile(options);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const wait = options.sleep || sleep;
  const summary = emptyClickSummary('coordinate', targets.length);

  if (!page || !page.mouse || typeof page.mouse.move !== 'function') {
    summary.errors = targets.length ? 1 : 0;
    summary.last_click_errors.push('page.mouse unavailable');
    return summary;
  }

  for (const target of targets) {
    try {
      const point = target.click_point || target.center;
      const steps = pickRangeValue(click.mouseMoveSteps, random);
      await page.mouse.move(point.x, point.y, { steps });
      await page.mouse.down();
      await wait(pickRangeValue(click.clickDownMs, random));
      await page.mouse.up();
      await wait(pickRangeValue(click.clickGapMs, random));
      summary.clicked += 1;
      summary.coordinate_click_count += 1;
    } catch (error) {
      summary.errors += 1;
      if (summary.last_click_errors.length < 5) {
        summary.last_click_errors.push(error && error.message ? error.message : String(error));
      }
    }
  }

  return summary;
}
```

Move the current in-page `el.click()` logic into:

```js
async function domClickExpandTargets(page, _targets = [], options = {}) {
  const maxClicksPerRound = toPositiveInteger(options.maxClicksPerRound, DEFAULT_EXPAND_CAPTURE_CONFIG.maxClicksPerRound);
  const result = await page.evaluate(config => {
    const normalizeText = value => String(value == null ? '' : value).replace(/\s+/g, '').trim();
    const patterns = [
      /^展开更多(?:回复|评论)?$/,
      /^展开(?:全部)?\d+条?回复$/,
      /^展开\d+回复$/,
      /^查看(?:全部|更多)?\d+条?回复$/,
      /^查看(?:全部|更多)?回复$/,
      /^查看更多回复$/,
      /^更多回复$/
    ];
    const rejectPatterns = [/展开全文/, /收起/, /商品/, /详情/];
    const isExpandText = value => {
      const text = normalizeText(value);
      if (!text || text.length > 24) return false;
      if (rejectPatterns.some(pattern => pattern.test(text))) return false;
      return patterns.some(pattern => pattern.test(text));
    };
    const isVisible = el => {
      if (!el) return false;
      if (el.disabled) return false;
      if (String(el.getAttribute && el.getAttribute('aria-disabled')) === 'true') return false;
      if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
      const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
      if (el.offsetParent === null && (!rect || (rect.width === 0 && rect.height === 0))) return false;
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0)) return false;
      return true;
    };
    const hasMatchingDescendant = el => {
      if (!el || typeof el.querySelectorAll !== 'function') return false;
      return Array.from(el.querySelectorAll('*')).some(child => child !== el && isVisible(child) && isExpandText(child.textContent));
    };
    const candidates = [];
    for (const el of Array.from(document.querySelectorAll('button,[role="button"],a,span,div'))) {
      if (candidates.length >= config.maxClicksPerRound) break;
      if (!isVisible(el)) continue;
      if (!isExpandText(el.textContent)) continue;
      if (hasMatchingDescendant(el)) continue;
      candidates.push(el);
    }
    let clicked = 0;
    let errors = 0;
    for (const el of candidates) {
      try {
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', inline: 'center' });
        }
        if (typeof el.click === 'function') {
          el.click();
          clicked += 1;
        }
      } catch (_error) {
        errors += 1;
      }
    }
    return { clicked, errors, available: candidates.length };
  }, { maxClicksPerRound });

  const clicked = Number(result && result.clicked) || 0;
  const errors = Number(result && result.errors) || 0;
  return {
    clicked,
    errors,
    available: Number(result && result.available) || clicked,
    click_mode: 'dom-click',
    fallback_used: Boolean(options.fallbackUsed),
    coordinate_click_count: 0,
    dom_click_count: clicked,
    fallback_click_count: options.fallbackUsed ? clicked : 0,
    last_click_errors: []
  };
}
```

Update `expandVisibleCommentsOnce` to:

```js
async function expandVisibleCommentsOnce(page, options = {}) {
  const maxClicksPerRound = toPositiveInteger(options.maxClicksPerRound, DEFAULT_EXPAND_CAPTURE_CONFIG.maxClicksPerRound);
  const click = options.click || normalizeClickProfile(options);
  const findTargets = options.findVisibleExpandTargets || findVisibleExpandTargets;
  const coordinateClick = options.clickExpandTargets || clickExpandTargets;
  const domClick = options.domClickExpandTargets || domClickExpandTargets;

  if (click.clickMode === 'dom-click') {
    return domClick(page, [], { ...options, maxClicksPerRound });
  }

  const targets = await findTargets(page, {
    ...options,
    maxClicksPerRound,
    clickJitterPx: click.clickJitterPx
  });
  const coordinateResult = await coordinateClick(page, targets, { ...options, click });

  if (coordinateResult.clicked > 0 || click.fallbackClickMode !== 'dom-click') {
    return coordinateResult;
  }

  const fallbackResult = await domClick(page, targets, {
    ...options,
    maxClicksPerRound,
    fallbackUsed: true
  });
  return {
    ...fallbackResult,
    errors: coordinateResult.errors + fallbackResult.errors,
    last_click_errors: coordinateResult.last_click_errors.concat(fallbackResult.last_click_errors).slice(0, 5)
  };
}
```

Export:

```js
emptyClickSummary,
clickExpandTargets,
domClickExpandTargets,
```

- [ ] **Step 4: Run the tests**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/comment-crawler-tools.js test/comment-crawler-mcp.test.js
git commit -m "feat：增加MCP坐标点击执行器"
```

---

### Task 5: Wire Click Mode Into The Main MCP Tool

**Files:**
- Modify: `mcp/comment-crawler-tools.js`
- Test: `test/comment-crawler-mcp.test.js`

**Interfaces:**
- Consumes:
  - `normalizeExpandCaptureConfig(args).click`
  - `expandVisibleCommentsOnce(page, { click })`
  - `decorateCaptureState(state, progress)`
- Produces:
  - Tool input schema accepts click mode and mouse profile fields.
  - `capture-state.json` includes aggregate click fields.
  - Tool result includes aggregate click fields.

- [ ] **Step 1: Write the failing integration test**

Extend the existing `expand_and_capture_comment_batches combines expansion, capture, scrolling, and idle stop` test. Add these arguments:

```js
clickMode: 'coordinate',
fallbackClickMode: 'dom-click',
clickJitterPx: 2,
mouseMoveStepsMin: 4,
mouseMoveStepsMax: 4,
clickDownMsMin: 60,
clickDownMsMax: 60,
clickGapMsMin: 300,
clickGapMsMax: 300,
```

Change the injected `expandVisibleCommentsOnce` assertion to:

```js
expandVisibleCommentsOnce: async (_page, options) => {
  calls.push(['expand', options.maxClicksPerRound, options.click.clickMode, options.click.clickJitterPx]);
  return {
    clicked: round === 0 ? 1 : 0,
    errors: 0,
    click_mode: 'coordinate',
    fallback_used: false,
    coordinate_click_count: round === 0 ? 1 : 0,
    dom_click_count: 0,
    fallback_click_count: 0,
    last_click_errors: []
  };
},
```

Add assertions:

```js
assert.equal(result.structuredContent.clickMode, 'coordinate');
assert.equal(result.structuredContent.coordinateClickCount, 1);
assert.equal(result.structuredContent.domClickCount, 0);
assert.equal(result.structuredContent.fallbackClickCount, 0);

const state = JSON.parse(fs.readFileSync(path.join(outDir, 'capture-state.json'), 'utf8'));
assert.equal(state.click_mode, 'coordinate');
assert.equal(state.coordinate_click_count, 1);
assert.equal(state.dom_click_count, 0);
assert.equal(state.fallback_click_count, 0);
assert.deepEqual(calls.slice(0, 1), [
  ['expand', 3, 'coordinate', 2]
]);
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: FAIL because the loop does not pass `click` config and does not aggregate click fields.

- [ ] **Step 3: Update tool schema and loop aggregation**

In the `EXPAND_CAPTURE_TOOL_NAME` input schema, add properties:

```js
clickMode: {
  type: 'string',
  enum: ['coordinate', 'dom-click', 'auto'],
  description: 'How expand controls are clicked. Defaults to coordinate.'
},
fallbackClickMode: {
  type: 'string',
  enum: ['dom-click', 'coordinate', 'auto'],
  description: 'Fallback click mode when coordinate input is unavailable.'
},
clickJitterPx: { type: 'number' },
mouseMoveStepsMin: { type: 'number' },
mouseMoveStepsMax: { type: 'number' },
clickDownMsMin: { type: 'number' },
clickDownMsMax: { type: 'number' },
clickGapMsMin: { type: 'number' },
clickGapMsMax: { type: 'number' }
```

Inside `expandAndCaptureCommentBatches`, initialize counters:

```js
let coordinateClickCount = Number(previousState.coordinate_click_count) || 0;
let domClickCount = Number(previousState.dom_click_count) || 0;
let fallbackClickCount = Number(previousState.fallback_click_count) || 0;
let lastClickErrors = Array.isArray(previousState.last_click_errors) ? previousState.last_click_errors.slice(-5) : [];
```

Pass click config:

```js
const expandResult = await expandStep(page, {
  maxClicksPerRound: config.maxClicksPerRound,
  click: config.click,
  random,
  sleep: wait
});
```

Aggregate:

```js
coordinateClickCount += Number(expandResult && expandResult.coordinate_click_count) || 0;
domClickCount += Number(expandResult && expandResult.dom_click_count) || 0;
fallbackClickCount += Number(expandResult && expandResult.fallback_click_count) || 0;
if (Array.isArray(expandResult && expandResult.last_click_errors)) {
  lastClickErrors = lastClickErrors.concat(expandResult.last_click_errors).slice(-5);
}
```

Update state after `decorateCaptureState`:

```js
previousState.click_mode = config.click.clickMode;
previousState.coordinate_click_count = coordinateClickCount;
previousState.dom_click_count = domClickCount;
previousState.fallback_click_count = fallbackClickCount;
previousState.last_click_errors = lastClickErrors;
```

Add result fields:

```js
clickMode: config.click.clickMode,
coordinateClickCount,
domClickCount,
fallbackClickCount,
lastClickErrors
```

- [ ] **Step 4: Run the test again**

Run:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/comment-crawler-tools.js test/comment-crawler-mcp.test.js
git commit -m "feat：接入MCP坐标点击主流程"
```

---

### Task 6: Update Skill Workflow Documentation

**Files:**
- Modify: `.codex/skills/comment-excel-delivery/SKILL.md`
- Modify: `.codex/skills/comment-excel-delivery/references/workflow.md`
- Test: `test/pipeline/test_comment_excel_delivery_skill.py`

**Interfaces:**
- Consumes: `comment-excel-delivery` skill docs.
- Produces: workflow docs that mention `clickMode: "coordinate"` and fallback behavior.

- [ ] **Step 1: Write the failing documentation test**

In `test/pipeline/test_comment_excel_delivery_skill.py`, add:

```python
def test_comment_excel_delivery_documents_coordinate_click_mode():
    skill = Path(".codex/skills/comment-excel-delivery/SKILL.md").read_text(encoding="utf-8")
    workflow = Path(".codex/skills/comment-excel-delivery/references/workflow.md").read_text(encoding="utf-8")

    assert "coordinate" in skill
    assert "DOM click fallback" in skill or "DOM-click fallback" in skill or "dom-click fallback" in skill
    assert '"clickMode": "coordinate"' in workflow
    assert '"fallbackClickMode": "dom-click"' in workflow
```

- [ ] **Step 2: Run the failing documentation test**

Run:

```bash
src/pipeline/.venv/bin/python -m unittest test.pipeline.test_comment_excel_delivery_skill
```

Expected: FAIL because the docs do not mention coordinate click mode.

- [ ] **Step 3: Update skill docs**

In `.codex/skills/comment-excel-delivery/SKILL.md`, change the browser-tool bullet to:

```markdown
- MCP/browser tools expand comments, scroll, and capture bounded DOM candidate batches. The default browser step is `expand_and_capture_comment_batches`, using coordinate click mode with `dom-click` fallback.
```

In `.codex/skills/comment-excel-delivery/references/workflow.md`, add the click fields to the MCP example:

```json
{
  "clickMode": "coordinate",
  "fallbackClickMode": "dom-click",
  "clickJitterPx": 4,
  "mouseMoveStepsMin": 4,
  "mouseMoveStepsMax": 9,
  "clickDownMsMin": 60,
  "clickDownMsMax": 160,
  "clickGapMsMin": 300,
  "clickGapMsMax": 900
}
```

Add this sentence after the example:

```markdown
Coordinate clicking is used for production interaction compatibility. If coordinate input is unavailable, the MCP tool falls back to `dom-click`; login, CAPTCHA, or verification pages should stop the run for user action.
```

- [ ] **Step 4: Run the documentation test**

Run:

```bash
src/pipeline/.venv/bin/python -m unittest test.pipeline.test_comment_excel_delivery_skill
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .codex/skills/comment-excel-delivery/SKILL.md .codex/skills/comment-excel-delivery/references/workflow.md test/pipeline/test_comment_excel_delivery_skill.py
git commit -m "docs：更新评论交付坐标点击流程"
```

---

### Task 7: Full Verification And Smoke Commands

**Files:**
- Modify only if a previous task exposed a small test gap.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified MCP coordinate-click implementation ready for live Douyin/Xiaohongshu smoke tests.

- [ ] **Step 1: Run all Node tests**

Run:

```bash
node --test --test-reporter=dot test/*.test.js
```

Expected: PASS.

- [ ] **Step 2: Run all Python pipeline tests**

Run:

```bash
src/pipeline/.venv/bin/python -m unittest discover -s test/pipeline
```

Expected: PASS.

- [ ] **Step 3: Inspect MCP status manually**

Run the MCP status test through the configured client or existing MCP test command:

```bash
node --test --test-reporter=dot test/comment-crawler-mcp.test.js
```

Expected: PASS and `expand_and_capture_comment_batches` remains exposed.

- [ ] **Step 4: Prepare live smoke command for the user**

Use this MCP payload against an already-open logged-in Chrome page:

```json
{
  "cdpEndpoint": "http://127.0.0.1:9222",
  "outDir": "output/coordinate_click_smoke_001",
  "taskId": "coordinate_click_smoke_001",
  "maxRuntimeMs": 300000,
  "maxRounds": 40,
  "maxBatches": 20,
  "maxIdleRounds": 6,
  "maxClicksPerRound": 3,
  "maxCandidates": 80,
  "maxCharsPerCandidate": 2500,
  "includeHtml": true,
  "includeText": true,
  "clickMode": "coordinate",
  "fallbackClickMode": "dom-click",
  "closePageAfter": false
}
```

Expected: tool result includes `clickMode`, `coordinateClickCount`, `domClickCount`, `fallbackClickCount`, and writes `capture-state.json`.

- [ ] **Step 5: Commit verification-only fixes if needed**

If Step 1 or Step 2 required small corrections:

```bash
git add mcp/comment-crawler-tools.js mcp/comment-crawler-cdp.js test/comment-crawler-mcp.test.js .codex/skills/comment-excel-delivery/SKILL.md .codex/skills/comment-excel-delivery/references/workflow.md test/pipeline/test_comment_excel_delivery_skill.py
git commit -m "test：补齐MCP坐标点击验证"
```

If no corrections were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: Tasks 1-5 cover click mode config, coordinate input, raw CDP fallback, state/result observability, and stop-compatible integration. Task 6 covers skill documentation. Task 7 covers verification and smoke payload.
- Placeholder scan: The plan contains concrete file paths, exact test snippets, expected failures, implementation snippets, commands, and commit messages.
- Type consistency: The plan uses `clickMode`, `fallbackClickMode`, `clickJitterPx`, `coordinate_click_count`, `dom_click_count`, `fallback_click_count`, and `last_click_errors` consistently across config, state, and result mapping.
