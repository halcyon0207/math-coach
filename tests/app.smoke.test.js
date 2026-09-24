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

const noop = () => {};

function makeEl(id) {
  return {
    id,
    innerHTML: '',
    _click: [],
    _input: [],
    addEventListener(type, fn) {
      if (type === 'click') this._click.push(fn);
      if (type === 'input') this._input.push(fn);
    },
    getAttribute() { return null; }
  };
}

// 画布替身：ctx 上的一切当空操作，指针事件记下来供测试触发。
// 以前 getElementById 根本不返回画布，attachCanvas 每次都直接 return ——
// 于是"画笔绑定""转屏重量尺寸"这两条路径一次都没跑过。
function makeCanvas(id) {
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  return {
    id, style: {}, width: 0, height: 0, _ptr: {},
    parentNode: { clientWidth: 320, clientHeight: 160 },
    getContext: () => ctx,
    addEventListener(type, fn) { (this._ptr[type] = this._ptr[type] || []).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: noop
  };
}

// persisted：预先塞进 localStorage 的内容，用来测"带着旧数据重新打开"。
// 以前所有用例都是从零启动的，于是"选过的单元会记住""记录不会丢"
// 这些承诺其实一次都没被验过。
function boot(persisted) {
  const els = { app: makeEl('app'), qCanvas: makeCanvas('qCanvas') };
  const bag = persisted ? { 'math-coach-v1': JSON.stringify(persisted) } : {};
  const keyHandlers = [];
  const winHandlers = {};

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
    alert: () => {},
    // app.js 会挂 resize / visualViewport 监听（转屏、软键盘收起后要重量画布尺寸）
    addEventListener: (t, fn) => { (winHandlers[t] = winHandlers[t] || []).push(fn); },
    visualViewport: { addEventListener: (t, fn) => { (winHandlers[t] = winHandlers[t] || []).push(fn); } },
    requestAnimationFrame: fn => fn(),
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  ['knowledge', 'templates', 'engine', 'store', 'cloud', 'app'].forEach(name => {
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

  // 真的"转一次屏"：先改容器宽度，再触发 app.js 挂上的 resize 监听
  function resize() {
    (winHandlers.resize || []).forEach(fn => fn({ type: 'resize' }));
  }

  // 往输入框里打字：触发 app.js 挂在 #app 上的 input 监听
  function type(id, value) {
    const input = els.app._input[0];
    assert.ok(input, '页面没有注册输入监听，说明 app.js 没有正常初始化');
    input({ target: { id, value } });
  }

  return {
    els, sandbox, canvas: els.qCanvas, click, key, resize, type,
    html: () => els.app.innerHTML,
    state: () => JSON.parse(bag['math-coach-v1'] || '{}')
  };
}

// 当前步骤的题干。单栏内联之后作答控件就排在它下面，
// 所以锚定 `<li class="step active">` 里的那个 step-prompt ——
// 已经做完的步骤也带着 step-prompt，不能随便抓一个。
const ACTIVE_STEP = /<li class="step active"[\s\S]*?<span class="step-prompt">([^<]+)<\/span>/;
const FIRST_OPTION = /data-act="opt" data-v="([^"]+)"/;

// 能照题干算出答案的填空题，返回答案；算不出就返回 null（这类题后面不断言对错）。
//
// 早先这里只认 "a × b = ?" 一种，加了改写、求近似数、三角尺拼角之后就不够用了：
// 那些题会被填成 '1' 判错，看起来像"判分坏了"，其实是测试自己算不出答案。
function computableAnswer(p) {
  let m;
  if ((m = p.match(/^(\d+)\s*×\s*(\d+)\s*=\s*\?$/))) return String(Number(m[1]) * Number(m[2]));
  if ((m = p.match(/^(\d+)\s*=\s*（　）万$/))) return String(Math.round(Number(m[1]) / 10000));
  if ((m = p.match(/^(\d+)\s*=\s*（　）亿$/))) return String(Math.round(Number(m[1]) / 1e8));
  if ((m = p.match(/^(\d+)\s*≈\s*（　）万$/))) return String(Math.round(Number(m[1]) / 10000));
  if ((m = p.match(/^(\d+)\s*≈\s*（　）亿$/))) return String(Math.round(Number(m[1]) / 1e8));
  if ((m = p.match(/^(\d+)°\s*\+\s*(\d+)°\s*=\s*\?$/))) return String(Number(m[1]) + Number(m[2]));
  if ((m = p.match(/^(\d+)°\s*−\s*(\d+)°\s*=\s*\?$/))) return String(Number(m[1]) - Number(m[2]));

  // v2.8 新增的四种问法。测试算不出答案时只会填 '1' 判错，
  // 于是"答对 → 撤一步支架"那条路径在这些题上从来没走过一遍。
  if ((m = p.match(/^(\d+)\s*×\s*(\d+)\s*≈\s*\?/))) {
    return String(Math.round(Number(m[1]) / 10) * 10 * Number(m[2]));   // 只凑整两位数那个
  }
  if ((m = p.match(/^(\d+)\s*省略万位后面的尾数，约是多少万？$/))) return String(Math.round(Number(m[1]) / 10000));
  if ((m = p.match(/^(\d+)\s*改写成用「万」作单位的数，是多少万？$/))) return String(Number(m[1]) / 10000);
  if (/^1 个平角 = （　）个直角$/.test(p)) return '2';
  return null;
}

// 把一场练习从头开到尾。
// 填空题照题干算出正确答案；选择题点第一个选项
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
      const value = computableAnswer(m[1]) || '1';
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

/* -------------------- 难度档位要看得见 -------------------- */
// 孩子问的是"为什么一直这么简单"。光把闸门做对不够 ——
// 他得看见这一题是哪一档、以及这一档在练什么，才知道不是系统小看他。

// 把所有知识点的掌握度和练习记录一次性拉满 / 拉到某个值
function allPracticed(mastery) {
  const K = require('../js/knowledge.js');
  const st = {}, masteryMap = {};
  K.implemented().forEach(k => {
    masteryMap[k.id] = mastery;
    st[k.id] = {
      attempts: 8, corrects: 8, wrongs: 0, lastPracticedAt: Date.now(),
      level: 2, dueAt: Date.now() + 86400000, streak: 4, wrongStreak: 0
    };
  });
  return { mastery: masteryMap, stats: st };
}

test('练习页显示这一题的难度档位', () => {
  const app = boot();
  app.click('start');
  const html = app.html();
  assert.ok(/badge-tier/.test(html), '题目上该有档位徽章');
  assert.ok(/tier-(BASE|SOLID|CHALLENGE)/.test(html), '徽章要带档位，不能只写个"题"');
  assert.ok(/>(基础|巩固|挑战)</.test(html), '徽章要写字，不能只有颜色');
});

test('巩固 / 挑战档会说明这一档在练什么；基础档不啰嗦', () => {
  const app = boot(allPracticed(0.95));
  let sawHigh = false;
  for (let i = 0; i < 10 && !sawHigh; i++) {
    app.click('home');                  // 上一场可能停在结果页，先回首页再开新的一场
    app.click('start');
    let guard = 0;
    while (guard++ < 40) {
      const html = app.html();
      if (/tier-(SOLID|CHALLENGE)/.test(html)) {
        sawHigh = true;
        assert.ok(/why-tier/.test(html),
          '高档题要同时说出这一档在练什么，光贴个"挑战"标签等于吓孩子');
        assert.ok(/绕个弯|接在一起|说清楚/.test(html), '那一行要说的是这一档在练什么');
        break;
      }
      if (/data-act="next"/.test(html)) { app.click('next'); continue; }
      if (html.includes(RESULT_MARK)) break;
      const m = html.match(ACTIVE_STEP);
      if (!m) break;
      const opt = html.match(FIRST_OPTION);
      if (opt) app.click('opt', { 'data-v': opt[1] });
      else {
        const v = computableAnswer(m[1]) || '1';
        v.split('').forEach(ch => app.key(ch));
      }
      app.click('submit');
    }
  }
  assert.ok(sawHigh, '掌握度 0.95 连开十场都没见过巩固 / 挑战档 —— 门禁把题锁死了');

  const low = boot(allPracticed(0.05));
  let sawLowOnly = true;
  for (let i = 0; i < 6 && sawLowOnly; i++) {
    low.click('home');
    low.click('start');
    // 第一场的第一题是热身题，它必须是基础档
    if (/tier-(SOLID|CHALLENGE)/.test(low.html())) sawLowOnly = false;
  }
  assert.ok(sawLowOnly, '掌握度 0.05 就该只看到基础档');
});

test('掌握度地图写清楚解锁到哪一档，没练过的不写', () => {
  const K = require('../js/knowledge.js');
  const base = allPracticed(0.95);
  // 留两个知识点"没练过"：一个掌握度 0.5（巩固），一个 0.05（基础）
  const ids = K.implemented().map(k => k.id);
  const solidKp = ids[0], baseKp = ids[1], untouchedKp = ids[2];
  base.mastery[solidKp] = 0.5;
  base.mastery[baseKp] = 0.05;
  delete base.stats[untouchedKp];
  base.mastery[untouchedKp] = 0.3;          // 默认先验，不该被当成进度

  const app = boot(base);
  app.click('progress');
  const html = app.html();

  assert.ok(/已解锁挑战题/.test(html), '掌握度 0.95 的知识点该显示解锁到挑战档');
  assert.ok(/已解锁巩固题|只出基础题/.test(html), '中间档也要有个说法');
  assert.ok((html.match(/kp-tier/g) || []).length === K.implemented().length - 1,
    '每个练过的知识点各有一行档位说明，没练过的不该有');
});

test('转屏重量画布尺寸，不会把指针事件绑第二遍', () => {
  const app = boot();
  app.click('start');
  assert.ok(app.canvas.width > 0, '画布应当已经按容器铺好（不然画笔是死的）');
  assert.strictEqual(app.canvas._ptr.pointerdown.length, 1, '练习页应当绑一次画笔事件');

  app.canvas.parentNode.clientWidth = 240;
  app.resize();
  assert.strictEqual(app.canvas.width, 240, '转屏之后位图宽度要跟着重量');
  assert.strictEqual(app.canvas._ptr.pointerdown.length, 1,
    '再绑一遍的话，一次落笔会被记成两笔，家长看到的题上全是重影');
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

  // 填空题是照题干算出来的，所以填空题必须全对 —— 判分要是坏了，这里先炸。
  //
  // 不能用"总共对几题"来判断：选择题是故意点第一个选项（大多是错的），
  // 好把"答错 → 提示 → 揭示答案"那条路走一遍。第二单元选择题多了以后，
  // 总正确率自然降下来，但那不是判分坏了。
  const checkable = state.history.filter(h => computableAnswer(h.stem || '') !== null);
  assert.ok(checkable.length > 0, '一场练习里应当有能照题干算出答案的填空题');
  checkable.forEach(h => {
    assert.ok(h.isCorrect, `「${h.stem}」照题干算出的答案应当判对，实际判错了`);
  });

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
  assert.ok(h1.includes('提示1'), '点第一次「我要提示」应当出现提示1');

  app.click('hint');
  assert.ok(app.html().includes('提示2'), '点第二次「我要提示」应当出现提示2');

  // 第一级提示只给方向，绝不能把答案直接说出来
  if (answer) {
    const block = h1.match(/提示1：([^<]*)/);
    assert.ok(block, '应当能看到第一级提示的文本');
    assert.ok(!block[1].includes(answer), '第一级提示把答案说了出来：' + block[1]);
  }
});

/* ==================== 版面结构 ==================== */

test('练习页是单栏：作答控件内联在当前步骤里，不再另起作答区', () => {
  const app = boot();
  app.click('start');
  let html = app.html();

  assert.ok(!html.includes('practice-grid') && !html.includes('col-side') &&
    !html.includes('workzone'),
    '旧的"两栏 + 独立作答区"结构应当已经移除');
  assert.ok(html.includes('card card-q') && html.includes('<ol class="steps">'),
    '题目和步骤应当是同一页里的一列');

  // 键盘提示只在填空题上出现 —— 选择题是点选项，没有"敲数字"这回事。
  // 而第一题的第一步不一定是填空题（阶梯题开头常是一个辅助步骤），
  // 所以必须先走到填空题再看，不能拿第一屏直接断言。
  assert.ok(advanceToNumberStep(app), '没走到填空题');
  html = app.html();
  assert.ok(html.includes('step-kbd-hint') && html.includes('键盘'),
    '当前步骤里要提示可以直接用键盘输入');

  // 输入控件必须在当前步骤（<li class="step active">）里面，
  // 而不是排在阶梯之外 —— 这正是"看到哪儿做到哪儿"的钉法。
  const active = html.match(/<li class="step active"[\s\S]*?<\/li>/);
  assert.ok(active, '找不到当前步骤');
  assert.ok(active[0].includes('answer-box') || active[0].includes('data-act="opt"'),
    '作答控件没有内联在当前步骤里');
});

test('方法徽章跟着题型走，并且把方法的步骤显示出来', () => {
  const app = boot();
  app.click('start');
  const html = app.html();
  // 名单要跟着 knowledge.js 里的 METHODS 一起更新：第一题出到哪个题型是随机的，
  // 只要徽章上的方法名不在这个名单里，这条就会偶发失败（看起来像界面的 bug，其实是漏改名）。
  assert.ok(/方法 · (盯住 0|拆开看|先估后算|四位一截|看下一位|看开口|找整角)/.test(html),
    '题目上应当有方法徽章');
  assert.ok(html.includes('mchip'), '方法的三个步骤应当显示在题目上，而不是只给一个名字');
});

test('看题区有画笔开关，打开后能清掉笔迹', () => {
  const app = boot();
  app.click('start');
  assert.ok(app.html().includes('data-act="pen"'), '题目区应当有画笔开关');

  app.click('pen');
  const on = app.html();
  assert.ok(on.includes('q-canvas on'), '打开画笔后画布应当显示出来');
  assert.ok(on.includes('data-act="pen-clear"'), '打开画笔后应当能清掉笔迹');
});

test('画笔只铺在看题区：开着画笔点得到选项，关了画笔线不藏', () => {
  // 这一条钉的是单栏内联之后冒出来的冲突：画布原来盖住整张题卡，
  // 而选项 / 输入框现在也在题卡里 —— 开着画笔就什么都点不动；
  // 关画笔时画布整个 display:none，笔迹明明还在数据里却看不见了。
  const app = boot();
  app.click('start');
  app.click('pen');
  const html = app.html();

  const stageAt = html.indexOf('q-stage');
  const stepsAt = html.indexOf('<ol class="steps">');
  assert.ok(stageAt >= 0 && stepsAt > stageAt, '结构应当是：看题区在前，步骤在后');
  const stage = html.slice(stageAt, stepsAt);
  assert.ok(stage.includes('q-canvas on'), '画布应当铺在看题区里，且处于开启状态');
  assert.ok(!stage.includes('data-act="opt"') && !stage.includes('answerInput'),
    '作答控件不能落在画布底下，否则开着画笔点不动');
  assert.ok(html.slice(stepsAt).includes('step-prompt'), '步骤要在画布之外');

  app.click('pen');                      // 关掉画笔
  const off = app.html();
  assert.ok(off.includes('id="qCanvas"'),
    '关了画笔画布也要留在页面上（笔迹继续可见，只是不再拦点击）');
  assert.ok(!off.includes('q-canvas on'), '关掉之后画布不该还处于可画状态');
});

test('万以上的题能直接看数位，不用抄到纸上数', () => {
  const app = boot();
  app.click('start');

  // 组卷保证每个知识点都至少出现一次，所以一定能走到第一单元的题
  let iter = 0;
  let seen = false;
  while (iter++ < 200) {
    const html = app.html();
    if (html.includes(RESULT_MARK)) break;

    if (html.includes('data-act="ruler"')) {
      seen = true;
      app.click('ruler');
      const withRuler = app.html();
      assert.ok(withRuler.includes('class="ruler"'), '点了「看看数位」应当显示数位标尺');
      assert.ok(/class="rname"/.test(withRuler), '数位标尺应当标出每一位的数位名称');
      break;
    }

    if (html.includes('data-act="next"')) { app.click('next'); continue; }
    const opt = html.match(FIRST_OPTION);
    if (opt) app.click('opt', { 'data-v': opt[1] });
    else app.key('1');
    app.click('submit');
  }

  assert.ok(seen, '一场练习里应当出现第一单元（改写 / 求近似数）的题');
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

/* ==================== 单元 / 家长报告 ==================== */

test('首页能选单元，选了第一单元就只出第一单元的题', () => {
  const app = boot();
  assert.ok(app.html().includes('data-act="unit"'), '首页应当能选单元');

  // 先随便做一场，让"没练过的知识点优先"那条规则不再干扰这次验证
  app.click('start');
  playThrough(app);
  app.click('home');

  // 先随便做一场，让"没练过的知识点优先"那条规则不再干扰这次验证
  app.click('unit', { u: '第一单元　万以上数的认识' });
  const homeHtml = app.html();
  assert.ok(homeHtml.includes('本次范围：第一单元'), '选单元后应当提示本次范围');
  assert.ok(homeHtml.includes('四位一截') && homeHtml.includes('看下一位'),
    '选第一单元应当显示这个单元的方法');
  assert.ok(!homeHtml.includes('盯住 0'),
    '选第一单元不应当把第四单元的方法也列出来');

  app.click('start');
  playThrough(app);

  const state = JSON.parse(app.sandbox.localStorage.getItem('math-coach-v1'));
  const last = state.history.slice(-10);
  assert.strictEqual(last.length, 10, '第二场应当有 10 道题');
  last.forEach(h => {
    assert.strictEqual(h.kpId.indexOf('M4A-01'), 0,
      `选了第一单元，却出了 ${h.kpId}`);
  });
});

test('家长报告能看到时间、正确率、每题用时和错点', () => {
  const app = boot({ passcode: '2468' });
  app.click('start');
  playThrough(app);
  app.click('home');
  app.click('parent');
  // 报告页现在在口令门后面：先进去，输对口令才看得到内容
  assert.ok(app.html().includes('请输入家长口令'), '应先要口令');
  app.type('passInput', '2468');
  app.click('unlock');

  const html = app.html();
  assert.ok(html.includes('家长报告'), '应当进入家长报告页');
  assert.ok(html.includes('总览'), '应当有总览');
  assert.ok(html.includes('10 题对'), '应当有这一场的正确数');
  assert.ok(html.includes('每题约'), '应当有效率（每题用时）');
  assert.ok(html.includes('错误点都在哪'), '应当有错点统计');
  assert.ok(html.includes('导出全部记录'), '应当能导出记录');
});

/* ==================== 其他 ==================== */

test('首次进家长页先设口令，设好后落盘并进报告', () => {
  const app = boot();               // 没有 passcode
  app.click('parent');
  assert.ok(app.html().includes('先设一个口令'), '没有口令时应引导设置');
  // 太短的直接拒
  app.type('passInput', '12');
  app.click('set-pass');
  assert.ok(app.html().includes('4～6 位'), '口令位数不够要拦住');
  assert.ok(!app.state().passcode, '没设对之前不该落盘');
  // 设成合法的
  app.type('passInput', '2468');
  app.click('set-pass');
  assert.strictEqual(app.state().passcode, '2468', '设好后应写进本地存储');
  assert.ok(app.html().includes('总览'), '设好即可进入报告');
});

test('口令不对进不去；没解锁时报告内容不外泄', () => {
  const app = boot({ passcode: '2468', history: [{ ts: 1, isCorrect: false, stem: '123456 ≈（　）万', stepTags: ['WRONG_DIGIT'] }] });
  app.click('parent');
  assert.ok(app.html().includes('请输入家长口令'));
  assert.ok(!app.html().includes('总览'), '没解锁不该看到报告正文');
  assert.ok(!app.html().includes('123456'), '没解锁不该把错题题干露出来');
  app.type('passInput', '0000');
  app.click('unlock');
  assert.ok(app.html().includes('口令不对'), '错口令应拒绝');
  assert.ok(!app.html().includes('总览'), '错口令后仍不该进去');
});

test('离开家长页后解锁自动失效，回来重新要口令', () => {
  const app = boot({ passcode: '2468' });
  app.click('parent');
  app.type('passInput', '2468');
  app.click('unlock');
  assert.ok(app.html().includes('总览'), '解锁后能看到报告');
  app.click('home');
  app.click('parent');
  assert.ok(app.html().includes('请输入家长口令'), '回来看报告要重新输口令');
});

test('没解锁时点了清空或导出也不会有任何反应', () => {
  const app = boot({ passcode: '2468', history: [{ ts: 1, isCorrect: true }] });
  app.click('parent');              // 停在输口令页
  app.click('reset');               // 假装孩子想办法触发了这两个动作
  assert.ok(app.sandbox.localStorage.getItem('math-coach-v1'), '未解锁不该清空数据');
  assert.ok(app.html().includes('请输入家长口令'), '未解锁点了导出也不该离开本页');
});

test('清空数据后回到初始状态', () => {
  const app = boot({ passcode: '2468' });
  // "清空所有数据"挪进了口令门后面（以前它在孩子能进的掌握度页上，一点就没）
  app.click('progress');
  assert.ok(!app.html().includes('清空所有数据'), '掌握度页不该再有清空按钮');
  app.click('parent');
  app.type('passInput', '2468');
  app.click('unlock');
  assert.ok(app.html().includes('清空所有数据'), '解锁后报告里应有清空');
  app.click('reset');
  assert.ok(app.html().includes('开始练习'), '清空后应当回到首页');
  assert.strictEqual(app.sandbox.localStorage.getItem('math-coach-v1'), null);
});

test('中途退出：一题没答就不该被记成答错', () => {
  const app = boot();
  app.click('start');
  app.click('submit');        // 空答案，应当只是提示，不崩
  assert.ok(app.html().includes('还没填答案'));
  app.click('quit');
  assert.ok(app.html().includes('开始练习'), '退出后应当回到首页');

  // 这是这条测试真正钉的东西：弹窗承诺"没做的不会算"。
  // 以前 quitSession 会无条件提交当前题，把"中途不做了"记成答错 ——
  // 掌握度降一档、错题列表多一条，对一个容易受挫的孩子方向正好相反。
  const raw = app.sandbox.localStorage.getItem('math-coach-v1');
  const saved = raw ? JSON.parse(raw) : null;
  assert.ok(!saved || (saved.history || []).length === 0,
    '没作答就退出，不该产生作答记录');
  assert.ok(!saved || (saved.sessions || []).length === 0,
    '一道没做的练习不该留下一场记录');
});

/* ==================== 重新打开页面之后的数据 ==================== */
// 以前所有用例都是从零启动的：练完关掉、明天再打开这条真实路径一次都没测过。

const U1 = '第一单元　万以上数的认识';

test('带着旧记录重新打开：选过的单元还在', () => {
  const app = boot({
    version: 1, childName: '', createdAt: 1, unit: U1,
    mastery: { 'M4A-01-05': 0.62 },
    stats: { 'M4A-01-05': { attempts: 4, corrects: 3, wrongs: 1, lastPracticedAt: 1, level: 2, dueAt: 0, streak: 0, wrongStreak: 0 } },
    history: [], sessions: []
  });
  const html = app.html();
  assert.ok(html.includes('data-u="' + U1 + '"'), '首页应当列出这个单元');
  assert.ok(html.includes('unit-btn on" data-act="unit" data-u="' + U1 + '"'),
    '上次的单元选择应当在按钮上是选中状态');
  app.click('progress');
  assert.ok(app.html().includes('练过 4 题'), '掌握度地图里该看到上次练过的题量');
});

test('带坏数据重新打开：不能白屏，也不能假装没事', () => {
  // 能 parse 但形状不对（history 是对象）——以前会一路混到 render 里才炸。
  const app = boot({ version: 1, unit: U1, mastery: {}, stats: {}, history: { 0: 'x' }, sessions: 'no' });
  assert.ok(app.html().includes('开始练习'), '形状不对时应当回到可用状态，而不是白屏');

  // 彻底读不出来（不是 JSON）——同样要能用，但要告诉家长数据没了。
  const bad = { 'math-coach-v1': '{ 这不是 JSON' };
  const app2 = boot(bad);
  assert.ok(app2.html().includes('开始练习'), '坏数据不该让页面打不开');
});

test('阶梯题辅助步骤的错因要能在家长报告里看到', () => {
  const tag = 'WRONG_DIGIT';   // 「看的数位不对」——只有 tier 1 那一步探测得到
  const app = boot({
    version: 1, childName: '', createdAt: 1, unit: 'all', passcode: '2468',
    mastery: { 'M4A-01-06': 0.4 },
    stats: { 'M4A-01-06': { attempts: 2, corrects: 1, wrongs: 1, lastPracticedAt: 1, level: 0, dueAt: 0, streak: 0, wrongStreak: 1 } },
    history: [{
      ts: Date.now(), sessionId: 'S1', kpId: 'M4A-01-06', templateId: 'T-0106-A',
      shape: 'approx', qid: 'T-0106-A@{}', difficulty: 0.55, scaffoldLevel: 2,
      stem: '123456 ≈ （　）万', isCorrect: false, attempts: 3,
      errorTag: null, stepTags: [tag], hintLevel: 0, inputType: 'number',
      timeSpentMs: 30000
    }],
    sessions: []
  });
  app.click('parent');
  app.type('passInput', '2468');
  app.click('unlock');
  const html = app.html();
  assert.ok(html.includes('看的数位不对'),
    '辅助步骤测出的错因必须出现在家长报告里，否则这一步的探针白放');
});
