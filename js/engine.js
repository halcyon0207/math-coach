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
    P_G_CHOICE: 0.25, // 选择题蒙对的概率（4 选项）
    P_G_NUMBER: 0.05, // 填空题蒙对的概率
    P_G_HINTED: 0.40, // 用了提示之后做对 —— 证据力弱很多
    P_S: 0.10     // 掌握了但答错的概率
  };

  function initialMastery() { return BKT.P_L0; }

  function guessRate(inputType, hintUsed) {
    if (hintUsed) return BKT.P_G_HINTED;
    return inputType === 'choice' ? BKT.P_G_CHOICE : BKT.P_G_NUMBER;
  }

  // attemptsSoFar = 这个知识点在这道题之前已经做过几题
  function updateMastery(pL, isCorrect, inputType, hintUsed, attemptsSoFar) {
    var pG = guessRate(inputType, hintUsed);
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

  /* ============================== 出题 ============================== */
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
      scaffoldLevel: scaffoldLevel,
      stem: data.stem,
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
    return (state.stats && state.stats[kpId]) || { attempts: 0, corrects: 0, wrongs: 0, lastPracticedAt: 0 };
  }

  function chooseTemplate(pool, targetDiff, rng, recentIds) {
    // 两级退让：先保证"不和上一题同模板"，再尽量避开更早用过的。
    // 池子里只有一个模板时只能重复 —— 这是内容问题（该补模板了），
    // 不该用"随机撞一下"来掩盖。
    var last = recentIds.length ? recentIds[recentIds.length - 1] : null;
    var noLast = pool.filter(function (t) { return t.id !== last; });
    if (!noLast.length) noLast = pool;

    var stricter = noLast.filter(function (t) { return recentIds.indexOf(t.id) === -1; });
    var use = stricter.length ? stricter : noLast;

    var sorted = use.slice().sort(function (a, b) {
      return Math.abs(a.difficulty - targetDiff) - Math.abs(b.difficulty - targetDiff);
    });
    var top = sorted.slice(0, Math.min(2, sorted.length));
    return top[Math.floor(rng() * top.length)];
  }

  // 「为什么给你出这道题」—— 把 AI 的判断过程摊开给孩子看。
  // 这既是透明度，也是"看得见的方法"：他慢慢会知道系统在盯什么。
  function reasonFor(kind, kp, st) {
    var name = kp ? kp.name : '';
    if (kind === 'warmup') {
      return '热身题。这两道比较简单，先把状态找回来。';
    }
    if (kind === 'weak') {
      if (st.attempts === 0) return '「' + name + '」你还没练过，先看看掌握得怎么样。';
      if (st.wrongs > 0) return '你在「' + name + '」上错过了 ' + st.wrongs + ' 次，再练一下。';
      return '「' + name + '」还不太稳，再来几道。';
    }
    if (kind === 'keep') {
      return '「' + name + '」你已经掌握得不错了。过几天再回来做一次，才不会忘。';
    }
    if (kind === 'challenge') {
      return '最后一道稍微难一点，试试看 —— 做不出来也完全没关系。';
    }
    return '';
  }

  function buildSession(state, rng, count) {
    count = count || QUESTIONS_PER_SESSION;
    var kps = Knowledge.implemented();
    var pool = Templates.TEMPLATES.filter(function (t) {
      return kps.some(function (k) { return k.id === t.kp; });
    });

    var byWeak = kps.slice().sort(function (a, b) {
      return masteryOf(state, a.id) - masteryOf(state, b.id);
    });

    var warmPool = pool.filter(function (t) { return t.difficulty <= 0.45; });
    if (!warmPool.length) warmPool = pool;

    var highest = pool.slice().sort(function (a, b) { return b.difficulty - a.difficulty; })[0];

    var slots = [];
    slots.push({ kind: 'warmup', pool: warmPool, kp: null, diff: 0.26 });
    slots.push({ kind: 'warmup', pool: warmPool, kp: null, diff: 0.30 });

    // 中间部分（热身之后、挑战之前）
    var middleTarget = Math.max(1, count - slots.length - 1);
    var middle = [];

    // 1) 还没练过的知识点先各占 2 个位置。
    //    不这么做的话，"薄弱"和"抗遗忘"两档会把名额占满 ——
    //    之前"乘法估算"就是这样一整场都没出现过，孩子根本没机会看到它。
    var untouched = kps.filter(function (k) { return statsOf(state, k.id).attempts === 0; });
    untouched.forEach(function (k) {
      for (var n = 0; n < 2 && middle.length < middleTarget; n++) {
        middle.push({ kind: 'weak', pool: Templates.forKnowledge(k.id), kp: k, diff: k.difficultyBase });
      }
    });

    // 2) 剩下的位置按薄弱程度轮流补
    var wi = 0;
    while (middle.length < middleTarget) {
      var k = byWeak[wi % byWeak.length];
      wi++;
      middle.push({ kind: 'weak', pool: Templates.forKnowledge(k.id), kp: k, diff: k.difficultyBase });
    }

    // 3) 有足够练习记录的知识点，抽两个位置换成"抗遗忘"的隔几天复现。
    //    挑选时从后往前找，并且跳过最薄弱的那个知识点 ——
    //    抗遗忘不该把薄弱点的练习名额吃掉。
    var reviewable = kps.filter(function (k) { return statsOf(state, k.id).attempts >= 3; })
      .sort(function (a, b) { return masteryOf(state, b.id) - masteryOf(state, a.id); });
    var protectedCount = Math.min(untouched.length * 2, middleTarget);

    for (var r = 0; r < Math.min(2, reviewable.length); r++) {
      for (var idx = middle.length - 1; idx >= protectedCount; idx--) {
        if (middle[idx].kind === 'keep') continue;
        if (middle[idx].kp && middle[idx].kp.id === byWeak[0].id) continue;
        var kk = reviewable[r];
        middle[idx] = {
          kind: 'keep', pool: Templates.forKnowledge(kk.id), kp: kk,
          diff: kk.difficultyBase + 0.08
        };
        break;
      }
    }

    slots = slots.concat(middle);
    slots.push({ kind: 'challenge', pool: pool, kp: Knowledge.byId(highest.kp), diff: highest.difficulty });
    slots = slots.slice(0, count);

    var questions = [];
    var recent = [];
    var usedQids = {};

    slots.forEach(function (slot) {
      var tpl = null, q = null, tries = 0;
      while (tries < 12) {
        tpl = chooseTemplate(slot.pool, slot.diff, rng, recent);
        var kpId2 = tpl.kp;
        var lvl = scaffoldLevelFor(masteryOf(state, kpId2), statsOf(state, kpId2));
        q = buildQuestion(tpl, rng, lvl);
        if (!usedQids[q.qid]) break;
        tries++;
      }
      usedQids[q.qid] = 1;
      recent.push(tpl.id);
      if (recent.length > 2) recent.shift();

      var kpInfo = slot.kp || Knowledge.byId(tpl.kp);
      var st = statsOf(state, tpl.kp);
      q.reason = reasonFor(slot.kind, kpInfo, st);
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
  // 把一次作答写回 state（纯函数，返回新的 state 片段，由 store 负责落盘）
  function applyResult(state, record) {
    var kpId = record.kpId;
    var pL = masteryOf(state, kpId);
    var st = statsOf(state, kpId);
    // 把"这是第几题"传进去：前两次作答要按证据量打折
    var next = updateMastery(pL, record.isCorrect, record.inputType, record.hintLevel > 0, st.attempts);

    var mutated = JSON.parse(JSON.stringify(state));
    mutated.mastery = mutated.mastery || {};
    mutated.stats = mutated.stats || {};
    mutated.history = mutated.history || [];

    mutated.mastery[kpId] = next;
    mutated.stats[kpId] = {
      attempts: st.attempts + 1,
      corrects: st.corrects + (record.isCorrect ? 1 : 0),
      wrongs: st.wrongs + (record.isCorrect ? 0 : 1),
      lastPracticedAt: Date.now()
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
    mulberry32: mulberry32,
    randomSeed: randomSeed,
    BKT: BKT,
    SCAFFOLD: SCAFFOLD,
    initialMastery: initialMastery,
    updateMastery: updateMastery,
    masteryLabel: masteryLabel,
    scaffoldLevelFor: scaffoldLevelFor,
    buildQuestion: buildQuestion,
    buildSession: buildSession,
    gradeStep: gradeStep,
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
