'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const expander = require('../expand-comments-v1.js');

class FakeElement {
  constructor(tagName, text = '', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this._text = text;
    this.children = [];
    this.parentElement = null;
    this.disabled = Boolean(options.disabled);
    this.offsetParent = options.hidden ? null : {};
    this.className = options.className || '';
    this.id = options.id || '';
    this.role = options.role;
    this.tabIndex = options.tabIndex ?? -1;
    this.scrollHeight = options.scrollHeight || 0;
    this.clientHeight = options.clientHeight || 0;
    this.scrollTop = options.scrollTop || 0;
    this.rect = options.rect || { width: 80, height: 24, top: 0, left: 0 };
    this.attrs = Object.assign({}, options.attrs);
  }

  get textContent() {
    return [this._text, ...this.children.map(child => child.textContent)].join('');
  }

  set textContent(value) {
    this._text = value;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    if (name === 'role') return this.role;
    return this.attrs[name];
  }

  getBoundingClientRect() {
    return this.rect;
  }

  getClientRects() {
    return this.offsetParent === null ? [] : [this.rect];
  }

  querySelectorAll() {
    const out = [];
    const visit = node => {
      for (const child of node.children) {
        out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

function fakeDocument(elements) {
  return {
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    querySelectorAll() {
      return elements;
    }
  };
}

test('recognizes Douyin-style expand labels and rejects unrelated expand text', () => {
  const accepted = [
    '展开更多',
    '展开更多回复',
    '展开3条回复',
    '展开 12 条回复',
    '展开3回复',
    '查看更多回复',
    '查看全部 8 条回复'
  ];

  const rejected = [
    '展开全文',
    '收起',
    '评论',
    '已展开3条回复',
    '展开商品详情'
  ];

  for (const text of accepted) {
    assert.equal(expander.isExpandText(text), true, text);
  }

  for (const text of rejected) {
    assert.equal(expander.isExpandText(text), false, text);
  }
});

test('builds a retry key from DOM path and normalized text', () => {
  const root = new FakeElement('div');
  root.appendChild(new FakeElement('span', '其他'));
  const secondSpan = root.appendChild(new FakeElement('span', ' 展开 3 条回复 '));

  assert.equal(
    expander.getButtonKey(secondSpan),
    'DIV:nth-of-type(1)>SPAN:nth-of-type(2)::展开3条回复'
  );
});

test('selects visible expand candidates while skipping disabled, hidden, duplicate, and exhausted elements', () => {
  const root = new FakeElement('div');
  const first = root.appendChild(new FakeElement('button', '展开更多回复'));
  const duplicate = root.appendChild(new FakeElement('button', '展开更多回复'));
  const disabled = new FakeElement('button', '展开3条回复', { disabled: true });
  const hidden = new FakeElement('button', '展开4条回复', { hidden: true });
  const exhausted = new FakeElement('button', '查看全部8条回复');
  const unrelated = new FakeElement('button', '展开全文');

  const attempts = new Map([
    [expander.getButtonKey(exhausted), 3]
  ]);

  const candidates = expander.selectExpandCandidates(
    fakeDocument([first, duplicate, disabled, hidden, exhausted, unrelated]),
    attempts,
    { maxRetryPerButton: 3, batchSize: 10 }
  );

  assert.deepEqual(candidates, [first, duplicate]);
});

test('stops after configured idle rounds or hard limits', () => {
  const config = {
    maxIdleRounds: 3,
    maxRounds: 10,
    maxClicks: 100,
    maxRuntimeMs: 1000
  };

  assert.equal(expander.shouldStop({ idleRounds: 2, round: 2, totalClicks: 5, elapsedMs: 500 }, config), false);
  assert.equal(expander.shouldStop({ idleRounds: 3, round: 2, totalClicks: 5, elapsedMs: 500 }, config), true);
  assert.equal(expander.shouldStop({ idleRounds: 0, round: 10, totalClicks: 5, elapsedMs: 500 }, config), true);
  assert.equal(expander.shouldStop({ idleRounds: 0, round: 2, totalClicks: 100, elapsedMs: 500 }, config), true);
  assert.equal(expander.shouldStop({ idleRounds: 0, round: 2, totalClicks: 5, elapsedMs: 1000 }, config), true);
});

test('scores scroll containers with comment-like containers above generic containers', () => {
  const generic = new FakeElement('div', '', {
    scrollHeight: 1200,
    clientHeight: 600,
    className: 'main-list'
  });
  const comments = new FakeElement('div', '', {
    scrollHeight: 900,
    clientHeight: 500,
    className: 'comment-panel reply-list'
  });
  comments.appendChild(new FakeElement('span', '展开更多回复'));

  assert.ok(
    expander.scoreScrollContainer(comments) > expander.scoreScrollContainer(generic)
  );
});
