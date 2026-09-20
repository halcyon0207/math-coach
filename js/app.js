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
    hintLevel: 0,
    // 这一题里到底有没有用过提示。hintLevel 是按"步"归零的，
    // 不能拿它来判断"这题用过提示没有"，所以单独记一个。
    hintUsedInQuestion: false,
    feedback: null,      // { tone: 'ok'|'warn'|'info'|'teach', text }
    questionStartAt: 0,
    results: [],
    summary: null
  };

  var el = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============================== 视图：首页 ============================== */
  function viewHome() {
    var state = app.state;
    var practiced = state.sessions.length;

    // 方法按"题型"归类，不是按知识点归类，所以这里从模板反查；
    // 顺便列出它出现在哪些知识点上 —— 「同一个方法能用在不同地方」这件事本身就值得让孩子看见。
    var methodUse = {};
    T.TEMPLATES.forEach(function (t) {
      if (!t.method || !K.METHODS[t.method]) return;
      if (!methodUse[t.method]) methodUse[t.method] = { m: K.METHODS[t.method], kps: {} };
      methodUse[t.method].kps[t.kp] = 1;
    });

    var methodCards = Object.keys(methodUse).map(function (mid) {
      var u = methodUse[mid];
      var kpNames = Object.keys(u.kps).map(function (id) {
        return (K.byId(id) || {}).name || id;
      }).join('、');
      return '' +
        '<div class="method-row">' +
        '<div class="method-name">「' + esc(u.m.name) + '」</div>' +
        '<div class="method-tip">' + esc(u.m.tip) + '</div>' +
        '<div class="method-steps">' + u.m.steps.map(function (s, i) {
          return '<span class="mstep">' + (i + 1) + '. ' + esc(s) + '</span>';
        }).join('') + '</div>' +
        '<div class="method-where">用在：' + esc(kpNames) + '</div>' +
        '</div>';
    }).join('');

    var lastLine = practiced
      ? '你已经练过 ' + practiced + ' 次了'
      : '第一次来，先做 10 道热身题';

    return '' +
      '<div class="hero">' +
      '<h1>数学小教练</h1>' +
      '<p class="hero-sub">西师大版 · 四年级上册 · 第四单元</p>' +
      '</div>' +

      '<div class="card card-cta">' +
      '<div class="cta-line">今天练 10 题，大约 10 分钟</div>' +
      '<div class="cta-sub">' + esc(lastLine) + '。前三道是热身，帮你先进入状态。</div>' +
      '<button class="btn btn-primary btn-lg" data-act="start">开始练习</button>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">你会用到的三个方法</h2>' +
      '<p class="card-note">做题的时候，注意看你用的是哪一个。</p>' +
      methodCards +
      '</div>' +

      '<div class="card card-quiet">' +
      '<h2 class="card-title">学习进度</h2>' +
      '<p class="card-note">看看哪块亮、哪块暗。</p>' +
      '<button class="btn btn-ghost btn-block" data-act="progress">查看掌握度地图</button>' +
      '</div>' +

      '<p class="footnote">数据只保存在这台设备上，不会上传。</p>';
  }

  /* ============================== 视图：进度地图 ============================== */
  function viewProgress() {
    var state = app.state;
    var kps = K.implemented();

    var rows = kps.map(function (k) {
      var p = E.masteryOf(state, k.id);
      var st = E.statsOf(state, k.id);
      var untouched = st.attempts === 0;
      // 没练过的知识点不显示那个"初始 0.3 的虚影"—— 宁可显示空，也不要给假信息
      var pct = untouched ? 0 : Math.round(p * 100);
      var cls = p >= 0.8 ? 'lv-4' : p >= 0.6 ? 'lv-3' : p >= 0.4 ? 'lv-2' : 'lv-1';
      var method = K.METHODS[k.method];
      return '' +
        '<div class="kp-row">' +
        '<div class="kp-head">' +
        '<span class="kp-name">' + esc(k.name) + '</span>' +
        '<span class="kp-label">' + (untouched ? '还没练过' : esc(E.masteryLabel(p))) + '</span>' +
        '</div>' +
        '<div class="bar">' + (untouched ? '' : '<i class="' + cls + '" style="width:' + pct + '%"></i>') + '</div>' +
        '<div class="kp-foot">' +
        '<span>' + (untouched ? '课本第 ' + k.bookPage + ' 页' : '练过 ' + st.attempts + ' 题，对 ' + st.corrects + ' 题') + '</span>' +
        (method ? '<span class="kp-method">主要方法：' + esc(method.name) + '</span>' : '') +
        '</div>' +
        '</div>';
    }).join('');

    // 错因汇总：这是"计算不仔细"的体检报告
    var tagCount = {};
    (state.history || []).forEach(function (h) {
      if (h.errorTag && h.errorTag !== 'OTHER') tagCount[h.errorTag] = (tagCount[h.errorTag] || 0) + 1;
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
      '<h2 class="card-title">三个知识点</h2>' +
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
        inputHtml = '<div class="answer-box">' +
          (app.input === '' ? '<span class="ph">填答案</span>' : esc(app.input)) +
          '<span class="caret"></span></div>';
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

    var keypad = '';
    if (!questionDone && step && step.type !== 'choice') {
      keypad = '' +
        '<div class="keypad">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) {
          return '<button class="key" data-act="key" data-k="' + n + '">' + n + '</button>';
        }).join('') +
        '<button class="key" data-act="key" data-k=".">.</button>' +
        '<button class="key" data-act="key" data-k="0">0</button>' +
        '<button class="key key-del" data-act="del">⌫</button>' +
        '</div>';
    }

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
      methodBar +
      (q.stem ? '<div class="stem">' + esc(q.stem) + '</div>' : '') +
      '<ol class="steps">' + stepsHtml + '</ol>' +
      '</div>' +
      '</div>' +

      '<div class="col-side">' +
      '<div class="workzone">' + workzone + '</div>' +
      feedback +
      actions +
      keypad +
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

  /* ============================== 会话流程 ============================== */
  function currentQuestion() {
    return app.session ? app.session.questions[app.cursor] : null;
  }

  function startSession() {
    var seed = E.randomSeed();
    var rng = E.mulberry32(seed);
    app.session = E.buildSession(app.state, rng, E.QUESTIONS_PER_SESSION);
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
      return { attempts: 0, done: false, isCorrect: false, lastValue: null, errorTag: null };
    });
    app.activeStep = 0;
    app.input = '';
    app.choiceValue = null;
    app.hintLevel = 0;
    app.hintUsedInQuestion = false;
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
        app.hintUsedInQuestion = true;
        app.feedback = { tone: 'info', text: '给你一点提示：' + E.hintFor(step, 1) };
        app.input = '';
        app.choiceValue = null;
      } else {
        ss.done = true;
        app.hintLevel = 2;
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
    app.hintUsedInQuestion = true;
    app.feedback = { tone: 'info', text: '提示' + app.hintLevel + '：' + E.hintFor(step, app.hintLevel) };
    render();
  }

  function finishQuestion() {
    var q = currentQuestion();
    var finalIdx = -1;
    q.steps.forEach(function (s, i) { if (s.tier === 0) finalIdx = i; });
    if (finalIdx < 0) finalIdx = q.steps.length - 1;
    var fs = app.stepStates[finalIdx];
    var finalStep = q.steps[finalIdx];

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
      errorTag: fs.isCorrect ? null : fs.errorTag,
      magnitudeFailed: !!fs.magnitudeFailed,
      hintLevel: app.hintUsedInQuestion ? Math.max(app.hintLevel, 1) : 0,
      isCorrectAfterHint: !!fs.isCorrect && !!app.hintUsedInQuestion,
      inputType: finalStep.type,
      timeSpentMs: Date.now() - app.questionStartAt
    };

    var out = E.applyResult(app.state, rec);
    app.state = out.state;
    S.save(app.state);
    app.results.push(rec);
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
    S.save(app.state);
    app.view = 'result';
    render();
  }

  function quitSession() {
    if (!window.confirm('要退出这次练习吗？已经做过的题会记下来，没做的不会算。')) return;
    finishQuestion();
    app.state.sessions = app.state.sessions || [];
    app.state.sessions.push({
      id: app.session.id,
      startedAt: app.session.startedAt,
      endedAt: Date.now(),
      total: app.results.length,
      correct: app.results.filter(function (r) { return r.isCorrect; }).length,
      quit: true
    });
    S.save(app.state);
    app.view = 'home';
    app.session = null;
    render();
  }

  /* ============================== 渲染与事件 ============================== */
  function render() {
    var root = el('app');
    var html = app.view === 'home' ? viewHome()
      : app.view === 'practice' ? viewPractice()
        : app.view === 'result' ? viewResult()
          : viewProgress();

    root.innerHTML = '<div class="view view-' + app.view + '">' + html + '</div>';
    window.scrollTo(0, 0);
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
    if (act === 'quit') return quitSession();
    if (act === 'key') { app.input += t.getAttribute('data-k'); return render(); }
    if (act === 'del') { app.input = app.input.slice(0, -1); return render(); }
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

    if (/^[0-9.]$/.test(e.key)) {
      e.preventDefault();
      app.input += e.key;
      render();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      app.input = app.input.slice(0, -1);
      render();
    }
  }

  function init() {
    app.state = S.load();
    el('app').addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
