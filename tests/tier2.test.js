/*
 * 新增四道题族的针对性测试（补基础档的三个口子 + 符号辨析）
 *
 * 这里最有价值的是第一条：它测的不是某道题，而是**知识点池的形状** ——
 * "每个已实现的知识点都得有一道和课本例题一样的基础题"这句话以前只写在文档里，
 * 掌握度为 0 的孩子进场时究竟有没有题可做，没人验过。
 */
const test = require('node:test');
const assert = require('node:assert');

const Knowledge = require('../js/knowledge.js');
const Templates = require('../js/templates.js');
const Engine = require('../js/engine.js');

const ROUNDS = 400;
const rngFor = seed => Engine.mulberry32(seed);

function tplOf(id) {
  const t = Templates.TEMPLATES.filter(x => x.id === id)[0];
  assert.ok(t, `模板 ${id} 不存在`);
  return t;
}

function stepsById(q) {
  const out = {};
  q.allSteps.forEach(s => { out[s.id] = s; });
  return out;
}

test('每个已实现的知识点都至少有一道基础档的非探究题', () => {
  // 探究题（intro）不算：那是"带你第一次把知识点搭出来"的长题，
  // 不是和例题一样的那道练习，闸门保底也不靠它。
  Knowledge.implemented().forEach(kp => {
    const pool = Templates.forKnowledge(kp.id);
    const base = pool.filter(t => !t.intro && Knowledge.tierOf(t.difficulty).key === 'BASE');
    assert.ok(base.length > 0,
      `${kp.id}「${kp.name}」最浅的一道题是 ${
        Math.min.apply(null, pool.map(t => t.difficulty))
      }，基础档（≤ ${Knowledge.TIERS[0].max}）一道没有 —— 没练过的孩子进场就没有题可做`);
  });
});

test('第一次见面的知识点（掌握度 = 初始值），开放的题除探究外都必须在基础档', () => {
  // 注意 state 里没写过 mastery，取的是 BKT 的初始掌握概率（0.30），不是 0。
  // 0.30 已经在巩固档的解锁线（0.45）之下，所以这条测的正是"第一次进场看到什么"。
  const state = { mastery: {}, records: {} };
  Knowledge.implemented().forEach(kp => {
    Engine.unlockedTemplates(state, kp.id).forEach(t => {
      if (t.intro) return;         // 探究题不受门禁，这是刻意的
      assert.strictEqual(Knowledge.tierOf(t.difficulty).key, 'BASE',
        `${kp.id} 在初始掌握度下开放了${Knowledge.tierOf(t.difficulty).name}档的 ${t.id}`);
    });
  });
});

/* ==================== 因数中间有 0 × 一位数（T-0403-C）==================== */

test('中间有 0 的最浅一层：积的十位必须是 0，两种错法都要能探测到', () => {
  const tpl = tplOf('T-0403-C');
  const seen = { MID_ZERO_SKIP: 0, ZERO_TIMES_ANY: 0 };

  for (let i = 0; i < ROUNDS; i++) {
    const q = Engine.buildQuestion(tpl, rngFor(i + 1), 2);
    const f = q.facts;
    const st = stepsById(q);
    const final = st.final;

    assert.strictEqual(final.answer, f.a * f.b, `${tpl.id} 答案不等于 ${f.a} × ${f.b}`);
    // 这一族存在的唯一理由就是"十位上是 0"；它要是没了，整族就失去意义
    assert.strictEqual(Math.floor(f.a / 10) % 10, 0, `${tpl.id} 因数 ${f.a} 的十位不是 0`);
    // 刻意不做进位：一有进位，"0 也要乘"就和进位混在一起，不是这一档要练的东西
    assert.ok(f.a % 10 * f.b < 10, `${tpl.id} 个位乘完进了位：${f.a} × ${f.b}`);
    assert.ok(final.answer < 1000, `${tpl.id} 积超过三位数：${f.a} × ${f.b}`);
    assert.strictEqual(Math.floor(final.answer / 10) % 10, 0,
      `${tpl.id} ${f.a} × ${f.b} 的积十位不是 0，这一档就没在练它该练的那件事`);

    final.distractors.forEach(d => {
      const g = Engine.gradeStep(final, d.value);
      assert.strictEqual(g.isCorrect, false);
      assert.ok(g.errorTag && g.errorTag !== 'OTHER',
        `${tpl.id} 干扰项 ${d.value} 没有归因`);
      if (seen[g.errorTag] !== undefined) seen[g.errorTag]++;
    });

    // 第一步那个"这一位怎么办"，正确说法必须是"照样要乘"
    const ok = st.zero.options.filter(o => o.value === st.zero.answer)[0];
    assert.ok(/照样要乘/.test(ok.label), `${tpl.id} 正确说法被改动了：${ok.label}`);
    assert.strictEqual(st.zero.options.length, 3, `${tpl.id} 三种做法刚好三个选项`);
  }

  Object.keys(seen).forEach(tag => {
    assert.ok(seen[tag] > 0, `错因 ${tag} 从没被触发过，这条错误路径等于没探`);
  });
});

/* ==================== 估算的最浅一层（T-0406-E）==================== */

test('估算基础档：只凑整一个数，而且不许拿"只凑了一个"当错因', () => {
  const tpl = tplOf('T-0406-E');

  for (let i = 0; i < ROUNDS; i++) {
    const q = Engine.buildQuestion(tpl, rngFor(i * 3 + 1), 2);
    const f = q.facts;
    const st = stepsById(q);

    assert.ok(f.b >= 2 && f.b <= 9, `${tpl.id} 乘数不是一位数：${f.b}`);
    assert.strictEqual(f.aR, Math.round(f.a / 10) * 10, `${tpl.id} ${f.a} 没凑成最接近的整十数`);
    assert.strictEqual(st.final.answer, f.aR * f.b, `${tpl.id} 估算结果不等于凑整后的积`);

    // 在这一档"只凑整一个数"就是正确做法（一位数没什么可凑的）。
    // 拿它当错因会冤枉人，还会往归因数据里灌进一条假记录。
    st.final.distractors.forEach(d => {
      assert.notStrictEqual(d.tag, 'HALF_ROUNDED',
        `${tpl.id} 基础档不该有「只凑整了一个因数」这个错因`);
      const g = Engine.gradeStep(st.final, d.value);
      assert.ok(g.errorTag && g.errorTag !== 'OTHER', `${tpl.id} 干扰项 ${d.value} 没有归因`);
    });

    // 估算还得估得出去：偏太多就不是估算，是乱估
    const dev = Math.abs(f.answer - f.a * f.b) / (f.a * f.b);
    assert.ok(dev <= 0.3, `${tpl.id} 估偏了：${f.a} × ${f.b} 估成 ${f.answer}`);
  }
});

/* ==================== 改写 vs 求近似数（T-0106-H）==================== */

test('符号辨析：三句话里只有一句两个符号都对，且错误那句都有数值硬伤', () => {
  const tpl = tplOf('T-0106-H');
  const seen = { REWRITE_VS_APPROX: 0, REAL_EQ_MIX: 0 };

  for (let i = 0; i < ROUNDS; i++) {
    const q = Engine.buildQuestion(tpl, rngFor(i * 11 + 5), 2);
    const f = q.facts;
    const st = stepsById(q);

    // 左边那个数必须"改得干净"：正好是整万，去掉 4 个 0 一个不多一个不少
    assert.strictEqual(f.a % 10000, 0, `${tpl.id} ${f.a} 不是整万数，该写 = 的前提不成立`);
    assert.strictEqual(f.w1 * 10000, f.a);
    // 右边那个必须"改不干净"，而且近似值一定要往前进过 1 ——
    // 否则两个括号里会是同一个数，选项光看数字分不出对错
    assert.notStrictEqual(f.b % 10000, 0, `${tpl.id} ${f.b} 尾数是 0，没东西可省，是废题`);
    assert.ok(f.lookDigit >= 5, `${tpl.id} 关键位是 ${f.lookDigit}，没进位，两道结果会撞在一起`);
    assert.strictEqual(f.approx, f.w2 + 1);

    let correctCount = 0;
    st.final.options.forEach(o => {
      const parts = o.label.split('，');
      assert.strictEqual(parts.length, 2, `${tpl.id} 选项不像两句话：${o.label}`);
      const left = parts[0].match(/^(\d+)\s*([=≈])\s*(\d+)\s*万$/);
      const right = parts[1].match(/^(\d+)\s*([=≈])\s*(\d+)\s*万$/);
      assert.ok(left && right, `${tpl.id} 选项读不出算式：${o.label}`);
      assert.strictEqual(Number(left[1]), f.a);
      assert.strictEqual(Number(right[1]), f.b);

      // 符号用对没用对，判据只有一个：换完单位之后还是不是同一个数
      const okLeft = (left[2] === '=') === (Number(left[3]) * 10000 === f.a);
      const okRight = (right[2] === '=') === (Number(right[3]) * 10000 === f.b);
      if (okLeft && okRight) correctCount++;

      if (o.value !== st.final.answer) {
        // 每个错误选项都得有一处**数值上就站不住**的半句。
        // 不然"380000 约等于 38 万 也没说错呀"这种抬杠没法驳 —— 题面必须只有一种读法。
        assert.ok(right[2] === '=',
          `${tpl.id} 错误选项只错在符号、没有硬伤：${o.label}`);
        const g = Engine.gradeStep(st.final, o.value);
        assert.strictEqual(g.isCorrect, false);
        assert.ok(g.errorTag && g.errorTag !== 'OTHER', `${tpl.id} 选项 ${o.value} 没有归因`);
        if (seen[g.errorTag] !== undefined) seen[g.errorTag]++;
      }
    });
    assert.strictEqual(correctCount, 1, `${tpl.id} 全对的句子不止一句，这题有歧义`);
    assert.strictEqual(st.final.answer, f.expect);
  }

  Object.keys(seen).forEach(tag => {
    assert.ok(seen[tag] > 0, `错因 ${tag} 从没被触发过，这个辨析点等于没做`);
  });
});

test('新方法：中间的 0 和末尾的 0 用的是两套说法', () => {
  const m = Knowledge.METHODS['M-SIGN-CHECK'];
  assert.ok(m, '新方法 M-SIGN-CHECK 没登记');
  assert.ok(m.tip.indexOf('=') >= 0 && m.tip.indexOf('≈') >= 0,
    '方法的说法里必须同时出现 = 和 ≈，否则孩子不知道它管哪件事');
  assert.strictEqual(tplOf('T-0106-H').method, 'M-SIGN-CHECK');
  // 「盯住 0」管末尾的 0（最后补回来就行），「每一位都要乘」管中间的 0（就占在那儿，跑不掉）。
  // 两条都叫"盯住 0"的话，讲的时候就会讲反。
  assert.strictEqual(tplOf('T-0403-C').method, 'M-EACH-DIGIT');
  assert.notStrictEqual(tplOf('T-0403-C').method, tplOf('T-0404-A').method);
});

/* ==================== 角的关系固定那一对（T-0204-F）==================== */

test('角的关系基础档只考「平角 = 2 个直角」，周角留给巩固档', () => {
  // 360 和 180 挨着，是这一族里最容易误判的一对，所以基础档先不让它进来。
  const tpl = tplOf('T-0204-F');
  const solid = tplOf('T-0204-A');

  for (let i = 0; i < 60; i++) {
    const f = Engine.buildQuestion(tpl, rngFor(i + 1), 2).facts;
    assert.strictEqual(f.big, '平角');
    assert.strictEqual(f.small, '直角');
    assert.strictEqual(f.expect, 2);
  }

  // 反向确认：随机那一档确实会出到周角，否则"固定一对"这个区分毫无意义
  let sawRound = false;
  for (let i = 0; i < 200; i++) {
    if (Engine.buildQuestion(solid, rngFor(i + 1), 2).facts.big === '周角') sawRound = true;
  }
  assert.ok(sawRound, 'T-0204-A 从没出过周角，那这两档其实是一回事');
});


