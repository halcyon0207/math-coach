/*
 * 知识点图谱 —— 西师大版《数学》四年级上册（2026 年 6 月第 1 版，西南大学出版社）
 *
 * 说明：
 *  - 教材页码为课本实际页码，不是 PDF 页码（PDF 页码 = 课本页码 + 5）。
 *  - prereq 是"前置知识点"，用于溯源：某个知识点薄弱时，先去检查它的前置。
 *    没有依赖图，溯源就只能靠猜；有了它，溯源可以变成"出几道前置题去确认"。
 *  - method / methodTip 是这一版刻意加的东西：把方法命名并显式呈现给孩子，
 *    四年级的孩子还不会自发总结方法，命名之后他才可能把它迁移到别的科目。
 *  - 本期实现 5 个知识点：第四单元三个（乘法）+ 第一单元两个（改写、求近似数）。
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Knowledge = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 方法论：给"方法"起名字，并在界面上显性呈现
  var METHODS = {
    'M-COUNT-ZERO': {
      id: 'M-COUNT-ZERO',
      name: '盯住 0',
      tip: '先算前面有效数字的积，再数一数末尾一共有几个 0，最后把 0 补回去。',
      steps: ['算有效部分', '数末尾的 0', '把 0 补回去']
    },
    'M-SPLIT': {
      id: 'M-SPLIT',
      name: '拆开看',
      tip: '乘数末尾没有 0，补 0 那招就用不上了。把乘数拆成"整十数 + 个位数"，一道难的就变成两道简单的。',
      steps: ['把乘数拆成整十 + 个位', '分别算两部分', '加起来']
    },
    'M-ESTIMATE': {
      id: 'M-ESTIMATE',
      name: '先估后算',
      tip: '先把因数看成接近的整十整百数，估一个大概的结果；算完对一下，位数差太多就说明算错了。',
      steps: ['看成整十整百', '估一个大概', '算完对一对']
    },
    'M-CHANGE-UNIT': {
      id: 'M-CHANGE-UNIT',
      name: '四位一截',
      tip: '改写成用"万"作单位的数，就是去掉末尾 4 个 0 再写"万"；改写成"亿"要去掉 8 个 0。',
      steps: ['看清要改写成哪个单位', '去掉末尾对应的 0', '写上"万"或"亿"']
    },
    'M-LOOK-NEXT': {
      id: 'M-LOOK-NEXT',
      name: '看下一位',
      tip: '要省略哪一位后面的尾数，就看它右边那一位：是 0~4 就舍去，是 5~9 就进 1。',
      steps: ['确定省略到哪一位', '看它右边那一位是几', '小于 5 舍去，5 及以上进 1']
    }
  };

  var KNOWLEDGE = [
    // ---------- 第四单元 两、三位数乘两位数 ----------
    {
      id: 'M4A-04-01',
      name: '整十、整百数相乘的口算',
      unit: '第四单元　两、三位数乘两位数',
      bookPage: 44,
      prereq: [],
      difficultyBase: 0.30,
      method: 'M-COUNT-ZERO',
      implemented: true
    },
    {
      id: 'M4A-04-04',
      name: '因数末尾有 0 的乘法',
      unit: '第四单元　两、三位数乘两位数',
      bookPage: 46,
      prereq: ['M4A-04-01'],
      difficultyBase: 0.52,
      // 主要方法。注意同一知识点里不同题型的解法可能不同，
      // 题目上显示的方法以模板为准（见 templates.js 的 spec.method）。
      method: 'M-COUNT-ZERO',
      implemented: true
    },
    {
      id: 'M4A-04-06',
      name: '乘法估算',
      unit: '第四单元　两、三位数乘两位数',
      bookPage: 57,
      prereq: ['M4A-04-01'],
      difficultyBase: 0.45,
      method: 'M-ESTIMATE',
      implemented: true
    },

    // ---------- 第一单元 万以上数的认识 ----------
    // 这一单元里只有这两块适合本系统：改写和求近似数的答案都是一个数，
    // 能由程序算出来，也能按"孩子真实会怎么错"反推出干扰项。
    // 读数、写数、数位顺序表、大小比较是记忆与概念型的内容，
    // 硬凑成"错因探针"只会污染归因数据，暂不纳入。
    {
      id: 'M4A-01-05',
      name: '改写（以万、亿为单位）',
      unit: '第一单元　万以上数的认识',
      bookPage: 14,
      prereq: [],
      difficultyBase: 0.4,
      method: 'M-CHANGE-UNIT',
      implemented: true
    },
    {
      id: 'M4A-01-06',
      name: '求近似数（四舍五入、省略尾数）',
      unit: '第一单元　万以上数的认识',
      bookPage: 17,
      prereq: ['M4A-01-05'],
      difficultyBase: 0.5,
      method: 'M-LOOK-NEXT',
      implemented: true
    },

    // ---------- 以下为后续待实现的图谱（本期只登记，不出题） ----------
    {
      id: 'M4A-02-03',
      name: '角的分类与计算',
      unit: '第二单元　角的度量',
      bookPage: 34,
      prereq: [],
      difficultyBase: 0.45,
      method: null,
      implemented: false
    },
    {
      id: 'M4A-03-01',
      name: '平行与垂直的判断',
      unit: '第三单元　相交与平行',
      bookPage: 39,
      prereq: [],
      difficultyBase: 0.4,
      method: null,
      implemented: false
    },
    {
      id: 'M4A-04-03',
      name: '因数中间有 0 的乘法',
      unit: '第四单元　两、三位数乘两位数',
      bookPage: 49,
      prereq: ['M4A-04-01'],
      difficultyBase: 0.58,
      method: 'M-SPLIT',
      implemented: false
    },
    {
      id: 'M4A-05-01',
      name: '单价 × 数量 = 总价',
      unit: '第五单元　常见的数量关系',
      bookPage: 60,
      prereq: [],
      difficultyBase: 0.45,
      method: 'M-SPLIT',
      implemented: false
    },
    {
      id: 'M4A-05-02',
      name: '速度 × 时间 = 路程',
      unit: '第五单元　常见的数量关系',
      bookPage: 63,
      prereq: ['M4A-05-01'],
      difficultyBase: 0.5,
      method: 'M-SPLIT',
      implemented: false
    },
    {
      id: 'M4A-06-04',
      name: '面积单位换算',
      unit: '第六单元　长方形、正方形的面积',
      bookPage: 78,
      prereq: [],
      difficultyBase: 0.55,
      method: null,
      implemented: false
    }
  ];

  var byId = {};
  KNOWLEDGE.forEach(function (k) { byId[k.id] = k; });

  return {
    METHODS: METHODS,
    KNOWLEDGE: KNOWLEDGE,
    byId: function (id) { return byId[id] || null; },
    implemented: function () {
      return KNOWLEDGE.filter(function (k) { return k.implemented; });
    }
  };
});
