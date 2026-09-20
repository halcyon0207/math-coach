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

  function defaultState() {
    return {
      version: 1,
      childName: '',
      createdAt: Date.now(),
      mastery: {},    // kpId -> 掌握概率
      stats: {},      // kpId -> { attempts, corrects, wrongs, lastPracticedAt }
      history: [],    // 每一条作答
      sessions: []    // 每次练习的汇总
    };
  }

  function load() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      var d = defaultState();
      return {
        version: s.version || d.version,
        childName: s.childName || '',
        createdAt: s.createdAt || d.createdAt,
        mastery: s.mastery || {},
        stats: s.stats || {},
        history: s.history || [],
        sessions: s.sessions || []
      };
    } catch (e) {
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

  return { KEY: KEY, defaultState: defaultState, load: load, save: save, reset: reset };
});
