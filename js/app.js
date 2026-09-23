/*
 * 界面层（手机优先）
 *
 * 几个刻意的设计选择，都是针对"不愿自主思考"这一类孩子的：
 *  1. 没有倒计时 —— 倒计时制造压力，也会干扰"到底会不会"的判断
 *  2. 有「我要提示」，没有「跳过」—— 跳过是逃避，提示是前进
 *  3. 提示用了不扣分、不批评 —— 一旦有惩罚，孩子宁可乱猜也不点，机制就废了
 *  4. 阶梯是"可见"的 —— 能看到"一共 3 步，已完成 1 步"，比一次抛一道难题让人安心
 *  5. 每道题都显示「为什么给你出这道题」—— 把系统的判断摊开给他看
 *  6. 答对不放烟花、不给积分 —— 夸张奖励会挤占内在动机，撤掉后掉得更狠
 */
(function () {
  'use strict';

  var K = window.Knowledge, T = window.Templates, E = window.Engine, S = window.Store;

  var app = {
    state: null,
    view: 'home',
    session: null,
    cursor: 0,
    stepStates: [],
    activeStep: 0,
    input: '',
    // 画笔：strokes 存的是每一笔的点，重新渲染后照着再画一遍。
    // 不直接存画布图像，是因为 render() 会整块替换 innerHTML，画布元素会被丢掉。
    strokes: [],
    drawing: false,
    penOn: false,
    showRuler: false,
    hintLevel: 0,
    hintLevelSeen: 0,
    // 这一题里到底有没有用过提示。hintLevel 是按"步"归零的，
    // 不能拿它来判断"这题用过提示没有"，所以单独记一个。
    hintUsedInQuestion: false,
    storageWarn: '',      // 本地存不进去时的提示，不静默吞掉
    feedback: null,      // { tone: 'ok'|'warn'|'info'|'teach', text }
    questionStartAt: 0,
    results: [],
    summary: null
  };

  var el = function (id) { return document.getElementById(id); };

  // 保存必须看结果。隐私模式、空间满、被沙箱拦住时 localStorage.setItem 会抛，
  // 只 console.warn 的表现就是"练了半天，下次打开全没了"，家长查都查不出来。
  function saveState() {
    if (S.save(app.state)) { app.storageWarn = ''; return true; }
    app.storageWarn = '这台设备现在存不下练习记录（可能是无痕模式或空间已满）。' +
      '这一轮还能继续练，但关掉页面就不会保存，先告诉家长。';
    return false;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============================== 视图：首页 ============================== */
  function viewHome() {
    var state = app.state;
    var practiced = state.sessions.length;
    var unit = state.unit || 'all';

    // ---------- 练哪个单元 ----------
    // 按单元出题：一次只练一个单元，混在一起孩子容易乱，
    // 组卷也会把名额摊薄，哪个单元都练不深。
    var unitBtns = '<div class="unit-row">' +
      '<button class="unit-btn' + (unit === 'all' ? ' on' : '') + '" data-act="unit" data-u="all">全部</button>' +
      K.units().map(function (u) {
        return '<button class="unit-btn' + (unit === u ? ' on' : '') + '" data-act="unit" data-u="' + esc(u) + '">' +
          esc(K.shortUnit(u)) + '</button>';
      }).join('') +
      '</div>';

    // ---------- 方法，按单元分组 ----------
    // 方法挂在"题型"上，不是挂在"知识点"上，所以从模板反查它被用在哪些知识点、哪些单元。
    var methodUse = {};
    T.TEMPLATES.forEach(function (t) {
      if (!t.method || !K.METHODS[t.method]) return;
      if (!methodUse[t.method]) methodUse[t.method] = { m: K.METHODS[t.method], kps: {} };
      methodUse[t.method].kps[t.kp] = 1;
    });

    function methodRow(mid) {
      var u = methodUse[mid];
      var kpNames = Object.keys(u.kps).map(function (id) {
        return (K.byId(id) || {}).name || id;
      }).join('、');
      return '<div class="method-row">' +
        '<div class="method-name">「' + esc(u.m.name) + '」</div>' +
        '<div class="method-tip">' + esc(u.m.tip) + '</div>' +
        '<div class="method-steps">' + u.m.steps.map(function (s, i) {
          return '<span class="mstep">' + (i + 1) + '. ' + esc(s) + '</span>';
        }).join('') + '</div>' +
        '<div class="method-where">用在：' + esc(kpNames) + '</div>' +
        '</div>';
    }

    // 只显示所选单元的方法：点了哪个单元，就只讲那个单元用得到的。
    // 还没学到的单元先不拿出来 —— 摆在一起只会让孩子觉得要记一大堆。
    var targetUnits = unit === 'all' ? K.units() : [unit];
    var methodCards = targetUnits.map(function (u) {
      var mids = Object.keys(methodUse).filter(function (mid) {
        return Object.keys(methodUse[mid].kps).some(function (kid) {
          var k = K.byId(kid);
          return k && k.unit === u;
        });
      });
      if (!mids.length) return '';
      return '<div class="unit-block"><div class="unit-head">' + esc(K.shortUnit(u)) + '</div>' +
        mids.map(methodRow).join('') + '</div>';
    }).join('');

    var lastLine = practiced
      ? '你已经练过 ' + practiced + ' 次了'
      : '第一次来，先做 10 道热身题';

    var unitName = unit === 'all' ? '全部单元' : K.shortUnit(unit);

    // 到期的知识点要在首页说出来。
    // 引擎里排个序是看不见的 —— 孩子不会因为某个数字到期了就想去练，
    // 但"这几块今天该复习了"是一句他能懂的话。
    var dueList = E.dueKnowledge(state, unit);
    var dueCard = dueList.length
      ? '<div class="card card-due">' +
        '<h2 class="card-title">该复习了（' + dueList.length + '）</h2>' +
        '<p class="card-note">这几块按 1/2/4/7/15 天的节奏到期了。现在练一次，比过几天再捡起来省力得多。</p>' +
        '<ul class="tag-list">' + dueList.map(function (k) {
          return '<li><b>' + esc(k.name) + '</b></li>';
        }).join('') + '</ul>' +
        '</div>'
      : '';

    return '' +
      '<div class="hero">' +
      '<h1>数学小教练</h1>' +
      '<p class="hero-sub">西师大版 · 四年级上册</p>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">练哪个单元</h2>' +
      '<p class="card-note">一次练一个单元，比混在一起效果好。</p>' +
      unitBtns +
      '</div>' +

      dueCard +

      '<div class="card card-cta">' +
      '<div class="cta-line">练 10 题，大约 10 分钟</div>' +
      '<div class="cta-sub">' + esc(lastLine) + '。本次范围：' + esc(unitName) + '，前两道是热身。</div>' +
      '<button class="btn btn-primary btn-lg" data-act="start">开始练习</button>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">做题的方法</h2>' +
      '<p class="card-note">按单元分开列。做题的时候，注意看你用的是哪一个。</p>' +
      methodCards +
      '</div>' +

      '<div class="card card-quiet">' +
      '<h2 class="card-title">学习进度</h2>' +
      '<p class="card-note">看看哪块亮、哪块暗。</p>' +
      '<button class="btn btn-ghost btn-block" data-act="progress">查看掌握度地图</button>' +
      '<button class="btn btn-ghost btn-block" data-act="parent">家长报告（时间 · 效率 · 错点）</button>' +
      '</div>' +

      '<p class="footnote">数据只保存在这台设备上，不会上传。</p>';
  }

  /* ============================== 视图：进度地图 ============================== */
  function viewProgress() {
    var state = app.state;
    var kps = K.implemented();

    function kpRow(k) {
      var p = E.masteryOf(state, k.id);
      var st = E.statsOf(state, k.id);
      var untouched = st.attempts === 0;
      // 没练过的知识点不显示那个"初始 0.3 的虚影"—— 宁可显示空，也不要给假信息
      var pct = untouched ? 0 : Math.round(p * 100);
      var cls = p >= 0.8 ? 'lv-4' : p >= 0.6 ? 'lv-3' : p >= 0.4 ? 'lv-2' : 'lv-1';
      var method = K.METHODS[k.method];
      // 下次复习的时间要说出来。掌握度是一个抽象数字，
      // "还有 3 天要复习"才是孩子能理解、也愿意照着做的事。
      var dueTxt = '';
      if (!untouched && st.dueAt) {
        var left = Math.ceil((st.dueAt - Date.now()) / 86400000);
        dueTxt = left <= 0 ? '今天该复习' : (left === 1 ? '明天复习' : left + ' 天后复习');
      }
      return '' +
        '<div class="kp-row">' +
        '<div class="kp-head">' +
        '<span class="kp-name">' + esc(k.name) + '</span>' +
        '<span class="kp-label">' + (untouched ? '还没练过' : esc(E.masteryLabel(p))) + '</span>' +
        '</div>' +
        '<div class="bar">' + (untouched ? '' : '<i class="' + cls + '" style="width:' + pct + '%"></i>') + '</div>' +
        '<div class="kp-foot">' +
        '<span>' + (untouched ? '课本第 ' + k.bookPage + ' 页' : '练过 ' + st.attempts + ' 题，对 ' + st.corrects + ' 题') + '</span>' +
        (dueTxt ? '<span class="kp-due">' + esc(dueTxt) + '</span>' : '') +
        (method ? '<span class="kp-method">主要方法：' + esc(method.name) + '</span>' : '') +
        '</div>' +
        '</div>';
    }

    // 按单元分组，和首页的单元选择对得上 —— 孩子刚练完哪个单元，就来这一栏看
    var rows = K.units().map(function (u) {
      var rs = kps.filter(function (k) { return k.unit === u; }).map(kpRow).join('');
      return '<div class="unit-block"><div class="unit-head">' + esc(K.shortUnit(u)) + '</div>' + rs + '</div>';
    }).join('');

    // 错因汇总：这是"计算不仔细"的体检报告
    var tagCount = {};
    (state.history || []).forEach(function (h) {
      tagsOf(h).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1; });
    });
    var tagRows = Object.keys(tagCount).sort(function (a, b) { return tagCount[b] - tagCount[a]; })
      .map(function (t) {
        var info = T.ERROR_TAGS[t] || { label: t, advice: '' };
        return '<li><b>' + esc(info.label) + '</b>（' + tagCount[t] + ' 次）' +
          (info.advice ? '<span class="advice">' + esc(info.advice) + '</span>' : '') + '</li>';
      }).join('');

    var hintSessions = (state.history || []).filter(function (h) { return h.hintLevel > 0; }).length;
    var totalH = (state.history || []).length;

    return '' +
      '<div class="topbar">' +
      '<button class="btn-icon" data-act="home">←</button>' +
      '<span class="topbar-title">掌握度地图</span>' +
      '<span class="topbar-right"></span>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">各单元掌握度</h2>' +
      '<p class="card-note">越接近满格越熟练。</p>' +
      rows +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">错因体检</h2>' +
      (tagRows
        ? '<p class="card-note">这是你做错时的"病根"，不是分数。</p><ul class="tag-list">' + tagRows + '</ul>'
        : '<p class="card-note">还没有错题数据。做过几次练习之后，这里会告诉你错得最多的那一类是什么。</p>') +
      '</div>' +

      '<div class="card card-quiet">' +
      '<h2 class="card-title">关于提示</h2>' +
      '<p class="card-note">' +
      (totalH
        ? '目前为止你用了 ' + hintSessions + ' 次提示（共 ' + totalH + ' 题）。用提示不可耻，用得越来越少才是进步。'
        : '提示不扣分。用提示是好事，说明你想把题做对。') +
      '</p>' +
      '<button class="btn btn-ghost btn-block" data-act="reset">清空所有数据</button>' +
      '</div>';
  }

  /* ============================== 视图：练习 ============================== */
  function viewPractice() {
    var q = currentQuestion();
    if (!q) return '<div class="card">题目加载失败。</div>';

    // 方法跟着题型走，不是跟着知识点走
    var method = K.METHODS[q.method];
    var total = app.session.questions.length;

    var dots = app.session.questions.map(function (_, i) {
      var cls = i < app.cursor ? 'dot done' : (i === app.cursor ? 'dot now' : 'dot');
      return '<i class="' + cls + '"></i>';
    }).join('');

    var step = q.steps[app.activeStep];
    var questionDone = q.steps.every(function (_, i) { return app.stepStates[i].done; });

    // 左边这一栏只说明"这一步问的是什么"，输入控件统一挪到作答区，
    // 这样电脑上就是"左边看、右边做"，手机上自然叠成一列。
    var stepsHtml = q.steps.map(function (s, i) {
      var ss = app.stepStates[i];
      var cls = ss.done ? (ss.isCorrect ? 'done-ok' : 'done-bad')
        : (i === app.activeStep && !questionDone ? 'active' : 'locked');

      var body = '';
      if (ss.done) {
        body = '<div class="step-answer">你的答案：<b>' + esc(displayAnswer(s, ss.lastValue)) + '</b>' +
          (ss.isCorrect ? ' <span class="mark ok">✓</span>' : ' <span class="mark bad">✗</span>') + '</div>';
        if (!ss.isCorrect) {
          body += '<div class="step-correct">正确答案：<b>' + esc(displayAnswer(s, s.answer)) + '</b></div>';
        }
      } else if (cls === 'active') {
        body = '<div class="step-doing">' +
          '<span class="on-mobile">在下面作答 ↓</span>' +
          '<span class="on-desktop">在右边作答 →</span>' +
          '</div>';
      } else {
        body = '<div class="step-locked">待完成</div>';
      }

      return '<li class="step ' + cls + '">' +
        '<div class="step-head"><span class="step-no">' + (i + 1) + '</span>' +
        '<span class="step-prompt">' + esc(s.prompt) + '</span></div>' +
        body + '</li>';
    }).join('');

    var feedback = '';
    if (app.feedback) {
      feedback = '<div class="feedback ' + app.feedback.tone + '">' + esc(app.feedback.text) +
        (app.feedback.tone === 'teach' ? '<div class="teach-body">' + esc(app.feedback.detail || '') + '</div>' : '') +
        '</div>';
    }

    // ---------- 作答区 ----------
    var workzone;
    if (questionDone) {
      workzone = '<div class="wz-done">这道题做完了</div>';
    } else {
      var inputHtml;
      if (step.type === 'choice') {
        inputHtml = '<div class="options">' + step.options.map(function (o) {
          var on = String(app.choiceValue) === String(o.value);
          return '<button class="opt' + (on ? ' on' : '') + '" data-act="opt" data-v="' + esc(o.value) + '">' +
            esc(o.label) + '</button>';
        }).join('') + '</div>';
      } else {
        // 用真的 input，让手机直接弹系统输入法。
        //
        // 以前是自己画一排数字键，手机上要点半天，退格也不顺手。
        // type 用 text + inputmode="numeric"：iOS 和安卓都会给数字键盘，
        // 又不会像 type=number 那样冒出步进箭头、把空格和前导 0 吃掉。
        inputHtml = '<div class="answer-box">' +
          '<input id="answerInput" class="answer-input" type="text" inputmode="numeric" ' +
          'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
          'enterkeyhint="done" placeholder="点一下，用输入法直接填" ' +
          'value="' + esc(app.input) + '">' +
          '</div>';
      }
      workzone =
        '<div class="wz-label">第 ' + (app.activeStep + 1) + ' 步' +
        (q.steps.length > 1 ? ' · 共 ' + q.steps.length + ' 步' : '') + '</div>' +
        '<div class="wz-prompt">' + esc(step.prompt) + '</div>' +
        inputHtml +
        '<div class="wz-kbd-hint">' +
        (step.type === 'choice' ? '按数字键 1 / 2 / 3 选择，回车确认' : '用键盘直接输入，回车确认') +
        '</div>';
    }

    var actions = '';
    if (questionDone) {
      actions = '<button class="btn btn-primary btn-lg btn-block" data-act="next">' +
        (app.cursor + 1 >= total ? '看今天的结果' : '下一题') + '</button>';
    } else {
      actions = '<div class="action-row">' +
        '<button class="btn btn-soft" data-act="hint"' + (app.hintLevel >= 2 ? ' disabled' : '') + '>我要提示</button>' +
        '<button class="btn btn-primary" data-act="submit">确认</button>' +
        '</div>';
    }

    // 屏幕数字键盘整个去掉了：手机上用系统输入法比自己画的一排按钮快得多，
    // 电脑上本来就敲物理键盘。留两套输入方式只会互相打架。

    // ---------- 直接在题目上写写画画 ----------
    // 「四位一截」这类题，以前孩子得把数抄到纸上才敢数位数、画分级线。
    // 现在笔迹就画在题目上，数位也能一键摊开看。
    var bigN = bigNumberOf(q);
    var rulerPanel = (app.showRuler && bigN)
      ? '<div class="ruler-card">' + rulerHtml(bigN, q) + '</div>'
      : '';

    var toolsHtml = '<div class="q-tools">' +
      '<button class="btn btn-soft btn-sm" data-act="pen">' +
      (app.penOn ? '✎ 画笔：开' : '✎ 画一画') + '</button>' +
      (app.penOn ? '<button class="btn btn-soft btn-sm" data-act="pen-clear">清掉笔迹</button>' : '') +
      (bigN ? '<button class="btn btn-soft btn-sm" data-act="ruler">' +
        (app.showRuler ? '收起数位' : '看看数位') + '</button>' : '') +
      '</div>' +
      (app.penOn ? '<div class="pen-tip">手指直接在题目上画，画错了点「清掉笔迹」。</div>' : '');

    // 方法徽章 + 步骤，让"这个方法具体怎么做"在题目上就能看见，不用去别处找
    var methodBar = '';
    if (method) {
      methodBar = '<div class="method-bar">' +
        '<span class="badge-method">方法 · ' + esc(method.name) + '</span>' +
        method.steps.map(function (s, i) {
          return '<span class="mchip">' + (i + 1) + '. ' + esc(s) + '</span>';
        }).join('') +
        '</div>';
    }

    return '' +
      '<div class="topbar">' +
      '<button class="btn-icon" data-act="quit" title="退出练习">✕</button>' +
      '<div class="dots">' + dots + '</div>' +
      '<span class="topbar-right">' + (app.cursor + 1) + '/' + total + '</span>' +
      '</div>' +

      '<div class="practice-grid">' +

      '<div class="col-main">' +
      '<div class="why"><span class="why-k">为什么给你出这道题</span>' + esc(q.reason) + '</div>' +
      '<div class="card card-q">' +
      '<canvas id="qCanvas" class="q-canvas' + (app.penOn ? ' on' : '') + '"></canvas>' +
      methodBar +
      (q.stem ? '<div class="stem"><span class="stem-label">题目</span>' + esc(q.stem) + '</div>' : '') +
      (q.figure ? figureHtml(q.figure) : '') +
      '<ol class="steps">' + stepsHtml + '</ol>' +
      '</div>' +
      '</div>' +

      '<div class="col-side">' +
      '<div class="workzone">' + workzone + '</div>' +
      // 画笔和数位的开关必须放在作答区里：手机上作答区是钉在屏幕底部的，
      // 放在题目那一栏的话，它就正好被这条挡住 —— 看得见却点不到。
      toolsHtml +
      rulerPanel +
      feedback +
      actions +
      '</div>' +

      '</div>';
  }

  function displayAnswer(step, v) {
    if (v === null || v === undefined || v === '') return '（空）';
    if (step.type === 'choice') {
      var o = (step.options || []).filter(function (x) { return String(x.value) === String(v); })[0];
      return o ? o.label : String(v);
    }
    return String(v);
  }

  /* ============================== 数位标尺 ============================== */
  // 万以上数的题，孩子最卡的一步是"这到底是几位数、万级在哪"。
  // 以前只能把数抄到纸上数，这里直接把每一位和它的数位摊开，
  // 并且按"每 4 位一级"断开 —— 断在哪，就是「四位一截」的答案。
  var DIGIT_NAMES = ['个', '十', '百', '千', '万', '十万', '百万', '千万',
    '亿', '十亿', '百亿', '千亿'];

  function bigNumberOf(q) {
    var f = q && q.facts ? q.facts : null;
    if (!f) return null;
    if (f.kind === 'rewrite') return f.raw;
    if (f.kind === 'approx') return f.n;
    return null;
  }

  function rulerHtml(n, q) {
    var s = String(n);
    var f = q.facts || {};
    // 求近似数要标出"该看哪一位"：万位后面看千位，亿位后面看千万位
    var mark = f.kind === 'approx' ? (f.unitName === '亿' ? 7 : 3) : -1;

    var cells = '';
    for (var i = 0; i < s.length; i++) {
      var unitIdx = s.length - 1 - i;
      if (i > 0 && unitIdx % 4 === 0) cells += '<span class="rcut"></span>';
      cells += '<span class="rcell">' +
        '<b class="rdigit' + (unitIdx === mark ? ' rmark' : '') + '">' + s.charAt(i) + '</b>' +
        '<i class="rname">' + esc(DIGIT_NAMES[unitIdx] || '') + '</i>' +
        '</span>';
    }

    var tip = f.kind === 'approx'
      ? '橙色那一位说了算：0~4 舍去，5~9 进 1。'
      : '每 4 位是一级。竖线后面是「个级」，把个级这 4 位换成「' +
        esc(f.unitName || '') + '」字，前面剩下的就是答案。';

    return '<div class="ruler">' + cells + '</div>' +
      '<div class="ruler-tip">' + esc(tip) + '</div>';
  }

  /* ============================== 角的插图 ============================== */
  // 「看图判断是什么角」这类题必须有个图，纯文字说不清"张开得多大"。
  // 用 SVG 画，不引任何库 —— 加载快，离线也能用，缩放不糊。
  function angleFigureHtml(fig) {
    if (!fig || fig.type !== 'angle') return '';
    var deg = fig.deg;
    var W = 180, H = 124, ox = 26, oy = 104, R = 92;
    var rad = deg * Math.PI / 180;

    function pt(r) {
      return [(ox + r * Math.cos(rad)).toFixed(1), (oy - r * Math.sin(rad)).toFixed(1)];
    }
    var tip = pt(R), arcEnd = pt(30);
    var large = deg > 180 ? 1 : 0;

    return '<svg class="angle-fig" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="一个 ' + deg + ' 度的角">' +
      '<line class="af-side" x1="' + ox + '" y1="' + oy + '" x2="' + (ox + R) + '" y2="' + oy + '"/>' +
      '<line class="af-side" x1="' + ox + '" y1="' + oy + '" x2="' + tip[0] + '" y2="' + tip[1] + '"/>' +
      '<path class="af-arc" d="M' + (ox + 30) + ' ' + oy +
      ' A30 30 0 ' + large + ' 0 ' + arcEnd[0] + ' ' + arcEnd[1] + '"/>' +
      '<circle class="af-dot" cx="' + ox + '" cy="' + oy + '" r="3.5"/>' +
      '</svg>';
  }

  /* ============================== 条形统计图 ============================== */
  // 读图题没有图就没法做，所以图跟着题目数据一起生成（见 templates 的 familyBarChart）。
  //
  // 图上刻意只标 0 和最大值：孩子得自己数格子推出"一格代表多少" ——
  // 这正是这一类题要练的能力，把答案直接印在图上就练不到了。
  function barFigureHtml(fig) {
    if (!fig || fig.type !== 'bar') return '';
    var items = fig.items || [];
    if (!items.length) return '';

    var W = 280, H = 176;
    var padL = 34, padB = 28, padT = 10, padR = 6;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var maxCells = items.reduce(function (m, it) { return Math.max(m, it.cells); }, 1);
    var cellH = plotH / (maxCells + 1);
    var slot = plotW / items.length;
    var barW = Math.min(30, slot * 0.56);
    var baseY = padT + plotH;

    var out = ['<svg class="bar-fig" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="条形统计图">'];

    // 每一格画一条网格线：孩子要靠它数格子
    for (var c = 0; c <= maxCells; c++) {
      var gy = (baseY - c * cellH).toFixed(1);
      out.push('<line class="bf-grid" x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '"/>');
    }
    out.push('<text class="bf-tick" x="' + (padL - 6) + '" y="' + (baseY + 4) + '" text-anchor="end">0</text>');
    out.push('<text class="bf-tick" x="' + (padL - 6) + '" y="' + (baseY - maxCells * cellH + 4) +
      '" text-anchor="end">' + (maxCells * fig.unitPerCell) + '</text>');

    items.forEach(function (it, i) {
      var h = it.cells * cellH;
      var x = (padL + slot * i + (slot - barW) / 2).toFixed(1);
      var y = (baseY - h).toFixed(1);
      out.push('<rect class="bf-bar" x="' + x + '" y="' + y + '" width="' + barW.toFixed(1) +
        '" height="' + h.toFixed(1) + '" rx="2"/>');
      out.push('<text class="bf-label" x="' + (padL + slot * i + slot / 2).toFixed(1) +
        '" y="' + (H - padB + 18) + '" text-anchor="middle">' + esc(it.label) + '</text>');
    });

    out.push('<line class="bf-axis" x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + baseY + '"/>');
    out.push('<line class="bf-axis" x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '"/>');
    out.push('</svg>');
    return out.join('');
  }

  // 题目里可能有不同类型的插图，统一从这里分发
  function figureHtml(fig) {
    if (!fig) return '';
    if (fig.type === 'angle') return angleFigureHtml(fig);
    if (fig.type === 'bar') return barFigureHtml(fig);
    return '';
  }

  /* ============================== 画笔 ============================== */
  // 笔迹按"点"存，不按图像存：render() 每次都会换掉整块 innerHTML，
  // 画布元素跟着重建，只有存成数据才能重画出来。
  function posOf(cv, e) {
    var r = cv.getBoundingClientRect ? cv.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // 每根手指各占一笔。用单个 drawing 布尔值的话，手掌或另一根手指碰一下屏幕，
  // 两根手指的点会被并进同一笔里，画出来就是一条横穿的怪线 ——
  // 孩子越想画干净越乱（9 岁孩子写字时另一只手常按在屏幕上）。
  var liveStrokes = {};   // pointerId -> 该手指那一笔的点数组

  function redrawCanvas(ctx, cv) {
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
    app.strokes.forEach(function (st) {
      if (!st.length) return;
      ctx.beginPath();
      ctx.moveTo(st[0].x, st[0].y);
      for (var i = 1; i < st.length; i++) ctx.lineTo(st[i].x, st[i].y);
      // 只点了一下没拖动，也要留下一个点
      if (st.length === 1) ctx.lineTo(st[0].x + 0.5, st[0].y + 0.5);
      ctx.stroke();
    });
  }

  function endStroke(e) {
    if (e && e.pointerId != null) delete liveStrokes[e.pointerId];
  }

  // 每次 render() 之后都要重新绑定：画布是新的，尺寸也可能变了
  function attachCanvas() {
    var cv = el('qCanvas');
    if (!cv || typeof cv.getContext !== 'function') return;
    var host = cv.parentNode;
    if (!host) return;

    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) {
      // 布局还没定（刚插入、或在隐藏容器里）。这时候放手的话画笔整个是死的，
      // 孩子点了没反应又不知道为什么 —— 等一帧再量一次。
      // 只再试两次：容器一直是 0 宽说明这一屏根本没有画布，
      // 不限次数的话会变成每帧重挂一次 rAF，手机就是这么发起烫的。
      var tries = cv._mcTries || 0;
      if (tries < 2 && typeof requestAnimationFrame === 'function') {
        cv._mcTries = tries + 1;
        requestAnimationFrame(function () { if (app.view === 'practice') attachCanvas(); });
      }
      return;
    }

    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';

    var ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#e8590c';
    redrawCanvas(ctx, cv);

    // 事件只绑一次。resize 会再调一回 attachCanvas，那时候节点还是原来那个，
    // 再绑一遍就等于一次落笔画出两笔 —— 家长看到的是一堆重影，
    // 而且越是转屏越是频繁，恰恰是最需要看清楚孩子写了什么的时候。
    if (!cv._mcBound) {
      cv._mcBound = true;
      cv.addEventListener('pointerdown', function (e) {
        if (!app.penOn) return;
        if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
        var st = [posOf(cv, e)];
        liveStrokes[e.pointerId] = st;
        app.strokes.push(st);
        redrawCanvas(ctx, cv);
        e.preventDefault();
      });
      cv.addEventListener('pointermove', function (e) {
        if (!app.penOn) return;
        var st = liveStrokes[e.pointerId];
        if (!st) return;
        st.push(posOf(cv, e));
        redrawCanvas(ctx, cv);
        e.preventDefault();
      });
      cv.addEventListener('pointerup', endStroke);
      cv.addEventListener('pointercancel', endStroke);
      cv.addEventListener('pointerleave', endStroke);
    }
  }

  /* ============================== 视图：结果 ============================== */
  function viewResult() {
    var s = app.summary;
    if (!s) return '<div class="card">没有结果。</div>';

    var pct = Math.round(s.accuracy * 100);
    var headline = s.accuracy >= 0.9 ? '很稳'
      : s.accuracy >= 0.7 ? '基本都会了'
        : s.accuracy >= 0.5 ? '有一半还需要再练'
          : '这次有点吃力，很正常';

    var kpRows = s.byKp.map(function (k) {
      var pctM = Math.round(k.mastery * 100);
      var cls = k.mastery >= 0.8 ? 'lv-4' : k.mastery >= 0.6 ? 'lv-3' : k.mastery >= 0.4 ? 'lv-2' : 'lv-1';
      return '<div class="kp-row">' +
        '<div class="kp-head"><span class="kp-name">' + esc(k.name) + '</span>' +
        '<span class="kp-label">对 ' + k.correct + '/' + k.total + '</span></div>' +
        '<div class="bar"><i class="' + cls + '" style="width:' + pctM + '%"></i></div>' +
        '<div class="kp-foot"><span>掌握度：' + esc(E.masteryLabel(k.mastery)) + '</span></div>' +
        '</div>';
    }).join('');

    // 错因总结：只说"病根"，不说"你真粗心"
    var adviceList = s.byKp.filter(function (k) { return k.topError; }).map(function (k) {
      var info = T.ERROR_TAGS[k.topError] || {};
      return '<li><b>' + esc(info.label || k.topError) + '</b>' +
        (info.advice ? '<span class="advice">' + esc(info.advice) + '</span>' : '') + '</li>';
    }).join('');

    // 溯源：如果某个知识点薄弱，而且它的前置也不牢，就把前置指出来
    var trace = '';
    s.byKp.forEach(function (k) {
      var cands = E.traceCandidates(app.state, k.kpId);
      if (cands.length) {
        trace += '<li>「' + esc(k.name) + '」不太稳，而它的基础「' + esc(cands[0].kp.name) +
          '」也还没牢。下一步先回去把这个基础打实，上层自然就轻松了。</li>';
      }
    });

    return '' +
      '<div class="topbar">' +
      '<span class="topbar-right"></span>' +
      '<span class="topbar-title">今天的结果</span>' +
      '<span class="topbar-right"></span>' +
      '</div>' +

      '<div class="card card-result">' +
      '<div class="big-score">' + s.correct + '<span class="big-score-total">/' + s.total + '</span></div>' +
      '<div class="score-note">' + esc(headline) + '</div>' +
      '<div class="score-sub">' + (s.hintUsed
        ? '其中 ' + s.hintUsed + ' 道用了提示。用提示是好事，说明你在想办法。'
        : '这次一道都没用提示，很专注。') + '</div>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">掌握度变化</h2>' +
      kpRows +
      '</div>' +

      (adviceList || trace
        ? '<div class="card">' +
        '<h2 class="card-title">下一步该练什么</h2>' +
        (adviceList ? '<p class="card-note">每一条都对应一个具体的改法，一条一条改就行。</p><ul class="tag-list">' + adviceList + '</ul>' : '') +
        (trace ? '<ul class="tag-list">' + trace + '</ul>' : '') +
        '</div>'
        : '') +

      '<button class="btn btn-primary btn-lg btn-block" data-act="home">回到首页</button>';
  }

  // 一条作答记录里能读出的错因：最终那一步的，加上阶梯题辅助步骤的。
  // "看错数位"这类探针只有辅助步骤能测到，只统计最终步骤等于把它们扔掉。
  function tagsOf(h) {
    var out = [];
    if (h.errorTag && h.errorTag !== 'OTHER') out.push(h.errorTag);
    (h.stepTags || []).forEach(function (t) {
      if (t && t !== 'OTHER' && out.indexOf(t) === -1) out.push(t);
    });
    return out;
  }

  /* ============================== 会话流程 ============================== */
  function currentQuestion() {
    return app.session ? app.session.questions[app.cursor] : null;
  }

  function startSession() {
    var seed = E.randomSeed();
    var rng = E.mulberry32(seed);
    app.session = E.buildSession(app.state, rng, E.QUESTIONS_PER_SESSION, app.state.unit);
    app.session.seed = seed;
    app.cursor = 0;
    app.results = [];
    app.summary = null;
    prepareQuestion();
    app.view = 'practice';
    render();
  }

  function prepareQuestion() {
    var q = currentQuestion();
    app.stepStates = q.steps.map(function () {
      return { attempts: 0, done: false, isCorrect: false, lastValue: null, errorTag: null, firstErrorTag: null };
    });
    app.activeStep = 0;
    app.input = '';
    app.choiceValue = null;
    app.hintLevel = 0;
    // 提示档位是按步给的（换步要归零，否则后面的步骤点不到提示），
    // 但"这一题一共要到了第几级提示"必须按题记下来 ——
    // 以前直接把已被归零的 hintLevel 写进记录，第 2 级提示永远记成第 1 级。
    app.hintLevelSeen = 0;
    app.hintUsedInQuestion = false;
    app.strokes = [];          // 换题就把上一题的笔迹清掉
    app.showRuler = false;
    app.feedback = null;
    app.questionStartAt = Date.now();
  }

  function advanceStep() {
    var q = currentQuestion();
    for (var i = 0; i < q.steps.length; i++) {
      if (!app.stepStates[i].done) {
        if (app.activeStep !== i) {
          app.activeStep = i;
          // 提示是按"步"给的，不是按"题"给的。
          //
          // 这里改过一个真 bug：某一步错到第三遍时 hintLevel 会被顶到 2，
          // 而它以前只在换题时归零 —— 于是同题后面几步的「我要提示」
          // 一直是禁用的。孩子刚被迫看完了上一步的答案，
          // 转头面对下一步却再也要不到任何提示，正好在最需要支撑的时候被撤空。
          // 题型一变（把选择题排在填空题前面）就会踩到，不是偶发。
          app.hintLevel = 0;
        }
        return;
      }
    }
    app.activeStep = q.steps.length;
  }

  function submitAnswer() {
    var q = currentQuestion();
    var i = app.activeStep;
    var step = q.steps[i];
    if (!step) return;
    var ss = app.stepStates[i];
    if (ss.done) return;

    var value = step.type === 'choice' ? app.choiceValue : app.input;
    if (value === null || value === undefined || value === '') {
      app.feedback = { tone: 'info', text: '还没填答案，先写下你的答案。' };
      render();
      return;
    }

    var g = E.gradeStep(step, value);
    ss.attempts++;
    ss.lastValue = value;
    ss.errorTag = g.errorTag;
    // 第一次答错时的那个错因最有信息量。后面再改对时 errorTag 会被清成 null，
    // 探针就白放了 —— 所以单独留一份"这步第一次错在哪"。
    if (!g.isCorrect && g.errorTag && g.errorTag !== 'OTHER' && !ss.firstErrorTag) {
      ss.firstErrorTag = g.errorTag;
    }

    if (g.isCorrect) {
      ss.done = true;
      ss.isCorrect = true;
      app.feedback = { tone: 'ok', text: pickOkText(ss.attempts) };
      app.input = '';
      app.choiceValue = null;
      advanceStep();
    } else {
      ss.isCorrect = false;
      var isFinalStep = step.tier === 0;
      var isCalc = !(q.facts && q.facts.isEstimate);

      if (ss.attempts === 1) {
        var mag = isFinalStep && isCalc ? E.magnitudeCheck(step.answer, value) : 'ok';
        if (mag === 'digit' || mag === 'magnitude') {
          ss.magnitudeFailed = true;
          app.feedback = { tone: 'warn', text: E.magnitudeMessage(mag) };
        } else {
          app.feedback = { tone: 'warn', text: '差一点点，再看看。' };
        }
        app.input = '';
        app.choiceValue = null;
      } else if (ss.attempts === 2) {
        app.hintLevel = Math.max(app.hintLevel, 1);
        app.hintLevelSeen = Math.max(app.hintLevelSeen, 1);
        app.hintUsedInQuestion = true;
        app.feedback = { tone: 'info', text: '给你一点提示：' + E.hintFor(step, 1) };
        app.input = '';
        app.choiceValue = null;
      } else {
        ss.done = true;
        app.hintLevel = 2;
        app.hintLevelSeen = 2;
        app.hintUsedInQuestion = true;
        app.feedback = {
          tone: 'teach',
          text: '这道题的正确答案是 ' + displayAnswer(step, step.answer) + '。',
          detail: (step.teach || []).join('　')
        };
        app.input = '';
        app.choiceValue = null;
        advanceStep();
      }
    }
    render();
  }

  function pickOkText(attempts) {
    if (attempts === 1) return '对了。';
    return '这次对了 —— 你刚才改的地方就是关键。';
  }

  function useHint() {
    var q = currentQuestion();
    var step = q.steps[app.activeStep];
    if (!step) return;
    if (app.hintLevel >= 2) return;
    app.hintLevel++;
    app.hintLevelSeen = Math.max(app.hintLevelSeen, app.hintLevel);
    app.hintUsedInQuestion = true;
    app.feedback = { tone: 'info', text: '提示' + app.hintLevel + '：' + E.hintFor(step, app.hintLevel) };
    render();
  }

  function finishQuestion() {
    var q = currentQuestion();
    if (!q) return false;
    var finalIdx = -1;
    q.steps.forEach(function (s, i) { if (s.tier === 0) finalIdx = i; });
    if (finalIdx < 0) finalIdx = q.steps.length - 1;
    var fs = app.stepStates[finalIdx];
    var finalStep = q.steps[finalIdx];

    // 一题都没作答就别记账。以前退出练习会无条件走到这里，
    // 把"孩子中途不做了"记成"这道题答错了"：掌握度降一档、
    // wrongs+1、还进家长报告的错题列表。
    // 对容易中途退出的孩子，这条会把数据系统性写成偏悲观的样子，
    // 而弹窗里承诺的恰恰是"没做的不会算"。
    if (!E.countsAsAnswer({ attempts: fs.attempts })) return false;

    // 辅助步骤的错因探针也要落盘：像"看错数位"这种只在第一步探测得到的错因，
    // 光记最终那一步就永远进不了统计。
    var stepTags = [];
    q.steps.forEach(function (s, i) {
      if (s.tier === 0 || i === finalIdx) return;
      var t = app.stepStates[i].firstErrorTag;
      if (t) stepTags.push(t);
    });

    var rec = {
      ts: Date.now(),
      sessionId: app.session.id,
      kpId: q.kpId,
      templateId: q.templateId,
      shape: q.shape,
      qid: q.qid,
      difficulty: q.difficulty,
      scaffoldLevel: q.scaffoldLevel,
      stem: finalStep.prompt,
      isCorrect: !!fs.isCorrect,
      attempts: fs.attempts,
      errorTag: fs.isCorrect ? null : (fs.firstErrorTag || fs.errorTag),
      stepTags: stepTags,
      magnitudeFailed: !!fs.magnitudeFailed,
      hintLevel: app.hintUsedInQuestion ? Math.max(app.hintLevelSeen, 1) : 0,
      isCorrectAfterHint: !!fs.isCorrect && !!app.hintUsedInQuestion,
      inputType: finalStep.type,
      // 蒙对率和这一题的选项数有关，必须随记录一起存下来
      optionCount: finalStep.type === 'choice' ? (finalStep.options || []).length : null,
      timeSpentMs: Date.now() - app.questionStartAt
    };

    var out = E.applyResult(app.state, rec);
    app.state = out.state;
    saveState();
    app.results.push(rec);
    return true;
  }

  function nextQuestion() {
    finishQuestion();
    if (app.cursor + 1 >= app.session.questions.length) {
      endSession();
      return;
    }
    app.cursor++;
    prepareQuestion();
    render();
  }

  function endSession() {
    app.session.endedAt = Date.now();
    app.summary = E.summarize(app.state, app.session, app.results);
    app.state.sessions = app.state.sessions || [];
    app.state.sessions.push({
      id: app.session.id,
      startedAt: app.session.startedAt,
      endedAt: app.session.endedAt,
      total: app.results.length,
      correct: app.results.filter(function (r) { return r.isCorrect; }).length
    });
    saveState();
    app.view = 'result';
    render();
  }

  function quitSession() {
    if (!window.confirm('要退出这次练习吗？已经做过的题会记下来，没做的不会算。')) return;
    finishQuestion();
    // 一道都没做就别记这一次"练习"，否则家长报告里会出现"练了 0 题"的记录
    if (app.results.length) {
      app.state.sessions = app.state.sessions || [];
      app.state.sessions.push({
        id: app.session.id,
        startedAt: app.session.startedAt,
        endedAt: Date.now(),
        total: app.results.length,
        correct: app.results.filter(function (r) { return r.isCorrect; }).length,
        quit: true
      });
      saveState();
    }
    app.view = 'home';
    app.session = null;
    render();
  }

  /* ============================== 视图：家长报告 ============================== */
  // 给家长看的页，不给孩子看：练了多久、效率怎么样、错在哪。
  // 数据全部来自本机的历史记录，不上传任何地方。
  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtDur(ms) {
    if (!ms || ms <= 0) return '—';
    var min = Math.floor(ms / 60000);
    var sec = Math.round((ms % 60000) / 1000);
    return min >= 1 ? (min + ' 分 ' + sec + ' 秒') : (sec + ' 秒');
  }

  function viewParent() {
    var state = app.state;
    var hist = state.history || [];

    // 按场次聚合：一场总共用了多久、平均每题几秒
    var bySession = {};
    hist.forEach(function (h) {
      var k = bySession[h.sessionId] = bySession[h.sessionId] || { n: 0, ok: 0, ms: 0, hints: 0 };
      k.n++;
      if (h.isCorrect) k.ok++;
      k.ms += h.timeSpentMs || 0;
      if (h.hintLevel > 0) k.hints++;
    });

    var totalMs = 0;
    hist.forEach(function (h) { totalMs += h.timeSpentMs || 0; });
    var totalOk = hist.filter(function (h) { return h.isCorrect; }).length;

    // ---- 每一场 ----
    var sessionRows = (state.sessions || []).slice().reverse().slice(0, 30).map(function (s) {
      var agg = bySession[s.id] || { n: 0, ok: 0, ms: 0, hints: 0 };
      var pct = agg.n ? Math.round(agg.ok / agg.n * 100) : 0;
      // 效率就看"每题约多少秒"：明显变慢，多半是卡在某个知识点上磨蹭
      var perQ = agg.n ? Math.round(agg.ms / agg.n / 1000) : 0;
      return '<div class="kp-row">' +
        '<div class="kp-head"><span class="kp-name">' + esc(fmtTime(s.endedAt || s.startedAt)) + '</span>' +
        '<span class="kp-label">' + (s.quit ? '中途退出' : '完成') + '</span></div>' +
        '<div class="kp-foot">' +
        '<span>' + s.total + ' 题对 ' + s.correct + ' 题（' + pct + '%）</span>' +
        '<span>每题约 ' + perQ + ' 秒 · 用提示 ' + agg.hints + ' 次</span>' +
        '</div></div>';
    }).join('');

    // ---- 按知识点 ----
    var kpRows = K.implemented().map(function (k) {
      var st = E.statsOf(state, k.id);
      if (!st.attempts) return '';
      var pct = Math.round(st.corrects / st.attempts * 100);
      var tags = {};
      hist.forEach(function (h) {
        if (h.kpId !== k.id) return;
        tagsOf(h).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; });
      });
      var top = '', topN = 0;
      Object.keys(tags).forEach(function (t) { if (tags[t] > topN) { topN = tags[t]; top = t; } });
      var topInfo = top ? (T.ERROR_TAGS[top] || { label: top }) : null;
      return '<div class="kp-row">' +
        '<div class="kp-head"><span class="kp-name">' + esc(k.name) + '</span>' +
        '<span class="kp-label">' + pct + '%</span></div>' +
        '<div class="kp-foot">' +
        '<span>练过 ' + st.attempts + ' 题，对 ' + st.corrects + ' 题</span>' +
        '<span>' + (topInfo
          ? '最常错：' + esc(topInfo.label) + (topN > 1 ? '（' + topN + ' 次）' : '')
          : '还没错过') + '</span>' +
        '</div></div>';
    }).join('');

    // ---- 最近错题 ----
    var wrongRows = hist.filter(function (h) { return !h.isCorrect; }).slice(-15).reverse()
      .map(function (h) {
        var ts = tagsOf(h).map(function (t) {
          return (T.ERROR_TAGS[t] || { label: '再算一遍试试' }).label;
        });
        return '<div class="kp-row">' +
          '<div class="kp-head"><span class="kp-name">' + esc(h.stem || '（无题干）') + '</span>' +
          '<span class="kp-label">' + esc(fmtTime(h.ts)) + '</span></div>' +
          '<div class="kp-foot"><span>错因：' + esc(ts.join('、') || '再算一遍试试') + '</span>' +
          '<span>' + (h.hintLevel > 0 ? '用了提示' : '没用提示') + '</span></div>' +
          '</div>';
      }).join('');

    return '' +
      '<div class="topbar">' +
      '<button class="btn-icon" data-act="home">←</button>' +
      '<span class="topbar-title">家长报告</span>' +
      '<span class="topbar-right"></span>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">总览</h2>' +
      (hist.length
        ? '<p class="card-note">练了 ' + (state.sessions || []).length + ' 次 · 共 ' + hist.length +
          ' 题 · 答对 ' + totalOk + ' 题（' + Math.round(totalOk / hist.length * 100) + '%） · 做题用时 ' +
          esc(fmtDur(totalMs)) + '</p>'
        : '<p class="card-note">还没有练习记录。孩子做完一场，这里就能看到时间和正确率。</p>') +
      '<button class="btn btn-ghost btn-block" data-act="export-csv">导出全部记录（CSV，可用 Excel 打开）</button>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">每次练习</h2>' +
      '<p class="card-note">看「每题约多少秒」判断效率：明显变慢多半是卡住了。</p>' +
      (sessionRows || '<p class="card-note">还没有记录。</p>') +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">错误点都在哪</h2>' +
      (kpRows || '<p class="card-note">还没有数据。</p>') +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">最近的错题</h2>' +
      (wrongRows || '<p class="card-note">还没有错题，很好。</p>') +
      '</div>';
  }

  function exportCsv() {
    var rows = [['时间', '知识点', '题干', '对错', '错因', '阶梯步错因', '用时（秒）', '提示到第几级']];
    (app.state.history || []).forEach(function (h) {
      var label = function (t) { return (T.ERROR_TAGS[t] || {}).label || t; };
      rows.push([
        fmtTime(h.ts),
        (K.byId(h.kpId) || {}).name || h.kpId,
        h.stem || '',
        h.isCorrect ? '对' : '错',
        h.errorTag ? label(h.errorTag) : '',
        (h.stepTags || []).map(label).join('、'),
        Math.round((h.timeSpentMs || 0) / 1000),
        h.hintLevel > 0 ? '第 ' + h.hintLevel + ' 级' : ''
      ]);
    });
    // \uFEFF 让 Excel 认出这是 UTF-8，否则中文全是乱码
    var csv = '\uFEFF' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');

    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '数学小教练-练习记录.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert('导出失败：' + (e && e.message ? e.message : e));
    }
  }

  /* ============================== 渲染与事件 ============================== */
  function render() {
    var root = el('app');
    var html = app.view === 'home' ? viewHome()
      : app.view === 'practice' ? viewPractice()
        : app.view === 'result' ? viewResult()
          : app.view === 'parent' ? viewParent()
            : viewProgress();

    var warn = app.storageWarn
      ? '<div class="card card-warn">' + esc(app.storageWarn) + '</div>'
      : '';
    root.innerHTML = '<div class="view view-' + app.view + '">' + warn + html + '</div>';
    // 画布是新造出来的，尺寸要重算、笔迹要照着再画一遍
    if (app.view === 'practice') attachCanvas();

    // 只在"换了一道题 / 换了一个页面"时才回到顶部。
    //
    // 以前每次渲染都 scrollTo(0, 0)：提交之后页面会突然弹回题目最上面，
    // 手机上还得重新往下滑才够得着「确认」，滑来滑去就是这么来的。
    var key = app.view + '#' + (app.session ? app.cursor : '-');
    if (key !== lastScrollKey) {
      lastScrollKey = key;
      window.scrollTo(0, 0);
    }
  }

  var lastScrollKey = '';

  // 在输入框里打字：只更新状态，不重新渲染。
  // 一渲染整块 innerHTML 就被换掉，输入框失去焦点、光标跳走，
  // 手机上的输入法也会被收起来 —— 那还不如回到自己画的那排数字键。
  function onInput(e) {
    var t = e.target;
    if (!t || t.id !== 'answerInput') return;
    app.input = t.value;
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    var act = t.getAttribute('data-act');

    // 点完按钮把焦点交还给页面。否则焦点会停在刚才那个按钮上，
    // 之后按回车浏览器会把这下回车变成"再点一次这个按钮" ——
    // 比如点了数字键 5，再按回车会又输入一个 5。
    if (typeof t.blur === 'function') t.blur();

    if (act === 'start') return startSession();
    if (act === 'home') { app.session = null; app.view = 'home'; return render(); }
    if (act === 'progress') { app.view = 'progress'; return render(); }
    if (act === 'parent') { app.view = 'parent'; return render(); }
    if (act === 'unit') {
      app.state.unit = t.getAttribute('data-u') || 'all';
      saveState();
      return render();
    }
    if (act === 'export-csv') return exportCsv();
    if (act === 'quit') return quitSession();
    if (act === 'pen') {
      // 开关只切"能不能画"，不清笔迹：孩子只是想点一下提示再回来接着画，
      // 笔迹不该丢。（要清空有专门的「清掉笔迹」。）
      app.penOn = !app.penOn;
      return render();
    }
    if (act === 'pen-clear') { app.strokes = []; return render(); }
    if (act === 'ruler') { app.showRuler = !app.showRuler; return render(); }
    if (act === 'opt') {
      app.choiceValue = t.getAttribute('data-v');
      if (/^-?\d+(\.\d+)?$/.test(app.choiceValue)) app.choiceValue = Number(app.choiceValue);
      return render();
    }
    if (act === 'submit') return submitAnswer();
    if (act === 'hint') return useHint();
    if (act === 'next') return nextQuestion();
    if (act === 'reset') {
      if (window.confirm('确定清空所有练习记录吗？这个操作不能撤销。')) {
        app.state = S.reset();
        app.view = 'home';
        render();
      }
      return;
    }
  }

  /* ============================== 电脑键盘 ============================== */
  // 网页版的主要输入方式：数字直接打、回车确认、退格删除、选择题按数字选。
  // 屏幕上的数字键盘保留，鼠标和键盘两条路都通。
  function onKeyDown(e) {
    if (app.view !== 'practice' || !app.session) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 输入法还在拼字（选词没敲定）时不要把这下按键当成答案处理：
    // 中文输入法里回车常常是用来"上屏"的，抢下来会吞掉正在拼的内容，
    // 还会拿旧的 app.input 去提交。
    if (e.isComposing || e.keyCode === 229) return;

    var q = currentQuestion();
    if (!q) return;
    var questionDone = q.steps.every(function (_, i) { return app.stepStates[i].done; });

    if (e.key === 'Enter') {
      // 焦点还停在某个按钮上时，浏览器会把这下回车变成对它的点击，这里就别重复处理
      var ae = document.activeElement;
      if (ae && ae.tagName === 'BUTTON') return;
      e.preventDefault();
      if (questionDone) nextQuestion(); else submitAnswer();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      quitSession();
      return;
    }

    if (questionDone) return;
    var step = q.steps[app.activeStep];
    if (!step) return;

    if (step.type === 'choice') {
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= step.options.length) {
        e.preventDefault();
        app.choiceValue = step.options[n - 1].value;
        render();
      }
      return;
    }

    // 焦点在输入框里时，数字和退格交给系统输入法处理。
    // 这里再拦一道就会变成"打一个字进去两个"。
    var inInput = !!e.target && String(e.target.tagName || '') === 'INPUT';

    if (/^[0-9.]$/.test(e.key)) {
      if (inInput) return;
      e.preventDefault();
      app.input += e.key;
      render();
      return;
    }
    if (e.key === 'Backspace') {
      if (inInput) return;
      e.preventDefault();
      app.input = app.input.slice(0, -1);
      render();
    }
  }

  function init() {
    app.state = S.load();
    // 读不出来 = 上次的数据没了。这必须说出来：静默回到空白状态，
    // 家长只会以为孩子自己清掉了。
    if (S.loadFailed && S.loadFailed()) {
      app.storageWarn = '上一次的练习记录读不出来，已经从空白开始。' +
        '如果不是自己清的，请告诉家长，可能需要重装或换浏览器。';
    }
    el('app').addEventListener('click', onClick);
    el('app').addEventListener('input', onInput);
    document.addEventListener('keydown', onKeyDown);

    // 转屏、软键盘收起都会改变画布大小。画布的位图尺寸是在渲染时定的，
    // 之后只靠 CSS 拉伸的话，笔迹会和题目错位 —— 得重新量一次再重画。
    // 不看 penOn：笔已经画在上面的那些字，转个身就歪了的话，
    // 孩子关掉画笔去看一眼提示，回来发现画的东西对不上位置了。
    var refit = function () {
      if (app.view === 'practice') attachCanvas();
    };
    window.addEventListener('resize', refit);
    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
      window.visualViewport.addEventListener('resize', refit);
    }

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
