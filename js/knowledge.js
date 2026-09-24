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
 *    第三单元（平行与垂直）、第四单元（乘法：末尾有 0 / 中间有 0 / 估算 / 积的变化规律）、
 *    第五单元（单价×数量、速度×时间、归一与归总）、第六单元（长方形与正方形的面积、
 *    面积单位换算）、第七单元（读条形统计图）。
 *    第八单元是总复习，不单独出题 —— 它是前面各单元的再回炉，
 *    单独做一遍等于把同样的题再出一遍，没有新信息。
 *  - difficultyBase 只决定"这个知识点平常出多难的题"；每道题属于哪一档
 *    由 TIERS 按模板难度算出来（见文件末尾的分级说明）。
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
    // ---- 第四单元 因数中间有 0 的乘法（教案："0×8=0，必须算，不能漏掉"）----
    // 和「盯住 0」不是一回事：那条管的是末尾的 0（可以最后补），
    // 这一条管的是中间的 0 —— 它就占在那个数位上，跑不掉，也不补回来。
    'M-EACH-DIGIT': {
      id: 'M-EACH-DIGIT',
      name: '每一位都要乘',
      tip: '从个位起一位一位地乘，中间的 0 也要乘到。0 乘任何数都得 0，可这个 0 还占着一个数位，不写就少了一位。',
      steps: ['个位乘一遍', '十位乘一遍（是 0 也要乘）', '百位乘一遍', '哪一位得 0，就在哪一位写 0 占位']
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
    // ---- 第一单元 改写 / 求近似数的符号辨析（教后反思点名的易错）----
    'M-SIGN-CHECK': {
      id: 'M-SIGN-CHECK',
      name: '还是不是那个数',
      tip: '写完先回头比一比：改完之后两边还是不是同一个数。是同一个数才写 "="，尾数被省掉、数变了，就只能写 "≈"。',
      steps: ['算出用"万"作单位的那个数', '把它乘回去，和原数比一比', '一模一样写 =，变了写 ≈']
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
    },
    // ---- 第四单元 探索规律（教材 P52，教案《积的变化规律》）----
    'M-PATTERN-SCALE': {
      id: 'M-PATTERN-SCALE',
      name: '倍数跟着走',
      tip: '不用重新竖式。先看乘数各自乘（或除以）了几，积就跟着乘几次：一个乘数乘 k 积就乘 k，两个乘数都乘 k 积要乘 k×k。',
      steps: ['先把原来那道算出来当基准', '看乘数各自乘了几或除几', '积跟着乘几（两个都乘就乘两回）', '记住 0 除外']
    },
    // ---- 第五单元 解决问题（教材 P64，教案：归一 / 归总）----
    'M-UNIT-RATE': {
      id: 'M-UNIT-RATE',
      name: '先求一份',
      tip: '题目给的是"几件一共多少"，问的却是"几件多少"或"一件多少"。先把一份算出来，后面就都会了。',
      steps: ['找到"一共"和"几份"', '用除法先算一份是多少', '再看题目要几份（或者要多少份）', '最后用一份去乘或除']
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
    // 探索规律（教材 P52 例1 + 课堂活动）。这是全册唯一一个"不重新算、
    // 只看乘数怎么变"的知识点 —— 它考的不是计算，是观察和对规律的信任。
    // 教案里把它拆成两条：两条乘数同时乘→积乘 k×k；一个乘一个除→积不变。
    {
      id: 'M4A-04-05',
      name: '积的变化规律（探索规律）',
      unit: '第四单元　两、三位数乘两位数',
      bookPage: 52,
      prereq: ['M4A-04-01', 'M4A-04-03'],
      difficultyBase: 0.5,
      method: 'M-PATTERN-SCALE',
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
    // 教材 P64「解决问题」+ 教案《第3课时 解决问题》：归一（先求一份）、
    // 归总（先求总数）。这是本册第一类"两步"应用题，也是巩固与挑战的分水岭。
    {
      id: 'M4A-05-03',
      name: '归一与归总（两步问题）',
      unit: '第五单元　常见的数量关系',
      bookPage: 64,
      prereq: ['M4A-05-01', 'M4A-05-02'],
      difficultyBase: 0.6,
      method: 'M-UNIT-RATE',
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

  /* ============================ 难度分级 ============================
   *
   * 三档的界线不是"数字更大、字数更多"，而是**要跨几步、要不要转化**：
   *   基础 —— 和课本例题同构，一步就能出答案（教材的"试一试"、教案的"基础问题"）
   *   巩固 —— 绕一个弯：反过来求、或者换个样子（教材的"课堂活动"、教案的"提升问题"、
   *            第五单元教案里那条"逆向推导除法关系式"）
   *   挑战 —— 要把两个关系接起来，或者要说理（归一/归总两步、积的变化规律、
   *            近似数反推最大最小、组合图形割补）
   *
   * 分档只读模板上那个手工调出来的 difficulty，不另立一套难度数字 ——
   * 两套难度早晚会漂移，最后谁也不信谁。
   *
   * unlock 是**闸门**：这一档要求该知识点的掌握度至少到多少才出场。
   * 为什么要有闸门：孩子说"全是基础题，练几次就没意思了"，但如果一上来就
   * 把挑战题摆出来，被打击的是同一个孩子。所以挑战题做成"解锁"而不是"随机"——
   * 基础没稳，第三档根本不出；基础稳了，它自己冒出来。
   */
  var TIERS = [
    {
      level: 1, key: 'BASE', name: '基础', max: 0.42, unlock: 0,
      tip: '和课本例题一样，一步一步就能算出来'
    },
    {
      level: 2, key: 'SOLID', name: '巩固', max: 0.56, unlock: 0.45,
      tip: '要绕个弯：反过来想，或者换个样子认它'
    },
    {
      level: 3, key: 'CHALLENGE', name: '挑战', max: 1.01, unlock: 0.70,
      tip: '要把两件事接在一起，或者要把道理说清楚'
    }
  ];

  function tierOf(difficulty) {
    var d = Number(difficulty);
    for (var i = 0; i < TIERS.length; i++) {
      if (d <= TIERS[i].max) return TIERS[i];
    }
    return TIERS[TIERS.length - 1];
  }

  // 这道题现在能不能出：档位越高，要求的掌握度越高
  function tierUnlocked(tier, mastery) {
    return (mastery || 0) >= tier.unlock;
  }

  return {
    METHODS: METHODS,
    KNOWLEDGE: KNOWLEDGE,
    TIERS: TIERS,
    tierOf: tierOf,
    tierUnlocked: tierUnlocked,
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
