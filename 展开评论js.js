(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const MAX_RETRY_PER_BUTTON = 3;
  const CLICK_INTERVAL = 1000;

  const cleanText = el => el.textContent.replace(/\s+/g, '');

  const isExpandBtn = btn => {
    const text = cleanText(btn);

    return (
      /^展开\d+条回复$/.test(text) ||
      /^展开\d+回复$/.test(text) ||
      /^展开更多$/.test(text) ||
      /^展开更多回复$/.test(text)
    );
  };

  const getDomPath = el => {
    const parts = [];

    while (el && el.nodeType === 1 && parts.length < 8) {
      let index = 1;
      let prev = el.previousElementSibling;

      while (prev) {
        if (prev.tagName === el.tagName) index++;
        prev = prev.previousElementSibling;
      }

      parts.unshift(`${el.tagName}:nth-of-type(${index})`);
      el = el.parentElement;
    }

    return parts.join('>');
  };

  const attempts = new Map();

  const getButtonKey = btn => {
    return `${getDomPath(btn)}::${cleanText(btn)}`;
  };

  const getNextBtn = () => {
    return [...document.querySelectorAll('button')]
      .find(btn => {
        if (!isExpandBtn(btn)) return false;
        if (btn.disabled) return false;
        if (btn.offsetParent === null) return false;

        const key = getButtonKey(btn);
        const count = attempts.get(key) || 0;

        return count < MAX_RETRY_PER_BUTTON;
      });
  };

  const clickLikeUser = async btn => {
    btn.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(200);

    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y) || btn;

    const fireMouse = type => {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        buttons: type === 'mousedown' ? 1 : 0
      }));
    };

    const firePointer = type => {
      if (!window.PointerEvent) return;

      target.dispatchEvent(new PointerEvent(type, {
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

    firePointer('pointerdown');
    fireMouse('mousedown');

    await sleep(80);

    firePointer('pointerup');
    fireMouse('mouseup');
    fireMouse('click');

    btn.click();
  };

  let total = 0;
  let skipped = 0;

  while (true) {
    const btn = getNextBtn();

    if (!btn) break;

    const key = getButtonKey(btn);
    const nextCount = (attempts.get(key) || 0) + 1;
    attempts.set(key, nextCount);

    await clickLikeUser(btn);

    total++;

    console.log(`已点击 ${total} 次，当前按钮第 ${nextCount}/${MAX_RETRY_PER_BUTTON} 次：${cleanText(btn)}`);

    if (nextCount >= MAX_RETRY_PER_BUTTON) {
      skipped++;
      console.warn(`这个按钮已达到 ${MAX_RETRY_PER_BUTTON} 次上限，后续跳过：`, btn);
    }

    await sleep(CLICK_INTERVAL);
  }

  console.log(`完成，总点击 ${total} 次，达到上限跳过 ${skipped} 个按钮`);
})();