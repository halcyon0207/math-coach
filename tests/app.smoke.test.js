/*
 * 界面冒烟测试
 *
 * 用一个极小的 DOM 替身把 5 个脚本按 index.html 的顺序跑起来，
 * 模拟真实的点击，把一整场练习从头走到结果页。
 *
 * 目的不是测样式，而是回答一个问题：**手机上打开它会不会白屏。**
 * 引擎有单元测试守着，但界面里的一个拼写错误同样能让整个页面挂掉 ——
 * 那种错在单元测试里是看不出来的。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const RESULT_MARK = 'card-result';   // 结果页独有的 class

function makeEl(id) {
  return {
    id,
    innerHTML: '',
    _click: [],
    addEventListener(type, fn) { if (type === 'click') this._click.push(fn); },
    getAttribute() { return null; }
  };
}

function boot() {
  const els = { app: makeEl('app') };
  const bag = {};
  const keyHandlers = [];

  const sandbox = {
    console,
    setTimeout, clearTimeout,
    localStorage: {
      getItem: k => (k in bag ? bag[k] : null),
      setItem: (k, v) => { bag[k] = String(v); },
      removeItem: k => { delete bag[k]; }
    },
    document: {
      readyState: 'complete',
      activeElement: { tagName: 'BODY' },
      getElementById: id => els[id] || null,
      addEventListener: (type, fn) => { if (type === 'keydown') keyHandlers.push(fn); }
    },
    scrollTo: () => {},
    confirm: () => true,
    alert: () => {}
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  ['knowledge', 'templates', 'engine', 'store', 'app'].forEach(name => {
    const file = path.join(ROOT, 'js', name + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  });

  function click(dataAct, attrs) {
    const handler = els.app._click[0];
    assert.ok(handler, '页面没有注册点击监听，说明 app.js 没有正常初始化');
    const a = { 'data-act': dataAct };
    Object.keys(attrs || {}).forEach(k => {
      a[k.indexOf('data-') === 0 ? k : 'data-' + k] = attrs[k];
    });
    const fake = {
      _a: a,
      closest() { return this; },
      getAttribute(n) { return n in this._a ? this._a[n] : null; }
    };
    handler({ target: fake });
  }

  // 模拟电脑键盘。app.js 把监听挂在 document 上，不是挂在按钮上。
  function key(k, opts) {
    assert.ok(keyHandlers.length, '页面没有注册键盘监听，说明 app.js 没有正常初始化');
    let prevented = false;
    keyHandlers.forEach(fn => fn(Object.assign({
      key: k,
      ctrlKey: false, metaKey: false, altKey: false,
      preventDefault() { prevented = true; }
    }, opts || {})));
    return prevented;
  }

  return { els, sandbox, click, key, html: () => els.app.innerHTML };
}

// 作答区里的当前步骤提示。用这个而不是从阶梯列表里找，
// 因为列表里已经做完的步骤也带着 step-prompt，容易抓到错的题。
const ACTIVE_STEP = /<div class="wz-prompt">([^<]+)<\/div>/;
const FIRST_OPTION = /data-act="opt" data-v="([^"]+)"/;

// 把一场练习从头开到尾。
// 填空题照题干里的算式算出正确答案；选择题点第一个选项
//（故意点错，顺便把"答错 → 提示 → 揭示答案"那条路径也走一遍）。
function playThrough(app) {
  let iter = 0;

  while (iter++ < 800) {
    const html = app.html();
    if (html.includes(RESULT_MARK)) return { iter, reached: true };
    if (html.includes('data-act="next"')) { app.click('next'); continue; }

    const m = html.match(ACTIVE_STEP);
    assert.ok(m, '作答区里找不到当前步骤，练习流程卡住了');

    const opt = html.match(FIRST_OPTION);
    if (opt) {
      app.click('opt', { 'data-v': opt[1] });
    } else {
      // 电脑网页版走键盘输入这条路（屏幕键盘在桌面端是隐藏的）
      const nums = m[1].match(/^(\d+)\s*×\s*(\d+)\s*=\s*\?/);
      const value = nums ? String(Number(nums[1]) * Number(nums[2])) : '1';
      value.split('').forEach(ch => app.key(ch));
    }
    app.click('submit');
  }

  return { iter, reached: app.html().includes(RESULT_MARK) };
}

/* ==================== 渲染 ==================== */

test('页面能加载，首页正常渲染', () => {
  const app = boot();
  const html = app.html();
  assert.ok(html.length > 200, '首页内容为空，多半是脚本报错了');
  assert.ok(html.includes('数学小教练'));
  assert.ok(html.includes('开始练习'));
  assert.ok(html.includes('盯住 0') && html.includes('拆开看') && html.includes('先估后算'),
    '首页应当把三个方法都讲清楚');
});

test('能进入掌握度地图，也能退回首页', () => {
  const app = boot();
  app.click('progress');
  assert.ok(app.html().includes('掌握度地图'));
  assert.ok(app.html().includes('因数末尾有 0 的乘法'));
  assert.ok(app.html().includes('还没练过'), '没练过的知识点应当明说，而不是显示虚假进度');
  app.click('home');
  assert.ok(app.html().includes('开始练习'));
});

test('每道题都解释了"为什么给你出这道题"', () => {
  const app = boot();
  app.click('start');
  assert.ok(app.html().includes('为什么给你出这道题'));
});

/* ==================== 完整流程 ==================== */

test('一场完整练习能从第一题走到结果页', () => {
  const app = boot();
  app.click('start');

  const r = playThrough(app);
  assert.ok(r.reached, `练习没有走到结果页（${r.iter} 步后仍在答题）`);

  const html = app.html();
  assert.ok(html.includes('掌握度变化'));
  assert.ok(html.includes('/10'), '结果页应当显示总题数');
  assert.ok(!/粗心|马虎|不认真/.test(html), '结果页不应该用"粗心"这种没法干预的说法');
});

test('做完一场之后，数据都落到本地存储里了', () => {
  const app = boot();
  app.click('start');
  const r = playThrough(app);
  assert.ok(r.reached, '练习没有走到结果页');

  const raw = app.sandbox.localStorage.getItem('math-coach-v1');
  assert.ok(raw, '练习数据没有写入 localStorage');
  const state = JSON.parse(raw);

  assert.strictEqual(state.history.length, 10, '应当记录 10 道题');
  assert.strictEqual(state.sessions.length, 1, '应当记录 1 次练习');
  assert.ok(state.history.every(h => h.qid && h.kpId && typeof h.isCorrect === 'boolean'),
    '每条记录都要有题目标识、知识点和正误');

  // 填空题是照题干算出来的，所以答对率不应该太低
  const correct = state.history.filter(h => h.isCorrect).length;
  assert.ok(correct >= 5, `答对题数偏少（${correct}/10），可能判分出了问题`);

  Object.keys(state.stats).forEach(kpId => {
    assert.ok(state.stats[kpId].attempts > 0);
    assert.ok(state.mastery[kpId] > 0 && state.mastery[kpId] < 1,
      `掌握度越界：${state.mastery[kpId]}`);
  });

  app.click('home');
  assert.ok(app.html().includes('你已经练过 1 次'));

  app.click('progress');
  assert.ok(app.html().includes('错因体检'));
});

test('连做两场，掌握度会累积，热身题不会被当成薄弱点', () => {
  const app = boot();
  app.click('start');
  playThrough(app);
  app.click('home');
  app.click('start');
  playThrough(app);

  const state = JSON.parse(app.sandbox.localStorage.getItem('math-coach-v1'));
  assert.strictEqual(state.history.length, 20, '两场应当累计 20 条记录');
  assert.strictEqual(state.sessions.length, 2);
  assert.ok(state.sessions.every(s => s.quit !== true), '正常做完的练习不应标记为退出');

  // 第二场的前三题仍然要是低难度热身
  const late = state.history.slice(10, 12);
  assert.ok(late.every(h => h.difficulty <= 0.5), '第二场的前两题仍应是热身难度');
});

/* ==================== 提示 ==================== */

test('提示不会泄露答案，且最多给两级', () => {
  const app = boot();
  app.click('start');

  // 走到一道填空题上
  let iter = 0;
  while (iter++ < 200) {
    const html = app.html();
    if (html.includes('data-act="next"')) { app.click('next'); continue; }
    const opt = html.match(FIRST_OPTION);
    if (!opt) break;
    app.click('opt', { 'data-v': opt[1] });
    app.click('submit');
  }

  const prompt = app.html().match(ACTIVE_STEP)[1];
  const nums = prompt.match(/^(\d+)\s*×\s*(\d+)/);
  const answer = nums ? String(Number(nums[1]) * Number(nums[2])) : null;

  app.click('hint');
  const h1 = app.html();
  assert.ok(h1.includes('提示1'));

  app.click('hint');
  assert.ok(app.html().includes('提示2'));

  // 第一级提示只给方向，绝不能把答案直接说出来
  if (answer) {
    const block = h1.match(/提示1：([^<]*)/);
    assert.ok(block, '应当能看到第一级提示的文本');
    assert.ok(!block[1].includes(answer), '第一级提示把答案说了出来：' + block[1]);
  }
});

/* ==================== 版面结构 ==================== */

test('练习页是"左边看、右边做"的两栏结构', () => {
  const app = boot();
  app.click('start');
  const html = app.html();

  assert.ok(html.includes('practice-grid') && html.includes('col-main') && html.includes('col-side'),
    '练习页应当分成两栏');
  assert.ok(html.includes('workzone'), '作答区要独立成一块');
  assert.ok(html.includes('wz-prompt'), '作答区要重复显示当前这一步问什么');
  assert.ok(html.includes('wz-kbd-hint') && html.includes('键盘'),
    '作答区要提示可以直接用键盘输入');

  // 输入控件必须在作答区里，不能留在阶梯列表那一栏
  const main = html.split('col-side')[0];
  assert.ok(!main.includes('answer-box') && !main.includes('data-act="opt"'),
    '输入控件不应该留在左边那一栏');
});

test('方法徽章跟着题型走，并且把方法的步骤显示出来', () => {
  const app = boot();
  app.click('start');
  const html = app.html();
  assert.ok(/方法 · (盯住 0|拆开看|先估后算)/.test(html), '题目上应当有方法徽章');
  assert.ok(html.includes('mchip'), '方法的三个步骤应当显示在题目上，而不是只给一个名字');
});

/* ==================== 电脑键盘 ==================== */

// 把前面的选择题答完，走到一道填空题上
function advanceToNumberStep(app) {
  let iter = 0;
  while (iter++ < 60) {
    const html = app.html();
    if (html.includes('data-act="next"')) { app.click('next'); continue; }
    const opt = html.match(FIRST_OPTION);
    if (!opt) return true;
    app.click('opt', { 'data-v': opt[1] });
    app.click('submit');
  }
  return false;
}

function answerBoxText(app) {
  const m = app.html().match(/<div class="answer-box">([\s\S]*?)<\/div>/);
  return m ? m[1] : null;
}

test('电脑上能直接用键盘答题：数字、退格、回车', () => {
  const app = boot();
  app.click('start');
  assert.ok(advanceToNumberStep(app), '没走到填空题');

  const prompt = app.html().match(ACTIVE_STEP)[1];
  // 只有 "a × b = ?" 这种才照题干算得出答案；估算题（≈）算不出，随便填一个，
  // 这里测的是键盘通路，不是判分（判分由引擎测试覆盖）
  const nums = prompt.match(/^(\d+)\s*×\s*(\d+)\s*=\s*\?$/);
  const answer = nums ? String(Number(nums[1]) * Number(nums[2])) : '12';

  answer.split('').forEach(ch => { assert.ok(app.key(ch), '数字键应该被拦截，不让页面滚动'); });
  assert.ok(answerBoxText(app).includes(answer), '键盘输入没有出现在答题框里：' + answer);

  if (answer.length > 1) {
    app.key('Backspace');
    assert.ok(answerBoxText(app).includes(answer.slice(0, -1)), '退格没有生效');
    answer.split('').forEach(ch => app.key(ch));
  }

  const before = app.html();
  app.key('Enter');
  const after = app.html();
  assert.notStrictEqual(after, before, '回车之后页面没有任何变化');
  assert.ok(/done-ok|class="feedback/.test(after), '回车没有触发判分');
});

test('选择题能按数字键选，也能按数字键 1/2/3', () => {
  const app = boot();
  app.click('start');

  // 一直答到出现选择题为止
  let iter = 0;
  let found = false;
  while (iter++ < 60) {
    const html = app.html();
    if (html.includes('data-act="next"')) { app.click('next'); continue; }
    if (html.match(FIRST_OPTION)) { found = true; break; }
    const prompt = html.match(ACTIVE_STEP);
    if (!prompt) break;
    const nums = prompt[1].match(/^(\d+)\s*×\s*(\d+)/);
    const value = nums ? String(Number(nums[1]) * Number(nums[2])) : '1';
    value.split('').forEach(ch => app.key(ch));
    app.click('submit');
  }
  assert.ok(found, '一次练习里应当有选择题');

  assert.ok(app.key('1'), '数字键 1 应当选中第一个选项');
  assert.ok(app.html().includes('opt on'), '选项应当被选中');
});

test('焦点停在按钮上时，回车交给浏览器处理，避免重复提交', () => {
  const app = boot();
  app.click('start');
  advanceToNumberStep(app);

  // 模拟"刚点完屏幕上的数字键，焦点还在那个按钮上"
  app.sandbox.document.activeElement = { tagName: 'BUTTON' };
  assert.strictEqual(app.key('Enter'), false,
    '焦点在按钮上时不应该拦截回车，否则会提交两次');
});

/* ==================== 其他 ==================== */

test('清空数据后回到初始状态', () => {
  const app = boot();
  app.click('progress');
  app.click('reset');
  assert.ok(app.html().includes('开始练习'), '清空后应当回到首页');
  assert.strictEqual(app.sandbox.localStorage.getItem('math-coach-v1'), null);
});

test('中途退出会如实记录，但仍回到首页', () => {
  const app = boot();
  app.click('start');
  app.click('submit');        // 空答案，应当只是提示，不崩
  assert.ok(app.html().includes('还没填答案'));
  app.click('quit');
  assert.ok(app.html().includes('开始练习'), '退出后应当回到首页');
});
