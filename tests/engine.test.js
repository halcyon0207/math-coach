/*
 * 引擎单元测试
 *
 * 最关键的一条：**每一道题的最终答案必须等于程序算出来的乘积**。
 * 这是整个方案的立身之本 —— 模型碰不到答案，答案永远来自程序，
 * 所以"答案出错"这件事在结构上就不可能发生。这里用大量随机生成来守住它。
 *
 * 跑：npm test
 */
const test = require('node:test');
const assert = require('node:assert');

const Knowledge = require('../js/knowledge.js');
const Templates = require('../js/templates.js');
const Engine = require('../js/engine.js');
const Store = require('../js/store.js');

const ROUNDS = 400;

function rngFor(seed) { return Engine.mulberry32(seed); }

/* ==================== 1. 答案正确性（最重要） ==================== */
test('每个模板生成 400 次，最终答案都等于程序算出的乘积', () => {
  Templates.TEMPLATES.forEach((tpl, ti) => {
    for (let i = 0; i < ROUNDS; i++) {
      const rng = rngFor(ti * 100000 + i + 1);
      const q = Engine.buildQuestion(tpl, rng, 2);
      const final = q.allSteps.find(s => s.tier === 0);
      const f = q.facts;

      assert.ok(final, `${tpl.id} 缺少最终步骤`);

      if (f.expect !== undefined) {
        // 第一单元（改写 / 求近似数）、第二单元（角）都不是乘法题，没有"两个因数"。
        // 答案同样必须由程序算出，只是算的规则不同 —— 规则写在 facts.expect 里。
        // 用 expect 判断而不是枚举 kind：以后再加别的题型，这里不用跟着改。
        assert.strictEqual(final.answer, f.expect,
          `${tpl.id} 答案 ${final.answer} 与程序按规则算出的 ${f.expect} 不一致`);
      } else if (f.isEstimate) {
        // 估算题：答案是"凑整后的整十数之积"，并应与精确值相近（不超过 30% 偏差）
        assert.strictEqual(final.answer, f.answer, `${tpl.id} 估算答案不一致`);
        const dev = Math.abs(f.answer - f.a * f.b) / (f.a * f.b);
        assert.ok(dev <= 0.3, `${tpl.id} 估算结果偏离过大：${f.a}×${f.b} 估成 ${f.answer}`);
      } else {
        assert.strictEqual(
          final.answer, f.a * f.b,
          `${tpl.id} 答案错误：${f.a} × ${f.b} 应为 ${f.a * f.b}，实际 ${final.answer}`
        );
      }
      assert.ok(Number.isInteger(final.answer), `${tpl.id} 答案不是整数：${final.answer}`);
      assert.ok(final.answer > 0, `${tpl.id} 答案非正：${final.answer}`);
    }
  });
});

test('所有步骤的答案都是正整数', () => {
  Templates.TEMPLATES.forEach((tpl, ti) => {
    for (let i = 0; i < 100; i++) {
      const q = Engine.buildQuestion(tpl, rngFor(ti * 777 + i + 1), 2);
      q.allSteps.forEach(s => {
        assert.ok(Number.isFinite(s.answer) && s.answer > 0,
          `${tpl.id} 步骤「${s.prompt}」答案异常：${s.answer}`);
      });
    }
  });
});

/* ==================== 2. 干扰项（错因探针） ==================== */
test('干扰项不与正确答案重复，也不与彼此重复', () => {
  Templates.TEMPLATES.forEach((tpl, ti) => {
    for (let i = 0; i < ROUNDS; i++) {
      const q = Engine.buildQuestion(tpl, rngFor(ti * 31 + i + 7), 2);
      q.allSteps.forEach(s => {
        if (s.type !== 'number') return;
        const vals = s.distractors.map(d => d.value);
        assert.strictEqual(new Set(vals).size, vals.length,
          `${tpl.id}/${s.id} 干扰项内部有重复：${vals}`);
        vals.forEach(v => {
          assert.notStrictEqual(v, s.answer,
            `${tpl.id}/${s.id} 干扰项与正确答案相同：${v}`);
        });
      });
    }
  });
});

test('选错选项能反推出确定的错因（250 × 40 的经典案例）', () => {
  const tpl = Templates.TEMPLATES.find(t => t.id === 'T-0404-B');
  let checked = { ZERO_LOW: 0, ZERO_HIGH: 0, FORGOT_ZEROS: 0 };
  let found250x40 = false;

  for (let i = 0; i < 2000; i++) {
    const q = Engine.buildQuestion(tpl, rngFor(i + 1), 2);
    const f = q.facts;
    const final = q.allSteps.find(s => s.tier === 0);

    if (f.a === 250 && f.b === 40) found250x40 = true;

    q.allSteps.forEach(s => {
      if (s.type !== 'number') return;
      s.distractors.forEach(d => {
        const g = Engine.gradeStep(s, d.value);
        assert.strictEqual(g.isCorrect, false);
        assert.ok(g.errorTag && g.errorTag !== 'OTHER',
          `${tpl.id}/${s.id} 干扰项 ${d.value} 没有归因`);
        if (s.id === 'final' && checked[g.errorTag] !== undefined) checked[g.errorTag]++;
      });
    });
  }

  assert.ok(found250x40, '应该能生成 250 × 40');
  Object.keys(checked).forEach(k => {
    assert.ok(checked[k] > 0, `错因 ${k} 从未被触发，说明干扰项没覆盖这条错误路径`);
  });
});

/* ============ 2.5 题目与答案的对应性（系统性检查） ============
 *
 * 这一组是为了防一类非常隐蔽的错误：每一步单看都没问题，但题目的**说法**
 * 和答案的**含义**对不上。
 *
 * 真实踩过的坑：500 × 60 那道题里，第②步问的是"两个因数末尾一共有几个 0？"，
 * 答案是 3；但 30000 里有 4 个 0，很自然会被读成"结果末尾有几个 0"于是答 4。
 * 答 4 会被判错，还会被归因成"末尾 0 数多了" —— 一个理解得更细的孩子反而被记成想错了，
 * 而错误归因的数据正是这个方案赖以成立的东西。
 *
 * 所以这里不只验算术，还验"题面的说法"：数字有没有点名、有没有歧义措辞、
 * 每一步的答案能不能串成一条自洽的链。
 */

function stepsById(q) {
  const out = {};
  q.allSteps.forEach(s => { out[s.id] = s; });
  return out;
}

// 凑整题的答案必须是真正的"最接近"，而且不能是平局
function assertNearestRound(step, id) {
  const m = step.prompt.match(/把\s*(\d+)\s*看成最接近的整([百十])数/);
  assert.ok(m, `${id} 凑整题的题干读不出数字：${step.prompt}`);
  const n = Number(m[1]);
  const unit = m[2] === '百' ? 100 : 10;
  const down = Math.floor(n / unit) * unit;
  const up = down + unit;

  assert.notStrictEqual(n - down, up - n,
    `${id} ${n} 到两个整${m[2]}数的距离一样远，答案是平局，这题是废题`);
  assert.strictEqual(step.answer, (n - down < up - n) ? down : up,
    `${id} ${n} 的凑整结果 ${step.answer} 不是最接近的整${m[2]}数`);
  assert.ok(step.options.some(o => o.value === step.answer),
    `${id} 凑整题的正确答案不在选项里`);
}

test('题目与答案的对应性：每一步的答案都能串成一条自洽的链', () => {
  Templates.TEMPLATES.forEach((tpl, ti) => {
    for (let i = 0; i < 300; i++) {
      const q = Engine.buildQuestion(tpl, rngFor(ti * 977 + i + 1), 2);
      const f = q.facts;
      const st = stepsById(q);
      const id = tpl.id;

      // 所有族的共同底线（估算题例外：它的答案本来就该是"凑整后的近似值"）
      const final = st.final;
      if (!f.isEstimate && !f.kind) {
        assert.strictEqual(final.answer, f.a * f.b,
          `${id} 最终答案不等于 ${f.a} × ${f.b}`);
      }

      // 第一单元：改写（380000 = 38 万）
      if (f.kind === 'rewrite') {
        assert.ok(st.drop, `${id} 缺少"去掉几个 0"这一步`);
        // 题干必须点名原数，否则孩子不知道在说哪个数
        assert.ok(st.drop.prompt.includes(String(f.raw)),
          `${id} 题干没有点名原数：${st.drop.prompt}`);
        assert.strictEqual(f.raw, f.k * Math.pow(10, f.dropZeros),
          `${id} 原数 ${f.raw} 与"${f.k} 去掉 ${f.dropZeros} 个 0"对不上`);
        assert.strictEqual(final.answer, f.raw / Math.pow(10, st.drop.answer),
          `${id}「去掉 ${st.drop.answer} 个 0」和答案 ${final.answer} 对不上`);
        continue;
      }

      // 第一单元：求近似数（384400 ≈ 38 万）
      if (f.kind === 'approx') {
        const unitPow = f.unitName === '亿' ? 100000000 : 10000;
        const lookPow = unitPow / 10;

        // 尾数不能为 0，否则"省略尾数"没东西可省，这是一道废题
        assert.notStrictEqual(f.n % unitPow, 0, `${id} ${f.n} 尾数为 0，是废题`);

        // 题干说"看的那一位上是几"，这个数必须真的是那一位上的数
        assert.strictEqual(Math.floor(f.n / lookPow) % 10, f.lookDigit,
          `${id} 关键位取错了`);
        assert.ok(st.dir.prompt.includes(String(f.lookDigit)),
          `${id} 关键位的数字与题干不一致：${st.dir.prompt}`);

        // 舍还是进，必须和关键位上的数一致
        assert.strictEqual(st.dir.answer, f.lookDigit >= 5 ? 2 : 1,
          `${id} 舍/进的判断与关键位 ${f.lookDigit} 不一致`);
        assert.strictEqual(final.answer, f.lookDigit >= 5 ? f.w + 1 : f.w,
          `${id} 四舍五入的结果不对`);
        continue;
      }

      // 族 A：两个因数末尾都有 0（含"数 0"这一步）
      if (st.core && st.zeros) {
        assert.strictEqual(st.core.answer, f.aCore * f.bCore, `${id} 有效部分的积不对`);

        // ★ 数 0 这一步必须点名是哪两个数。只写"两个因数"就有"结果"的第二种读法。
        assert.ok(st.zeros.prompt.includes(String(f.a)) && st.zeros.prompt.includes(String(f.b)),
          `${id} 数 0 的题目没有点名两个因数，会有歧义：${st.zeros.prompt}`);
        assert.ok(!st.zeros.prompt.includes('两个因数'),
          `${id} 数 0 的题目用了"两个因数"这种有歧义的写法：${st.zeros.prompt}`);

        assert.strictEqual(st.zeros.answer, f.totalZeros, `${id} 要补的 0 的个数不对`);

        // ★ 关键恒等式：按"要补几个 0"给有效部分的积补 0，必须正好等于最终答案
        assert.strictEqual(final.answer, st.core.answer * Math.pow(10, st.zeros.answer),
          `${id}「补 ${st.zeros.answer} 个 0」和答案 ${final.answer} 对不上`);
      }

      // 族 B：只有乘数末尾有 0
      if (st.core && !st.zeros && !st.part1) {
        assert.strictEqual(final.answer, st.core.answer * 10,
          `${id} 乘数末尾多一个 0，积也应该多一个 0`);
      }

      // 族 C：拆成两部分相加
      if (st.part1 && st.part2) {
        assert.strictEqual(final.answer, st.part1.answer + st.part2.answer,
          `${id} 两部分加起来不等于最终答案`);
      }

      // 族 D：估算
      if (st.roundA && st.roundB) {
        assert.strictEqual(final.answer, st.roundA.answer * st.roundB.answer,
          `${id} 估算结果不等于两个凑整数之积`);
        assertNearestRound(st.roundA, id);
        assertNearestRound(st.roundB, id);
      }
    }
  });
});

test('求近似数："看错数位"和"该进没进"必须是两种不同的错因', () => {
  // 这两件事的干预方式完全不同：
  //   · 该进没进 —— 是规则没记住，讲一遍"0~4 舍、5~9 入"就行
  //   · 看错数位 —— 是不知道该看哪一位，得先讲"省略到哪一位，就看它右边一位"
  // 混成一个标签的话，孩子会被反复教他已经会的东西。
  const tpl = Templates.TEMPLATES.find(t => t.id === 'T-0106-A');
  const seen = { ROUND_DIR: 0, WRONG_DIGIT: 0, NOT_IN_UNIT: 0 };

  for (let i = 0; i < 2000; i++) {
    const q = Engine.buildQuestion(tpl, rngFor(i + 1), 2);
    const st = stepsById(q);

    // 最终答案上能观察到的是"该进没进"和"没用万作单位"
    st.final.distractors.forEach(d => {
      const g = Engine.gradeStep(st.final, d.value);
      assert.strictEqual(g.isCorrect, false);
      assert.ok(g.errorTag && g.errorTag !== 'OTHER',
        `${tpl.id} 干扰项 ${d.value} 没有归因`);
      if (seen[g.errorTag] !== undefined) seen[g.errorTag]++;
    });

    // "看错数位"只能在"要看哪一位"这一步上观察到 ——
    // 看错数位算出来的结果，数值上和"该进没进"完全重合，
    // 塞进最终答案的干扰项里必然被去重掉，孩子答错了也归不出这个因。
    st.look.options.forEach(o => {
      if (o.value === st.look.answer) return;
      const g = Engine.gradeStep(st.look, o.value);
      assert.strictEqual(g.isCorrect, false);
      assert.ok(g.errorTag && g.errorTag !== 'OTHER',
        `${tpl.id} 选项「${o.label}」没有归因`);
      if (seen[g.errorTag] !== undefined) seen[g.errorTag]++;
    });
  }

  Object.keys(seen).forEach(k => {
    assert.ok(seen[k] > 0, `错因 ${k} 从未被触发，说明干扰项没覆盖这条错误路径`);
  });
});

test('每道题都必须有带数字的题干，不能让孩子直接面对孤零零的一步', () => {
  // 阶梯是"把这道题拆开"，不是"替代这道题"。
  // 题干丢了数字，孩子看到"① 25 × 4 = ?"根本不知道这是哪道题的一步。
  Templates.TEMPLATES.forEach((tpl, ti) => {
    for (let i = 0; i < 20; i++) {
      const q = Engine.buildQuestion(tpl, rngFor(ti * 51 + i + 1), 2);
      assert.ok(q.stem && q.stem.length > 3, `${tpl.id} 没有题干`);
      const f = q.facts;
      const k = f.kind;
      if (k === 'rewrite') {
        assert.ok(q.stem.includes(String(f.raw)), `${tpl.id} 题干里没有原数：${q.stem}`);
      } else if (k === 'approx') {
        assert.ok(q.stem.includes(String(f.n)), `${tpl.id} 题干里没有原数：${q.stem}`);
      } else if (k === 'angle-class') {
        // 看图题的数字在图上，不在题干里 —— 那就必须真的画出了图，
        // 否则孩子对着一句"看下面的角"什么也看不到。
        if (q.figure) {
          assert.strictEqual(q.figure.type, 'angle', `${tpl.id} 图的类型不对`);
          assert.ok(q.figure.deg > 0, `${tpl.id} 图里没有角度`);
        } else {
          assert.ok(q.stem.includes(String(f.deg)), `${tpl.id} 题干里没有角的度数：${q.stem}`);
        }
      } else if (k === 'angle-edge') {
        assert.ok(q.stem.includes(String(f.deg)), `${tpl.id} 题干里没有角的度数：${q.stem}`);
      } else if (k === 'angle-split') {
        assert.ok(q.stem.includes(String(f.x)), `${tpl.id} 题干里没有已知的那个角：${q.stem}`);
      } else if (k === 'angle-relation' || k === 'triangle-make') {
        assert.ok(/三角尺|周角|平角|直角/.test(q.stem), `${tpl.id} 题干里没有角的信息：${q.stem}`);
      } else {
        assert.ok(q.stem.includes(String(f.a)) && q.stem.includes(String(f.b)),
          `${tpl.id} 题干里没有两个因数：${q.stem}`);
      }
    }
  });
});

test('角的分类：180° 被选成钝角时要认出是"把平角当钝角"', () => {
  // 教材同步资料里"易错点 TOP 8"第 3 条就是"认为 180° 是钝角"。
  // 这类题的错因要看"正确答案 + 选了什么"这一对，所以得逐选项验。
  const tpl = Templates.TEMPLATES.find(t => t.id === 'T-0202-A');
  const seen = { FLAT_AS_OBTUSE: 0, TYPE_REVERSE: 0, RIGHT_CONFUSE: 0 };
  let saw180 = false;

  for (let i = 0; i < 2000; i++) {
    const q = Engine.buildQuestion(tpl, rngFor(i + 1), 2);
    if (q.facts.deg === 180) saw180 = true;
    q.allSteps.forEach(s => {
      if (s.type !== 'choice') return;
      s.options.forEach(o => {
        if (o.value === s.answer) return;
        const g = Engine.gradeStep(s, o.value);
        assert.strictEqual(g.isCorrect, false);
        assert.ok(g.errorTag && g.errorTag !== 'OTHER', `选项「${o.label}」没有归因`);
        if (seen[g.errorTag] !== undefined) seen[g.errorTag]++;
      });
    });
  }

  assert.ok(saw180, '应当能出到 180°（平角）');
  Object.keys(seen).forEach(k => {
    assert.ok(seen[k] > 0, `错因 ${k} 从未被触发，说明干扰项没覆盖这条错误路径`);
  });
});

test('有效部分的积本身带 0 时，讲解必须把这个"多出来的 0"说清楚', () => {
  // 5 × 6 = 30 已经带一个 0，所以 500 × 60 = 30000 末尾是 4 个 0，但只补了 3 个。
  // 不解释，孩子和家长都会以为系统数错了。
  const tpl = Templates.TEMPLATES.find(t => t.id === 'T-0401-B');
  let checked = 0;

  for (let i = 0; i < 2000; i++) {
    const q = Engine.buildQuestion(tpl, rngFor(i + 1), 2);
    const st = stepsById(q);
    if (5 * 6 !== st.core.answer) continue;      // 只看有效部分的积带 0 的那批

    checked++;
    const teach = st.final.teach.join(' ');
    assert.ok(/末尾本身已经有/.test(teach),
      `有效部分带 0 时讲解没有说明白：${teach}`);
    assert.ok(teach.includes(String(st.final.answer)),
      '讲解里应当给出最终答案');
    // 结果末尾的 0 确实比"补的个数"多
    assert.strictEqual(st.final.answer, 30000);
    assert.strictEqual(st.zeros.answer, 3);
  }
  assert.ok(checked > 0, '没抽到有效部分带 0 的样本');
});

test('每一个设计出来的干扰项都必须带错因，不能落到 OTHER', () => {
  // 干扰项就是错因探针。没标签的干扰项 = 探针失效 = 白白污染归因数据。
  Templates.TEMPLATES.forEach((tpl, ti) => {
    for (let i = 0; i < 200; i++) {
      const q = Engine.buildQuestion(tpl, rngFor(ti * 131 + i + 1), 2);
      q.allSteps.forEach(s => {
        if (s.type === 'choice') {
          s.options.forEach(o => {
            if (o.value === s.answer) return;
            assert.ok(o.tag && o.tag !== 'OTHER',
              `${tpl.id}/${s.id} 选项「${o.label}」没有错因标签`);
          });
        } else {
          s.distractors.forEach(d => {
            assert.ok(d.tag && d.tag !== 'OTHER',
              `${tpl.id}/${s.id} 干扰项 ${d.value} 没有错因标签`);
          });
        }
      });
    }
  });
});

/* ==================== 3. 判分 ==================== */
test('判分：正确答案判对，未知错值归为 OTHER', () => {
  const q = Engine.buildQuestion(Templates.TEMPLATES[0], rngFor(9), 2);
  q.allSteps.forEach(s => {
    assert.strictEqual(Engine.gradeStep(s, s.answer).isCorrect, true);
    if (s.type === 'number') {
      const weird = Engine.gradeStep(s, s.answer + 12345);
      assert.strictEqual(weird.isCorrect, false);
      assert.strictEqual(weird.errorTag, 'OTHER');
    }
  });
});

test('判分：空答案不算对', () => {
  const q = Engine.buildQuestion(Templates.TEMPLATES[0], rngFor(11), 2);
  ['', null, undefined].forEach(v => {
    assert.strictEqual(Engine.gradeStep(q.allSteps[0], v).isCorrect, false);
  });
});

/* ==================== 4. 数量级校验 ==================== */
test('数量级校验能抓出"少写一个 0"这类错误，但不会泄露答案', () => {
  assert.strictEqual(Engine.magnitudeCheck(10000, 10000), 'ok');
  assert.strictEqual(Engine.magnitudeCheck(10000, 1000), 'digit');    // 少一个 0
  assert.strictEqual(Engine.magnitudeCheck(10000, 100000), 'digit');  // 多一个 0
  assert.strictEqual(Engine.magnitudeCheck(10000, 20000), 'magnitude');
  assert.strictEqual(Engine.magnitudeCheck(10000, 0), 'none');

  const msg = Engine.magnitudeMessage('digit');
  assert.ok(msg.length > 0);
  assert.ok(!/\d/.test(msg), '提示里不应该出现任何数字（否则等于给了答案）');
});

/* ==================== 5. 掌握度 ==================== */
test('掌握度：答对上升、答错下降', () => {
  const p0 = Engine.initialMastery();
  const up = Engine.updateMastery(p0, true, 'number', false);
  const down = Engine.updateMastery(p0, false, 'number', false);
  assert.ok(up > p0, '答对后掌握度应上升');
  assert.ok(down < p0, '答错后掌握度应下降');
  assert.ok(up > down);
});

test('掌握度：填空蒙对比选择题蒙对更有说服力', () => {
  const p0 = 0.4;
  const byChoice = Engine.updateMastery(p0, true, 'choice', false);
  const byNumber = Engine.updateMastery(p0, true, 'number', false);
  assert.ok(byNumber > byChoice, '填空题答对的证据力应强于选择题');
});

test('掌握度：用了提示之后做对，涨幅应明显更小', () => {
  const p0 = 0.4;
  const clean = Engine.updateMastery(p0, true, 'number', false);
  const hinted = Engine.updateMastery(p0, true, 'number', true);
  assert.ok(hinted < clean, '提示后做对的证据力应更弱');
  assert.ok(clean - hinted > 0.05, '差距应当是可感知的');
});

test('掌握度始终落在 (0, 1) 区间', () => {
  let p = 0.5;
  for (let i = 0; i < 500; i++) {
    p = Engine.updateMastery(p, i % 2 === 0, 'number', false);
    assert.ok(p > 0 && p < 1, `掌握度越界：${p}`);
  }
});

/* ==================== 6. 支架档位 ==================== */
test('支架档位：证据不足时一律全拆，稳住了才逐步撤', () => {
  const none = { attempts: 0, corrects: 0 };
  const few = { attempts: 3, corrects: 3 };
  const some = { attempts: 7, corrects: 7 };
  const many = { attempts: 14, corrects: 14 };
  const shaky = { attempts: 14, corrects: 8 };     // 正确率约 57%
  const soSo = { attempts: 14, corrects: 11 };     // 正确率约 79%

  assert.strictEqual(Engine.scaffoldLevelFor(0.99, none), 2, '一题都没做过就不能撤支架');
  assert.strictEqual(Engine.scaffoldLevelFor(0.99, few), 2, '没做满 5 题不能撤支架');
  assert.strictEqual(Engine.scaffoldLevelFor(0.99, some), 1);
  assert.strictEqual(Engine.scaffoldLevelFor(0.99, many), 0);
  assert.strictEqual(Engine.scaffoldLevelFor(0.99, shaky), 2, '正确率低就要保持全拆');
  assert.strictEqual(Engine.scaffoldLevelFor(0.99, soSo), 1, '正确率没到 85% 不该裸着做');
  assert.strictEqual(Engine.scaffoldLevelFor(0.5, many), 1, '掌握度不够也不能撤到最低');

  // ★ 回归：这正是"题目突然没步骤了"那个 bug 的核心。
  // 之前只看掌握度，而一道题答对就能把掌握度从 0.30 推到 0.91，
  // 于是第二次练习整场都不拆了。
  let p = Engine.initialMastery();
  p = Engine.updateMastery(p, true, 'number', false, 0);
  assert.ok(p > 0.35, '答对之后掌握度应当上升');
  assert.strictEqual(Engine.scaffoldLevelFor(p, { attempts: 1, corrects: 1 }), 2,
    '只做过一题就不给步骤了 —— 这正是之前那个 bug');
  assert.strictEqual(Engine.scaffoldLevelFor(p, { attempts: 4, corrects: 4 }), 2,
    '做满 5 题之前都应当保持全拆');

  // 任何档位都要保留核心步骤
  Templates.TEMPLATES.forEach(tpl => {
    [0, 1, 2].forEach(lvl => {
      const q = Engine.buildQuestion(tpl, rngFor(lvl + 3), lvl);
      assert.ok(q.steps.length >= 1, `${tpl.id} 在档位 ${lvl} 下没有步骤`);
      assert.ok(q.steps.some(s => s.tier === 0), `${tpl.id} 在档位 ${lvl} 下丢了核心步骤`);
      assert.ok(q.steps.every(s => s.tier <= lvl || s.tier === 0),
        `${tpl.id} 在档位 ${lvl} 下出现了超出档位的步骤`);
    });
  });
});

test('掌握度：先验是拍的，所以头两次作答不该被当成强证据', () => {
  const p0 = Engine.initialMastery();
  const p1 = Engine.updateMastery(p0, true, 'number', false, 0);
  const p2 = Engine.updateMastery(p1, true, 'number', false, 1);
  const p3 = Engine.updateMastery(p2, true, 'number', false, 2);

  assert.ok(p1 < 0.65, `第一题答对就把掌握度推到 ${p1.toFixed(2)}，太急了`);
  assert.ok(p1 < p2 && p2 < p3, '掌握度应当逐次上升');
  assert.ok(p3 > 0.9, '连着做对之后应当接近熟练');
});

/* ==================== 7. 组卷 ==================== */
function freshState() { return Store.defaultState(); }

// 把一场练习的结果全部按 isCorrect 写回 state（用来模拟"做了又做"）
function applySession(state, sess, isCorrect) {
  sess.questions.forEach(q => {
    const final = q.allSteps.find(s => s.tier === 0);
    state = Engine.applyResult(state, {
      kpId: q.kpId, templateId: q.templateId, qid: q.qid,
      difficulty: q.difficulty, scaffoldLevel: q.scaffoldLevel, stem: final.prompt,
      isCorrect: isCorrect, attempts: 1, errorTag: null, magnitudeFailed: false,
      hintLevel: 0, isCorrectAfterHint: false, inputType: final.type, timeSpentMs: 5000
    }).state;
  });
  return state;
}

test('组卷：题量正确、前三题是热身、同一道题不重复', () => {
  const state = freshState();
  for (let s = 0; s < 50; s++) {
    const sess = Engine.buildSession(state, rngFor(s * 13 + 1));
    assert.strictEqual(sess.questions.length, Engine.QUESTIONS_PER_SESSION);

    // 前两题必须是热身（低难度）
    assert.strictEqual(sess.questions[0].slotKind, 'warmup');
    assert.strictEqual(sess.questions[1].slotKind, 'warmup');
    assert.ok(sess.questions[0].difficulty <= 0.45, '热身题难度应偏低');
    assert.ok(sess.questions[1].difficulty <= 0.45, '热身题难度应偏低');

    // 每道题都要有出题理由
    sess.questions.forEach(q => {
      assert.ok(q.reason && q.reason.length > 3, '每道题都必须有「为什么给你出这道题」');
      assert.ok(Knowledge.byId(q.kpId), `未知知识点 ${q.kpId}`);
    });

    // 同一道题不能在一次练习里出现两次
    const qids = sess.questions.map(q => q.qid);
    assert.strictEqual(new Set(qids).size, qids.length, '同一次练习里出现了重复题目');

    // 同一模板不连续出现
    for (let i = 1; i < sess.questions.length; i++) {
      assert.notStrictEqual(sess.questions[i].templateId, sess.questions[i - 1].templateId,
        '连续两题用了同一个模板');
    }
  }
});

test('组卷：练过的知识点里，掌握度低的会被优先安排', () => {
  const state = freshState();
  // 全部都练过 —— 否则会被"没练过的知识点优先"那条规则接管，
  // 而这条测试要看的是"练过之后，弱的能不能被优先安排"。
  //
  // 这里必须遍历所有已实现的知识点，不能只写原来那三个：
  // 只给三个造记录的话，后加的知识点会被当成"没练过"，名额就被它们占走了，
  // 看起来像是"薄弱点没被优先"，其实是测试自己的场景没造对。
  Knowledge.implemented().forEach(k => {
    state.stats[k.id] = { attempts: 6, corrects: 6, wrongs: 0, lastPracticedAt: Date.now() };
  });
  state.mastery['M4A-04-01'] = 0.95;
  state.mastery['M4A-04-04'] = 0.10;
  state.mastery['M4A-04-06'] = 0.90;

  const sess = Engine.buildSession(state, rngFor(5));
  const counts = {};
  sess.questions.forEach(q => { counts[q.kpId] = (counts[q.kpId] || 0) + 1; });

  assert.ok(counts['M4A-04-04'] >= counts['M4A-04-01'],
    `最弱的知识点安排得比最熟的还少：${JSON.stringify(counts)}`);
  assert.ok(counts['M4A-04-04'] >= counts['M4A-04-06'],
    `最弱的知识点安排得比第二熟的还少：${JSON.stringify(counts)}`);
  assert.ok(counts['M4A-04-04'] >= 3, `最弱的知识点太少了：${JSON.stringify(counts)}`);
});

test('组卷：连着几场下来，每个知识点都会被练到（新的不能被饿死）', () => {
  // 注意这里改过：原来是"每一场都必须覆盖所有知识点"。
  // 知识点只有 3 个时那句话成立；现在有 8 个，而一场只有 10 道题、
  // 中间能自由分配的只有 7 个位置 —— 单场强求全覆盖，
  // 就只能牺牲"薄弱优先"去凑名额，那是本末倒置。
  //
  // 真正要防的是"某个知识点一直练不到"，所以看连着几场。
  const state = freshState();
  const seen = new Set();

  for (let s = 0; s < 4; s++) {
    const sess = Engine.buildSession(state, rngFor(s * 31 + 3));
    sess.questions.forEach(q => {
      seen.add(q.kpId);
      // 让下一场知道这个知识点已经练过，否则每场都从"全都没练过"开始算
      state.stats[q.kpId] = { attempts: 1, corrects: 1, wrongs: 0, lastPracticedAt: Date.now() };
    });
  }

  Knowledge.implemented().forEach(k => {
    assert.ok(seen.has(k.id), `连着 4 场都没出现「${k.name}」`);
  });
});

test('做完一整场之后，支架不会整场消失（这是"题目突然没步骤了"的回归测试）', () => {
  let state = freshState();

  const s1 = Engine.buildSession(state, rngFor(11));
  assert.ok(s1.questions.every(q => q.steps.length >= 2),
    '第一场每道题都应当有阶梯');
  assert.ok(s1.questions.every(q => q.scaffoldLevel === 2),
    '第一场应当全部是全拆的');

  state = applySession(state, s1, true);   // 全部答对

  const s2 = Engine.buildSession(state, rngFor(12));
  s2.questions.forEach(q => {
    assert.ok(q.steps.length >= 2,
      `第二场出现了没有阶梯的题（${q.kpId}，只有 ${q.steps.length} 步）—— 支架撤得太早了`);
  });
  assert.ok(s2.questions.some(q => q.steps.length >= 3),
    '第二场应当还有全拆的题，不该全部降到只剩核心步骤');

  // 再答对一场，仍然不该出现"只剩最终答案"的裸题
  state = applySession(state, s2, true);
  const s3 = Engine.buildSession(state, rngFor(13));
  s3.questions.forEach(q => {
    assert.ok(q.steps.length >= 2, `第三场出现了裸题：${q.kpId}`);
  });
});

test('答错较多时，支架应当保持全拆', () => {
  let state = freshState();
  for (let s = 0; s < 4; s++) {
    const sess = Engine.buildSession(state, rngFor(100 + s));
    state = applySession(state, sess, s < 2);   // 前两场对，后两场错
  }
  const sess = Engine.buildSession(state, rngFor(200));
  const levels = {};
  sess.questions.forEach(q => { levels[q.scaffoldLevel] = (levels[q.scaffoldLevel] || 0) + 1; });
  assert.strictEqual(levels[0] || 0, 0, `答错多的时候不该出现"只问最终答案"的题：${JSON.stringify(levels)}`);
});

/* ==================== 8. 溯源 ==================== */
test('溯源：知识点薄弱且前置不牢时，能给出候选根因', () => {
  const state = freshState();
  state.mastery['M4A-04-04'] = 0.20;
  state.mastery['M4A-04-01'] = 0.30;

  const cands = Engine.traceCandidates(state, 'M4A-04-04');
  assert.strictEqual(cands.length, 1);
  assert.strictEqual(cands[0].kp.id, 'M4A-04-01');

  // 前置已经牢了，就不该再去怀疑它
  state.mastery['M4A-04-01'] = 0.95;
  assert.strictEqual(Engine.traceCandidates(state, 'M4A-04-04').length, 0);

  // 自身掌握度够高时，不做溯源
  state.mastery['M4A-04-04'] = 0.9;
  state.mastery['M4A-04-01'] = 0.3;
  assert.strictEqual(Engine.traceCandidates(state, 'M4A-04-04').length, 0);
});

/* ==================== 9. 作答写回 ==================== */
test('作答写回：掌握度、统计、历史三者同步更新', () => {
  let state = freshState();
  const rec = {
    ts: Date.now(), sessionId: 'S1', kpId: 'M4A-04-04', templateId: 'T-0404-B',
    qid: 'x', difficulty: 0.5, scaffoldLevel: 2, stem: '250 × 40 = ?',
    isCorrect: true, attempts: 1, errorTag: null, magnitudeFailed: false,
    hintLevel: 0, isCorrectAfterHint: false, inputType: 'number', timeSpentMs: 8000
  };
  const out = Engine.applyResult(state, rec);
  state = out.state;

  assert.ok(out.masteryAfter > out.masteryBefore);
  assert.strictEqual(state.mastery['M4A-04-04'], out.masteryAfter);
  assert.strictEqual(state.stats['M4A-04-04'].attempts, 1);
  assert.strictEqual(state.stats['M4A-04-04'].corrects, 1);
  assert.strictEqual(state.history.length, 1);

  // applyResult 必须是纯函数，不改动传入的 state
  const original = freshState();
  Engine.applyResult(original, rec);
  assert.deepStrictEqual(original, freshState(), 'applyResult 不应该是就地修改');
});

test('汇总报告能统计正确率与主要错因', () => {
  const state = freshState();
  const results = [
    { kpId: 'M4A-04-04', isCorrect: false, errorTag: 'ZERO_LOW' },
    { kpId: 'M4A-04-04', isCorrect: false, errorTag: 'ZERO_LOW' },
    { kpId: 'M4A-04-04', isCorrect: true, errorTag: null },
    { kpId: 'M4A-04-01', isCorrect: true, errorTag: null, hintLevel: 1 }
  ];
  const s = Engine.summarize(state, null, results);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.correct, 2);
  assert.strictEqual(s.hintUsed, 1);
  assert.strictEqual(s.accuracy, 0.5);
  const kp = s.byKp.find(k => k.kpId === 'M4A-04-04');
  assert.strictEqual(kp.topError, 'ZERO_LOW');
});

/* ==================== 10. 内容约定 ==================== */
test('知识点图谱：前置知识点必须真实存在，且不构成自环', () => {
  Knowledge.KNOWLEDGE.forEach(k => {
    (k.prereq || []).forEach(p => {
      assert.ok(Knowledge.byId(p), `${k.id} 的前置 ${p} 不存在`);
      assert.notStrictEqual(p, k.id, `${k.id} 的前置不能是自己`);
    });
  });
});

test('已实现的知识点都必须有可用模板', () => {
  Knowledge.implemented().forEach(k => {
    const list = Templates.forKnowledge(k.id);
    assert.ok(list.length > 0, `${k.id} 没有任何题目模板`);
  });
});

test('每个知识点至少要有 2 个模板', () => {
  // 这不是洁癖：知识点只有一个模板时，同一个知识点连着出两题就必然重复。
  // 与其让引擎用随机撞一下来掩盖，不如把内容补上。
  Knowledge.implemented().forEach(k => {
    const list = Templates.forKnowledge(k.id);
    assert.ok(list.length >= 2, `${k.id} 只有 ${list.length} 个模板，至少需要 2 个`);
  });
});

test('每个错因标签都要有面向孩子的说法，且不能出现"粗心"这种没法干预的词', () => {
  Object.keys(Templates.ERROR_TAGS).forEach(tag => {
    const info = Templates.ERROR_TAGS[tag];
    assert.ok(info.label && info.label.length > 0, `${tag} 缺少 label`);
    assert.ok(!/粗心|不认真|马虎/.test(info.label), `${tag} 用了无法干预的说法：${info.label}`);
  });
});

test('三个方法都要有名字、说明与步骤', () => {
  Object.keys(Knowledge.METHODS).forEach(mid => {
    const m = Knowledge.METHODS[mid];
    assert.ok(m.name && m.tip && m.steps.length >= 3, `方法 ${mid} 定义不完整`);
  });
});

test('方法挂在题型上，不是挂在知识点上', () => {
  // 「盯住 0」适用于所有因数末尾有 0 的题（20×30、250×40、348×20 都是先算有效部分再补 0），
  // 「拆开看」只适用于乘数末尾没有 0、必须拆两部分的题（250×24）。
  // 一开始我把方法挂在知识点上，结果同一个知识点里的题被判成了两种方法 —— 那是错的。
  const kp404 = Templates.forKnowledge('M4A-04-04');
  const methods = new Set(kp404.map(t => t.method));
  assert.ok(methods.size >= 2, '「因数末尾有 0」这一组里应当同时出现盯住 0 和拆开看');

  Templates.TEMPLATES.forEach(t => {
    assert.ok(t.method, `${t.id} 没有指定方法`);
    assert.ok(Knowledge.METHODS[t.method], `${t.id} 的方法 ${t.method} 不存在`);
  });

  // 生成出来的题目要带上方法，界面才能显示徽章
  const q = Engine.buildQuestion(Templates.TEMPLATES[0], rngFor(1), 1);
  assert.strictEqual(q.method, Templates.TEMPLATES[0].method);
});
