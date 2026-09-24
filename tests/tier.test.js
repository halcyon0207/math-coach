/* 难度分级（基础 / 巩固 / 挑战）+ 这一轮新增的三族题目
 *
 * 三档来自教材与教案自己的分层：
 *   基础 = 和课本例题一样；巩固 = 变式、逆向；挑战 = 两步串联、说理。
 * 档位由模板自己写的 difficulty 查出来（只有一份难度数字，避免两套账）。
 *
 * 真正要防的是两件事，所以两边都得测：
 *   1. 门关得上 —— 掌握度没到，高档题不许出场（随机撒难题只会把弱的孩子按下去）
 *   2. 门打得开、也不夹人 —— 掌握度高了挑战题必须真的出现；
 *      而任何掌握度下每个知识点都得有题可出，分级不该变成卡住出题的坑。
 */
const test = require('node:test');
const assert = require('node:assert');

const Knowledge = require('../js/knowledge.js');
const Templates = require('../js/templates.js');
const Engine = require('../js/engine.js');
const Store = require('../js/store.js');

const ROUNDS = 300;

function rngFor(seed) { return Engine.mulberry32(seed); }
function freshState() { return Store.defaultState(); }

function stepsById(q) {
  const out = {};
  q.allSteps.forEach(s => { out[s.id] = s; });
  return out;
}

function setAllMastery(state, m) {
  Knowledge.implemented().forEach(k => { state.mastery[k.id] = m; });
  return state;
}

const INTRO_IDS = new Set(Templates.TEMPLATES.filter(t => t.intro).map(t => t.id));

test('三档都有题，且每道题都落在自己那一档的区间里', () => {
  const count = { 1: 0, 2: 0, 3: 0 };
  Templates.TEMPLATES.forEach(t => {
    const tier = Knowledge.tierOf(t.difficulty);
    assert.ok(tier, `${t.id} 的难度 ${t.difficulty} 查不到档位`);
    const lo = tier.level === 1 ? -1 : Knowledge.TIERS[tier.level - 2].max;
    assert.ok(t.difficulty > lo && t.difficulty <= tier.max,
      `${t.id} 的难度 ${t.difficulty} 不在「${tier.name}」档 (${lo}, ${tier.max}] 里`);
    count[tier.level]++;
  });
  // 三档都得有相当数量，否则"分级"只是给少数题贴标签
  assert.ok(count[1] >= 15 && count[2] >= 15 && count[3] >= 10,
    `档位分布太偏：${JSON.stringify(count)}`);
});

test('模板 id 不许重复（补题时最容易犯的错）', () => {
  const seen = new Set();
  const dup = [];
  Templates.TEMPLATES.forEach(t => {
    if (seen.has(t.id)) dup.push(t.id);
    seen.add(t.id);
  });
  assert.strictEqual(dup.length, 0, `重复的题型 id：${JSON.stringify([...new Set(dup)])}`);
});

test('闸门不许把出题夹死：任何掌握度下，每个知识点都有正经（非探究）题可出', () => {
  [0, 0.2, 0.45, 0.6, 0.9].forEach(m => {
    const state = setAllMastery(freshState(), m);
    Knowledge.implemented().forEach(k => {
      const pool = Engine.unlockedTemplates(state, k.id);
      assert.ok(pool.filter(t => !t.intro).length >= 1,
        `掌握度 ${m} 时 ${k.id} 的池子里一道正经题都没有（只剩探究题）`);
    });
  });
});

test('低掌握度不许出高档题：出场的题一定来自该知识点当前解锁的池子', () => {
  [0.2, 0.5].forEach(m => {
    const state = setAllMastery(freshState(), m);
    const allowed = {};
    Knowledge.implemented().forEach(k => {
      allowed[k.id] = new Set(Engine.unlockedTemplates(state, k.id).map(t => t.id));
    });

    for (let s = 0; s < 6; s++) {
      const sess = Engine.buildSession(state, rngFor(s * 41 + 11));
      sess.questions.forEach(q => {
        assert.ok(allowed[q.kpId].has(q.templateId),
          `掌握度 ${m} 时 ${q.kpId} 出了没解锁的题：${q.templateId}（第 ${s} 场）`);
        if (m > 0.2) return;
        // 只有"基础档确实有题"的知识点才谈得上这条硬约束。
        // 乘法估算、因数中间有 0 这类知识点最浅的一题就在巩固档，
        // 门禁对它只能退让（否则一进场无题可出），这是记录在案的行为。
        const poolHasBase = Engine.unlockedTemplates(state, q.kpId)
          .some(t => !t.intro && Knowledge.tierOf(t.difficulty).level === 1);
        if (poolHasBase && !INTRO_IDS.has(q.templateId)) {
          assert.strictEqual(q.diffTier.level, 1,
            `${q.kpId} 明明有基础题，却在掌握度 0.2 时出了 ${q.diffTier.name}档的 ${q.templateId}`);
        }
      });
    }
  });
});

test('挑战题不是空话：掌握度拉满后，挑战档必须真的会出现', () => {
  const state = setAllMastery(freshState(), 0.9);
  Knowledge.implemented().forEach(k => {
    state.stats[k.id] = {
      attempts: 8, corrects: 8, wrongs: 0, lastPracticedAt: Date.now(),
      level: 2, dueAt: Date.now() + 86400000, streak: 4, wrongStreak: 0
    };
  });
  const challenged = new Set();
  for (let s = 0; s < 6; s++) {
    Engine.buildSession(state, rngFor(s * 23 + 7)).questions.forEach(q => {
      if (q.diffTier.level === 3 && !INTRO_IDS.has(q.templateId)) challenged.add(q.templateId);
    });
  }
  assert.ok(challenged.size >= 3,
    `掌握度 0.9 连出六场只见到了 ${challenged.size} 种挑战题，门禁等于把题锁死了`);
});

test('tierCeiling 报的是"解锁到第几档"，和闸门用同一套数字', () => {
  const kp = Knowledge.implemented()[0].id;
  const at = m => { const s = freshState(); s.mastery[kp] = m; return Engine.tierCeiling(s, kp); };
  assert.strictEqual(at(0), 1, '什么都没练过时只该有基础题');
  assert.strictEqual(at(0.44), 1);
  assert.strictEqual(at(0.45), 2, '掌握度到 0.45 解锁巩固');
  assert.strictEqual(at(0.69), 2);
  assert.strictEqual(at(0.7), 3, '到 0.7 解锁挑战');
  assert.strictEqual(at(0.95), 3);
});

/* ==================== 新题型的自洽 ==================== */
// 这三族的共同点是：答案既能"按规律推"，也能"直接算"。
// 两条路必须撞在同一个数上 —— 不然教的就是错的规律，比不出题更糟。

test('积的变化规律：按规律推出来的积，必须等于直接乘出来的积', () => {
  Templates.TEMPLATES.filter(t => t.id.indexOf('T-0405-') === 0).forEach(tpl => {
    for (let i = 0; i < ROUNDS; i++) {
      const q = Engine.buildQuestion(tpl, rngFor(i * 61 + 17), 2);
      const f = q.facts;
      const st = stepsById(q);
      assert.strictEqual(f.kind, 'product-rule', `${tpl.id} 用错了族`);

      // ① 答案 = 两个新乘数直接相乘（题面没给第二道乘法，孩子只能靠规律）
      assert.strictEqual(f.expect, f.askA * f.askB, `${tpl.id} expect 和两个新乘数对不上`);
      // ② 基准那道乘法 = 参考积
      assert.strictEqual(st.base.answer, f.refA * f.refB, `${tpl.id} 基准积不对`);
      assert.strictEqual(st.base.answer, f.ref, `${tpl.id} facts.ref 与基准步对不上`);
      // ③ 按黑板上那条规律推一遍，必须落在同一个答案上
      let byRule;
      if (f.mode === 'single') byRule = f.ref * f.k;
      else if (f.mode === 'both-up') byRule = f.ref * f.k * f.k;
      else if (f.mode === 'both-down') byRule = f.ref / (f.k * f.k);
      else byRule = f.ref;                       // 一乘一除，积不变
      assert.strictEqual(st.final.answer, byRule,
        `${tpl.id} 模式 ${f.mode}：规律推出来是 ${byRule}，答案却是 ${st.final.answer}`);
      assert.strictEqual(st.final.answer, f.expect, `${tpl.id} 最终答案与 expect 不符`);
      // ④「积怎么变」这一步只能有一个说对的选项
      assert.strictEqual(st.scale.options.filter(o => o.value === st.scale.answer).length, 1,
        `${tpl.id} 「积怎么变」的选项里有重复值`);
    }
  });
});

test('归一与归总：每一步的答案都能被下一步用上，且归总一定除得尽', () => {
  Templates.TEMPLATES.filter(t => t.id.indexOf('T-0503-') === 0).forEach(tpl => {
    for (let i = 0; i < ROUNDS; i++) {
      const q = Engine.buildQuestion(tpl, rngFor(i * 97 + 23), 2);
      const f = q.facts;
      const st = stepsById(q);
      assert.strictEqual(f.kind, 'unit-rate', `${tpl.id} 用错了族`);

      if (f.mode === 'unit') {
        assert.strictEqual(f.total, f.per * f.given, `${tpl.id} 总数与"每份 × 份数"对不上`);
        assert.ok(f.want > f.given, `${tpl.id} 要买的个数该比已知的多，否则不像绕了个弯`);
        assert.strictEqual(st.unit.answer * f.want, st.final.answer,
          `${tpl.id} 先求一份、再乘份数，串不起来`);
      } else if (f.mode === 'total') {
        assert.strictEqual(st.total.answer, f.each * f.rooms, `${tpl.id} 总数算错`);
        assert.strictEqual(f.total % f.alt, 0, `${tpl.id} 归总之后除不尽：${f.total} ÷ ${f.alt}`);
        assert.ok(f.alt < f.each, `${tpl.id} 每间铺的砖该变少，间数才会变多`);
        assert.strictEqual(st.final.answer * f.alt, f.total, `${tpl.id}「间数 × 每间 = 总数」不成立`);
        assert.ok(st.final.answer > f.rooms, `${tpl.id} 每间铺得少了，可铺的间数必须变多`);
      } else {
        assert.strictEqual(f.cost, f.per * f.want, `${tpl.id} 要付的钱算错`);
        assert.ok(f.pay >= f.cost + 20, `${tpl.id} 付的钱只多 ${f.pay - f.cost} 元，找零太容易蒙`);
        assert.strictEqual(st.cost.answer, f.cost, `${tpl.id} 中间步与 facts 对不上`);
        assert.ok(st.final.answer > 0, `${tpl.id} 找零是 ${st.final.answer}，题目废了`);
        assert.strictEqual(st.final.answer, f.pay - f.cost, `${tpl.id} 找零算错`);
      }
    }
  });
});

// 近似数反推最大 / 最小：答案唯一的检验标准就是"四舍五入回万位还约是 W 万"，
// 而且要"不差"——最大数再加 1、最小数再减 1 都必须跨过进位门槛。
test('近似数反推：推回去还约是原数，边界挪一格就破', () => {
  const toWan = n => Math.floor(n / 10000 + 0.5);
  ['T-0106-F', 'T-0106-G'].forEach(id => {
    const tpl = Templates.TEMPLATES.find(t => t.id === id);
    assert.ok(tpl, `${id} 不在了`);
    const isMax = id === 'T-0106-F';
    for (let i = 0; i < ROUNDS; i++) {
      const q = Engine.buildQuestion(tpl, rngFor(i * 53 + 9), 2);
      const f = q.facts;
      const st = stepsById(q);
      assert.strictEqual(f.kind, 'round-extreme', `${id} 用错了族`);

      const a = st.final.answer;
      assert.strictEqual(toWan(a), f.w, `${id} ${a} 四舍五入到万位不是 ${f.w} 万`);
      assert.strictEqual(a, f.expect, `${id} 最终答案与 expect 不符`);
      assert.notStrictEqual(toWan(a + (isMax ? 1 : -1)), f.w,
        `${id} 不严格：${a} 挪一格仍然约是 ${f.w} 万，那它就不是最大 / 最小`);
      // 支架步教的就是那一位：求最大填 4，求最小填 5
      assert.strictEqual(st.digit.answer, isMax ? 4 : 5,
        `${id} 千位上的数与"${isMax ? '最大' : '最小'}"矛盾`);
    }
  });
});
