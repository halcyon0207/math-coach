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
    // ---- 第四单元 因数中间有 0 的乘法 ----
    MID_ZERO_SKIP: { label: '把因数中间的 0 漏掉了', advice: '306 中间的 0 也要占着数位，每一位都要乘到，不能跳过去。' },
    PART_NO_SHIFT: { label: '十位乘出来的没有错开一位', advice: '用十位去乘，结果末尾要补一个 0（也就是向左错开一位）再相加。' },
    PART_SUM: { label: '两部分相加算错了', advice: '个位乘出来的和十位乘出来的，最后要加起来 —— 这一步最容易错。' },
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
    MAKEABLE_MISSED: { label: '能拼出的角被当成了拼不出来', advice: '能拼出的角一共七个：15°、75°、105°、120°、135°、150°、180°。两块尺各取一个角，加一加、减一减。' },
    COMBO_WRONG: { label: '拼法对不上这个角', advice: '把你选的那两个角加一加（或减一减），得数是不是题目问的角？' },
    TRI_CALC: { label: '两个角度数算错了', advice: '把两个角写在纸上对齐了再加减，别在心里硬记。' },
    // ---- 第三单元 相交与平行 ----
    INTERSECT_AS_PERP: { label: '以为相交就是垂直', advice: '两条直线相交不一定垂直 —— 只有相交成直角（90°）才叫互相垂直。先看夹角是多少度。' },
    PERP_NOT_RECOGNIZED: { label: '没认出直角', advice: '看到 90°（或者画着直角符号的那个角），这两条直线就是互相垂直。' },
    PARALLEL_AS_INTERSECT: { label: '把平行当成了相交', advice: '同一平面内、怎么延长都不相交的两条直线才叫互相平行。' },
    NOT_SAME_PLANE: { label: '忘了"同一平面内"这个前提', advice: '说"平行"必须加上"在同一平面内" —— 不在同一个平面里的两条直线，不相交也不算平行。' },
    DISTANCE_CONFUSE: { label: '把斜的线段当成了距离', advice: '点到直线的距离，是从这个点画到直线的**垂直**线段的长度，不是随便连一条斜线。' },
    // ---- 第五单元 常见的数量关系 ----
    RELATION_REVERSE: { label: '三个量的关系搞反了', advice: '单价 × 数量 = 总价；速度 × 时间 = 路程。知道其中两个求第三个，用除法而不是乘法。' },
    QUANTITY_WRONG: { label: '代错了量', advice: '先把"哪个是单价、哪个是数量"标出来，再套关系式，别看见两个数就相乘。' },
    UNIT_MISMATCH: { label: '单位没统一就计算', advice: '速度和时间的单位要对上：速度是"每分钟"就用分钟，是"每小时"就用小时。' },
    DIV_MUL_REVERSE: { label: '该除的做成乘法了', advice: '已知总价和单价，求数量 —— 要用总价 ÷ 单价，不是相乘。' },
    // ---- 第六单元 长方形、正方形的面积 ----
    AREA_PERIMETER: { label: '把周长算成了面积', advice: '周长是一圈的长度（长+宽然后再×2），面积是表面的大小（长×宽）。先想清楚问的是哪一个。' },
    AREA_UNIT_RATE: { label: '面积单位进率记错了', advice: '面积单位的进率是 100 不是 10：1 平方米 = 100 平方分米，1 平方分米 = 100 平方厘米。' },
    SIDE_SQUARE_CONFUSE: { label: '正方形面积算成了边长×2', advice: '边长 × 2 那是周长的一部分。正方形的面积是边长 × 边长。' },
    UNIT_CONVERT_DIR: { label: '换算方向反了', advice: '大单位换成小单位要乘进率（1 平方米 = 100 平方分米），小单位换大单位要除。' },
    // ---- 第七单元 条形统计图 ----
    AXIS_SCALE_WRONG: { label: '每格代表多少看错了', advice: '先看纵轴：一格代表几个。看错这一格，后面全错。' },
    READ_VALUE_WRONG: { label: '条形高度读错了', advice: '数格子的时候要对齐纵轴的刻度，别凭"看起来多高"去猜。' },
    COMPARE_WRONG: { label: '比多少看反了', advice: '问"最多/最少"就先找出最高和最低的那两根；问"相差多少"就大数减小数。' },
    SUM_WRONG: { label: '加起来算错了', advice: '求一共多少，要把每一项都算进去，一项一项加起来，别漏掉。' },
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

  // 取一个"凑整之后不会偏太多"的数。
  // 个位是 5 的数（25、35……）凑整要跳 5，两个这样的数碰到一起，
  // 估算值和精确值能差到 40% —— 那就不是估算，是乱估了，孩子也没法用它去检验精算。
  function pickEstimateNum(rng, min, max) {
    for (var i = 0; i < 300; i++) {
      var v = pickInt(rng, min, max);
      var u = v % 10;
      if (u !== 0 && u !== 5) return v;
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
          hint: '1 ' + unitName + ' = ' + unitValue + '。数一数 ' + unitValue +
            ' 的末尾有几个 0，就是要去掉的个数。',
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
  // 整角名称必须查表。
  // 原来是"不是平角就是周角"的二选一，于是 whole=90（直角）时题干被拼成
  // "周角是多少度？"、答案却是 90 —— 孩子答 360 反被判错，还被告知"正确答案 90"。
  // 直角也是整角，二选一在这里是错的。
  var WHOLE_ANGLE_NAME = { 360: '周角', 180: '平角', 90: '直角' };

  function familyAngleSplit(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var whole = spec.whole;                        // 90 / 180 / 360
        var wholeName = WHOLE_ANGLE_NAME[whole] || (whole + '°的角');
        var x = pickInt(rng, spec.xMin, spec.xMax);    // 已知的那一块
        var rest = whole - x;
        // 最常和它认错的那个整角
        var other = whole === 90 ? 180 : (whole === 360 ? 180 : 360);

        return {
          stem: '一个' + wholeName + '被分成两个角，其中一个是 ' + x + '°。',
          steps: [
            {
              id: 'whole',
              tier: 1,
              type: 'choice',
              prompt: wholeName + '是多少度？',
              answer: whole,
              options: shuffle(rng, [90, 180, 360].map(function (v) {
                return { value: v, label: v + '°', tag: v === whole ? null : 'WHOLE_ANGLE_WRONG' };
              })),
              // 提示里刻意不出现度数：三个选项就是 90 / 180 / 360，
              // 一提数字就等于把答案念出来了，这一步的探测也就白放了。
              hint: '想想这三个名字是怎么来的：直角方方正正，平角张开成一条直线，周角转了一整圈。',
              teach: [wholeName + '是 ' + whole + '°']
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
  //
  // 一副三角尺（30/60/90 和 45/45/90）能拼出的角是固定的七个：
  // 15、75、105、120、135、150、180。这个知识点的考法就两种 ——
  // 判断某个角拼不拼得出来；反过来，说出某个角是哪两个角拼的。
  // 所以拆成两个模板族：
  //   · familyTriangleExplore —— 探究题。第一次接触这个知识点先做它：
  //     七个得数一个一个亲手算出来，整张表是孩子自己搭起来的，不是背下来的。
  //     题面就给了"相加或相减"的搭法顺序（先加后减），顺序本身就是方法。
  //   · familyTriangleMake —— 两步式日常练习：先判断"能不能拼"，再找"怎么拼"。
  //     判断题是探针，答"能/不能"错在哪一边，归因就落在哪一边。
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

  function exploreDistractors(m, part) {
    return dedupeDistractors(part, [
      { value: m.op === '+' ? Math.abs(m.a - m.b) : m.a + m.b, tag: 'TRI_CALC' },
      { value: part + 10, tag: 'TRI_CALC' },
      { value: part - 10, tag: 'TRI_CALC' }
    ]);
  }

  function familyTriangleExplore(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function () {
        // 七种拼法按固定顺序列出来，不打乱 —— 这是第一次搭表，不是考核。
        // 前六道是加法（核心是"哪两个角接在一起"），最后那道减法
        // （45−30=15，"两个角叠起来差多少"）单独当核心步骤：
        // 孩子如果只会加不会减，到这一步就会被问住，探针才有牙齿。
        var steps = MAKEABLE.map(function (m, i) {
          var part = m.op === '+' ? m.a + m.b : m.a - m.b;
          return {
            id: 'make' + i,
            tier: i === MAKEABLE.length - 1 ? 0 : 1,
            type: 'number',
            prompt: m.expr + ' = ?',
            answer: part,
            distractors: exploreDistractors(m, part),
            hint: m.op === '+'
              ? '两块尺各拿出一个角，贴着边接起来，从 ' + m.a + ' 往后数 ' + m.b + '。'
              : '把小的那个角叠在大的上面，对齐一条边，露出来的就是差。',
            teach: [m.expr + ' = ' + part + '°']
          };
        });
        return {
          stem: '一副三角尺上有 30°、45°、60°、90° 这些角。两块各取一个拼在一起（相加或相减），把每种拼法的得数都算出来，就能把能拼出的角一次找全。',
          steps: steps,
          facts: { kind: 'triangle-explore', expect: steps[steps.length - 1].answer }
        };
      }
    };
  }

  function familyTriangleMake(spec) {
    return {
      id: spec.id,
      kp: spec.kp,
      difficulty: spec.difficulty,
      shape: spec.shape,
      method: spec.method,
      gen: function (rng) {
        var m = MAKEABLE[pickInt(rng, 0, MAKEABLE.length - 1)];

        if (rng() < 0.6) {
          // —— 能拼出的角：第一步判断，第二步说出是哪一组拼出来的 ——
          var others = shuffle(rng, MAKEABLE.filter(function (x) { return x.deg !== m.deg; })).slice(0, 3);
          return {
            stem: '一副三角尺上的角是 30°、45°、60°、90°。两块各取一个拼一拼（相加或相减）。',
            steps: [
              {
                id: 'judge', tier: 1, type: 'choice',
                prompt: m.deg + '° 可以用一副三角尺拼出来吗？',
                // 选项值用 1 / 2：步骤答案必须是正整数，判分走 Number 相等。
                answer: 1,
                options: shuffle(rng, [
                  { value: 1, label: '能拼出来', tag: null },
                  { value: 2, label: '拼不出来', tag: 'MAKEABLE_MISSED' }
                ]),
                hint: '两块尺各挑一个角，加一加、减一减，看凑不凑得出它。',
                teach: [m.deg + '° = ' + m.expr + '，能拼出来']
              },
              {
                id: 'combo', tier: 0, type: 'choice',
                prompt: m.deg + '° 是用下面哪一组角拼出来的？',
                // 选项值就用各组的得数：这样"答对了"和"知道怎么拼"是同一件事，
                // facts.expect 也能继续对着程序算出的数判。
                answer: m.deg,
                options: shuffle(rng, [{ value: m.deg, label: m.expr, tag: null }].concat(
                  others.map(function (o) { return { value: o.deg, label: o.expr, tag: 'COMBO_WRONG' }; })
                )),
                hint: '把每个选项的得数算一算，哪一个正好是题目问的那个角？',
                teach: [
                  m.deg + '° = ' + m.expr,
                  others.map(function (o) { return o.expr + ' = ' + o.deg + '°'; }).join('，')
                ]
              }
            ],
            facts: { kind: 'triangle-make', deg: m.deg, expect: m.deg }
          };
        }

        // —— 拼不出的角：第一步判断，第二步在选项里认出真能拼出的那个 ——
        var pool = shuffle(rng, UNMAKEABLE);
        var deg = pool[0];
        var wrong = pool.slice(1, 4);
        return {
          stem: '一副三角尺上的角是 30°、45°、60°、90°。两块各取一个拼一拼（相加或相减）。',
          steps: [
            {
              id: 'judge', tier: 1, type: 'choice',
              prompt: deg + '° 可以用一副三角尺拼出来吗？',
              answer: 2,
              options: shuffle(rng, [
                { value: 1, label: '能拼出来', tag: 'CANNOT_MAKE' },
                { value: 2, label: '拼不出来', tag: null }
              ]),
              hint: '两块尺各挑一个角，把能拼出的挨个排一排，看它在不在这张表里。',
              teach: [deg + '° 不在能拼出的那七个角里，拼不出来']
            },
            {
              id: 'pick', tier: 0, type: 'choice',
              prompt: '下面哪个角可以用一副三角尺拼出来？',
              answer: m.deg,
              options: shuffle(rng, [{ value: m.deg, label: m.deg + '°', tag: null }].concat(
                wrong.map(function (v) { return { value: v, label: v + '°', tag: 'CANNOT_MAKE' }; })
              )),
              hint: '先把能拼的都列出来：30+45、60+45、90+30、90+45、60+90、90+90、45−30。',
              teach: [
                '一副三角尺能拼出：15°、75°、105°、120°、135°、150°、180°',
                m.deg + '° = ' + m.expr + '，所以拼得出来'
              ]
            }
          ],
          facts: { kind: 'triangle-make-no', deg: deg, expect: m.deg }
        };
      }
    };
  }

  /* ============================ 第三单元 相交与平行 ============================ */
  // 这一单元最容易错的地方不是"不会画"，而是**把相交当成垂直**：
  // 四年级刚接触垂直，看到两条线交叉就喊"垂直"，忘了还要成 90°。
  // 所以题目刻意一半出直角、一半出斜角，让这个混淆点暴露出来。
  //
  // 选择题的 value 一律用数字 —— 判分是 Number(value) === Number(answer)，
  // 传字符串会变成 NaN，那道题永远判不对。

  function familyPerpJudge(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var isRight = rng() < 0.5;
        var pool = [30, 45, 60, 75, 100, 120, 135, 150];
        var deg = isRight ? 90 : pool[pickInt(rng, 0, pool.length - 1)];

        return {
          stem: '两条直线相交，其中一个角是 ' + deg + '°，这两条直线的关系是？',
          steps: [
            {
              id: 'is-right', tier: 1, type: 'choice',
              prompt: '这个角是直角吗？',
              // 选项值用 1 / 2，不用 1 / 0：步骤答案要求为正整数，
              // 一个答案为 0 的步骤既不合规范，也会被"所有步骤答案为正"这条校验拦下。
              answer: isRight ? 1 : 2,
              options: shuffle(rng, [
                { value: 1, label: '是直角（90°）', tag: isRight ? null : 'INTERSECT_AS_PERP' },
                { value: 2, label: '不是直角', tag: isRight ? 'PERP_NOT_RECOGNIZED' : null }
              ]),
              hint: '直角是方方正正的 90°。',
              teach: [deg + '° ' + (isRight ? '正好是 90°，是直角' : '不是 90°，不是直角')]
            },
            {
              id: 'final', tier: 0, type: 'choice',
              prompt: '它们是什么关系？',
              answer: isRight ? 1 : 2,
              options: shuffle(rng, [
                { value: 1, label: '互相垂直', tag: isRight ? null : 'INTERSECT_AS_PERP' },
                { value: 2, label: '相交但不垂直', tag: isRight ? 'PERP_NOT_RECOGNIZED' : null },
                { value: 3, label: '互相平行', tag: 'PARALLEL_AS_INTERSECT' }
              ]),
              hint: '相交成直角才叫互相垂直；只是交叉在一起不算。',
              teach: [
                '两条直线相交成 ' + deg + '°',
                deg === 90 ? '90° 是直角，所以这两条直线互相垂直'
                  : '不是 90°，所以只是相交，不垂直'
              ]
            }
          ],
          facts: { kind: 'perp-judge', deg: deg, isRight: isRight, expect: isRight ? 1 : 2 }
        };
      }
    };
  }

  function familyParallelJudge(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var isParallel = rng() < 0.5;
        return {
          stem: isParallel
            ? '在同一个平面内有 2 条直线，无论怎么延长都不会相交，这两条直线（　　）。'
            : '在同一个平面内有 2 条直线，延长之后会相交，这两条直线（　　）。',
          steps: [
            {
              // 这一步是必须的：平行判断只有一个最终步骤的话，
              // 支架一撤这道题就"光秃秃"地只剩一个问题，孩子没有任何抓手。
              id: 'how', tier: 1, type: 'choice',
              prompt: '判断两条直线是不是平行，要看什么？',
              answer: 1,
              options: shuffle(rng, [
                { value: 1, label: '把它们延长，看会不会相交', tag: null },
                { value: 2, label: '看它们是不是一样长', tag: 'PARALLEL_AS_INTERSECT' },
                { value: 3, label: '看它们有没有垂直', tag: 'INTERSECT_AS_PERP' }
              ]),
              hint: '平行不看长短，也不看垂不垂直 —— 只看延长后会不会相交。',
              teach: ['判断平行：同一平面内，延长后永远不相交。']
            },
            {
              id: 'final', tier: 0, type: 'choice',
              prompt: '它们是什么关系？',
              answer: isParallel ? 1 : 2,
              options: shuffle(rng, [
                { value: 1, label: '互相平行', tag: isParallel ? null : 'PARALLEL_AS_INTERSECT' },
                { value: 2, label: '相交', tag: isParallel ? 'PARALLEL_AS_INTERSECT' : null },
                { value: 3, label: '互相垂直', tag: 'INTERSECT_AS_PERP' }
              ]),
              hint: '平行要同时满足两个条件：在同一平面内、延长后永远不相交。',
              teach: [
                isParallel
                  ? '同一平面内 + 延长后永不相交 = 互相平行'
                  : '延长之后会相交，那就不是平行，是相交'
              ]
            }
          ],
          facts: { kind: 'parallel-judge', isParallel: isParallel, expect: isParallel ? 1 : 2 }
        };
      }
    };
  }

  // 点到直线的距离：垂线段最短。
  // 这一条是后面学三角形高、平行四边形高的地基，概念不清会一路错下去。
  function familyPerpDistance(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var d = pickInt(rng, 3, 12);                 // 垂直线段（最短）
        var a = d + pickInt(rng, 1, 4);
        var b = d + pickInt(rng, 5, 9);
        return {
          stem: '从点 P 向直线 l 画了 3 条线段：与直线垂直的那条长 ' + d +
            ' 厘米，另外两条斜着的长 ' + a + ' 厘米和 ' + b + ' 厘米。点 P 到直线 l 的距离是多少？',
          steps: [
            {
              id: 'which', tier: 1, type: 'choice',
              prompt: '点 P 到直线 l 的距离，指的是哪一条线段的长度？',
              answer: 1,
              options: shuffle(rng, [
                { value: 1, label: '与直线垂直的那条', tag: null },
                { value: 2, label: '最长的那条', tag: 'DISTANCE_CONFUSE' },
                { value: 3, label: '随便哪一条都行', tag: 'DISTANCE_CONFUSE' }
              ]),
              hint: '垂线段最短 —— 距离指的是这一条。',
              teach: ['距离指的是垂直线段的长度，不是随便连一条斜线。']
            },
            {
              id: 'final', tier: 0, type: 'choice',
              prompt: '点 P 到直线 l 的距离是多少厘米？',
              answer: d,
              options: shuffle(rng, [
                { value: d, label: d + ' 厘米', tag: null },
                { value: a, label: a + ' 厘米', tag: 'DISTANCE_CONFUSE' },
                { value: b, label: b + ' 厘米', tag: 'DISTANCE_CONFUSE' }
              ]),
              hint: '先找出与直线垂直的那条，它的长度就是距离。',
              teach: ['垂直的那条长 ' + d + ' 厘米，所以点 P 到直线 l 的距离是 ' + d + ' 厘米。']
            }
          ],
          facts: { kind: 'perp-distance', d: d, expect: d }
        };
      }
    };
  }

  /* ============================ 第四单元 因数中间有 0 ============================ */
  // 末尾有 0 可以用"数 0 补回去"，中间有 0 不行 —— 中间的 0 占着数位，
  // 每一位都要乘到。孩子最常见的错是把 306 当成 36 来算。
  function familyMiddleZero(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var h = pickInt(rng, 2, 9);
        var u = pickInt(rng, 1, 9);
        var a = h * 100 + u;              // 十位固定为 0，如 306
        // 乘数的个位不能是 0：否则"用个位去乘"那一步会算出 0，
        // 一个 0 分的步骤既没意义，也会让"步骤答案必须为正"这条校验挂掉。
        var b = pickCore(rng, 12, 49);
        var bu = b % 10, bt = Math.floor(b / 10);
        var p1 = a * bu;                  // 个位部分
        var p2 = a * bt * 10;             // 十位部分（末尾补 0）
        var answer = p1 + p2;
        var skipZero = (h * 10 + u) * b;  // 把中间的 0 漏掉：306 → 36

        return {
          stem: a + ' × ' + b + ' = ?',
          steps: [
            {
              id: 'part1', tier: 2, type: 'number',
              prompt: a + ' × ' + bu + ' = ?',
              answer: p1, distractors: [],
              hint: '先用个位去乘。' + a + ' 中间的 0 也要乘到。',
              teach: [a + ' × ' + bu + ' = ' + p1]
            },
            {
              id: 'part2', tier: 1, type: 'number',
              prompt: a + ' × ' + (bt * 10) + ' = ?',
              answer: p2,
              distractors: dedupeDistractors(p2, [
                { value: a * bt, tag: 'PART_NO_SHIFT' },
                { value: skipZero, tag: 'MID_ZERO_SKIP' }
              ]),
              hint: '用十位去乘，结果末尾要补一个 0。',
              teach: [a + ' × ' + bt + ' = ' + (a * bt) + '，末尾补一个 0 → ' + p2]
            },
            {
              id: 'final', tier: 0, type: 'number',
              prompt: a + ' × ' + b + ' = ?',
              answer: answer,
              distractors: dedupeDistractors(answer, [
                { value: skipZero, tag: 'MID_ZERO_SKIP' },
                { value: p1 + a * bt, tag: 'PART_NO_SHIFT' },
                { value: answer + Math.max(2, Math.round(answer * 0.02)), tag: 'PART_SUM' }
              ]),
              hint: '把两部分加起来。',
              teach: [
                '① ' + a + ' × ' + bu + ' = ' + p1,
                '② ' + a + ' × ' + (bt * 10) + ' = ' + p2,
                '③ ' + p1 + ' + ' + p2 + ' = ' + answer,
                '④ ' + a + ' 中间的 0 占着十位，每一位都要乘到'
              ]
            }
          ],
          facts: { kind: 'middle-zero', a: a, b: b, expect: answer }
        };
      }
    };
  }

  /* ============================ 第五单元 常见的数量关系 ============================ */
  // 这一单元的难点不是计算，是**认出关系式**：看见两个数就乘，
  // 因为"乘法"是刚学的，而"求一份是多少"要用除法，反倒被忘了。
  // 所以每道题都先让他选关系式 —— 选错了错因就落在关系式上，
  // 不会被记成"算错了"，家长看到的建议也就对得上。

  function familyPriceQty(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var price = spec.price(rng);
        var qty = spec.qty(rng);
        var total = price * qty;
        var ask = spec.ask;
        var REL = { total: 1, price: 2, qty: 3 };

        var stem, answer, unit, relAnswer, distractors, teach;
        if (ask === 'total') {
          stem = '一本笔记本 ' + price + ' 元，买 ' + qty + ' 本一共要多少元？';
          answer = total; unit = ' 元'; relAnswer = REL.total;
          distractors = [
            { value: price + qty, tag: 'QUANTITY_WRONG' },
            { value: total * 10, tag: 'QUANTITY_WRONG' }
          ];
          teach = ['单价 × 数量 = 总价', price + ' × ' + qty + ' = ' + total + '（元）'];
        } else if (ask === 'price') {
          stem = '买 ' + qty + ' 本笔记本一共花了 ' + total + ' 元，每本多少元？';
          answer = price; unit = ' 元'; relAnswer = REL.price;
          distractors = [
            { value: total * qty, tag: 'DIV_MUL_REVERSE' },
            { value: total - qty, tag: 'QUANTITY_WRONG' }
          ];
          teach = ['总价 ÷ 数量 = 单价', total + ' ÷ ' + qty + ' = ' + price + '（元）'];
        } else {
          stem = '每本笔记本 ' + price + ' 元，带 ' + total + ' 元能买几本？';
          answer = qty; unit = ' 本'; relAnswer = REL.qty;
          distractors = [
            { value: total * price, tag: 'DIV_MUL_REVERSE' },
            { value: total - price, tag: 'QUANTITY_WRONG' }
          ];
          teach = ['总价 ÷ 单价 = 数量', total + ' ÷ ' + price + ' = ' + qty + '（本）'];
        }

        return {
          stem: stem,
          steps: [
            {
              id: 'relation', tier: 1, type: 'choice',
              prompt: '这道题用哪个关系式？',
              answer: relAnswer,
              options: shuffle(rng, [
                { value: 1, label: '单价 × 数量 = 总价', tag: ask === 'total' ? null : 'RELATION_REVERSE' },
                { value: 2, label: '总价 ÷ 数量 = 单价', tag: ask === 'price' ? null : 'RELATION_REVERSE' },
                { value: 3, label: '总价 ÷ 单价 = 数量', tag: ask === 'qty' ? null : 'RELATION_REVERSE' }
              ]),
              hint: '先看要求的是哪一个量，再选关系式。',
              teach: teach
            },
            {
              id: 'final', tier: 0, type: 'number',
              prompt: '答案是多少' + unit + '？',
              answer: answer,
              distractors: dedupeDistractors(answer, distractors),
              hint: '按你选的那个关系式算。',
              teach: teach
            }
          ],
          facts: { kind: 'price-qty', ask: ask, price: price, qty: qty, total: total, expect: answer }
        };
      }
    };
  }

  function familySpeedTime(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var v = spec.speed(rng);
        var t = spec.hours(rng);
        var s = v * t;
        var ask = spec.ask;
        var REL = { dist: 1, speed: 2, time: 3 };
        var needConvert = spec.convert || false;

        // 需要换算的题型（速度按"每小时"给，时间却给"分钟"）：
        // 这一类的错因几乎全是"没换单位就直接乘"，单独做成一个变体。
        var minutes = t * 60;

        var stem, answer, unit, relAnswer, distractors, teach, extraStep = null;
        if (ask === 'dist') {
          stem = needConvert
            ? '一辆车每小时行 ' + v + ' 千米，行了 ' + minutes + ' 分钟，一共行了多少千米？'
            : '一辆车每小时行 ' + v + ' 千米，行了 ' + t + ' 小时，一共行了多少千米？';
          answer = s; unit = ' 千米'; relAnswer = REL.dist;
          distractors = needConvert
            ? [{ value: v * minutes, tag: 'UNIT_MISMATCH' }]
            : [{ value: v + t, tag: 'QUANTITY_WRONG' }, { value: s + v, tag: 'QUANTITY_WRONG' }];
          teach = ['速度 × 时间 = 路程'];
          teach.push(needConvert
            ? minutes + ' 分钟 = ' + t + ' 小时，' + v + ' × ' + t + ' = ' + s + '（千米）'
            : v + ' × ' + t + ' = ' + s + '（千米）');
        } else if (ask === 'speed') {
          stem = '一辆车 ' + t + ' 小时行了 ' + s + ' 千米，平均每小时行多少千米？';
          answer = v; unit = ' 千米/时'; relAnswer = REL.speed;
          distractors = [
            { value: s * t, tag: 'DIV_MUL_REVERSE' },
            { value: s - t, tag: 'QUANTITY_WRONG' }
          ];
          teach = ['路程 ÷ 时间 = 速度', s + ' ÷ ' + t + ' = ' + v + '（千米/时）'];
        } else {
          stem = '一辆车每小时行 ' + v + ' 千米，行 ' + s + ' 千米需要多少小时？';
          answer = t; unit = ' 小时'; relAnswer = REL.time;
          distractors = [
            { value: s * v, tag: 'DIV_MUL_REVERSE' },
            { value: s - v, tag: 'QUANTITY_WRONG' }
          ];
          teach = ['路程 ÷ 速度 = 时间', s + ' ÷ ' + v + ' = ' + t + '（小时）'];
        }

        if (needConvert) {
          extraStep = {
            id: 'convert', tier: 2, type: 'number',
            prompt: minutes + ' 分钟 = ? 小时',
            answer: t, distractors: [{ value: minutes, tag: 'UNIT_MISMATCH' }],
            hint: '1 小时 = 60 分钟，分钟换成小时要除以 60。',
            teach: [minutes + ' ÷ 60 = ' + t + '（小时）']
          };
        }

        var steps = [];
        if (extraStep) steps.push(extraStep);
        steps.push({
          id: 'relation', tier: 1, type: 'choice',
          prompt: '这道题用哪个关系式？',
          answer: relAnswer,
          options: shuffle(rng, [
            { value: 1, label: '速度 × 时间 = 路程', tag: ask === 'dist' ? null : 'RELATION_REVERSE' },
            { value: 2, label: '路程 ÷ 时间 = 速度', tag: ask === 'speed' ? null : 'RELATION_REVERSE' },
            { value: 3, label: '路程 ÷ 速度 = 时间', tag: ask === 'time' ? null : 'RELATION_REVERSE' }
          ]),
          hint: '先看要求的是哪一个量。',
          teach: teach
        });
        steps.push({
          id: 'final', tier: 0, type: 'number',
          prompt: '答案是多少' + unit + '？',
          answer: answer,
          distractors: dedupeDistractors(answer, distractors),
          hint: '速度和时间的单位要对上，再套关系式。',
          teach: teach
        });

        return {
          stem: stem,
          steps: steps,
          facts: { kind: 'speed-time', ask: ask, v: v, t: t, s: s, expect: answer }
        };
      }
    };
  }

  /* ============================ 第六单元 长方形、正方形的面积 ============================ */
  // 这一单元有两个坑，题目是照着坑设计的：
  //  1. **面积和周长分不清** —— 干扰项里一定放一个"周长"的答案，
  //     选了它错因就是 AREA_PERIMETER，而不是笼统的"算错了"。
  //  2. **面积单位进率是 100 不是 10** —— 长度单位刚学完（进率 10），
  //     孩子会顺手把 100 写成 10，所以干扰项里也一定放一个"差 10 倍"的值。

  function familyAreaUnit(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var rate = spec.rate;                 // 100 或 10000
        var k = pickInt(rng, spec.kMin, spec.kMax);
        var answer, stem, distractors;
        if (spec.reverse) {
          // 小单位 → 大单位：除以进率
          answer = k;
          stem = (k * rate) + ' ' + spec.to + ' = （　）' + spec.from;
          distractors = [
            { value: k * rate * rate, tag: 'UNIT_CONVERT_DIR' },
            { value: k * 10, tag: 'AREA_UNIT_RATE' }
          ];
        } else {
          answer = k * rate;
          stem = k + ' ' + spec.from + ' = （　）' + spec.to;
          distractors = [
            { value: k * 10, tag: 'AREA_UNIT_RATE' },
            { value: Math.max(1, Math.round(k / 10)), tag: 'UNIT_CONVERT_DIR' }
          ];
        }
        return {
          stem: stem,
          steps: [
            {
              id: 'rate', tier: 1, type: 'choice',
              prompt: spec.from + ' 和 ' + spec.to + ' 之间的进率是多少？',
              answer: rate,
              options: shuffle(rng, [
                { value: 10, label: '10', tag: 'AREA_UNIT_RATE' },
                { value: 100, label: '100', tag: rate === 100 ? null : 'AREA_UNIT_RATE' },
                { value: 10000, label: '10000', tag: rate === 10000 ? null : 'AREA_UNIT_RATE' }
              ]),
              hint: '面积单位的进率是"长度进率的平方"：把相邻长度单位之间的那个进率，自己乘一次。',
              teach: ['1 ' + spec.from + ' = ' + rate + ' ' + spec.to]
            },
            {
              id: 'final', tier: 0, type: 'number',
              prompt: '括号里填多少？',
              answer: answer,
              distractors: dedupeDistractors(answer, distractors),
              hint: spec.reverse ? '小单位换大单位要除以进率。' : '大单位换小单位要乘进率。',
              teach: [
                '1 ' + spec.from + ' = ' + rate + ' ' + spec.to,
                (spec.reverse ? (k * rate) + ' ÷ ' + rate : k + ' × ' + rate) + ' = ' + answer
              ]
            }
          ],
          facts: { kind: 'area-unit', rate: rate, k: k, expect: answer }
        };
      }
    };
  }

  function familyRectArea(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var a = spec.long(rng);
        var b = spec.wide(rng);
        var area = a * b;
        var perimeter = (a + b) * 2;
        var ask = spec.ask;   // 'area' | 'side'
        var answer, stem, distractors, unit;

        if (ask === 'side') {
          // 已知面积和一条边，求另一条边：面积 ÷ 宽
          answer = a; unit = ' 厘米';
          stem = '一个长方形的面积是 ' + area + ' 平方厘米，宽是 ' + b + ' 厘米，长是多少厘米？';
          distractors = [
            { value: area * b, tag: 'DIV_MUL_REVERSE' },
            { value: area - b, tag: 'QUANTITY_WRONG' }
          ];
        } else {
          answer = area; unit = ' 平方厘米';
          stem = '一个长方形长 ' + a + ' 厘米，宽 ' + b + ' 厘米，它的面积是多少平方厘米？';
          distractors = [
            { value: perimeter, tag: 'AREA_PERIMETER' },
            { value: a + b, tag: 'AREA_PERIMETER' }
          ];
        }

        return {
          stem: stem,
          steps: [
            {
              id: 'which', tier: 1, type: 'choice',
              prompt: '这道题要用哪个公式？',
              answer: ask === 'side' ? 2 : 1,
              options: shuffle(rng, [
                { value: 1, label: '面积 = 长 × 宽', tag: ask === 'side' ? 'RELATION_REVERSE' : null },
                { value: 2, label: '长 = 面积 ÷ 宽', tag: ask === 'side' ? null : 'RELATION_REVERSE' },
                { value: 3, label: '周长 = （长 + 宽）× 2', tag: 'AREA_PERIMETER' }
              ]),
              hint: '先确认题目问的是面积还是周长。',
              teach: ['长方形的面积 = 长 × 宽']
            },
            {
              id: 'final', tier: 0, type: 'number',
              prompt: '答案是多少' + unit + '？',
              answer: answer,
              distractors: dedupeDistractors(answer, distractors),
              hint: '面积用"长 × 宽"，别做成周长。',
              teach: ask === 'side'
                ? ['面积 ÷ 宽 = 长', area + ' ÷ ' + b + ' = ' + a + '（厘米）']
                : ['长 × 宽 = 面积', a + ' × ' + b + ' = ' + area + '（平方厘米）']
            }
          ],
          facts: { kind: 'rect-area', a: a, b: b, area: area, expect: answer }
        };
      }
    };
  }

  function familySquareArea(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var s = spec.side(rng);
        var area = s * s;
        return {
          stem: '一个正方形的边长是 ' + s + ' 厘米，它的面积是多少平方厘米？',
          steps: [
            {
              id: 'which', tier: 1, type: 'choice',
              prompt: '正方形的面积怎么算？',
              answer: 1,
              options: shuffle(rng, [
                { value: 1, label: '边长 × 边长', tag: null },
                { value: 2, label: '边长 × 2', tag: 'SIDE_SQUARE_CONFUSE' },
                { value: 3, label: '边长 × 4', tag: 'AREA_PERIMETER' }
              ]),
              hint: '边长 × 4 那是周长。面积是"铺满有多大"。',
              teach: ['正方形的面积 = 边长 × 边长']
            },
            {
              id: 'final', tier: 0, type: 'number',
              prompt: '面积是多少平方厘米？',
              answer: area,
              distractors: dedupeDistractors(area, [
                { value: s * 2, tag: 'SIDE_SQUARE_CONFUSE' },
                { value: s * 4, tag: 'AREA_PERIMETER' }
              ]),
              hint: s + ' × ' + s + '，不是 ' + s + ' × 2。',
              teach: [s + ' × ' + s + ' = ' + area + '（平方厘米）']
            }
          ],
          facts: { kind: 'square-area', s: s, area: area, expect: area }
        };
      }
    };
  }

  /* ============================ 第七单元 条形统计图 ============================ */
  // 这是全册唯一一个"读图"的知识点，题目形态和前面都不一样：
  // 数据不是算出来的，是**从图上看出来的**。所以图形数据（figure）跟着题目走，
  // 由界面照着画出来 —— 引擎这边只负责保证"图上标的数"和"正确答案"是同一份。
  //
  // 刻意让每项的格数互不相同：出现并列时"哪个最多"就有两个正确答案，
  // 那不是孩子的错，是题目出错了。

  function familyBarChart(spec) {
    var NAMES = ['苹果', '香蕉', '橘子', '梨', '葡萄', '桃子'];
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var unitPerCell = spec.unitPerCell(rng);
        var n = spec.itemCount || 4;
        var picked = shuffle(rng, NAMES).slice(0, n);

        // 格数不重复，保证"最多""最少"都唯一
        var pool = [];
        for (var c = spec.cellsMin; c <= spec.cellsMax; c++) pool.push(c);
        var chosen = shuffle(rng, pool).slice(0, n);

        var items = picked.map(function (name, i) {
          return { label: name, cells: chosen[i], value: chosen[i] * unitPerCell };
        });

        var maxIdx = 0, minIdx = 0;
        items.forEach(function (it, i) {
          if (it.value > items[maxIdx].value) maxIdx = i;
          if (it.value < items[minIdx].value) minIdx = i;
        });
        var total = items.reduce(function (s, it) { return s + it.value; }, 0);
        var ask = spec.ask;

        var finalStep;
        if (ask === 'max') {
          finalStep = {
            id: 'final', tier: 0, type: 'choice',
            prompt: '哪一种最多？',
            answer: maxIdx + 1,
            options: shuffle(rng, items.map(function (it, i) {
              return { value: i + 1, label: it.label, tag: i === maxIdx ? null : 'COMPARE_WRONG' };
            })),
            hint: '找最高的那根，再看它对应横轴上哪一栏。',
            teach: ['最高的是「' + items[maxIdx].label + '」，' +
              items[maxIdx].cells + ' 格 × ' + unitPerCell + ' = ' + items[maxIdx].value + ' 个']
          };
        } else if (ask === 'diff') {
          var diff = items[maxIdx].value - items[minIdx].value;
          finalStep = {
            id: 'final', tier: 0, type: 'number',
            prompt: '最多的比最少的多多少个？',
            answer: diff,
            distractors: dedupeDistractors(diff, [
              { value: items[maxIdx].cells - items[minIdx].cells, tag: 'READ_VALUE_WRONG' },
              { value: items[maxIdx].value + items[minIdx].value, tag: 'COMPARE_WRONG' }
            ]),
            hint: '先分别算出最多和最少各多少个，再相减。',
            teach: [
              '最多：' + items[maxIdx].label + ' ' + items[maxIdx].value + ' 个',
              '最少：' + items[minIdx].label + ' ' + items[minIdx].value + ' 个',
              '相差：' + items[maxIdx].value + ' − ' + items[minIdx].value + ' = ' + diff
            ]
          };
        } else if (ask === 'sum') {
          finalStep = {
            id: 'final', tier: 0, type: 'number',
            prompt: '这 ' + n + ' 种一共多少个？',
            answer: total,
            distractors: dedupeDistractors(total, [
              { value: items.reduce(function (s, it) { return s + it.cells; }, 0), tag: 'READ_VALUE_WRONG' },
              { value: total - items[minIdx].value, tag: 'SUM_WRONG' }
            ]),
            hint: '每一项都要算进去，一项一项加，别漏。',
            teach: [
              items.map(function (it) { return it.label + ' ' + it.value; }).join('，'),
              '一共 ' + total + ' 个'
            ]
          };
        } else {
          var target = items[0];
          finalStep = {
            id: 'final', tier: 0, type: 'number',
            prompt: '「' + target.label + '」有多少个？',
            answer: target.value,
            distractors: dedupeDistractors(target.value, [
              { value: target.cells, tag: 'READ_VALUE_WRONG' },
              { value: target.value + unitPerCell, tag: 'READ_VALUE_WRONG' }
            ]),
            hint: '先看「' + target.label + '」的条形有几格，再乘每格代表的数量。',
            teach: [target.cells + ' 格 × ' + unitPerCell + ' = ' + target.value + '（个）']
          };
        }

        return {
          stem: '看图回答下面的问题（一共 ' + n + ' 种）。',
          figure: { type: 'bar', unitPerCell: unitPerCell, items: items },
          steps: [
            {
              id: 'scale', tier: 1, type: 'number',
              prompt: '纵轴上一格代表多少个？',
              answer: unitPerCell,
              distractors: dedupeDistractors(unitPerCell, [
                { value: unitPerCell * 10, tag: 'AXIS_SCALE_WRONG' },
                { value: unitPerCell === 1 ? 2 : 1, tag: 'AXIS_SCALE_WRONG' }
              ]),
              hint: '看纵轴上相邻两个刻度相差多少。这一格看错，后面全错。',
              teach: ['一格 = ' + unitPerCell + ' 个']
            },
            finalStep
          ],
          facts: { kind: 'bar-chart', ask: ask, unitPerCell: unitPerCell, expect: finalStep.answer }
        };
      }
    };
  }

  /* ============================ 第四单元 估算的应用题 ============================ */
  // 原来的估算题是"48 × 19 ≈ ?"，孩子会老老实实算出 912 再写上去 ——
  // 那不是估算，是精算。放到"买东西大约花多少"这种真实场景里，
  // 他就没法精算（也不需要），只能用凑整。
  function familyEstimateApply(spec) {
    return {
      id: spec.id, kp: spec.kp, difficulty: spec.difficulty,
      shape: spec.shape, method: spec.method,
      gen: function (rng) {
        var a = spec.a(rng);                       // 每箱的数量
        var b = spec.b(rng);                       // 箱数
        var aR = Math.round(a / 10) * 10;
        var bR = Math.round(b / 10) * 10;
        var estimate = aR * bR;
        var exact = a * b;

        return {
          stem: '学校买 ' + b + ' 箱粉笔，每箱 ' + a + ' 支，大约一共多少支？',
          steps: [
            {
              id: 'round', tier: 1, type: 'choice',
              prompt: '估算时这两个数分别看成多少？',
              answer: 1,
              options: shuffle(rng, [
                { value: 1, label: aR + ' 和 ' + bR, tag: null },
                { value: 2, label: a + ' 和 ' + bR, tag: 'HALF_ROUNDED' },
                { value: 3, label: aR + ' 和 ' + b, tag: 'HALF_ROUNDED' }
              ]),
              hint: '估算要**两个**数都凑成整十数，只凑一个结果会偏。',
              teach: [a + ' ≈ ' + aR + '，' + b + ' ≈ ' + bR]
            },
            {
              id: 'final', tier: 0, type: 'number',
              prompt: '大约一共多少支？',
              answer: estimate,
              distractors: dedupeDistractors(estimate, [
                { value: exact, tag: 'EXACT_NOT_ESTIMATE' },
                { value: a * bR, tag: 'HALF_ROUNDED' },
                { value: aR * b, tag: 'HALF_ROUNDED' }
              ]),
              hint: '用凑整后的两个整十数相乘。题目问"大约"，不用算精确值。',
              teach: [aR + ' × ' + bR + ' = ' + estimate + '（支）']
            }
          ],
          facts: { kind: 'estimate-apply', isEstimate: true, a: a, b: b, answer: estimate }
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
    },
    {
      // 探究题：第一次接触"三角尺拼角"时先做它（见 engine 的 intro 选題逻辑）
      family: familyTriangleExplore, id: 'T-0204-E', kp: 'M4A-02-04', difficulty: 0.40, intro: true,
      shape: '把一副三角尺能拼出的角一次找全', method: 'M-WHOLE-ANGLE'
    },

    // ==================================================================
    // 下面这批是补齐单元时加的。
    //
    // 同时它们也解决了另一件事：**同一个知识点有了不同难度的模板**。
    // 难度自适应（engine.js 的 difficultyShift）是靠"换模板"实现的，
    // 一个知识点只有两个模板、难度还挨着，升档降档就没东西可选 ——
    // 那一档自适应等于没做。所以扩容不是凑数，是自适应的前提。
    // ==================================================================

    // ---- 04-01 补足两个难度档（原来只有 2 个）----
    {
      family: familyBothZeros, id: 'T-0401-C', kp: 'M4A-04-01', difficulty: 0.34,
      shape: '整十 × 整百', method: 'M-COUNT-ZERO',
      aCore: function (rng) { return pickInt(rng, 2, 9); },
      bCore: function (rng) { return pickInt(rng, 2, 9); },
      aZeros: 1, bZeros: 2
    },
    {
      family: familyBothZeros, id: 'T-0401-D', kp: 'M4A-04-01', difficulty: 0.46,
      shape: '整百 × 整百', method: 'M-COUNT-ZERO',
      aCore: function (rng) { return pickInt(rng, 2, 9); },
      bCore: function (rng) { return pickInt(rng, 2, 9); },
      aZeros: 2, bZeros: 2
    },

    // ---- 04-03 因数中间有 0 的乘法（原来登记了没做）----
    {
      family: familyMiddleZero, id: 'T-0403-A', kp: 'M4A-04-03', difficulty: 0.56,
      shape: '三位数（中间是 0）× 两位数', method: 'M-SPLIT'
    },
    {
      family: familyMiddleZero, id: 'T-0403-B', kp: 'M4A-04-03', difficulty: 0.64,
      shape: '三位数（中间是 0）× 两位数（较大的乘数）', method: 'M-SPLIT'
    },

    // ---- 04-06 估算：补两个应用题形态（原来只有"直接估算"）----
    {
      family: familyEstimateApply, id: 'T-0406-C', kp: 'M4A-04-06', difficulty: 0.45,
      // 两个数都从 30 起：14 凑成 10 要丢掉近三成，两个数一起凑偏得更多，
      // 那估算值就失去"用来检验精算"的意义了。
      shape: '估算应用题（整十数凑整）', method: 'M-ESTIMATE',
      a: function (rng) { return pickEstimateNum(rng, 30, 90); },
      b: function (rng) { return pickEstimateNum(rng, 30, 49); }
    },
    {
      family: familyEstimateApply, id: 'T-0406-D', kp: 'M4A-04-06', difficulty: 0.58,
      shape: '估算应用题（三位数 × 两位数）', method: 'M-ESTIMATE',
      a: function (rng) { return pickEstimateNum(rng, 100, 480); },
      b: function (rng) { return pickEstimateNum(rng, 30, 49); }
    },

    // ---- 01-05 改写：补两个难度档 ----
    {
      family: familyRewrite, id: 'T-0105-C', kp: 'M4A-01-05', difficulty: 0.50,
      shape: '整万数改写成"万"（万位是三位数）', method: 'M-CHANGE-UNIT',
      unitName: '万', dropZeros: 4, kMin: 100, kMax: 999
    },
    {
      family: familyRewrite, id: 'T-0105-D', kp: 'M4A-01-05', difficulty: 0.58,
      shape: '整亿数改写成"亿"（亿位是三位数）', method: 'M-CHANGE-UNIT',
      unitName: '亿', dropZeros: 8, kMin: 100, kMax: 999
    },

    // ---- 01-06 近似数：补两个难度档 ----
    {
      family: familyRound, id: 'T-0106-C', kp: 'M4A-01-06', difficulty: 0.60,
      shape: '省略万位后面的尾数（万位是三位数）', method: 'M-LOOK-NEXT',
      unitName: '万', unitPow: 10000, lookName: '千位', nextName: '百位', wMin: 100, wMax: 999
    },
    {
      family: familyRound, id: 'T-0106-D', kp: 'M4A-01-06', difficulty: 0.68,
      shape: '省略亿位后面的尾数（亿位是三位数）', method: 'M-LOOK-NEXT',
      unitName: '亿', unitPow: 100000000, lookName: '千万位', nextName: '百万位', wMin: 100, wMax: 999
    },

    // ---- 02-02 / 02-03 / 02-04 各补足到 4 个 ----
    {
      family: familyAngleClassify, id: 'T-0202-D', kp: 'M4A-02-02', difficulty: 0.46,
      shape: '看图判断角的类型（偏难的一批角）', method: 'M-ANGLE-TYPE',
      figure: true,
      pickDeg: function (rng) {
        var pool = [1, 15, 88, 92, 135, 175];
        return pool[pickInt(rng, 0, pool.length - 1)];
      }
    },
    {
      family: familyAngleSplit, id: 'T-0203-C', kp: 'M4A-02-03', difficulty: 0.42,
      shape: '直角分成两个角', method: 'M-WHOLE-ANGLE',
      whole: 90, xMin: 10, xMax: 80
    },
    {
      family: familyAngleSplit, id: 'T-0203-D', kp: 'M4A-02-03', difficulty: 0.62,
      shape: '周角分成两个角（跨度更大）', method: 'M-WHOLE-ANGLE',
      whole: 360, xMin: 100, xMax: 300
    },
    {
      family: familyAngleRelation, id: 'T-0204-C', kp: 'M4A-02-04', difficulty: 0.50,
      shape: '周角 / 平角 / 直角的换算', method: 'M-WHOLE-ANGLE'
    },
    {
      family: familyTriangleMake, id: 'T-0204-D', kp: 'M4A-02-04', difficulty: 0.62,
      shape: '一副三角尺能拼出哪个角', method: 'M-WHOLE-ANGLE'
    },

    // ---- 03-01 第三单元 相交与平行 ----
    {
      family: familyPerpJudge, id: 'T-0301-A', kp: 'M4A-03-01', difficulty: 0.38,
      shape: '判断是否互相垂直', method: 'M-PERP'
    },
    {
      family: familyPerpJudge, id: 'T-0301-B', kp: 'M4A-03-01', difficulty: 0.44,
      shape: '判断是否互相垂直（易混的角）', method: 'M-PERP'
    },
    {
      family: familyParallelJudge, id: 'T-0301-C', kp: 'M4A-03-01', difficulty: 0.42,
      shape: '判断是否互相平行', method: 'M-PARALLEL'
    },
    {
      family: familyPerpDistance, id: 'T-0301-D', kp: 'M4A-03-01', difficulty: 0.55,
      shape: '点到直线的距离', method: 'M-PERP'
    },

    // ---- 05-01 第五单元 单价 × 数量 = 总价 ----
    {
      family: familyPriceQty, id: 'T-0501-A', kp: 'M4A-05-01', difficulty: 0.40,
      shape: '已知单价和数量求总价（口算）', method: 'M-QUANTITY',
      ask: 'total',
      price: function (rng) { return pickInt(rng, 2, 9); },
      qty: function (rng) { return pickInt(rng, 2, 9); }
    },
    {
      family: familyPriceQty, id: 'T-0501-B', kp: 'M4A-05-01', difficulty: 0.52,
      shape: '已知单价和数量求总价（笔算）', method: 'M-QUANTITY',
      ask: 'total',
      price: function (rng) { return pickCore(rng, 12, 48); },
      qty: function (rng) { return pickInt(rng, 3, 9); }
    },
    {
      family: familyPriceQty, id: 'T-0501-C', kp: 'M4A-05-01', difficulty: 0.50,
      shape: '已知总价和数量求单价', method: 'M-QUANTITY',
      ask: 'price',
      price: function (rng) { return pickInt(rng, 3, 9); },
      qty: function (rng) { return pickInt(rng, 4, 12); }
    },
    {
      family: familyPriceQty, id: 'T-0501-D', kp: 'M4A-05-01', difficulty: 0.55,
      shape: '已知总价和单价求数量', method: 'M-QUANTITY',
      ask: 'qty',
      price: function (rng) { return pickInt(rng, 4, 12); },
      qty: function (rng) { return pickInt(rng, 3, 9); }
    },

    // ---- 05-02 第五单元 速度 × 时间 = 路程 ----
    {
      family: familySpeedTime, id: 'T-0502-A', kp: 'M4A-05-02', difficulty: 0.45,
      shape: '已知速度和时间求路程', method: 'M-QUANTITY',
      ask: 'dist',
      speed: function (rng) { return pickInt(rng, 30, 90); },
      hours: function (rng) { return pickInt(rng, 2, 9); }
    },
    {
      family: familySpeedTime, id: 'T-0502-B', kp: 'M4A-05-02', difficulty: 0.52,
      shape: '已知路程和时间求速度', method: 'M-QUANTITY',
      ask: 'speed',
      speed: function (rng) { return pickInt(rng, 30, 90); },
      hours: function (rng) { return pickInt(rng, 2, 9); }
    },
    {
      family: familySpeedTime, id: 'T-0502-C', kp: 'M4A-05-02', difficulty: 0.55,
      shape: '已知路程和速度求时间', method: 'M-QUANTITY',
      ask: 'time',
      speed: function (rng) { return pickInt(rng, 30, 90); },
      hours: function (rng) { return pickInt(rng, 2, 9); }
    },
    {
      family: familySpeedTime, id: 'T-0502-D', kp: 'M4A-05-02', difficulty: 0.62,
      shape: '求路程（时间给的是分钟，要先换算）', method: 'M-QUANTITY',
      ask: 'dist', convert: true,
      speed: function (rng) { return pickInt(rng, 40, 90); },
      hours: function (rng) { return pickInt(rng, 2, 6); }
    },

    // ---- 06-01 第六单元 长方形面积 ----
    {
      family: familyRectArea, id: 'T-0601-A', kp: 'M4A-06-01', difficulty: 0.40,
      shape: '已知长和宽求面积（口算）', method: 'M-AREA-RECT',
      ask: 'area',
      long: function (rng) { return pickInt(rng, 3, 9); },
      wide: function (rng) { return pickInt(rng, 2, 9); }
    },
    {
      family: familyRectArea, id: 'T-0601-B', kp: 'M4A-06-01', difficulty: 0.52,
      shape: '已知长和宽求面积（笔算）', method: 'M-AREA-RECT',
      ask: 'area',
      long: function (rng) { return pickInt(rng, 12, 35); },
      wide: function (rng) { return pickCore(rng, 3, 9); }
    },
    {
      family: familyRectArea, id: 'T-0601-C', kp: 'M4A-06-01', difficulty: 0.58,
      shape: '已知面积和一条边求另一条边', method: 'M-AREA-RECT',
      ask: 'side',
      long: function (rng) { return pickInt(rng, 6, 18); },
      wide: function (rng) { return pickInt(rng, 3, 9); }
    },

    // ---- 06-02 第六单元 正方形面积 ----
    {
      family: familySquareArea, id: 'T-0602-A', kp: 'M4A-06-02', difficulty: 0.38,
      shape: '已知边长求正方形面积（口算）', method: 'M-AREA-RECT',
      side: function (rng) { return pickInt(rng, 2, 9); }
    },
    {
      family: familySquareArea, id: 'T-0602-B', kp: 'M4A-06-02', difficulty: 0.50,
      shape: '已知边长求正方形面积（笔算）', method: 'M-AREA-RECT',
      side: function (rng) { return pickInt(rng, 10, 25); }
    },

    // ---- 06-04 第六单元 面积单位换算 ----
    {
      family: familyAreaUnit, id: 'T-0604-A', kp: 'M4A-06-04', difficulty: 0.48,
      shape: '平方米 → 平方分米', method: 'M-UNIT-100',
      from: '平方米', to: '平方分米', rate: 100, reverse: false, kMin: 2, kMax: 9
    },
    {
      family: familyAreaUnit, id: 'T-0604-B', kp: 'M4A-06-04', difficulty: 0.52,
      shape: '平方分米 → 平方厘米', method: 'M-UNIT-100',
      from: '平方分米', to: '平方厘米', rate: 100, reverse: false, kMin: 2, kMax: 9
    },
    {
      family: familyAreaUnit, id: 'T-0604-C', kp: 'M4A-06-04', difficulty: 0.60,
      shape: '平方分米 → 平方米（反过来）', method: 'M-UNIT-100',
      from: '平方米', to: '平方分米', rate: 100, reverse: true, kMin: 2, kMax: 9
    },
    {
      family: familyAreaUnit, id: 'T-0604-D', kp: 'M4A-06-04', difficulty: 0.66,
      shape: '平方米 → 平方厘米（跨一级）', method: 'M-UNIT-100',
      from: '平方米', to: '平方厘米', rate: 10000, reverse: false, kMin: 2, kMax: 9
    },

    // ---- 07-01 第七单元 条形统计图 ----
    {
      family: familyBarChart, id: 'T-0701-A', kp: 'M4A-07-01', difficulty: 0.42,
      shape: '读条形图：某一项是多少', method: 'M-READ-CHART',
      ask: 'value', itemCount: 4, cellsMin: 1, cellsMax: 8,
      unitPerCell: function (rng) { return pickInt(rng, 1, 2); }
    },
    {
      family: familyBarChart, id: 'T-0701-B', kp: 'M4A-07-01', difficulty: 0.46,
      shape: '读条形图：哪一种最多', method: 'M-READ-CHART',
      ask: 'max', itemCount: 4, cellsMin: 1, cellsMax: 8,
      unitPerCell: function (rng) { return pickInt(rng, 2, 5); }
    },
    {
      family: familyBarChart, id: 'T-0701-C', kp: 'M4A-07-01', difficulty: 0.56,
      shape: '读条形图：最多的比最少的多多少', method: 'M-READ-CHART',
      ask: 'diff', itemCount: 5, cellsMin: 1, cellsMax: 9,
      unitPerCell: function (rng) { return pickInt(rng, 2, 5); }
    },
    {
      family: familyBarChart, id: 'T-0701-D', kp: 'M4A-07-01', difficulty: 0.62,
      shape: '读条形图：一共多少个', method: 'M-READ-CHART',
      ask: 'sum', itemCount: 4, cellsMin: 1, cellsMax: 8,
      unitPerCell: function (rng) { return pickInt(rng, 2, 5); }
    }
  ];

  var TEMPLATES = SPECS.map(function (s) {
    var t = s.family(s);
    // intro 是"这个知识点第一次露面先出这道探究题"的标记，由组卷层使用
    if (s.intro) t.intro = true;
    return t;
  });

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
