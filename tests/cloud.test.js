/*
 * 跨设备同步测试（数学：报告只读取）
 *
 * 数学这边不做批改闭环（程序自己判分，没有"待家长批改"），只做一件事：
 * 孩子在这台设备练完，家长在另一台设备的报告页能看到。
 *
 * 要钉住的三条：
 *  1. 没开家庭码时一次请求都不发 —— 这个项目原本是"数据只在这台设备上"。
 *  2. 快照只带最近的一小段（覆盖写），不把全量历史搬上去。
 *  3. 清空数据要连云端那份一起清（留墓碑），否则别的设备还能看到旧数据。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const noop = () => {};

function boot() {
  const els = { app: { id: 'app', innerHTML: '', _click: [], _input: [],
    addEventListener(type, fn) { if (type === 'click') this._click.push(fn); if (type === 'input') this._input.push(fn); },
    getAttribute() { return null; } } };
  const bag = {};
  const calls = [];

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
      addEventListener: noop
    },
    scrollTo: noop,
    confirm: () => true,
    alert: noop,
    addEventListener: noop,
    visualViewport: { addEventListener: noop },
    requestAnimationFrame: fn => fn(),
    // 云函数替身：记下请求，永远返回成功
    fetch: (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: {} }) });
    },
    Date, Math, JSON, Promise, Object, Array, String, Number, Error
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
    const a = { 'data-act': dataAct };
    Object.keys(attrs || {}).forEach(k => { a[k.indexOf('data-') === 0 ? k : 'data-' + k] = attrs[k]; });
    els.app._click[0]({
      target: {
        _a: a,
        closest() { return this; },
        getAttribute(n) { return n in this._a ? this._a[n] : null; },
        blur: noop
      }
    });
  }

  function type(id, value) { els.app._input[0]({ target: { id, value } }); }

  return { sandbox, calls, click, type };
}

function flush() { return new Promise(r => setImmediate(r)); }

test('没开家庭码：一次请求都不发，还是原来那个纯本地项目', async () => {
  const t = boot();
  t.sandbox.__mc.pushReport();
  await flush();
  assert.strictEqual(t.calls.length, 0);
  assert.strictEqual(t.sandbox.FamilySync.on(), false);
});

test('开了家庭码：练完一场会把统计传上去（覆盖写，不是累积）', async () => {
  const t = boot();
  const app = t.sandbox.__mc.app;

  // 造点数据：120 场、300 条作答
  app.state.sessions = [];
  for (let i = 0; i < 120; i++) {
    app.state.sessions.push({ id: 's' + i, startedAt: Date.now(), endedAt: Date.now(), total: 10, correct: 8 });
  }
  app.state.history = [];
  for (let i = 0; i < 300; i++) {
    app.state.history.push({ ts: Date.now(), kpId: 'M4A-04-04', isCorrect: i % 2 === 0, timeSpentMs: 5000 });
  }

  t.sandbox.FamilySync.enable('k3f9-7wq2-xm4p');
  t.sandbox.__mc.pushReport();
  await flush();

  const push = t.calls.filter(c => c.action === 'report.push');
  assert.strictEqual(push.length, 1, '练完要传一次');
  assert.strictEqual(push[0].snapshot.sessions.length, 100, '只带最近 100 场，不把全量搬上去');
  assert.strictEqual(push[0].snapshot.history.length, 200, '只带最近 200 条');
  assert.strictEqual(push[0].snapshot.history[199].timeSpentMs, 5000);
  assert.ok(push[0].dev, '带上设备标识，家长才分得清是哪一台');
});

test('报告页拉别的设备的统计，本机那份不算"别的设备"', async () => {
  const t = boot();
  t.sandbox.FamilySync.enable('k3f9-7wq2-xm4p');
  const myDev = t.sandbox.FamilySync.sync().dev;

  // 云函数返回两台设备：本机 + 另一台
  t.sandbox.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      code: 0,
      data: {
        reports: [
          { dev: myDev, ts: Date.now(), snapshot: { devName: '本机', history: [{ isCorrect: true }] } },
          { dev: 'otherdev', ts: Date.now(), snapshot: { devName: '平板', sessions: [{}, {}], history: [{ isCorrect: true }, { isCorrect: false }] } }
        ]
      }
    })
  });

  t.click('parent');
  t.type('passInput', '1234');
  t.click('set-pass');
  await flush();

  const app = t.sandbox.__mc.app;
  assert.strictEqual(app.cloudReports.length, 2);
  const html = t.sandbox.document.getElementById('app').innerHTML;
  assert.ok(html.indexOf('别的设备上') >= 0, '报告页要显示别的设备那一段');
  assert.ok(html.indexOf('平板') >= 0);
  assert.ok(html.indexOf('50%') >= 0, '另一台 2 题对 1 题 = 50%');
});

test('家长在自己手机上看报告：本机一场没练，也能看到孩子那台设备的场次和错题', async () => {
  const t = boot();
  const app = t.sandbox.__mc.app;

  // 这台设备（家长的手机）从没练过
  app.state.history = [];
  app.state.sessions = [];
  app.state.stats = {};
  t.sandbox.FamilySync.enable('k3f9-7wq2-xm4p');

  const now = Date.now();
  t.sandbox.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      code: 0,
      data: {
        reports: [{
          dev: 'otherdev', ts: now,
          snapshot: {
            devName: '平板',
            sessions: [{ id: 's1', startedAt: now - 60000, endedAt: now, total: 10, correct: 8 }],
            history: [
              { ts: now - 5000, kpId: 'M4A-04-04', sessionId: 's1', isCorrect: false, timeSpentMs: 9000, tags: ['FORGOT_ZEROS'] },
              { ts: now, kpId: 'M4A-04-04', sessionId: 's1', isCorrect: true, timeSpentMs: 4000 }
            ],
            stats: { 'M4A-04-04': { attempts: 10, corrects: 8, wrongs: 2 } }
          }
        }]
      }
    })
  });

  t.click('parent');
  t.type('passInput', '1234');
  t.click('set-pass');
  await flush();

  const out = t.sandbox.document.getElementById('app').innerHTML;
  assert.ok(out.indexOf('练了 1 次') >= 0, '要看到孩子那台设备练的场次');
  assert.ok(out.indexOf('10 题对 8 题') >= 0, '场次统计要用云端的');
  assert.ok(out.indexOf('80%') >= 0, '知识点正确率按累加后的统计算');
});

test('清空数据：云端那份也要跟着清（不然别的设备还能看到旧数据）', async () => {
  const t = boot();
  t.sandbox.FamilySync.enable('k3f9-7wq2-xm4p');

  t.click('parent');
  t.type('passInput', '1234');
  t.click('set-pass');
  t.click('reset');
  await flush();

  const clear = t.calls.filter(c => c.action === 'clear');
  assert.strictEqual(clear.length, 1, '清空要通知云端留墓碑');
  assert.strictEqual(clear[0].dev, t.sandbox.FamilySync.sync().dev);
});
