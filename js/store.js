/*
 * 本地存储 —— 数据只存在这台设备上，不上传任何地方。
 * 对一个孩子的数据量（一天几十条）来说，localStorage 完全够用，
 * 也就不需要后端、数据库和账号体系。
 *
 * 什么时候才需要后端？二期接"启发式讲解"要调大模型时。
 * 那时候数据仍然可以留在本地，只把题目和作答作为上下文发给云函数。
 */
(function (root, factory) {
  // 注意：root 必须显式传给工厂。工厂函数是在模块作用域里定义的，
  // 它读不到外层 IIFE 的参数 —— 之前就是这里漏传，导致浏览器里
  // 所有读写都抛 ReferenceError，又被下面的 try/catch 吞掉，
  // 表现是"数据存了但下次打开就没了"。
  var mod = factory(typeof self !== 'undefined' ? self : root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Store = mod;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KEY = 'math-coach-v1';
  var loadFailed = false;   // 上一次 load 有没有读坏

  function defaultState() {
    return {
      version: 1,
      childName: '',
      createdAt: Date.now(),
      mastery: {},    // kpId -> 掌握概率
      stats: {},      // kpId -> { attempts, corrects, wrongs, lastPracticedAt }
      history: [],    // 每一条作答
      sessions: [],   // 每次练习的汇总
      unit: 'all'     // 这次练哪个单元（'all' = 全部混着来）
    };
  }

  // 类型也要校。只写 `s.history || []` 的话，一个"能 parse 但形状不对"的
  // 值（比如 history 是 {}）会一路混进界面，在 render 里才炸 ——
  // 表现出来是"打开就白屏"，比回到空白状态难查得多。
  function obj(v, dflt) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : dflt; }
  function arr(v, dflt) { return Array.isArray(v) ? v : dflt; }
  function str(v, dflt) { return typeof v === 'string' && v ? v : dflt; }

  function load() {
    loadFailed = false;
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') throw new Error('形状不对');
      var d = defaultState();
      return {
        version: s.version || d.version,
        childName: str(s.childName, ''),
        createdAt: s.createdAt || d.createdAt,
        mastery: obj(s.mastery, {}),
        stats: obj(s.stats, {}),
        history: arr(s.history, []),
        sessions: arr(s.sessions, []),
        unit: str(s.unit, 'all')
      };
    } catch (e) {
      loadFailed = true;
      return defaultState();
    }
  }

  function save(state) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      // 存不进去是很严重的事（隐私模式、空间满、被沙箱拦住），
      // 不能静默吞掉 —— 否则表现是"数据凭空消失"，查起来毫无头绪。
      if (root.console && root.console.warn) {
        root.console.warn('[math-coach] 本地保存失败：', e);
      }
      return false;
    }
  }

  function reset() {
    try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    return defaultState();
  }

  return {
    KEY: KEY,
    defaultState: defaultState,
    load: load,
    save: save,
    reset: reset,
    loadFailed: function () { return loadFailed; }
  };
});
