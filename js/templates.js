/*
 * 题目模板 —— 全部由程序生成，答案由程序算出（不经过大模型）
 *
 * 核心设计：干扰项 = 错因探针
 *  ------------------------------------------------------------------
 *  选项不是随机造的错数，而是按孩子真实的错误路径反推出来的。
 *  孩子选了哪个选项，系统就直接知道他想错了哪一步 ——
 *  不需要 OCR，不需要模型猜，错因是自证的。
 *
 *  所以：拿不准的干扰项不要硬凑。宁可有 3 个选项，也不要污染归因数据。
 *  ------------------------------------------------------------------
 *
 * 另一个设计：阶梯（scaffolding）
 *  每个模板把一道题拆成有先后顺序的步骤，每步的 tier 决定它在什么支架档位出现：
 *    tier 1 —— 辅助步骤（拆解思维，薄弱时才显示）
 *    tier 0 —— 核心步骤（永远显示）
 *  引擎按掌握度选择 scaffoldLevel：0 = 只问核心，1 = 核心+辅助，2 = 全部。
 *  这样"手机端输入难"和"难题不愿思考"两件事被同一个设计解决。
 */
(function (root, factory) {
  var deps = typeof module !== 'undefined' && module.exports
    ? { Knowledge: require('./knowledge.js') }
    : { Knowledge: root.Knowledge };
  var mod = factory(deps.Knowledge);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Templates = mod;
})(typeof self !== 'undefined' ? self : this, function (Knowledge) {
  'use strict';

  /* ============================ 错因标签 ============================ */
  // 这些标签是"计算不仔细"的完整分类。不要加"粗心"这种没法干预的词。
  var ERROR_TAGS = {
    ZERO_LOW: { label: '末尾的 0 数少了', advice: '因数末尾的 0 数量数少了，积就小了 10 倍。' },
    ZERO_HIGH: { label: '末尾的 0 数多了', advice: '因数末尾的 0 数量数多了，积就大了 10 倍。' },
    FORGOT_ZEROS: { label: '忘记补末尾的 0', advice: '前面有效部分算对了，但忘了把因数末尾的 0 补回去。' },
    CORE_CALC: { label: '有效部分算错', advice: '去掉 0 之后的那一步乘法就算错了，先把这个补上。' },
    ZERO_COUNT_LOW: { label: '末尾 0 的个数少数了', advice: '把两个因数末尾的 0 分别数一遍再加起来。' },
    ZERO_COUNT_HIGH: { label: '末尾 0 的个数多数了', advice: '把两个因数末尾的 0 分别数一遍再加起来。' },
    DIGIT_SHIFT: { label: '积的数位错了', advice: '乘 20 和乘 2 只差一个 0，乘数是几十，积的后面就要补一个 0。' },
    SPLIT_SUM: { label: '拆开之后合起来算错', advice: '两部分分别算对了，最后相加时出错。' },
    ROUND_WRONG: { label: '凑整凑错了', advice: '把因数看成最接近的整十数，看的是个位：个位是 1~4 往下看，6~9 往上看。' },
    EXACT_NOT_ESTIMATE: { label: '直接精算了，没有估算', advice: '估算题要求先把因数凑整再算，不用算出准确值。' },
    HALF_ROUNDED: { label: '只凑整了一个因数', advice: '两个因数都要凑整，只凑一个结果会偏。' },
    ESTIMATE_PRODUCT: { label: '整十数相乘算错', advice: '这一步是口算，先算有效数字，再数 0。' },
    // ---- 第一单元 万以上数的认识 ----
    UNIT_ZERO_FEW: { label: '去掉的 0 数少了', advice: '改写成"万"要去掉 4 个 0，改写成"亿"要去掉 8 个 0，去掉少了结果就偏大。' },
    UNIT_ZERO_MORE: { label: '去掉的 0 数多了', advice: '改写成"万"只去掉 4 个 0，改写成"亿"只去掉 8 个 0，去掉多了结果就偏小。' },
    NOT_REWRITTEN: { label: '照抄了原数，没有改写', advice: '改写要去掉末尾的 0，再换成"万"或"亿"作单位。' },
    ROUND_DIR: { label: '该舍的进了、该进的舍了', advice: '看的那一位是 0~4 就舍去，是 5~9 才进 1。' },
    WRONG_DIGIT: { label: '看的数位不对', advice: '省略哪一位后面的尾数，就看紧挨着它右边那一位，不是看更后面的。' },
    NOT_IN_UNIT: { label: '没有用"万"或"亿"作单位', advice: '题目问的是多少万（亿），答案只填"万"前面的那个数就行。' },
    // ---- 第二单元 角的度量（课本 P30—38）----
    // 每一条都对着同步资料《单元知识要点》里的"易错点 TOP 8"，不是拍脑袋想的
    FLAT_AS_OBTUSE: { label: '把平角当成了钝角', advice: '180° 是平角。钝角必须比 90° 大、又比 180° 小，180° 正好卡在边上，不属于钝角。' },
    OBTUSE_AS_FLAT: { label: '把钝角当成了平角', advice: '只有正好 180° 才是平角。比 180° 小的（哪怕 179°）都还是钝角。' },
    TYPE_REVERSE: { label: '锐角和钝角搞反了', advice: '比直角小的是锐角，比直角大又不到 180° 的是钝角 —— 先和直角比一比就不会反。' },
    RIGHT_CONFUSE: { label: '一律拿直角去套', advice: '只有方方正正、正好 90° 的才是直角。先比一比大小，再定名字。' },
    ROUND_FLAT_MIX: { label: '周角和平角搞混了', advice: '转半周是平角 180°，转一整圈才是周角 360°。' },
    ROUND_MISUSE: { label: '周角用错了', advice: '周角是 360°，是转了一整圈。一般只有说"转一圈"的时候才用得上。' },
    CMP_RIGHT_WRONG: { label: '和直角比错了', advice: '直角是 90°。把这个角和 90° 比一比：小、正好、还是大。' },
    WHOLE_ANGLE_WRONG: { label: '整角认错了', advice: '平角是 180°，周角是 360°。先看清楚这个整角到底是哪一个。' },
    ADD_NOT_SUB: { label: '该减的做成加法了', advice: '已知其中一块，求剩下的那一块 —— 要用整角减去已知的，不是加。' },
    SUB_CALC: { label: '减法算错了', advice: '整角减去已知角这一步算错了，再算一遍，可以拆成整十数来减。' },
    RELATION_WRONG: { label: '倍数关系记错了', advice: '1 周角 = 2 平角 = 4 直角（360 = 2×180 = 4×90）。记住这一串就够。' },
    EDGE_LENGTH_CONFUSE: { label: '以为边画得越长角就越大', advice: '角的大小只和两条边张开的程度有关，和边画得长不长没有关系。' },
    CANNOT_MAKE: { label: '这个角用一副三角尺拼不出来', advice: '一副三角尺只有 30°、45°、60°、90°，把它们相加或相减，能拼出的角是固定的几个。' },
    OTHER: { label: '再算一遍试试', advice: '' }
  };

  /* ============================ 随机数工具 ============================ */
  function pickInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  // 取一个末位不为 0 的数（"有效部分"）
  function pickCore(rng, min, max) {
    for (var i = 0; i < 300; i++) {
      var v = pickInt(rng, min, max);
      if (v % 10 !== 0) return v;
    }
    return min;
  }

  // 因数末尾有几个 0
  function countZeros(n) {
    var s = String(n), m = s.match(/0+$/);
    return m ? m[0].length : 0;
  }

  function shuffle(rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 去重、去掉与正确答案相同的项
  function dedupeDistractors(answer, list) {
    var seen = {}, out = [];
    list.forEach(function (d) {
      if (d.value === answer) return;
      if (!isFinite(d.value) || d.value <= 0) return;
      if (Number(d.value) === Number(answer)) return;
      if (seen[d.value]) return;
      seen[d.value] = 1;
      out.push(d);
    });
    return out;
  }

  /* ============================ 通用步骤构造 ============================ */

  // 步骤①：有效部分相乘（送分，但它是方法的起点）
  function stepCore(ac, bc, core) {
    return {
      id: 'core',
      tier: 1,
      type: 'number',
      prompt: ac + ' × ' + bc + ' = ?',
      answer: core,
      distractors: [],
      hint: '先不看因数末尾的 0，把前面的有效数字相乘。',
      teach: [ac + ' × ' + bc + ' = ' + core]
    };
  }

  // 步骤②：要补几个 0
  //
  // 这里改过一次，值得记下来。原来的问法是"两个因数末尾一共有几个 0？"，答案是 3。
  // 但 500 × 60 = 30000 里明明有 4 个 0 —— 很自然会被读成"结果末尾有几个 0"，于是答 4。
  //
  // 关键不在于 3 和 4 谁对，而在于这个问法有两种读法。而歧义的代价不只是体验：
  // 答 4 会被判错，还会被归到"末尾 0 数多了"这个错因上 —— 一个理解得更细的孩子
  // 反而被记成想错了，错误归因的数据就被污染了。错因探针是这个方案的地基，不能脏。
  //
  // 所以问法必须**点名是哪两个数**，不能只写"两个因数"（那才有"结果"的读法）。
  function stepZeroCount(totalZeros, a, b, aZeros, bZeros, rng) {
    var cands = [totalZeros];
    if (totalZeros - 1 >= 0) cands.push(totalZeros - 1);
    cands.push(totalZeros + 1);
    cands = cands.filter(function (v, i, arr) { return arr.indexOf(v) === i; });

    var options = shuffle(rng, cands).map(function (v) {
      return {
        value: v,
        label: v + ' 个',
        tag: v === totalZeros ? null : (v < totalZeros ? 'ZERO_COUNT_LOW' : 'ZERO_COUNT_HIGH')
      };
    });

    return {
      id: 'zeros',
      tier: 2,
      type: 'choice',
      // 点名两个数，去掉"结果"那一种读法
      prompt: a + ' 和 ' + b + '，末尾一共有几个 0？',
      answer: totalZeros,
      options: options,
      hint: '分别看 ' + a + ' 和 ' + b + ' 的末尾各有几个 0，加起来就是要补的个数。',
      teach: [
        a + ' 末尾有 ' + aZeros + ' 个 0，' + b + ' 末尾有 ' + bZeros + ' 个 0',
        '一共 ' + totalZeros + ' 个，所以要在有效部分的积后面补 ' + totalZeros + ' 个 0'
      ]
    };
  }

  // 步骤③：最终答案（核心步骤）
  //
  // 参数用对象传，不用一长串位置参数。7 个位置参数太容易传错顺序，
  // 而"传错了题目看着还挺像回事"正是这类题最危险的一种 bug。
  function stepFinal(info) {
    var a = info.a, b = info.b, core = info.core;
    var answer = info.answer, totalZeros = info.totalZeros;

    var distractors = dedupeDistractors(answer, [
      { value: answer / 10, tag: 'ZERO_LOW' },
      { value: answer * 10, tag: 'ZERO_HIGH' },
      { value: core, tag: 'FORGOT_ZEROS' },
      { value: answer + pickIntFix(answer), tag: 'CORE_CALC' }
    ]);

    var teach = [
      '① 先不看末尾的 0：' + info.aCore + ' × ' + info.bCore + ' = ' + core,
      '② ' + a + ' 和 ' + b + ' 末尾一共 ' + totalZeros + ' 个 0',
      '③ 把 0 补回去：' + answer
    ];

    // 有效部分的积本身就带 0 的时候（5 × 6 = 30），结果末尾的 0 会比"补的个数"多一个。
    // 不说明白，孩子和家长都会以为系统数错了 —— 而这恰恰是这类题最值得讲的一个点。
    var coreZeros = countZeros(core);
    if (coreZeros > 0) {
      teach.push('④ 注意：' + core + ' 末尾本身已经有 ' + coreZeros + ' 个 0，' +
        '所以 ' + answer + ' 末尾一共是 ' + countZeros(answer) + ' 个 0 —— 这不是多补了。');
    }

    return {
      id: 'final',
      tier: 0,
      type: 'number',
      prompt: a + ' × ' + b + ' = ?',
      answer: answer,
      distractors: distractors,
      hint: '有效部分是 ' + core + '，再数一数要补几个 0。',
      teach: teach
    };
  }

  // 给 CORE_CALC 造一个"看着像"的错数（不破坏答案）
  function pickIntFix(answer) {
    var d = Math.max(2, Math.round(Math.abs(answer) * 0.03));
    return d;
  }

  /* ============================ 模板族 ============================ */

  // 族 A：两个因数末尾都有 0（250 × 40 / 300 × 40 / 20 × 30）
  function familyBothZeros(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      // 方法挂在"题目形态"上，不是挂在知识点上 ——
      // 同一个知识点里不同题型的解法本来就不同（见下面 T-0404-D）。
      method: spec.method,
      gen: function (rng) {
        var aCore = spec.aCore(rng);
        var bCore = spec.bCore(rng);
        var aZeros = spec.aZeros;
        var bZeros = spec.bZeros;
        var a = aCore * Math.pow(10, aZeros);
        var b = bCore * Math.pow(10, bZeros);
        var core = aCore * bCore;
        var totalZeros = aZeros + bZeros;
        var answer = a * b;

        return {
          // 题干必须带数字、放在最前面 —— 否则孩子一上来就看到"① 25 × 4 = ?"，
          // 摸不着头脑：这是哪道题的一步？阶梯是拆解，不是替代原题。
          stem: a + ' × ' + b + ' = ?',
          steps: [
            stepCore(aCore, bCore, core),
            stepZeroCount(totalZeros, a, b, aZeros, bZeros, rng),
            stepFinal({
              a: a, b: b, aCore: aCore, bCore: bCore,
              core: core, totalZeros: totalZeros, answer: answer
            })
          ],
          facts: { a: a, b: b, aCore: aCore, bCore: bCore, core: core, totalZeros: totalZeros, answer: answer }
        };
      }
    };
  }

  // 族 B：只有乘数末尾有 0（348 × 20）
  // 这是"积的数位"最容易错的一类，单独做成一个族
  function familyMultiplierZeros(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      // 方法挂在"题目形态"上，不是挂在知识点上 ——
      // 同一个知识点里不同题型的解法本来就不同（见下面 T-0404-D）。
      method: spec.method,
      gen: function (rng) {
        var aCore = spec.aCore(rng);      // 三位数，末位非 0
        var bCore = pickCore(rng, 2, 9);  // 一位数
        var bZeros = 1;
        var a = aCore;
        var b = bCore * 10;
        var step1 = a * bCore;
        var answer = a * b;

        return {
          stem: a + ' × ' + b + ' = ?',
          steps: [
            {
              id: 'core',
              tier: 1,
              type: 'number',
              prompt: a + ' × ' + bCore + ' = ?',
              answer: step1,
              distractors: [],
              hint: '先不看乘数末尾的 0，用它前面的数字去乘。',
              teach: [a + ' × ' + bCore + ' = ' + step1]
            },
            {
              id: 'final',
              tier: 0,
              type: 'number',
              prompt: a + ' × ' + b + ' = ?',
              answer: answer,
              distractors: dedupeDistractors(answer, [
                { value: step1, tag: 'DIGIT_SHIFT' },
                { value: answer * 10, tag: 'ZERO_HIGH' },
                { value: answer / 10, tag: 'ZERO_LOW' }
              ]),
              hint: '乘数是 ' + b + '，比 ' + bCore + ' 后面多了一个 0，积也要多一个 0。',
              teach: [
                '① ' + a + ' × ' + bCore + ' = ' + step1,
                '② 乘数 ' + b + ' 末尾有 1 个 0，积后面也要补 1 个 0',
                '③ 所以 ' + a + ' × ' + b + ' = ' + answer
              ]
            }
          ],
          facts: { a: a, b: b, aCore: aCore, bCore: bCore, core: step1, totalZeros: 1, answer: answer }
        };
      }
    };
  }

  // 族 C：只有被乘数末尾有 0（250 × 24）—— 拆成两部分相加
  function familyMultiplicandZeros(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      // 方法挂在"题目形态"上，不是挂在知识点上 ——
      // 同一个知识点里不同题型的解法本来就不同（见下面 T-0404-D）。
      method: spec.method,
      gen: function (rng) {
        var aCore = spec.aCore(rng);          // 两位数，末位非 0
        var a = aCore * 10;                    // 末尾 1 个 0
        var bt = pickInt(rng, 1, 4);           // 十位
        var bu = pickCore(rng, 2, 9);          // 个位，末位非 0
        var b = bt * 10 + bu;

        var p1 = a * (bt * 10);
        var p2 = a * bu;
        var answer = a * b;

        return {
          stem: a + ' × ' + b + ' = ?',
          steps: [
            {
              id: 'part1',
              tier: 1,
              type: 'number',
              prompt: a + ' × ' + (bt * 10) + ' = ?',
              answer: p1,
              distractors: [],
              hint: '先算 ' + a + ' 乘整十的那部分。',
              teach: [a + ' × ' + (bt * 10) + ' = ' + p1]
            },
            {
              id: 'part2',
              tier: 1,
              type: 'number',
              prompt: a + ' × ' + bu + ' = ?',
              answer: p2,
              distractors: [],
              hint: '再算个位的那部分。',
              teach: [a + ' × ' + bu + ' = ' + p2]
            },
            {
              id: 'final',
              tier: 0,
              type: 'number',
              prompt: a + ' × ' + b + ' = ?',
              answer: answer,
              distractors: dedupeDistractors(answer, [
                { value: p1, tag: 'SPLIT_SUM' },
                { value: p1 + p2 * 10, tag: 'SPLIT_SUM' },
                { value: Math.abs(p1 - p2), tag: 'SPLIT_SUM' }
              ]),
              hint: '把 ' + b + ' 拆成 ' + (bt * 10) + ' + ' + bu + '，两部分加起来。',
              teach: [
                '① 把 ' + b + ' 拆成 ' + (bt * 10) + ' + ' + bu,
                '② ' + a + ' × ' + (bt * 10) + ' = ' + p1,
                '③ ' + a + ' × ' + bu + ' = ' + p2,
                '④ ' + p1 + ' + ' + p2 + ' = ' + answer
              ]
            }
          ],
          facts: { a: a, b: b, core: p1, totalZeros: 1, answer: answer }
        };
      }
    };
  }

  // 族 D：估算（48 × 32 ≈ ? ／ 198 × 32 ≈ ?）
  // 注意：估算答案与精确值必然有偏差，所以因数的取值范围是刻意收窄的 ——
  // 保证"估算结果"离精确值不超过约 25%，否则孩子估出来会以为自己算错了。
  var ROUND_UNITS = [1, 2, 3, 4, 6, 7, 8, 9];   // 避开 0 和 5，不制造"刚好一半"的边界

  function familyEstimate(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      // 方法挂在"题目形态"上，不是挂在知识点上 ——
      // 同一个知识点里不同题型的解法本来就不同（见下面 T-0404-D）。
      method: spec.method,
      gen: function (rng) {
        var a, aR, aUnit;
        if (spec.aDigits === 3) {
          var aH = pickInt(rng, 2, 8);
          // 后两位收窄到 30~70（凑整误差才可控），并且避开 50 ——
          // 后两位正好是 50 时，两个整百数一样近，答案是平局，这题就废了。
          var aRest = pickInt(rng, 30, 49);
          if (rng() < 0.5) aRest = pickInt(rng, 51, 70);
          a = aH * 100 + aRest;
          aR = aRest > 50 ? (aH + 1) * 100 : aH * 100;
          aUnit = 100;
        } else {
          var aT = pickInt(rng, 3, 8);
          var aU = ROUND_UNITS[pickInt(rng, 0, ROUND_UNITS.length - 1)];
          a = aT * 10 + aU;
          aR = aU >= 5 ? (aT + 1) * 10 : aT * 10;
          aUnit = 10;
        }

        var bT = pickInt(rng, 3, 8);
        var bU = ROUND_UNITS[pickInt(rng, 0, ROUND_UNITS.length - 1)];
        var b = bT * 10 + bU;
        var bR = bU >= 5 ? (bT + 1) * 10 : bT * 10;
        var bUnit = 10;

        var estimate = aR * bR;
        var exact = a * b;

        function roundStep(name, val, rounded, unit) {
          var unitName = unit === 100 ? '百' : '十';
          var cands = [rounded, rounded - unit, rounded + unit].filter(function (v) { return v > 0; });
          cands = cands.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
          return {
            id: name,
            tier: 1,
            type: 'choice',
            prompt: '把 ' + val + ' 看成最接近的整' + unitName + '数，是多少？',
            answer: rounded,
            options: shuffle(rng, cands).map(function (v) {
              return { value: v, label: String(v), tag: v === rounded ? null : 'ROUND_WRONG' };
            }),
            hint: '把它和左右两边的整' + unitName + '数比一比，谁离得更近。',
            teach: [val + ' 最接近的整' + unitName + '数是 ' + rounded]
          };
        }

        return {
          stem: '估算 ' + a + ' × ' + b + ' 大约是多少。',
          steps: [
            roundStep('roundA', a, aR, aUnit),
            (function () {
              var s = roundStep('roundB', b, bR, bUnit);
              s.tier = 2;   // 第二个凑整除步骤只在最强支架下出现
              return s;
            })(),
            {
              id: 'final',
              tier: 0,
              type: 'number',
              prompt: a + ' × ' + b + ' ≈ ?（填估算结果）',
              answer: estimate,
              distractors: dedupeDistractors(estimate, [
                { value: exact, tag: 'EXACT_NOT_ESTIMATE' },   // 算了准确值，没有估算
                { value: aR * b, tag: 'HALF_ROUNDED' },        // 只凑整了第一个因数
                { value: a * bR, tag: 'HALF_ROUNDED' },        // 只凑整了第二个因数
                { value: estimate * 10, tag: 'ZERO_HIGH' }
              ]),
              hint: '把两个因数都看成整十、整百数之后，就变成口算了：' + aR + ' × ' + bR,
              teach: [
                '① ' + a + ' ≈ ' + aR + '，' + b + ' ≈ ' + bR,
                '② ' + aR + ' × ' + bR + ' = ' + estimate,
                '③ 所以 ' + a + ' × ' + b + ' 大约等于 ' + estimate
              ]
            }
          ],
          facts: { a: a, b: b, core: estimate, totalZeros: 0, answer: estimate, isEstimate: true }
        };
      }
    };
  }

  // 族 E：改写（380000 = 38 万 ／ 1200000000 = 12 亿）
  //
  // 干扰项只留两条真正会犯的错：
  //   · 少去掉一个 0（38 → 380）
  //   · 根本没改写，把原数照抄进来（380000）
  // 想不出第三条有把握的就不凑 —— 宁可选项少，也不要污染归因数据。
  //
  // k 取末位非 0 的数：这样原数末尾的 0 正好是要去掉的个数，
  // 不会多出一个 0 来让孩子以为是"去掉 5 个"。
  function familyRewrite(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var k = pickCore(rng, spec.kMin, spec.kMax);
        var dropZeros = spec.dropZeros;
        var unitName = spec.unitName;
        var raw = k * Math.pow(10, dropZeros);
        var unitValue = '1' + new Array(dropZeros + 1).join('0');

        var cands = [dropZeros];
        if (dropZeros - 1 > 0) cands.push(dropZeros - 1);
        cands.push(dropZeros + 1);

        var dropStep = {
          id: 'drop',
          tier: 1,
          type: 'choice',
          prompt: '把 ' + raw + ' 改写成用「' + unitName + '」作单位的数，' +
            '要去掉 ' + raw + ' 末尾的几个 0？',
          answer: dropZeros,
          options: shuffle(rng, cands).map(function (v) {
            return {
              value: v,
              label: v + ' 个',
              tag: v === dropZeros ? null : (v < dropZeros ? 'UNIT_ZERO_FEW' : 'UNIT_ZERO_MORE')
            };
          }),
          hint: '1 ' + unitName + ' = ' + unitValue + '，所以要去掉 ' + dropZeros + ' 个 0。',
          teach: ['1 ' + unitName + ' = ' + unitValue + '，去掉 ' + dropZeros +
            ' 个 0 就换成「' + unitName + '」作单位']
        };

        var finalStep = {
          id: 'final',
          tier: 0,
          type: 'number',
          prompt: raw + ' = （　）' + unitName,
          answer: k,
          distractors: dedupeDistractors(k, [
            { value: k * 10, tag: 'UNIT_ZERO_FEW' },
            { value: raw, tag: 'NOT_REWRITTEN' }
          ]),
          hint: '先去掉 ' + raw + ' 末尾的 ' + dropZeros + ' 个 0。',
          teach: [
            '① 改写成「' + unitName + '」作单位，要去掉末尾 ' + dropZeros + ' 个 0',
            '② ' + raw + ' 去掉末尾 ' + dropZeros + ' 个 0 是 ' + k,
            '③ 所以 ' + raw + ' = ' + k + unitName
          ]
        };

        return {
          stem: '把 ' + raw + ' 改写成用「' + unitName + '」作单位的数。',
          steps: [dropStep, finalStep],
          facts: {
            kind: 'rewrite', raw: raw, k: k, dropZeros: dropZeros,
            unitName: unitName, expect: k
          }
        };
      }
    };
  }

  // 族 F：求近似数（384400 ≈ 38 万 ／ 1496000000 ≈ 15 亿）
  //
  // 这一类最容易错的不是"四舍五入"这四个字，而是**看错了哪一位**：
  // 省略万位后面的尾数要看千位，可孩子很自然地就去看百位。
  // 所以"看错数位"单独占一个错因标签，不混进"该进没进"里 ——
  // 混在一起就没法区分"规则不会"和"看错地方"，干预方式完全不同。
  function familyRound(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var unitName = spec.unitName;         // '万' / '亿'
        var unitPow = spec.unitPow;           // 10000 / 100000000
        var lookPow = unitPow / 10;           // 要看的那一位：千位 / 千万位
        var lookName = spec.lookName;
        var nextPow = lookPow / 10;           // 更后面一位：百位 / 百万位
        var nextName = spec.nextName;

        var w = pickInt(rng, spec.wMin, spec.wMax);
        var d = pickInt(rng, 0, 9);                  // 关键位上的数字
        // 尾数不能为 0，否则"省略尾数"没东西可省，这题就是废题
        var rest = pickInt(rng, 1, lookPow - 1);
        var n = w * unitPow + d * lookPow + rest;

        var up = d >= 5;
        var answer = up ? w + 1 : w;
        var wrongDir = up ? w : w + 1;               // 该进没进 / 该舍没舍
        //
        // 注意：「看错数位」这个错因**不能**放进最终答案的干扰项里。
        // 无论看千位还是看百位，算出来的结果都只能是 w 或 w+1 ——
        // 也就是"正确答案"或"该进没进"，数值上和它们完全重合，
        // 放进去必然被去重掉，孩子答错了也归不出这个因。
        // 所以这条错误路径只在 tier 1 的"要看哪一位"那一步上探测。

        var lookStep = {
          id: 'look',
          tier: 1,
          type: 'choice',
          prompt: '省略「' + unitName + '」位后面的尾数，要看哪一位上的数？',
          answer: lookPow,
          options: shuffle(rng, [lookPow, nextPow, unitPow]).map(function (v) {
            var name = v === lookPow ? lookName : (v === nextPow ? nextName : unitName + '位');
            return { value: v, label: name, tag: v === lookPow ? null : 'WRONG_DIGIT' };
          }),
          hint: '要省掉哪一位后面的数，就看紧挨着它右边的那一位。',
          teach: ['省略' + unitName + '位后面的尾数，要看' + lookName]
        };

        var dirStep = {
          id: 'dir',
          tier: 2,
          type: 'choice',
          prompt: lookName + '上是 ' + d + '，尾数该舍去还是进 1？',
          answer: up ? 2 : 1,
          options: shuffle(rng, [1, 2]).map(function (v) {
            return {
              value: v,
              label: v === 1 ? '舍去' : '进 1',
              tag: v === (up ? 2 : 1) ? null : 'ROUND_DIR'
            };
          }),
          hint: '0~4 舍去，5~9 进 1。',
          teach: [lookName + '上是 ' + d + '，' + (up ? '5 及以上，进 1' : '比 5 小，舍去')]
        };

        var finalStep = {
          id: 'final',
          tier: 0,
          type: 'number',
          prompt: n + ' ≈ （　）' + unitName,
          answer: answer,
          distractors: dedupeDistractors(answer, [
            { value: wrongDir, tag: 'ROUND_DIR' },
            { value: w * unitPow, tag: 'NOT_IN_UNIT' }
          ]),
          hint: '看清' + lookName + '上是几，决定舍还是进，再去掉' + unitName + '位后面的尾数。',
          teach: [
            '① 省略' + unitName + '位后面的尾数，要看' + lookName,
            '② ' + lookName + '上是 ' + d + '，' + (up ? '进 1' : '舍去'),
            '③ 所以 ' + n + ' ≈ ' + answer + unitName
          ]
        };

        return {
          stem: '把 ' + n + ' 省略' + unitName + '位后面的尾数，求近似数。',
          steps: [lookStep, dirStep, finalStep],
          facts: {
            kind: 'approx', n: n, w: w, lookDigit: d, answer: answer,
            unitName: unitName, expect: answer
          }
        };
      }
    };
  }

  /* ==================== 第二单元 角的度量（课本 P30—38）==================== */
  var ANGLE_TYPES = [
    { value: 1, name: '锐角' },
    { value: 2, name: '直角' },
    { value: 3, name: '钝角' },
    { value: 4, name: '平角' },
    { value: 5, name: '周角' }
  ];

  function typeOfDeg(deg) {
    if (deg < 90) return 1;
    if (deg === 90) return 2;
    if (deg < 180) return 3;
    if (deg === 180) return 4;
    return 5;
  }

  function angleTypeName(v) {
    var t = ANGLE_TYPES.filter(function (x) { return x.value === v; })[0];
    return t ? t.name : '';
  }

  // 选错类型的错因要看"正确答案 + 选了什么"这一对 —— 单看一个选项说不出他错在哪。
  // 这跟乘法那边的标签不一样：那边一个错数对应一种错法，这边得比对两个。
  function angleTypeErrorTag(chosen, correct) {
    if (chosen === 2) return 'RIGHT_CONFUSE';                      // 一律拿直角去套
    if (correct === 4 && chosen === 3) return 'FLAT_AS_OBTUSE';     // 180° 当成钝角（教材易错点 3）
    if (correct === 3 && chosen === 4) return 'OBTUSE_AS_FLAT';
    if (correct === 5) return 'ROUND_FLAT_MIX';                     // 周角认错
    if (chosen === 5) return 'ROUND_MISUSE';                        // 乱用周角
    return 'TYPE_REVERSE';
  }

  // 辅助步骤：先和直角比一比。判断类型最容易错的就是"没比就下结论"。
  function stepCompareRight(deg, rng) {
    var right = deg < 90 ? 1 : (deg === 90 ? 2 : 3);
    var opts = [
      { value: 1, label: '比直角小' },
      { value: 2, label: '正好是直角' },
      { value: 3, label: '比直角大' }
    ].map(function (o) {
      return { value: o.value, label: o.label, tag: o.value === right ? null : 'CMP_RIGHT_WRONG' };
    });
    return {
      id: 'cmp',
      tier: 1,
      type: 'choice',
      prompt: deg + '° 这个角和直角（90°）比一比，谁大？',
      answer: right,
      options: shuffle(rng, opts),
      hint: '直角是 90°，方方正正的。先比大小，再定名字。',
      teach: [deg + '° ' + (right === 1 ? '比 90° 小' : (right === 2 ? '正好是 90°' : '比 90° 大'))]
    };
  }

  // 族 G：角的分类（给度数 / 看图）
  function familyAngleClassify(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var deg = spec.pickDeg(rng);
        var correct = typeOfDeg(deg);
        var options = ANGLE_TYPES.map(function (t) {
          return {
            value: t.value,
            label: t.name,
            tag: t.value === correct ? null : angleTypeErrorTag(t.value, correct)
          };
        });

        return {
          stem: spec.figure
            ? '看下面的角，判断它是哪一类角。'
            : '判断 ' + deg + '° 这个角是哪一类角。',
          figure: spec.figure ? { type: 'angle', deg: deg } : null,
          steps: [
            stepCompareRight(deg, rng),
            {
              id: 'type',
              tier: 0,
              type: 'choice',
              prompt: spec.figure ? '这个角是（　）' : deg + '° 的角是（　）',
              answer: correct,
              options: shuffle(rng, options),
              hint: '先和直角（90°）比，再看它到没到 180°，最后对上名字。',
              teach: [
                '锐角 < 90°，直角 = 90°，钝角 90°~180°，平角 = 180°，周角 = 360°',
                deg + '° 是' + angleTypeName(correct)
              ]
            }
          ],
          facts: { kind: 'angle-class', deg: deg, expect: correct }
        };
      }
    };
  }

  // 族 H：角的大小与边的长短无关（教材 P33，易错点 2）
  function familyAngleEdge(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var deg = pickInt(rng, 30, 130);
        return {
          stem: '∠1 的两条边画得很长，∠2 的两条边画得很短，但它们张开的大小一样，都是 ' + deg + '°。',
          steps: [
            {
              id: 'idea',
              tier: 1,
              type: 'choice',
              prompt: '角的大小和两条边画得长不长，有关系吗？',
              answer: 2,
              options: shuffle(rng, [
                { value: 1, label: '有，边画得越长角越大', tag: 'EDGE_LENGTH_CONFUSE' },
                { value: 2, label: '没有，只看张开的大小', tag: null }
              ]),
              hint: '想想活动角：把边往外延长，张开的大小变了吗？',
              teach: ['角的大小只和两条边张开的大小有关，与边的长短无关']
            },
            {
              id: 'cmp',
              tier: 0,
              type: 'choice',
              prompt: '那么 ∠1 和 ∠2 比，哪个角大？',
              answer: 3,
              options: shuffle(rng, [
                { value: 1, label: '∠1 大（它的边更长）', tag: 'EDGE_LENGTH_CONFUSE' },
                { value: 2, label: '∠2 大', tag: 'EDGE_LENGTH_CONFUSE' },
                { value: 3, label: '一样大', tag: null }
              ]),
              hint: '两个角张开的大小都是 ' + deg + '°。',
              teach: ['∠1 和 ∠2 都是 ' + deg + '°，张开得一样大，所以两个角一样大']
            }
          ],
          facts: { kind: 'angle-edge', deg: deg, expect: 3 }
        };
      }
    };
  }

  // 族 I：角的计算 —— 整角分成两块，已知一块求另一块
  function familyAngleSplit(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var whole = spec.whole;                        // 180 或 360
        var x = pickInt(rng, spec.xMin, spec.xMax);    // 已知的那一块
        var rest = whole - x;
        var other = whole === 180 ? 360 : 180;         // 最常认错的那个整角

        return {
          stem: '一个' + (whole === 180 ? '平角' : '周角') + '被分成两个角，其中一个是 ' + x + '°。',
          steps: [
            {
              id: 'whole',
              tier: 1,
              type: 'choice',
              prompt: (whole === 180 ? '平角' : '周角') + '是多少度？',
              answer: whole,
              options: shuffle(rng, [180, 360, 90].map(function (v) {
                return { value: v, label: v + '°', tag: v === whole ? null : 'WHOLE_ANGLE_WRONG' };
              })),
              hint: '1 周角 = 2 平角 = 4 直角，直角是 90°。',
              teach: [(whole === 180 ? '平角' : '周角') + '是 ' + whole + '°']
            },
            {
              id: 'rest',
              tier: 0,
              type: 'number',
              prompt: '另一个角是多少度？',
              answer: rest,
              distractors: dedupeDistractors(rest, [
                { value: other - x, tag: 'WHOLE_ANGLE_WRONG' },      // 整角认错了
                { value: whole + x, tag: 'ADD_NOT_SUB' },            // 该减做成加
                { value: rest + pickIntFix(rest), tag: 'SUB_CALC' },
                { value: Math.abs(rest - pickIntFix(rest)), tag: 'SUB_CALC' }
              ]),
              hint: '用整角 ' + whole + '° 减去已知的 ' + x + '°。',
              teach: [
                '① 整角是 ' + whole + '°',
                '② ' + whole + ' − ' + x + ' = ' + rest,
                '③ 另一个角是 ' + rest + '°'
              ]
            }
          ],
          facts: { kind: 'angle-split', whole: whole, x: x, rest: rest, expect: rest }
        };
      }
    };
  }

  // 族 J：角的大小关系换算（1 周角 = 2 平角 = 4 直角，教材 P32）
  var ANGLE_UNITS = [
    { name: '周角', deg: 360 },
    { name: '平角', deg: 180 },
    { name: '直角', deg: 90 }
  ];

  function familyAngleRelation(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var i = pickInt(rng, 0, 1);          // 大的那个：0 周角 / 1 平角
        var j = pickInt(rng, i + 1, 2);      // 小的那个
        var big = ANGLE_UNITS[i], small = ANGLE_UNITS[j];
        var answer = big.deg / small.deg;

        return {
          stem: '角的大小关系：1 周角 = 2 平角 = 4 直角。',
          steps: [
            {
              id: 'deg',
              tier: 1,
              type: 'choice',
              prompt: '1 个' + big.name + '是多少度？',
              answer: big.deg,
              options: shuffle(rng, [360, 180, 90].map(function (v) {
                return { value: v, label: v + '°', tag: v === big.deg ? null : 'WHOLE_ANGLE_WRONG' };
              })),
              hint: '直角 90°，平角是它的 2 倍，周角又是平角的 2 倍。',
              teach: ['1 个' + big.name + ' = ' + big.deg + '°']
            },
            {
              id: 'how',
              tier: 0,
              type: 'number',
              prompt: '1 个' + big.name + ' = （　）个' + small.name,
              answer: answer,
              distractors: dedupeDistractors(answer, [
                { value: answer - 1, tag: 'RELATION_WRONG' },
                { value: answer + 1, tag: 'RELATION_WRONG' },
                { value: answer * 2, tag: 'RELATION_WRONG' }
              ]),
              hint: big.deg + ' ÷ ' + small.deg + ' = ?',
              teach: [
                '① ' + big.name + ' = ' + big.deg + '°，' + small.name + ' = ' + small.deg + '°',
                '② ' + big.deg + ' ÷ ' + small.deg + ' = ' + answer,
                '③ 1 个' + big.name + ' = ' + answer + ' 个' + small.name
              ]
            }
          ],
          facts: { kind: 'angle-relation', big: big.name, small: small.name, expect: answer }
        };
      }
    };
  }

  // 族 K：三角尺拼角（教材 P37 例题）
  var MAKEABLE = [
    { deg: 75, expr: '30° + 45°', a: 30, b: 45, op: '+' },
    { deg: 105, expr: '60° + 45°', a: 60, b: 45, op: '+' },
    { deg: 120, expr: '90° + 30°', a: 90, b: 30, op: '+' },
    { deg: 135, expr: '90° + 45°', a: 90, b: 45, op: '+' },
    { deg: 150, expr: '60° + 90°', a: 60, b: 90, op: '+' },
    { deg: 180, expr: '90° + 90°', a: 90, b: 90, op: '+' },
    { deg: 15, expr: '45° − 30°', a: 45, b: 30, op: '-' }
  ];
  // 这几个是拼不出来的，刻意挑了"看着很像"的：100、115、130 常被误以为能拼
  var UNMAKEABLE = [20, 50, 65, 80, 100, 115, 130, 145, 160, 170];

  function familyTriangleMake(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var m = MAKEABLE[pickInt(rng, 0, MAKEABLE.length - 1)];
        var deg = m.deg;
        var part = m.op === '+' ? m.a + m.b : m.a - m.b;
        var wrong = shuffle(rng, UNMAKEABLE).slice(0, 3);

        return {
          stem: '一副三角尺上的角是 30°、45°、60°、90°。把它们拼在一起（相加或相减），能拼出哪些角？',
          steps: [
            {
              id: 'part',
              tier: 1,
              type: 'number',
              prompt: m.a + '° ' + (m.op === '+' ? '+' : '−') + ' ' + m.b + '° = ?',
              answer: part,
              distractors: dedupeDistractors(part, [
                { value: m.a + m.b, tag: 'SUB_CALC' },
                { value: Math.abs(m.a - m.b), tag: 'SUB_CALC' }
              ]),
              hint: '就是这两个角合在一起（或相差）是多少度。',
              teach: [m.a + '° ' + (m.op === '+' ? '+' : '−') + ' ' + m.b + '° = ' + part + '°']
            },
            {
              id: 'pick',
              tier: 0,
              type: 'choice',
              prompt: '下面哪个角可以用一副三角尺拼出来？',
              answer: deg,
              options: shuffle(rng, [{ value: deg, label: deg + '°', tag: null }].concat(
                wrong.map(function (v) { return { value: v, label: v + '°', tag: 'CANNOT_MAKE' }; })
              )),
              hint: '先把能拼的都列出来：30+45、60+45、90+30、90+45、60+90、90+90、45−30。',
              teach: [
                '一副三角尺能拼出：15°、75°、105°、120°、135°、150°、180°',
                deg + '° = ' + m.expr + '，所以拼得出来'
              ]
            }
          ],
          facts: { kind: 'triangle-make', deg: deg, expect: deg }
        };
      }
    };
  }

  /* ============================ 模板清单 ============================ */
  // 每个 spec 都是一个经过手调难度的"骨架"，参数在其中随机。
  //
  // 方法是按"题型"给的，不是按知识点给的。这一点很要紧：
  // 「盯住 0」适用于所有"因数末尾有 0"的题（20×30、250×40、348×20 都是先算有效部分再补 0），
  // 而「拆开看」只适用于乘数末尾没有 0、必须拆成两部分的题（250×24）。
  // 一开始我把方法挂在知识点上，结果同一个知识点里的题被判成了两种方法 —— 那是错的。
  var SPECS = [
    // ---- 04-01 整十整百数相乘的口算（低难度，主要用来做热身）----
    {
      family: familyBothZeros, id: 'T-0401-A', kp: 'M4A-04-01', difficulty: 0.26,
      shape: '两整十数相乘', method: 'M-COUNT-ZERO',
      aCore: function (rng) { return pickInt(rng, 2, 9); },
      bCore: function (rng) { return pickInt(rng, 2, 9); },
      aZeros: 1, bZeros: 1
    },
    {
      family: familyBothZeros, id: 'T-0401-B', kp: 'M4A-04-01', difficulty: 0.40,
      shape: '整百 × 整十', method: 'M-COUNT-ZERO',
      aCore: function (rng) { return pickInt(rng, 2, 9); },
      bCore: function (rng) { return pickInt(rng, 2, 9); },
      aZeros: 2, bZeros: 1
    },

    // ---- 04-04 因数末尾有 0 的乘法（本期主战场）----
    {
      family: familyBothZeros, id: 'T-0404-A', kp: 'M4A-04-04', difficulty: 0.42,
      shape: '整百 × 整十', method: 'M-COUNT-ZERO',
      aCore: function (rng) { return pickInt(rng, 2, 9); },
      bCore: function (rng) { return pickInt(rng, 3, 9); },
      aZeros: 2, bZeros: 1
    },
    {
      family: familyBothZeros, id: 'T-0404-B', kp: 'M4A-04-04', difficulty: 0.52,
      shape: '三位数（末尾 0）× 整十', method: 'M-COUNT-ZERO',
      aCore: function (rng) { return pickCore(rng, 12, 48); },
      bCore: function (rng) { return pickInt(rng, 2, 9); },
      aZeros: 1, bZeros: 1
    },
    {
      family: familyMultiplierZeros, id: 'T-0404-C', kp: 'M4A-04-04', difficulty: 0.58,
      shape: '三位数 × 整十（只有乘数有 0）', method: 'M-COUNT-ZERO',
      aCore: function (rng) { return pickCore(rng, 112, 489); }
    },
    {
      // ★ 全组唯一一个需要「拆开看」的题型：乘数末尾没有 0，补 0 那招用不上
      family: familyMultiplicandZeros, id: 'T-0404-D', kp: 'M4A-04-04', difficulty: 0.62,
      shape: '末尾有 0 的三位数 × 两位数（要拆两部分）', method: 'M-SPLIT',
      aCore: function (rng) { return pickCore(rng, 12, 48); }
    },

    // ---- 04-06 乘法估算 ----
    {
      family: familyEstimate, id: 'T-0406-A', kp: 'M4A-04-06', difficulty: 0.50,
      shape: '两位数 × 两位数的估算', method: 'M-ESTIMATE'
    },
    {
      family: familyEstimate, id: 'T-0406-B', kp: 'M4A-04-06', difficulty: 0.60,
      shape: '三位数 × 两位数的估算', method: 'M-ESTIMATE',
      aDigits: 3
    },

    // ---- 01-05 改写（以万、亿为单位）----
    {
      family: familyRewrite, id: 'T-0105-A', kp: 'M4A-01-05', difficulty: 0.35,
      shape: '整万数改写成"万"', method: 'M-CHANGE-UNIT',
      unitName: '万', dropZeros: 4, kMin: 12, kMax: 98
    },
    {
      family: familyRewrite, id: 'T-0105-B', kp: 'M4A-01-05', difficulty: 0.45,
      shape: '整亿数改写成"亿"', method: 'M-CHANGE-UNIT',
      unitName: '亿', dropZeros: 8, kMin: 12, kMax: 98
    },

    // ---- 01-06 求近似数（四舍五入、省略尾数）----
    {
      family: familyRound, id: 'T-0106-A', kp: 'M4A-01-06', difficulty: 0.55,
      shape: '省略万位后面的尾数', method: 'M-LOOK-NEXT',
      unitName: '万', unitPow: 10000, lookName: '千位', nextName: '百位', wMin: 10, wMax: 99
    },
    {
      family: familyRound, id: 'T-0106-B', kp: 'M4A-01-06', difficulty: 0.62,
      shape: '省略亿位后面的尾数', method: 'M-LOOK-NEXT',
      unitName: '亿', unitPow: 100000000, lookName: '千万位', nextName: '百万位', wMin: 10, wMax: 99
    },

    // ---- 02-02 角的分类（课本 P32）----
    {
      family: familyAngleClassify, id: 'T-0202-A', kp: 'M4A-02-02', difficulty: 0.35,
      shape: '给度数判断角的类型', method: 'M-ANGLE-TYPE',
      // 度数池是刻意挑的：89 / 91 贴着直角，179 贴着平角，
      // 180 最常被当成钝角，360 是唯一一个周角
      pickDeg: function (rng) {
        var pool = [30, 45, 60, 89, 90, 91, 100, 120, 150, 179, 180, 360];
        return pool[pickInt(rng, 0, pool.length - 1)];
      }
    },
    {
      family: familyAngleClassify, id: 'T-0202-B', kp: 'M4A-02-02', difficulty: 0.40,
      shape: '看图判断角的类型', method: 'M-ANGLE-TYPE',
      figure: true,
      // 画得出来的才放进看图题（周角两条边重合，画出来看不出，不放在这里）
      pickDeg: function (rng) {
        var pool = [25, 40, 65, 80, 90, 100, 115, 140, 165, 180];
        return pool[pickInt(rng, 0, pool.length - 1)];
      }
    },
    {
      family: familyAngleEdge, id: 'T-0202-C', kp: 'M4A-02-02', difficulty: 0.30,
      shape: '角的大小与边的长短无关', method: 'M-ANGLE-TYPE'
    },

    // ---- 02-03 角的计算（课本 P34）----
    {
      family: familyAngleSplit, id: 'T-0203-A', kp: 'M4A-02-03', difficulty: 0.50,
      shape: '平角分成两个角', method: 'M-WHOLE-ANGLE',
      whole: 180, xMin: 20, xMax: 160
    },
    {
      family: familyAngleSplit, id: 'T-0203-B', kp: 'M4A-02-03', difficulty: 0.58,
      shape: '周角分成两个角', method: 'M-WHOLE-ANGLE',
      whole: 360, xMin: 40, xMax: 320
    },

    // ---- 02-04 角的大小关系与三角尺拼角（课本 P32 / P37）----
    {
      family: familyAngleRelation, id: 'T-0204-A', kp: 'M4A-02-04', difficulty: 0.45,
      shape: '周角 / 平角 / 直角的换算', method: 'M-WHOLE-ANGLE'
    },
    {
      family: familyTriangleMake, id: 'T-0204-B', kp: 'M4A-02-04', difficulty: 0.55,
      shape: '一副三角尺能拼出哪个角', method: 'M-WHOLE-ANGLE'
    }
  ];

  var TEMPLATES = SPECS.map(function (s) { return s.family(s); });

  var byKp = {};
  TEMPLATES.forEach(function (t) {
    (byKp[t.kp] = byKp[t.kp] || []).push(t);
  });

  return {
    ERROR_TAGS: ERROR_TAGS,
    TEMPLATES: TEMPLATES,
    byKp: function (kpId) { return byKp[kpId] || []; },
    forKnowledge: function (kpId) {
      return TEMPLATES.filter(function (t) { return t.kp === kpId; });
    }
  };
});
