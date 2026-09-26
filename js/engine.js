/*
 * 引擎层 —— 出题 / 判分 / 归因 / 数量级校验 / 掌握度
 *
 * 这一层里没有任何大模型调用。这是刻意的：
 *  - 出题、算答案、判对错、找错因、算掌握度，全是可验证的程序逻辑
 *  - 模型碰不到答案，也就没有幻觉风险
 *  - 副作用是成本几乎为零，而且离线可用
 */
(function (root, factory) {
  var deps = typeof module !== 'undefined' && module.exports
    ? { Knowledge: require('./knowledge.js'), Templates: require('./templates.js') }
    : { Knowledge: root.Knowledge, Templates: root.Templates };
  var mod = factory(deps.Knowledge, deps.Templates);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Engine = mod;
})(typeof self !== 'undefined' ? self : this, function (Knowledge, Templates) {
  'use strict';

  var QUESTIONS_PER_SESSION = 10;

  /* ============================== 间隔复习 ============================== */
  // 答对就往后推一档，答错退回第一天。
  //
  // 数学原本完全没有跨天调度 —— lastPracticedAt 只写不读，
  // 错题当场最多错 3 次就公布答案放过，之后再也不出现。
  // 于是"薄弱点"只活在家长报告的一张只读列表里，孩子永远练不到。
  //
  // 算术和生字是一样的：今天会做，下周照样忘。
  // 这套阶梯是从语文那边搬过来的（1/2/4/7/15），两边保持一致。
  var REVIEW_STEPS = [1, 2, 4, 7, 15];
  var DAY = 24 * 60 * 60 * 1000;

  /* ============================== 随机数 ============================== */
  // 可复现的伪随机：同一个种子必然出同一套题，便于回看与调试
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    return Math.floor(Math.random() * 2147483647);
  }

  /* ============================== 掌握度 ============================== */
  // BKT（贝叶斯知识追踪）：可解释、零成本、纯程序。
  // 掌握度是给家长和孩子看的东西，如果它是模型"感觉"出来的，一旦不准就再也没人信。
  var BKT = {
    P_L0: 0.30,   // 初始掌握概率
    P_T: 0.20,    // 每次练习后学会的概率
    P_G_NUMBER: 0.05, // 填空题蒙对的概率
    P_G_HINTED: 0.40, // 用了提示之后做对 —— 证据力弱很多
    P_G_DEFAULT_OPTIONS: 4, // 不知道选项数时按 4 个算
    P_S: 0.10     // 掌握了但答错的概率
  };

  function initialMastery() { return BKT.P_L0; }

  // 选择题的蒙对率必须按**这一题实际的选项数**算，不能是个常数。
  // 原来写死 0.25（假设 4 个选项），但实测生成的选择题里
  // 2 选项和 3 选项占了绝大多数（判断题式的"舍去/进 1"只有 2 个）。
  // 于是"蒙对了"被当成"有把握"记账：同样答对一题，
  // 按 0.25 算掌握度会涨到 0.685，按 0.5 算只到 0.548。
  // 这个数直接喂给撤支架的门槛（≥0.85）和难度升档（≥0.70），
  // 高估一次，孩子就在还没稳住的时候被撤走支撑。
  function guessRate(inputType, hintUsed, optionCount) {
    if (hintUsed) return BKT.P_G_HINTED;
    if (inputType === 'choice') {
      var n = (typeof optionCount === 'number' && optionCount >= 2)
        ? optionCount : BKT.P_G_DEFAULT_OPTIONS;
      return 1 / n;
    }
    return BKT.P_G_NUMBER;
  }

  // attemptsSoFar = 这个知识点在这道题之前已经做过几题
  function updateMastery(pL, isCorrect, inputType, hintUsed, attemptsSoFar, optionCount) {
    var pG = guessRate(inputType, hintUsed, optionCount);
    var pT = BKT.P_T, pS = BKT.P_S;
    var pLg;
    if (isCorrect) {
      pLg = (pL * (1 - pS)) / (pL * (1 - pS) + (1 - pL) * pG);
    } else {
      pLg = (pL * pS) / (pL * pS + (1 - pL) * (1 - pG));
    }
    var raw = pLg + (1 - pLg) * pT;

    // 前两次作答按证据量打折。
    // 原因：0.30 这个先验本来就是拍的（"默认他大概不会"），
    // 而填空题蒙不中（P_G = 0.05），两者一碰，第一道题答对就能把掌握度推到 0.91。
    // 那不是一个可信的数字，不该这么快就指导后面的决策。
    var w = Math.min(1, ((attemptsSoFar || 0) + 1) / 3);
    var next = pL + (raw - pL) * w;

    return Math.min(0.99, Math.max(0.01, next));
  }

  // 掌握度 → 掌握度档位（给孩子看的话，不显示数字，显示描述）
  function masteryLabel(p) {
    if (p >= 0.80) return '熟练';
    if (p >= 0.60) return '基本掌握';
    if (p >= 0.40) return '还需要练';
    return '要重点补';
  }

  /* ============================== 支架档位 ============================== */
  // 0 = 只问最终答案；1 = 加上核心辅助步骤；2 = 全部步骤
  //
  // 这里改过一次，是这一版最重要的一个修正。
  //
  // 原来只看掌握度：<0.45 全拆，<0.75 拆一半，再高就不拆。
  // 问题是 BKT 在"填空题基本蒙不中"的前提下（P_G = 0.05），
  // 一道题答对就能把掌握度从 0.30 推到 0.91 —— 于是**第二次练习整场都不拆了**，
  // 恰好把孩子最需要的那个支撑撤走。表现出来就是"题目突然没有步骤了"。
  //
  // 现在撤支架看的是"证据够不够、稳不稳"，不是一次答对：
  //   · 不到 5 题        → 一律全拆（先让他做出来，再谈独立）
  //   · 正确率不到 75%   → 保持全拆
  //   · 5~9 题           → 拆一半
  //   · 10 题以上 + 正确率 85% + 掌握度 85% → 才只问最终答案
  //
  // 门槛定得比直觉保守，因为撤早了代价很大：这个孩子本来就不愿碰难题，
  // 支撑一撤，他面对的就是一道整题，退回"不做了"。宁可多给几场。
  var SCAFFOLD = {
    FULL_UNTIL: 5,
    HALF_UNTIL: 10,
    KEEP_FULL_ACCURACY: 0.75,
    DROP_ALL_ACCURACY: 0.85,
    MIN_MASTERY: 0.85
  };

  function scaffoldLevelFor(pMastery, stats) {
    var attempts = (stats && stats.attempts) || 0;
    var corrects = (stats && stats.corrects) || 0;
    var acc = attempts > 0 ? corrects / attempts : 0;

    if (attempts < SCAFFOLD.FULL_UNTIL) return 2;
    if (acc < SCAFFOLD.KEEP_FULL_ACCURACY) return 2;
    if (attempts < SCAFFOLD.HALF_UNTIL) return 1;
    if (acc >= SCAFFOLD.DROP_ALL_ACCURACY && pMastery >= SCAFFOLD.MIN_MASTERY) return 0;
    return 1;
  }

  /* ============================== 难度档位 ============================== */
  // 每个知识点的出题难度随练习表现上下浮动，不再写死在模板上。
  //
  // 之前难度是模板的静态属性，组卷只按槽位目标值挑最接近的模板，
  // 而目标值本身也是写死的 —— 于是孩子连对十道，题还是一样难。
  // 那和做纸质试卷没有区别，"AI 出题"的意义也就没了。
  //
  // 现在看三件事：连对、连错、掌握度。
  //   · 连错 2 次以上，或掌握度低于 0.40   → 降一档（先让他做得出来）
  //   · 连对 3 次以上，且掌握度到 0.70    → 升一档
  //   · 其余                             → 基准难度
  // 档位只影响"挑哪个模板"，不修改模板自身的难度值 —— 那个是手调出来的。
  var DIFFICULTY = {
    STEP: 0.12,            // 每档的难度偏移
    DROP_WRONG_STREAK: 2,  // 连错几次就降档
    DROP_MASTERY: 0.40,    // 掌握度低于多少就降档
    UP_STREAK: 3,          // 连对几次才考虑升档
    UP_MASTERY: 0.70       // 升档要求的掌握度
  };

  // 返回 -1（降）/ 0（平）/ +1（升）
  function difficultyShift(state, kpId) {
    var st = statsOf(state, kpId);
    var m = masteryOf(state, kpId);
    if (st.wrongStreak >= DIFFICULTY.DROP_WRONG_STREAK) return -1;
    if (m < DIFFICULTY.DROP_MASTERY) return -1;
    if (st.streak >= DIFFICULTY.UP_STREAK && m >= DIFFICULTY.UP_MASTERY) return 1;
    return 0;
  }

  // 这个知识点现在解锁到哪一档（TIERS 按 level 升序，取最后一个解锁的）
  function openTopTier(m) {
    var top = null;
    Knowledge.TIERS.forEach(function (t) {
      if (Knowledge.tierUnlocked(t, m)) top = t;
    });
    return top;
  }

  // 这个知识点现在该出多难的题
  //
  // 光"解锁"是不够的 —— 这是孩子说"太简单"的真正原因：
  // 原来只围着 difficultyBase 打转（连对 +0.12、连错 -0.12），
  // 于是池子里明明已经放进巩固题、挑战题，中间那七八个名额挑出来的还是基础题，
  // 只有压轴那一位会去够最难的。他 59 题全对，掌握度早过了 0.9，
  // 看到的却还是课本例题那个样子 —— 解锁解锁了，出出来的题没跟着走。
  //
  // 所以：解锁到哪一档，目标难度就抬进哪一档（抬到那一档区间的偏上处，
  // 不是顶到上沿，免得整场只剩最难的那一两道）。
  function targetDifficulty(state, kp) {
    var shift = difficultyShift(state, kp.id);
    var base = kp.difficultyBase + shift * DIFFICULTY.STEP;
    var top = openTopTier(masteryOf(state, kp.id));
    // 连错的时候不抬：那时候该做的是退回去，不是再往上加一层
    if (top && top.level >= 2 && shift >= 0) {
      var aim = top.min + Math.min(0.08, (top.max - top.min) / 2);
      if (base < aim) base = aim;
    }
    return base;
  }

  /* ============================== 出题 ============================== */
  // 难度分档的门禁：孩子的掌握度没到，高一档的模板就不进池子。
  //
  // 为什么要"解锁"而不是"随机出难题"：这四档是按教材和教案的分层来的
  // （基础 = 和例题一样；巩固 = 变式、逆向；挑战 = 两步串联、说理；
  //  拓展 = 条件要自己先理出来，教材里标 ★ 的那几道），
  // 目标始终是先把基础夯实。随机撒难题只会让弱的孩子一直错、
  // 掌握度往下掉，最后连基础题都不敢做。
  //
  // 保底规则不能省，而且有两层：
  //  1. 一个知识点如果只写了高档题（低掌握度时无题可出），退回全池；
  //  2. 退回来的池子里**必须还有一个非探究题**。
  // 第 2 条是这轮踩出来的：池子被门禁筛过之后如果只剩探究题，
  // chooseTemplate 那条"没别的可挑就挑它"的退让会让同一道七步题在一场里出三遍。
  // 分级是加分项，不该变成卡住出题的坑。
  function unlockedTemplates(state, kpId) {
    var all = Templates.forKnowledge(kpId);
    var m = masteryOf(state, kpId);
    var open = all.filter(function (t) {
      return tierAllows(t, m);
    });
    if (!open.length) return all;
    return withPlainWork(open, all);
  }

  function withPlainWork(open, all) {
    if (open.some(function (t) { return !t.intro; })) return open;
    var plain = all.filter(function (t) { return !t.intro; })
      .sort(function (a, b) { return a.difficulty - b.difficulty; });
    return plain.length ? [plain[0]].concat(open) : open;
  }

  // 探究题（intro）不受门禁限制：它不是考核，是"带你把这个知识点第一次搭出来"。
  // 把它锁在高档门外，等于新知识点第一次露面时反而上不了最好的那道题。
  function tierAllows(t, m) {
    if (t.intro) return true;
    return Knowledge.tierUnlocked(Knowledge.tierOf(t.difficulty), m);
  }

  // 全池（热身、压轴）用的同一套门禁，按各题自己知识点的掌握度筛。
  function openPool(pool, state) {
    var open = pool.filter(function (t) {
      return tierAllows(t, masteryOf(state, t.kp));
    });
    if (!open.length) return pool;
    return withPlainWork(open, pool);
  }

  // 这个知识点当前开放到的最高一档（家长报告里用得上）
  function tierCeiling(state, kpId) {
    var m = masteryOf(state, kpId);
    var top = 1;
    Knowledge.TIERS.forEach(function (t) {
      if (Knowledge.tierUnlocked(t, m)) top = t.level;
    });
    return top;
  }

  function buildQuestion(template, rng, scaffoldLevel) {
    var data = template.gen(rng);
    var steps = data.steps.map(function (s) {
      return {
        id: s.id, tier: s.tier, type: s.type, prompt: s.prompt,
        answer: s.answer, options: s.options || null,
        distractors: s.distractors || [], hint: s.hint || '',
        teach: s.teach || []
      };
    });

    var active = steps.filter(function (s) { return s.tier <= scaffoldLevel; });
    // 兜底：任何情况下至少要有 core 步骤
    if (!active.length) active = [steps[steps.length - 1]];

    var finalStep = steps.filter(function (s) { return s.tier === 0; })[0] || steps[steps.length - 1];

    return {
      qid: template.id + '@' + JSON.stringify(data.facts),
      kpId: template.kp,
      templateId: template.id,
      shape: template.shape,
      method: template.method,
      difficulty: template.difficulty,
      // 这题属于哪一档（基础 / 巩固 / 挑战）—— 由 difficulty 对着 Knowledge.TIERS 查出来。
      // 注意别和步骤上的 tier 混了：那个是"支架档位"（拆几步），这个是"难度档位"。
      // 名字里带上 diff 就是为了不让两者在代码里长成一个样子。
      diffTier: Knowledge.tierOf(template.difficulty),
      scaffoldLevel: scaffoldLevel,
      stem: data.stem,
      // 插图（角的图形）。题目数据里带着，界面照着画出来。
      figure: data.figure || null,
      steps: active,
      allSteps: steps,
      finalStepId: finalStep.id,
      facts: data.facts
    };
  }

  /* ============================== 组卷 ============================== */
  function masteryOf(state, kpId) {
    var m = state.mastery && state.mastery[kpId];
    return (typeof m === 'number') ? m : initialMastery();
  }

  function statsOf(state, kpId) {
    return (state.stats && state.stats[kpId]) || {
      attempts: 0, corrects: 0, wrongs: 0, lastPracticedAt: 0,
      level: 0, dueAt: 0, streak: 0, wrongStreak: 0
    };
  }

  // introKp：这个名额要优先出探究题的知识点 id（null = 不需要）。
  // 必须按知识点过滤 —— 热身之外的名额（比如压轴题）用的是全池，
  // 不过滤会把别的知识点的探究题抓过来，还会在一次练习里撞出重复题。
  function chooseTemplate(pool, targetDiff, rng, recentIds, introKp, avoidIds, usedIds) {
    // 探究题（intro）只有一条出场路径：这个知识点的**第一次**露面。
    // 平时按难度挑模板时把它排除掉 —— 一道七步的整理题反复出现，
    // 挤掉的是该练的判断题，孩子烦了，自适应也没了抓手。
    if (introKp) {
      var intros = pool.filter(function (t) { return t.intro && t.kp === introKp; });
      if (intros.length) return intros[0];
    }
    var candidates = pool.filter(function (t) { return !t.intro; });
    if (!candidates.length) candidates = pool;

    // 三级退让：一级一级放宽，收窄之后空了就退回上一级。
    //   1) 这一场还没出过的（同一套卷子里尽量别撞题）
    //   2) 最近两场也没出过的（连着做同一种考法，孩子会觉得"怎么又是这道题"）
    //   3) 不是上一道题的题型
    // 退让到最后一级是正常的：某个知识点只有一两种题型，那是内容该补了。
    // 用"随机撞一下"来掩盖它，代价是选出难度完全不合适的题 —— 更亏。
    var cand = candidates;
    function narrow(fn) {
      var next = cand.filter(fn);
      if (next.length) cand = next;
    }
    if (usedIds) narrow(function (t) { return !usedIds[t.id]; });
    if (avoidIds) narrow(function (t) { return !avoidIds[t.id]; });
    var last = recentIds.length ? recentIds[recentIds.length - 1] : null;
    narrow(function (t) { return t.id !== last; });

    var sorted = cand.slice().sort(function (a, b) {
      return Math.abs(a.difficulty - targetDiff) - Math.abs(b.difficulty - targetDiff);
    });
    var top = sorted.slice(0, Math.min(2, sorted.length));
    return top[Math.floor(rng() * top.length)];
  }

  // 「为什么给你出这道题」—— 把 AI 的判断过程摊开给孩子看。
  // 这既是透明度，也是"看得见的方法"：他慢慢会知道系统在盯什么。
  function reasonFor(kind, kp, st, isIntro) {
    var name = kp ? kp.name : '';
    if (kind === 'warmup') {
      return '热身题。这两道比较简单，先把状态找回来。';
    }
    if (kind === 'weak') {
      if (st.attempts === 0) {
        return isIntro
          ? '「' + name + '」你还没练过。这道题不考试，带你一步一步把答案自己找出来，先搭表，再考核。'
          : '「' + name + '」你还没练过，先看看掌握得怎么样。';
      }
      if (st.wrongs > 0) return '你在「' + name + '」上错过了 ' + st.wrongs + ' 次，再练一下。';
      return '「' + name + '」还不太稳，再来几道。';
    }
    if (kind === 'review') {
      if (st.wrongs > 0) return '「' + name + '」上次错过了，今天先订正一次。';
      return '「' + name + '」到复习的日子了 —— 现在再练一次，才不会忘。';
    }
    if (kind === 'keep') {
      return '「' + name + '」你已经掌握得不错了。过几天再回来做一次，才不会忘。';
    }
    if (kind === 'challenge') {
      return '最后一道稍微难一点，试试看 —— 做不出来也完全没关系。';
    }
    return '';
  }

  function buildSession(state, rng, count, unitFilter) {
    count = count || QUESTIONS_PER_SESSION;
    // 按单元出题：只在这个单元的知识点里组卷。
    // 传了不存在的单元名时别让整场崩掉，退回全部。
    var kps = Knowledge.implemented().filter(function (k) {
      return !unitFilter || unitFilter === 'all' || k.unit === unitFilter;
    });
    if (!kps.length) kps = Knowledge.implemented();
    var pool = Templates.TEMPLATES.filter(function (t) {
      return kps.some(function (k) { return k.id === t.kp; });
    });

    // 掌握度相同时，练得少的排前面。
    // 光按掌握度排会出事：补完单元后知识点有 15 个，而一场只有 7 个自由名额，
    // 每场都从最弱的开始取、取满就停 —— 排在最末的那个知识点几乎永远轮不到，
    // 孩子练了好几场，某个单元一次都没见过。
    // 加上"练得少的优先"之后，队伍会自己往前推，不会有人被卡在队尾。
    var byWeak = kps.slice().sort(function (a, b) {
      var ma = masteryOf(state, a.id), mb = masteryOf(state, b.id);
      if (Math.abs(ma - mb) > 1e-6) return ma - mb;
      return statsOf(state, a.id).attempts - statsOf(state, b.id).attempts;
    });

    // 最近两场做过的题型：一单元的知识点就那么几个，连着两场很可能挑中同一批
    // 模板 —— 题里的数字是新的，但考法一模一样，孩子会觉得"刚做过"。
    // 取 history 尾部 20 条（大约两场）的模板 id，出题时优先避开（避不开就放开）。
    var avoid = {};
    (state.history || []).slice(-20).forEach(function (h) {
      if (h && h.templateId) avoid[h.templateId] = 1;
    });

    // 先过一遍难度门禁：热身和压轴都只在"已经解锁的题"里挑。
    // 原来的压轴是"本单元最难的那道"，跟掌握度无关 —— 刚把基础过完的孩子
    // 每场最后都要撞一次挑战题，错了再记一笔，掌握度反而掉下去。
    var open = openPool(pool, state);
    var warmPool = open.filter(function (t) { return t.difficulty <= 0.45; });
    if (!warmPool.length) warmPool = open;

    var highest = open.slice().sort(function (a, b) { return b.difficulty - a.difficulty; })[0];

    var slots = [];
    slots.push({ kind: 'warmup', pool: warmPool, kp: null, diff: 0.26 });
    slots.push({ kind: 'warmup', pool: warmPool, kp: null, diff: 0.30 });

    // 中间部分（热身之后、挑战之前）
    var middleTarget = Math.max(1, count - slots.length - 1);
    var middle = [];

    // 先把到期清单算出来：下面"没练过的"能占多少名额，取决于有没有复习要插进来。
    var now = Date.now();
    var dueKps = kps.filter(function (k) {
      var s = statsOf(state, k.id);
      return s.attempts > 0 && (s.dueAt || 0) <= now;
    }).sort(function (a, b) {
      // 到期的一批内部，还是弱的先来：到期且没掌握的，比到期但很熟的更值得现在练。
      return masteryOf(state, a.id) - masteryOf(state, b.id);
    });

    // 1) 还没练过的知识点先露面（每个 1 个位置）。
    //    不这么做的话，"薄弱"和"抗遗忘"两档会把名额占满 ——
    //    之前"乘法估算"就是这样一整场都没出现过，孩子根本没机会看到它。
    //
    //    这里改过三轮。第一次是改成"每个先占 1 个，而不是直接给 2 个"：
    //    直接给 2 个时，知识点一多，排在最末的一个名额都拿不到，
    //    整场一次都不出现。先保住"露面"，再谈加练，顺序不能反。
    //
    //    第二次是把封顶改成**有条件的**：
    //    没有任何东西到期时，露面这一项可以用满 middle —— 第一次来练的孩子
    //    本来就只该看新东西；等到期复习插进来之后，才让出一半名额给它。
    //    写死封顶会让"连着几场要覆盖所有知识点"变成一件根本做不到的事。
    //    原来的"第二轮加练"取消了：新知识点默认掌握度就偏低，
    //    在下面"薄弱轮流"那一档里自然还会被排到，不需要再单独占位置。
    //
    //    第三次（这一轮）：知识点从 15 个涨到 17 个之后，"到期就先占掉一半"这个让法
    //    本身不够用了 —— 算下来总会有一个知识点连着四场一次都不出现。
    //    改成按**实际需要**让：到期题最多占一半，但只有几个到期就只占几个，
    //    剩下的名额全给没练过的。复习是在"已经见过"的基础上防遗忘，
    //    把一个从没露过面的知识点一直挡在门外是本末倒置；
    //    反过来，真有几个到期时要全部空出来也是错的（那是孩子最该补的时候）。
    var dueLimit = Math.floor(middleTarget / 2);
    var untouchedAll = kps.filter(function (k) { return statsOf(state, k.id).attempts === 0; });
    var NEW_ROOM = middleTarget - Math.min(dueLimit, dueKps.length);
    var untouched = untouchedAll.slice(0, NEW_ROOM);
    untouched.forEach(function (k) {
      if (middle.length < middleTarget) {
        middle.push({ kind: 'weak', pool: unlockedTemplates(state, k.id), kp: k, diff: targetDifficulty(state, k) });
      }
    });

    // 2) 到期的知识点接着复现 —— 这是间隔复习真正起作用的地方。
    //
    //    排位刻意在"没练过"之后、"薄弱"之前：
    //    · 没练过的要先露面，否则整场可能一次都不出现；
    //    · 到期的比"一直不会的"更值得现在练 —— 会做但快忘的，补一次就回到掌握状态；
    //      而一直不会的那块，本来就在薄弱档里排着，不会因为这次让位就丢掉。

    // 到期的最多占一半名额（dueLimit 在上面给露面留位置时已经算过，同一个数）。
    // 不设上限的话，隔了几天回来练时所有知识点都到期，会把 middle 全占满 ——
    // 那么"最弱的优先"就等于被取消了。复习不该把薄弱点的练习名额吃掉，
    // 这和下面 keep 那条"跳过最薄弱的知识点"是同一个道理。
    var dueUsed = 0;
    dueKps.forEach(function (k) {
      if (middle.length < middleTarget && dueUsed < dueLimit) {
        middle.push({ kind: 'review', pool: unlockedTemplates(state, k.id), kp: k, diff: targetDifficulty(state, k) });
        dueUsed++;
      }
    });

    // 3) 剩下的位置按薄弱程度轮流补。
    //
    // 最弱的那个在一轮里占两个位置。只让它"先出"是不够的：
    // 知识点少的时候轮流一圈它自然分得多，知识点一多（现在是 5 个），
    // 轮流一圈每人分到一个，"薄弱优先"就只剩下一个说法 ——
    // 题量上完全看不出差别，等于没优先。
    var wi = 0;
    var order = byWeak.length > 1 ? [byWeak[0]].concat(byWeak) : byWeak.slice();
    while (middle.length < middleTarget) {
      var k = order[wi % order.length];
      wi++;
      middle.push({ kind: 'weak', pool: unlockedTemplates(state, k.id), kp: k, diff: targetDifficulty(state, k) });
    }

    // 4) 有足够练习记录、且还没到期的知识点，抽两个位置换成本场内的隔题复现。
    //    挑选时从后往前找，并且跳过最薄弱的那个知识点 ——
    //    抗遗忘不该把薄弱点的练习名额吃掉。
    var reviewable = kps.filter(function (k) {
      var s = statsOf(state, k.id);
      // 已经到期的那批由 review 档负责了，这里不重复占位
      return s.attempts >= 3 && (s.dueAt || 0) > now;
    }).sort(function (a, b) { return masteryOf(state, b.id) - masteryOf(state, a.id); });
    var protectedCount = Math.min(untouched.length, middleTarget);

    for (var r = 0; r < Math.min(2, reviewable.length); r++) {
      for (var idx = middle.length - 1; idx >= protectedCount; idx--) {
        if (middle[idx].kind === 'keep') continue;
        if (middle[idx].kp && middle[idx].kp.id === byWeak[0].id) continue;
        var kk = reviewable[r];
        middle[idx] = {
          kind: 'keep', pool: unlockedTemplates(state, kk.id), kp: kk,
          diff: targetDifficulty(state, kk) + 0.08
        };
        break;
      }
    }

    slots = slots.concat(middle);
    slots.push({ kind: 'challenge', pool: open, kp: Knowledge.byId(highest.kp), diff: highest.difficulty });
    slots = slots.slice(0, count);

    var questions = [];
    var recent = [];
    var usedQids = {};
    var usedTplIds = {};   // 这一场已经出过的题型：同一套卷子里尽量不撞题型
    // 探究题一场只出一次：state 在组卷过程中不会变（作答记录要练完才写回），
    // 光看 attempts === 0 会让同一知识点的第二个名额又抓一次探究题，
    // 而它生成的题目是完全相同的。
    var introDone = {};

    slots.forEach(function (slot) {
      // 传知识点 id（不是布尔）：chooseTemplate 只认"这个知识点的探究题"，
      // 免得把别的知识点的探究题抓到热身 / 压轴名额里。
      var introKp = (slot.kp && statsOf(state, slot.kp.id).attempts === 0 && !introDone[slot.kp.id])
        ? slot.kp.id : null;
      var tpl = null, q = null, tries = 0;
      while (tries < 12) {
        tpl = chooseTemplate(slot.pool, slot.diff, rng, recent, introKp, avoid, usedTplIds);
        if (tpl.intro) introDone[tpl.kp] = true;
        var kpId2 = tpl.kp;
        var lvl = scaffoldLevelFor(masteryOf(state, kpId2), statsOf(state, kpId2));
        q = buildQuestion(tpl, rng, lvl);
        if (!usedQids[q.qid]) break;
        tries++;
      }
      usedQids[q.qid] = 1;
      usedTplIds[tpl.id] = 1;
      recent.push(tpl.id);
      if (recent.length > 2) recent.shift();

      var kpInfo = slot.kp || Knowledge.byId(tpl.kp);
      var st = statsOf(state, tpl.kp);
      q.reason = reasonFor(slot.kind, kpInfo, st, !!tpl.intro);
      q.slotKind = slot.kind;
      questions.push(q);
    });

    return {
      id: 'S' + Date.now(),
      seed: null,
      startedAt: Date.now(),
      endedAt: null,
      questions: questions,
      cursor: 0
    };
  }

  /* ============================== 判分与归因 ============================== */
  function gradeStep(step, value) {
    if (value === null || value === undefined || value === '') {
      return { isCorrect: false, errorTag: 'OTHER' };
    }
    if (step.type === 'choice') {
      if (Number(value) === Number(step.answer)) return { isCorrect: true, errorTag: null };
      var opt = (step.options || []).filter(function (o) { return Number(o.value) === Number(value); })[0];
      return { isCorrect: false, errorTag: (opt && opt.tag) || 'OTHER' };
    }
    var num = Number(value);
    if (!isFinite(num)) return { isCorrect: false, errorTag: 'OTHER' };
    if (Math.abs(num - Number(step.answer)) < 1e-9) return { isCorrect: true, errorTag: null };
    var d = (step.distractors || []).filter(function (x) {
      return Math.abs(Number(x.value) - num) < 1e-9;
    })[0];
    return { isCorrect: false, errorTag: (d && d.tag) || 'OTHER' };
  }

  /* ============================== 数量级校验 ============================== */
  // 「先估后算」的程序化实现：不看答案，只看数量级对不对。
  // 这一步做的是训练"检查"这个动作本身 —— 对"计算不仔细"的孩子比多刷 50 道题有用。
  function magnitudeCheck(answer, value) {
    var a = Math.abs(Number(answer));
    var v = Math.abs(Number(value));
    if (!isFinite(v) || v === 0) return 'none';
    var da = String(Math.round(a)).length;
    var dv = String(Math.round(v)).length;
    if (dv !== da) return 'digit';
    var r = v / a;
    if (r >= 2 || r <= 0.5) return 'magnitude';
    return 'ok';
  }

  function magnitudeMessage(kind) {
    if (kind === 'digit') return '结果的位数好像不对，要不要再检查一下？（先估一估大概是多少）';
    if (kind === 'magnitude') return '结果的数量级好像不太对，先估一估再算算看。';
    return '';
  }

  /* ============================== 提示分级 ============================== */
  // 三级提示：用了不扣分、不批评、不显示任何负面反馈。
  // 一旦提示有惩罚，孩子宁可乱猜也不点提示，这套机制就废了。
  function hintFor(step, level) {
    if (level <= 1) return step.hint || '再仔细读一遍题目，想想题目问的是什么。';
    if (level === 2) {
      var t = step.teach || [];
      return t.length > 1 ? t.slice(0, t.length - 1).join('　') : (step.hint || '');
    }
    return (step.teach || []).join('　');
  }

  /* ============================== 结果提交 ============================== */
  // 这道题算不算"作答过一次"。中途退出时界面会走到提交这一步，
  // 一题没答的记录必须被丢掉 —— 把"不做了"记成"答错了"，
  // 掌握度会朝悲观方向漂，而越受挫的孩子越容易中途退出，反馈环是恶性方向的。
  function countsAsAnswer(record) {
    return !!record && (record.attempts || 0) > 0;
  }

  // 把一次作答写回 state（纯函数，返回新的 state 片段，由 store 负责落盘）
  function applyResult(state, record) {
    var kpId = record.kpId;
    var pL = masteryOf(state, kpId);
    var st = statsOf(state, kpId);
    // 把"这是第几题"传进去：前两次作答要按证据量打折；
    // 选择题还要按这一题真实的选项数算蒙对率（见 guessRate）。
    var next = updateMastery(pL, record.isCorrect, record.inputType,
      record.hintLevel > 0, st.attempts, record.optionCount);

    var mutated = JSON.parse(JSON.stringify(state));
    mutated.mastery = mutated.mastery || {};
    mutated.stats = mutated.stats || {};
    mutated.history = mutated.history || [];

    var isRight = !!record.isCorrect;
    var nextStreak = isRight ? (st.streak || 0) + 1 : 0;
    var nextWrongStreak = isRight ? 0 : (st.wrongStreak || 0) + 1;
    var nextLevel = st.level || 0;
    var nextDueAt;

    if (isRight) {
      // 答对就往后推一档；到了最后一档就停在 15 天。
      nextLevel = Math.min(nextLevel + 1, REVIEW_STEPS.length - 1);
      nextDueAt = Date.now() + REVIEW_STEPS[nextLevel] * DAY;
    } else {
      // 答错退回第一天，而且是**当天到期**：错的做法拖几天才纠正，
      // 孩子这几天里多半已经把错的记牢了，改起来的成本比当时高得多。
      nextLevel = 0;
      nextDueAt = Date.now();
    }

    mutated.mastery[kpId] = next;
    mutated.stats[kpId] = {
      attempts: st.attempts + 1,
      corrects: st.corrects + (isRight ? 1 : 0),
      wrongs: st.wrongs + (isRight ? 0 : 1),
      lastPracticedAt: Date.now(),
      streak: nextStreak,
      wrongStreak: nextWrongStreak,
      level: nextLevel,
      dueAt: nextDueAt
    };
    mutated.history.push(record);
    if (mutated.history.length > 2000) mutated.history = mutated.history.slice(-2000);

    return { state: mutated, masteryBefore: pL, masteryAfter: next };
  }

  /* ============================== 知识点溯源 ============================== */
  // 不靠模型猜根因，而是：这个知识点薄弱 → 查它的前置 → 用几道前置题去确认。
  function traceCandidates(state, kpId) {
    var kp = Knowledge.byId(kpId);
    if (!kp || !kp.prereq || !kp.prereq.length) return [];
    var p = masteryOf(state, kpId);
    if (p >= 0.55) return [];
    return kp.prereq.map(function (pid) {
      return { kp: Knowledge.byId(pid), mastery: masteryOf(state, pid) };
    }).filter(function (x) {
      return x.kp && x.mastery < 0.70;
    }).sort(function (a, b) { return a.mastery - b.mastery; });
  }

  /* ============================== 到期查询 ============================== */
  // 今天该复习的知识点。首页和进度页拿它显示"还有 N 块到期了"。
  // 间隔复习如果只是引擎内部排个序，孩子是看不见的 —— 看得见才会去点。
  function dueKnowledge(state, unitFilter) {
    var now = Date.now();
    return Knowledge.implemented().filter(function (k) {
      if (unitFilter && unitFilter !== 'all' && k.unit !== unitFilter) return false;
      var s = statsOf(state, k.id);
      return s.attempts > 0 && (s.dueAt || 0) <= now;
    });
  }

  /* ============================== 汇总报告 ============================== */
  function summarize(state, session, results) {
    var total = results.length;
    var correct = results.filter(function (r) { return r.isCorrect; }).length;
    var afterHint = results.filter(function (r) { return r.hintLevel > 0; }).length;
    var byKp = {};

    results.forEach(function (r) {
      var k = byKp[r.kpId] = byKp[r.kpId] || { kpId: r.kpId, total: 0, correct: 0, tags: {} };
      k.total++;
      if (r.isCorrect) k.correct++;
      if (r.errorTag) k.tags[r.errorTag] = (k.tags[r.errorTag] || 0) + 1;
      // 阶梯题的辅助步骤也是错因探针（比如"看错数位"只在第一步探测得到）。
      // 只记最终那一步的话，这些设计出来的探针就白做了。
      (r.stepTags || []).forEach(function (t) {
        if (!t || t === 'OTHER') return;
        k.tags[t] = (k.tags[t] || 0) + 1;
      });
    });

    return {
      total: total,
      correct: correct,
      accuracy: total ? correct / total : 0,
      hintUsed: afterHint,
      byKp: Object.keys(byKp).map(function (id) {
        var k = byKp[id];
        return {
          kpId: id,
          name: (Knowledge.byId(id) || {}).name || id,
          total: k.total,
          correct: k.correct,
          mastery: masteryOf(state, id),
          topError: topKey(k.tags)
        };
      })
    };
  }

  function topKey(obj) {
    var best = null, bestN = 0;
    Object.keys(obj || {}).forEach(function (k) {
      if (obj[k] > bestN) { bestN = obj[k]; best = k; }
    });
    return best;
  }

  return {
    QUESTIONS_PER_SESSION: QUESTIONS_PER_SESSION,
    REVIEW_STEPS: REVIEW_STEPS,
    DIFFICULTY: DIFFICULTY,
    mulberry32: mulberry32,
    randomSeed: randomSeed,
    BKT: BKT,
    SCAFFOLD: SCAFFOLD,
    guessRate: guessRate,
    difficultyShift: difficultyShift,
    targetDifficulty: targetDifficulty,
    unlockedTemplates: unlockedTemplates,
    tierCeiling: tierCeiling,
    dueKnowledge: dueKnowledge,
    initialMastery: initialMastery,
    updateMastery: updateMastery,
    masteryLabel: masteryLabel,
    scaffoldLevelFor: scaffoldLevelFor,
    buildQuestion: buildQuestion,
    buildSession: buildSession,
    gradeStep: gradeStep,
    countsAsAnswer: countsAsAnswer,
    magnitudeCheck: magnitudeCheck,
    magnitudeMessage: magnitudeMessage,
    hintFor: hintFor,
    applyResult: applyResult,
    masteryOf: masteryOf,
    statsOf: statsOf,
    traceCandidates: traceCandidates,
    summarize: summarize
  };
});
