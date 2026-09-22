/*
 * 知识点图谱 —— 西师大版《数学》四年级上册（2026 年 6 月第 1 版，西南大学出版社）
 *
 * 说明：
 *  - 教材页码为课本实际页码，不是 PDF 页码（PDF 页码 = 课本页码 + 5）。
 *  - prereq 是"前置知识点"，用于溯源：某个知识点薄弱时，先去检查它的前置。
 *    没有依赖图，溯源就只能靠猜；有了它，溯源可以变成"出几道前置题去确认"。
 *  - method / methodTip 是这一版刻意加的东西：把方法命名并显式呈现给孩子，
 *    四年级的孩子还不会自发总结方法，命名之后他才可能把它迁移到别的科目。
 *  - 已实现：第一单元（改写、求近似数）、第二单元（角的分类与计算）、
 *    第三单元（平行与垂直）、第四单元（乘法：末尾有 0 / 中间有 0 / 估算）、
 *    第五单元（单价×数量、速度×时间）、第六单元（长方形与正方形的面积、
 *    面积单位换算）、第七单元（读条形统计图）。
 *    第八单元是总复习，不单独出题 —— 它是前面各单元的回炉，
 *    单独做一遍等于把同样的题再出一遍，没有新信息。
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
    },
    'M-ANGLE-TYPE': {
      id: 'M-ANGLE-TYPE',
      name: '看开口',
      tip: '判断是哪一类角，看它张开得多大：比直角小是锐角，方方正正是直角，比直角大又不到 180° 是钝角，张开成一条直线是平角，转一整圈是周角。',
      steps: ['看它张开得多大', '和直角、平角比一比', '对上名字']
    },
    'M-WHOLE-ANGLE': {
      id: 'M-WHOLE-ANGLE',
      name: '找整角',
      tip: '平角 180°、周角 360°。已知其中一块，用整角减去这一块，剩下的就是另一块。',
      steps: ['认出这是平角还是周角', '记住整角是多少度', '减去已知的那一块']
    },
    // ---- 第三单元 相交与平行 ----
    'M-PERP': {
      id: 'M-PERP',
      name: '看夹角',
      tip: '两条直线相交，先看夹角是不是 90°。是 90° 才叫互相垂直 —— 光"相交"不算。',
      steps: ['先看两条直线相交成什么角', '判断是不是 90°', '是就垂直，不是就只是相交']
    },
    'M-PARALLEL': {
      id: 'M-PARALLEL',
      name: '延长看看',
      tip: '判断平不平行，就在脑子里把它们往两头延长：怎么延长都碰不到，才是互相平行（还得在同一个平面里）。',
      steps: ['把两条直线往两头延长', '看它们会不会相交', '永远不相交才算平行']
    },
    // ---- 第五单元 常见的数量关系 ----
    'M-QUANTITY': {
      id: 'M-QUANTITY',
      name: '找三个量',
      tip: '先把三个量找出来：单价 × 数量 = 总价，速度 × 时间 = 路程。知道两个求第三个，就换成除法。',
      steps: ['标出题目给了哪两个量', '套上对应的关系式', '求谁就把谁单独留下来（用除法）']
    },
    // ---- 第六单元 长方形、正方形的面积 ----
    'M-AREA-RECT': {
      id: 'M-AREA-RECT',
      name: '长乘宽',
      tip: '长方形的面积 = 长 × 宽，正方形的面积 = 边长 × 边长。先分清问的是面积还是周长，别拿错公式。',
      steps: ['看清问的是面积还是周长', '面积用长 × 宽', '写上面积单位（平方厘米、平方分米……）']
    },
    'M-UNIT-100': {
      id: 'M-UNIT-100',
      name: '进率是 100',
      tip: '面积单位的进率是 100，不是 10：1 平方米 = 100 平方分米。大换小乘 100，小换大除以 100。',
      steps: ['看清是从大单位换到小单位，还是反过来', '记住相邻面积单位相差 100', '大换小乘 100，小换大除以 100']
    },
    // ---- 第七单元 条形统计图 ----
    'M-READ-CHART': {
      id: 'M-READ-CHART',
      name: '先看一格',
      tip: '读条形统计图先看纵轴：一格代表几个。这一格看错，后面每一项都会跟着错。',
      steps: ['先看纵轴一格代表多少', '再数每根条形占了几格', '最后才比多少、算相差或求和']
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

    // ---------- 第二单元 角的度量（课本 P30—38）----------
    // 错因素材来自同步资料《单元知识要点》里的"易错点 TOP 8"：
    //   认为 180° 是钝角 / 以为边越长角越大 / 记错 1周角=2平角=4直角 / 周角平角搞混。
    // 量角器的读数和画角要真操作，本系统不出 —— 那两样在纸上练更好。
    {
      id: 'M4A-02-02',
      name: '角的分类（锐角 / 直角 / 钝角 / 平角 / 周角）',
      unit: '第二单元　角的度量',
      bookPage: 32,
      prereq: [],
      difficultyBase: 0.4,
      method: 'M-ANGLE-TYPE',
      implemented: true
    },
    {
      id: 'M4A-02-04',
      name: '角的大小关系与三角尺拼角',
      unit: '第二单元　角的度量',
      bookPage: 32,
      prereq: ['M4A-02-02'],
      difficultyBase: 0.5,
      method: 'M-WHOLE-ANGLE',
      implemented: true
    },
    {
      id: 'M4A-02-03',
      name: '角的计算（已知一部分求另一部分）',
      unit: '第二单元　角的度量',
      bookPage: 34,
      prereq: ['M4A-02-02'],
      difficultyBase: 0.5,
      method: 'M-WHOLE-ANGLE',
      implemented: true
    },

    // ---------- 第三单元 相交与平行（课本 P39—43）----------
    // 错因素材来自同步资料里反复出现的那几句：
    //   以为相交就是垂直 / 忘了"同一平面内" / 把斜线当成点到直线的距离。
    // 画垂线、画平行线要真用尺子画，本系统不出 —— 那两样在纸上练更好。
    {
      id: 'M4A-03-01',
      name: '平行与垂直的判断',
      unit: '第三单元　相交与平行',
      bookPage: 39,
      prereq: [],
      difficultyBase: 0.42,
      method: 'M-PERP',
      implemented: true
    },

    // ---------- 第四单元 因数中间有 0（课本 P49）----------
    {
      id: 'M4A-04-03',
      name: '因数中间有 0 的乘法',
      unit: '第四单元　两、三位数乘两位数',
      bookPage: 49,
      prereq: ['M4A-04-01'],
      difficultyBase: 0.58,
      method: 'M-SPLIT',
      implemented: true
    },

    // ---------- 第五单元 常见的数量关系（课本 P60—68）----------
    {
      id: 'M4A-05-01',
      name: '单价 × 数量 = 总价',
      unit: '第五单元　常见的数量关系',
      bookPage: 60,
      prereq: [],
      difficultyBase: 0.45,
      method: 'M-QUANTITY',
      implemented: true
    },
    {
      id: 'M4A-05-02',
      name: '速度 × 时间 = 路程',
      unit: '第五单元　常见的数量关系',
      bookPage: 63,
      prereq: ['M4A-05-01'],
      difficultyBase: 0.5,
      method: 'M-QUANTITY',
      implemented: true
    },

    // ---------- 第六单元 长方形、正方形的面积（课本 P69—90）----------
    // 面积和周长分不清、面积单位进率记成 10 —— 这两个坑是这一单元的主要失分点，
    // 干扰项就是照着这两个坑造的。
    {
      id: 'M4A-06-01',
      name: '长方形的面积',
      unit: '第六单元　长方形、正方形的面积',
      bookPage: 69,
      prereq: [],
      difficultyBase: 0.45,
      method: 'M-AREA-RECT',
      implemented: true
    },
    {
      id: 'M4A-06-02',
      name: '正方形的面积',
      unit: '第六单元　长方形、正方形的面积',
      bookPage: 71,
      prereq: ['M4A-06-01'],
      difficultyBase: 0.42,
      method: 'M-AREA-RECT',
      implemented: true
    },
    {
      id: 'M4A-06-04',
      name: '面积单位换算',
      unit: '第六单元　长方形、正方形的面积',
      bookPage: 78,
      prereq: [],
      difficultyBase: 0.55,
      method: 'M-UNIT-100',
      implemented: true
    },

    // ---------- 第七单元 条形统计图（课本 P92—105）----------
    // 这是全册唯一一个"读图"的知识点，题目形态和前面都不同：
    // 数据是从图上读出来的，不是算出来的。画统计图要在纸上练，这里只练"读"。
    {
      id: 'M4A-07-01',
      name: '读条形统计图',
      unit: '第七单元　条形统计图',
      bookPage: 92,
      prereq: [],
      difficultyBase: 0.5,
      method: 'M-READ-CHART',
      implemented: true
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
    },
    // 已实现知识点涉及的单元，按登记顺序返回。
    // "按单元出题"和首页按单元分组，清单都从这里拿，不另写一份。
    units: function () {
      var seen = {}, out = [];
      KNOWLEDGE.forEach(function (k) {
        if (!k.implemented || seen[k.unit]) return;
        seen[k.unit] = 1;
        out.push(k.unit);
      });
      return out;
    },
    // '第一单元　万以上数的认识' -> '第一单元'（按钮上放不下全名）
    shortUnit: function (u) {
      return String(u || '').split(/\s+/)[0] || String(u || '');
    }
  };
});
