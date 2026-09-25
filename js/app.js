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
  // 跨设备同步。没引 cloud.js 时这里是 null，同步调用全部跳过，项目照常跑。
  var F = (typeof window !== 'undefined' && window.FamilySync) ? window.FamilySync : null;

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
    summary: null,
    // 家长报告的口令门。parentUnlocked 只在停留在报告页时为真 ——
    // 一离开就归零，下次进来重新输，孩子连点几下也摸不到里面的错题和"清空数据"。
    parentUnlocked: false,
    passInput: '',       // 口令输入框当前内容（render 会换掉 DOM，得存这儿回填）
    passMsg: '',         // 设口令/输口令时的提示
    // 跨设备同步：别的设备上传的统计快照（只在内存里）
    cloudReports: [],
    cloudMsg: '',
    famInput: '',
    // 「提交给家长」的结果提示（成功 / 没开同步 / 没传上去）
    submitMsg: '',
    // 报告里"看哪一段时间"（今天 / 最近 7 天 / 最近 30 天 / 全部）。
    // 家长的用法是"看看这几天练了什么"，所以默认最近 7 天。
    range: '7',
    // 从首页点「跨设备同步」进来时先过口令；过了之后直接去同步页，
    // 不用家长自己再找一遍。见 onClick 的 'sync' 和 viewSync()。
    afterUnlock: ''
  };

  var el = function (id) { return document.getElementById(id); };

  /* ------------------------------ 日期 ------------------------------ */
  // 只到"天"：家长要知道的是"这块知识哪天练的"，精确到分秒没有意义。
  function fmtDay(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var n = new Date();
    function same(x, y) {
      return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
    }
    if (same(d, n)) return '今天';
    var y1 = new Date(n.getTime() - 24 * 60 * 60 * 1000);
    if (same(d, y1)) return '昨天';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // 按钮角标用短格式，免得把一行按钮撑开
  function fmtDayShort(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function lastAtOfKp(id) {
    var st = E.statsOf(app.state, id);
    return (st && st.lastPracticedAt) || 0;
  }

  /* ------------------------------ 报告看哪一段时间 ------------------------------ */
  // 家长问的是"这几天他练得怎么样"，不是"有史以来"。按**日历天**切，不按 24 小时 ——
  // 晚上九点做的那题，第二天早上看"今天"就该不在了。
  var DAY_MS = 24 * 60 * 60 * 1000;
  var RANGES = [
    { k: 'today', name: '今天' },
    { k: '7', name: '最近 7 天' },
    { k: '30', name: '最近 30 天' },
    { k: 'all', name: '全部' }
  ];

  function dayStart(t) {
    var d = new Date(t);
    if (typeof d.setHours === 'function') d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function rangeStart(k) {
    var base = dayStart(Date.now());
    if (k === 'today') return base;
    if (k === '7') return base - 6 * DAY_MS;    // 含今天，一共 7 天
    if (k === '30') return base - 29 * DAY_MS;
    return 0;                                   // 全部
  }

  function rangeName(k) {
    for (var i = 0; i < RANGES.length; i++) if (RANGES[i].k === k) return RANGES[i].name;
    return '全部';
  }

  function inRange(ts, since) { return (ts || 0) >= since; }

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

  /* ====================== 没做完的那一场（断点续练） ====================== */
  // 一场 10 题，做到第 6 题被叫走是常态。以前下次进来重新组一套题，
  // 前面的白做、后面的也接不上。
  //
  // 所以把这一场"原样"存在本机：题目本身 + 做到第几题 + 每一步的对错 + 笔迹。
  // 存题目而不是只存种子，是因为组卷会看"哪些知识点到期了、最近做过什么" ——
  // 隔一天拿同一个种子重算，出来的可能就是另一套题，状态会对错格子。
  function saveDraft() {
    if (!app.session || !Array.isArray(app.session.questions) || !app.session.questions.length) return;
    app.state.draft = {
      ts: Date.now(),
      seed: app.session.seed,
      id: app.session.id,
      startedAt: app.session.startedAt,
      unit: app.state.unit,
      cursor: app.cursor,
      stepStates: app.stepStates,
      results: app.results,
      input: app.input,
      choiceValue: app.choiceValue,
      hintLevel: app.hintLevel,
      hintLevelSeen: app.hintLevelSeen,
      hintUsedInQuestion: app.hintUsedInQuestion,
      strokes: app.strokes,
      penOn: app.penOn,
      questionStartAt: app.questionStartAt,
      questions: app.session.questions
    };
    // 题目里可能带插图之类的数据，极端情况下会比较大。太大就不存草稿 ——
    // 宁可下次重新组一套题，也不能把本机存储顶爆（顶爆之后连练习记录都存不进去）。
    var text = '';
    try { text = JSON.stringify(app.state.draft); } catch (e) { text = ''; }
    if (!text || text.length > 200 * 1024) {
      app.state.draft = null;
      return;
    }
    saveState();
  }

  function clearDraft() {
    if (!app.state.draft) return;
    app.state.draft = null;
    saveState();
  }

  // 一道题的空状态。数学的 stepStates 是"当前这道题各步"的状态
  //（不是每题一个），所以条数要跟着题目里那一步一步来。
  function emptyStepStates(stepCount) {
    var out = [];
    for (var i = 0; i < stepCount; i++) {
      out.push({ attempts: 0, done: false, isCorrect: false, lastValue: null, errorTag: null, firstErrorTag: null });
    }
    return out;
  }

  function resumeDraft() {
    var d = app.state.draft;
    if (!d || !Array.isArray(d.questions) || !d.questions.length) {
      app.state.draft = null;
      return render();
    }
    app.session = {
      id: d.id || ('S' + Date.now()),
      seed: d.seed,
      startedAt: d.startedAt || Date.now(),
      endedAt: null,
      questions: d.questions,
      cursor: 0
    };
    app.cursor = Math.min(Math.max(0, d.cursor || 0), d.questions.length - 1);
    app.stepStates = Array.isArray(d.stepStates) ? d.stepStates : [];
    app.results = Array.isArray(d.results) ? d.results : [];
    // 防御：这一题的状态条数必须和它的步骤数对上，否则 render 会读到 undefined，
    // 表现就是"点继续就白屏"。对不上就把这一题当作没开始过 ——
    // 宁可重做一道，也不能打不开。
    var curSteps = (d.questions[app.cursor] && d.questions[app.cursor].steps) || [];
    if (app.stepStates.length !== curSteps.length) {
      app.stepStates = emptyStepStates(curSteps.length);
      app.feedback = null;
    }
    // 光标落在"第一个还没做完的步骤"上。直接设成 0 的话，
    // 已经做完前两步的题会把后面的步骤判成 locked —— 孩子点不动，看着像卡死。
    app.activeStep = 0;
    for (var si = 0; si < app.stepStates.length; si++) {
      if (!app.stepStates[si].done) break;
      app.activeStep = si + 1;
    }
    app.input = d.input || '';
    app.choiceValue = (d.choiceValue === undefined) ? null : d.choiceValue;
    app.hintLevel = d.hintLevel || 0;
    app.hintLevelSeen = d.hintLevelSeen || 0;
    app.hintUsedInQuestion = !!d.hintUsedInQuestion;
    app.strokes = d.strokes || [];
    app.penOn = !!d.penOn;
    app.showRuler = false;
    app.feedback = null;
    app.submitMsg = '';
    app.questionStartAt = d.questionStartAt || Date.now();
    app.view = 'practice';
    render();
  }

  function draftCard() {
    var d = app.state.draft;
    if (!d || !Array.isArray(d.questions) || !d.questions.length) return '';
    var at = d.cursor || 0;
    if (at >= d.questions.length) return '';
    var done = (d.stepStates || []).filter(function (s) { return s && s.done; }).length;
    return '<div class="card card-due">' +
      '<h2 class="card-title">上次还没做完</h2>' +
      '<p class="card-note">做到第 ' + (at + 1) + ' 题（共 ' + d.questions.length + ' 题），' +
      esc(fmtDay(d.ts)) + '，其中 ' + done + ' 题已经答过。接着做，答过的不重算。</p>' +
      '<div class="action-row">' +
      '<button class="btn btn-soft" data-act="drop-draft">不用了</button>' +
      '<button class="btn btn-primary" data-act="resume">继续做</button>' +
      '</div></div>';
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
        // 练过哪个单元就标上最后一次是哪天：孩子一眼能看出哪块动过、哪块还没碰
        var at = 0;
        K.implemented().forEach(function (k) {
          if (k.unit !== u) return;
          var t = lastAtOfKp(k.id);
          if (t > at) at = t;
        });
        return '<button class="unit-btn' + (unit === u ? ' on' : '') + '" data-act="unit" data-u="' + esc(u) + '">' +
          esc(K.shortUnit(u)) +
          (at ? '<span class="when">' + esc(fmtDayShort(at)) + '</span>' : '') + '</button>';
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

      draftCard() +

      '<div class="card card-cta">' +
      '<div class="cta-line">练 10 题，大约 10 分钟</div>' +
      '<div class="cta-sub">' + esc(lastLine) + '。本次范围：' + esc(unitName) + '，前两道是热身。</div>' +
      '<button class="btn btn-primary btn-lg" data-act="start">开始练习</button>' +
      // 家长和孩子都会问"这一场和上一场什么关系"。规则摆在按钮下面，不用去别处找。
      '<p class="card-note">和刚做过的那一场不撞题型：练过的题型这场换成别的，' +
      '同一个知识点也是新的数字。错过的、到期的、还没练过的会优先排进来。</p>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">做题的方法</h2>' +
      '<p class="card-note">按单元分开列。做题的时候，注意看你用的是哪一个。</p>' +
      methodCards +
      '</div>' +

      '<div class="card card-quiet">' +
      '<h2 class="card-title">学习进度</h2>' +
      // 一行两个主入口：看掌握度、看报告。家庭码配一次基本不动，收成下面一行。
      '<div class="parent-row">' +
      '<button class="btn btn-soft" data-act="progress">掌握度地图</button>' +
      '<button class="btn btn-soft" data-act="parent">家长报告</button>' +
      '</div>' +
      '<div class="parent-row">' +
      // 家庭码以前只藏在报告页最底下，家长翻半天也找不着 —— 单独留一个入口，
      // 和报告一样要口令（家庭码等于全家的钥匙）。
      '<button class="btn btn-ghost" data-act="sync">跨设备同步</button>' +
      '</div>' +
      '<p class="card-note">家长报告要口令（里面有错题和正确答案）。报告里也能进同步设置。</p>' +
      '</div>' +

      '<p class="footnote">不填家庭码时，数据只保存在这台设备上。</p>';
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
      // 这一档说的是什么：现在这个知识点能出到哪一档的题。
      // 它是"先夯实基础才给难题"这条规则唯一的可见处 —— 看不见的话，
      // 家长会以为系统在随机出题，孩子会以为练习册突然变难了。
      var ceil = E.tierCeiling(state, k.id);
      var tierTxt = untouched ? '' : (ceil >= 3 ? '已解锁挑战题'
        : ceil === 2 ? '已解锁巩固题' : '只出基础题，练稳了才加档');
      // 哪天练的：家长看报告时要能对得上"这星期练了哪几天"
      var lastTxt = (!untouched && st.lastPracticedAt) ? ('上次练：' + fmtDay(st.lastPracticedAt)) : '';
      return '' +
        '<div class="kp-row">' +
        '<div class="kp-head">' +
        '<span class="kp-name">' + esc(k.name) + '</span>' +
        '<span class="kp-label">' + (untouched ? '还没练过' : esc(E.masteryLabel(p))) + '</span>' +
        '</div>' +
        '<div class="bar">' + (untouched ? '' : '<i class="' + cls + '" style="width:' + pct + '%"></i>') + '</div>' +
        '<div class="kp-foot">' +
        '<span>' + (untouched ? '课本第 ' + k.bookPage + ' 页' : '练过 ' + st.attempts + ' 题，对 ' + st.corrects + ' 题') + '</span>' +
        (lastTxt ? '<span>' + esc(lastTxt) + '</span>' : '') +
        (dueTxt ? '<span class="kp-due">' + esc(dueTxt) + '</span>' : '') +
        (tierTxt ? '<span class="kp-tier">' + esc(tierTxt) + '</span>' : '') +
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
      '</div>';
  }

  /* ============================== 视图：练习 ============================== */
  function viewPractice() {
    var q = currentQuestion();
    if (!q) return '<div class="card">题目加载失败。</div>';
    // 这块知识上次什么时候练的：孩子得有个"我是不是刚练过"的参照
    var lastAt = lastAtOfKp(q.kpId);

    // 方法跟着题型走，不是跟着知识点走
    var method = K.METHODS[q.method];
    var total = app.session.questions.length;

    var dots = app.session.questions.map(function (_, i) {
      var cls = i < app.cursor ? 'dot done' : (i === app.cursor ? 'dot now' : 'dot');
      return '<i class="' + cls + '"></i>';
    }).join('');

    var questionDone = q.steps.every(function (_, i) { return app.stepStates[i].done; });

    // 单栏内联：看到哪儿，做到哪儿。
    //
    // 以前是"左边看题、右边作答"两栏 + 一块独立的作答区。作答区看着体面，
    // 实际上是把当前这一步的问题原样抄了一遍，眼睛还得在两栏之间来回找。
    // 现在输入框和选项直接排在题目下面那一步里 —— 每一步答完就地打勾，
    // 下一步自己展开，整页一列，手机上也不会有东西盖住题干。
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
        if (s.type === 'choice') {
          body = '<div class="options">' + s.options.map(function (o) {
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
          body = '<div class="answer-box">' +
            '<input id="answerInput" class="answer-input" type="text" inputmode="numeric" ' +
            'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
            'enterkeyhint="done" placeholder="点一下，用输入法直接填" ' +
            'value="' + esc(app.input) + '">' +
            '</div>';
        }
        body += '<div class="step-kbd-hint">' +
          (s.type === 'choice' ? '按数字键 1 / 2 / 3 选择，回车确认' : '用键盘直接输入，回车确认') +
          '</div>';
      } else {
        body = '<div class="step-locked">待完成</div>';
      }

      return '<li class="step ' + cls + '"' + (cls === 'active' ? ' id="active-step"' : '') + '>' +
        '<div class="step-head"><span class="step-no">' + (i + 1) + '</span>' +
        '<span class="step-prompt">' + esc(s.prompt) + '</span></div>' +
        body + '</li>';
    }).join('');

    var feedback = '';
    if (app.feedback) {
      feedback = '<div class="feedback ' + app.feedback.tone + '" id="step-feedback">' + esc(app.feedback.text) +
        (app.feedback.tone === 'teach' ? '<div class="teach-body">' + esc(app.feedback.detail || '') + '</div>' : '') +
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
      (app.penOn ? '<div class="pen-tip">在题目上直接画（分级线、圈 0 都行）。关了画笔线也留着，点「清掉笔迹」才擦。</div>' : '');

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

    // 难度档徽章（基础 / 巩固 / 挑战）。三档是照着教材和教案的分层给的，
    // 巩固和挑战要练到才解锁 —— 所以这一栏同时也是给孩子看的"我练到哪了"。
    var tier = q.diffTier || null;
    var tierChip = tier ? '<span class="badge-tier tier-' + esc(tier.key) + '">' +
      esc(tier.name) + '</span>' : '';
    var tierTip = (tier && tier.level > 1)
      ? '<span class="why-tier">这一档：' + esc(tier.tip) + '</span>' : '';

    return '' +
      '<div class="topbar">' +
      '<button class="btn-icon" data-act="quit" title="退出练习">✕</button>' +
      '<div class="dots">' + dots + '</div>' +
      tierChip +
      '<span class="topbar-right">' + (app.cursor + 1) + '/' + total + '</span>' +
      '</div>' +

      '<div class="why"><span class="why-k">为什么给你出这道题</span>' + esc(q.reason) + tierTip + '</div>' +
      '<p class="card-note">' + esc(lastAt
        ? ('这块知识上次练过：' + fmtDay(lastAt))
        : '这块知识这是第一次练') + '</p>' +
      '<div class="card card-q">' +
      // 画布只盖"看题区"（题干和图），不盖下面的步骤 ——
      // 单栏内联之后作答控件也在题卡里，整张卡都铺上画布的话，
      // 开了画笔就点不到选项和输入框了。数字本来就在题干里，够画。
      '<div class="q-stage">' +
      '<canvas id="qCanvas" class="q-canvas' + (app.penOn ? ' on' : '') + '"></canvas>' +
      methodBar +
      (q.stem ? '<div class="stem"><span class="stem-label">题目</span>' + esc(q.stem) + '</div>' : '') +
      (q.figure ? figureHtml(q.figure) : '') +
      '</div>' +
      '<ol class="steps">' + stepsHtml + '</ol>' +
      '</div>' +
      toolsHtml +
      rulerPanel +
      feedback +
      (app.submitMsg ? '<div class="feedback info">' + esc(app.submitMsg) + '</div>' : '') +
      actions +
      // 交的时机是"这一场做完"（做完会自动把统计推上去），不是做一题交一题。
      // 这个按钮是给"我想早点让家长看到"用的。
      '<div class="action-row">' +
      '<button class="btn btn-ghost" data-act="my-records">看这一场的记录</button>' +
      '<button class="btn btn-soft" data-act="submit-report">提交给家长</button>' +
      '</div>' +
      '<p class="card-note">不会自动上传：点一下「提交给家长」就把已经答过的题交上去 —— ' +
      '挑个空闲的时候点，家长那边马上就能看到。</p>';
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
  // 画布的位置每帧只量一次。一次 pointermove 里往往攒着十几个采样点，
  // 每个点都量一次会反复触发布局重算（低配平板上就是这么卡起来的），
  // 卡一次浏览器就丢一批采样 —— 孩子画出来的线跟着断。
  var rectCv = null, rectCache = null, rectAt = 0;
  function rectOf(cv) {
    var now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    if (rectCv !== cv || !rectCache || now - rectAt > 16) {
      rectCache = cv.getBoundingClientRect ? cv.getBoundingClientRect() : { left: 0, top: 0 };
      rectCv = cv;
      rectAt = now;
    }
    return rectCache;
  }

  function posOf(cv, e) {
    var r = rectOf(cv);
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // 一次 pointermove 里浏览器可能攒了好几个采样点（电容笔尤其明显）。
  // 只取最后一个的话，快画时线会变成几段直棱棱的折线 —— 看着就像"连着画会断"。
  function coalesced(e) {
    if (typeof e.getCoalescedEvents === 'function') {
      try {
        var list = e.getCoalescedEvents();
        if (list && list.length) return list;
      } catch (err) { /* 老浏览器：退回这一个点，照常能画 */ }
    }
    return [e];
  }

  // 笔画的线型只在这里设一次：整块重画和"只补一小段"必须一模一样，
  // 不然一笔线会一段粗一段细。
  var INK = '#e8590c';
  var INK_W = 2.5;
  function inkBegin(ctx) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = INK_W;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
  }

  // 每根手指各占一笔。用单个 drawing 布尔值的话，手掌或另一根手指碰一下屏幕，
  // 两根手指的点会被并进同一笔里，画出来就是一条横穿的怪线 ——
  // 孩子越想画干净越乱（9 岁孩子写字时另一只手常按在屏幕上）。
  var liveStrokes = {};   // pointerId -> 该手指那一笔的点数组
  var livePen = {};       // pointerId -> 这一笔是不是电容笔
  // 电容笔最近一次落下 / 抬起的时间。笔在画的时候手掌常常就贴在屏上，
  // 不管的话一道题上会多出一条掌痕。
  var penAt = 0;
  function penLive() {
    for (var k in livePen) { if (livePen[k]) return true; }
    return false;
  }

  function redrawCanvas(ctx, cv) {
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
    inkBegin(ctx);
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
    if (!e || e.pointerId == null) return;
    delete liveStrokes[e.pointerId];
    delete livePen[e.pointerId];
    if (e.pointerType === 'pen') penAt = Date.now();
  }

  // 落笔的那一下：只点了一个点也要看得见（原来靠整块重画，现在是补画一笔）
  function drawDot(ctx, p) {
    inkBegin(ctx);
    ctx.arc(p.x, p.y, INK_W / 2, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
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
    rectCv = null;   // 尺寸变了，缓存的画布位置也得重量
    redrawCanvas(ctx, cv);

    // 事件只绑一次。resize 会再调一回 attachCanvas，那时候节点还是原来那个，
    // 再绑一遍就等于一次落笔画出两笔 —— 家长看到的是一堆重影，
    // 而且越是转屏越是频繁，恰恰是最需要看清楚孩子写了什么的时候。
    if (!cv._mcBound) {
      cv._mcBound = true;
      cv.addEventListener('pointerdown', function (e) {
        if (!app.penOn) return;
        // 电容笔正在画、或刚抬起的那一下：这时的触摸基本都是手掌跟手指，
        // 让它也起一笔的话，孩子画的竖式上就糊一条痕。
        var isPen = e.pointerType === 'pen';
        if (isPen) penAt = Date.now();
        else if (penLive() || (penAt && Date.now() - penAt < 400)) return;
        if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
        var p = posOf(cv, e);
        var st = [p];
        liveStrokes[e.pointerId] = st;
        livePen[e.pointerId] = isPen;
        app.strokes.push(st);
        drawDot(ctx, p);
        e.preventDefault();
      });
      cv.addEventListener('pointermove', function (e) {
        if (!app.penOn) return;
        var st = liveStrokes[e.pointerId];
        if (!st) return;
        // 这一批采样点只补画新增的那一小段，不整块重画：
        // 整块重画在低配平板上每动一下就卡一次，卡的时候浏览器丢采样，
        // 画出来的线就是一段一段断的。
        var evts = coalesced(e);
        var prev = st[st.length - 1];
        inkBegin(ctx);
        ctx.moveTo(prev.x, prev.y);
        for (var i = 0; i < evts.length; i++) {
          var p = posOf(cv, evts[i]);
          st.push(p);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        e.preventDefault();
      });
      // 不用 pointerleave：笔尖滑到画布外面就被判成"这一笔完了"，
      // 孩子接着画就从那儿断开。已经 setPointerCapture 了，
      // 出了画布 pointermove / pointerup 照样送到这里。
      cv.addEventListener('pointerup', endStroke);
      cv.addEventListener('pointercancel', endStroke);
      cv.addEventListener('lostpointercapture', endStroke);
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

  /* ============================== 视图：这一场的记录 ============================== */
  // 这一场做到哪儿、每题对没错、填的是什么、错在哪 —— 随时能翻，
  // 不用等整场结束看结果页。数学由程序判分，这些就是"批改"的全部内容。
  function recordRows(list) {
    return list.map(function (r) {
      var tag = tagsOf(r)[0];
      var info = tag ? (T.ERROR_TAGS[tag] || { label: tag }) : null;
      return '<div class="kp-row">' +
        '<div class="kp-head"><span class="kp-name">' + esc(r.stem || '（无题干）') + '</span>' +
        '<span class="kp-label">' + (r.isCorrect ? '对' : '错') + '</span></div>' +
        '<div class="kp-foot">' +
        '<span>' + esc((K.byId(r.kpId) || {}).name || '') +
        (r.ts ? '　' + esc(fmtDay(r.ts)) : '') + '</span>' +
        '<span>' + (r.answer ? '你填的：' + esc(r.answer) : '') +
        (r.isCorrect ? '' : ((r.answer ? '　' : '') + esc(info ? info.label : '再算一遍试试'))) + '</span>' +
        '</div></div>';
    }).join('');
  }

  function viewRecords() {
    var head = '<div class="topbar">' +
      '<button class="btn-icon" data-act="home">←</button>' +
      '<span class="topbar-title">这一场的记录</span>' +
      '<span class="topbar-right"></span></div>';

    var mine = (app.results || []).slice().reverse();
    var body;
    if (mine.length) {
      body = '<div class="card"><h2 class="card-title">这一场已答 ' + mine.length + ' 题</h2>' +
        '<p class="card-note">对错、你填的答案、错在哪，都记在这里。</p>' +
        recordRows(mine) + '</div>';
    } else {
      var hist = (app.state.history || []).slice(-20).reverse();
      body = '<div class="card"><h2 class="card-title">最近做过的题</h2>' +
        '<p class="card-note">这一场还没答过题，下面是之前做过的。</p>' +
        (hist.length ? recordRows(hist) : '<p class="card-note">还没有记录。</p>') + '</div>';
    }
    return head + body + '<button class="btn btn-ghost btn-block" data-act="home">回首页</button>';
  }

  /* --------------------------- 提交给家长（上传报告） --------------------------- */
  // 数学是程序判分，没有"等家长批"这一步 —— 这里的"提交"是把这一场的统计快照
  // 推上去，家长在自己手机上就能看到"做到哪儿了、对了多少"。
  function submitReport() {
    if (!F || !F.on()) {
      app.submitMsg = '还没开跨设备同步。让家长在「跨设备同步」里填上家庭码，' +
        '之后就能把练习情况传到家长手机上。';
      return render();
    }
    app.submitMsg = '正在提交…';
    render();
    F.pushReport(reportSnapshot()).then(function () {
      app.submitMsg = '已提交。家长在另一台设备上打开报告就能看到这一场。';
      render();
    }).catch(function (e) {
      app.submitMsg = '没提交上去（' + ((e && e.message) || '网络不通') + '）。记录还在本机，下次会自动补。';
      render();
    });
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
    app.submitMsg = '';
    prepareQuestion();
    app.view = 'practice';
    // 整场题存进 draft：做到一半被打断，下次进同一台设备接着做
    saveDraft();
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

  // 单栏内联之后整页变长了（探究题有 7 步），答完一步要把它接住的
  // 下一步/反馈滚进视野，否则孩子要点两次提交才知道页面没反应。
  function reveal(id) {
    var node = el(id);
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
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
    reveal(app.activeStep !== i ? 'active-step' : 'step-feedback');
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
    reveal('step-feedback');
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
      // 孩子填的是什么也记下来：家长看报告时，"他答的是几"比一句"错了"有用得多。
      // 截前 24 个字符 —— 答案本身很短，防的是极端输入把存储撑大。
      answer: String(fs.lastValue == null ? '' : fs.lastValue).slice(0, 24),
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
    saveDraft();   // 没做完：记下做到第几题，下次接着做
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
    clearDraft();       // 这一场做完了，草稿不用留
    saveState();
    // 不自动上传：什么时候把这一场的成绩交给家长，由人点「提交给家长」决定
    app.view = 'result';
    render();
  }

  function quitSession() {
    if (!window.confirm('要退出这次练习吗？已经做过的题会记下来，没做的不会算。\n' +
      '下次进来还能接着做没做完的那些。')) return;
    finishQuestion();
    var hasResults = !!(app.results && app.results.length);
    // 一道都没做就别记这一次"练习"，否则家长报告里会出现"练了 0 题"的记录
    if (hasResults) {
      app.state.sessions = app.state.sessions || [];
      app.state.sessions.push({
        id: app.session.id,
        startedAt: app.session.startedAt,
        endedAt: Date.now(),
        total: app.results.length,
        correct: app.results.filter(function (r) { return r.isCorrect; }).length,
        quit: true
      });
    }
    // 刚退出的这一题已经记过账了，草稿要推到下一题 ——
    // 不推的话下次"继续做"会把同一道题再算一遍，掌握度也跟着多记一笔。
    if (app.session && app.cursor + 1 < app.session.questions.length) {
      app.cursor++;
      prepareQuestion();
      app.submitMsg = '';
      saveDraft();
    } else {
      clearDraft();
    }
    // 不自动上传：要交给家长就点「提交给家长」（见 submitReport）
    if (hasResults) saveState();
    app.view = 'home';
    app.session = null;
    render();
  }

  /* ============================== 视图：家长报告 ============================== */
  // 给家长看的页，不给孩子看：练了多久、效率怎么样、错在哪。
  // 数据默认只在本机；开了跨设备同步之后，家长可以在别的设备上看到这台设备的统计。

  // 统计快照：覆盖写，云端只留每台设备的最新一份。
  // 全量历史就在孩子设备上，没必要再往云端堆一份。
  function reportSnapshot() {
    return {
      devName: (F && F.sync() && F.sync().name) || '设备',
      ts: Date.now(),
      sessions: (app.state.sessions || []).slice(-100),
      history: (app.state.history || []).slice(-200),
      stats: app.state.stats || {}
    };
  }

  function pushReport() {
    if (!F || !F.on()) return;
    F.pushReport(reportSnapshot());
  }

  function refreshReports() {
    if (!F || !F.on()) return;
    F.pullReports().then(function (list) {
      app.cloudReports = list || [];
      if (app.view === 'parent') render();
    }).catch(function () { /* 连不上就只看本机的 */ });
  }

  /* ------------------- 为什么不做定时轮询（这是刻意的） ------------------- */
  // 试过在报告页每 30 秒自动拉一次，用下来不合适：页面在背后不停地请求。
  // 所以用"手动一下"的模型（和 05_商品到期提醒 那套一样）：
  //   · 孩子：这一场做完自动推一次统计；也可以点「提交给家长」马上推
  //   · 家长：报告页点「刷新」拉一次别的设备的最新统计
  //   · 打开页面 / 从后台切回时各拉一次，其余时间一次请求都不发

  // 别的设备上练得怎么样
  function cloudReportsHtml() {
    if (!F || !F.on() || !app.cloudReports || !app.cloudReports.length) return '';
    var myDev = F.sync().dev;
    var rows = app.cloudReports.filter(function (r) { return r.dev !== myDev; });
    if (!rows.length) return '';

    var list = rows.map(function (r) {
      var h = (r.snapshot && r.snapshot.history) || [];
      var ok = h.filter(function (x) { return x.isCorrect; }).length;
      var pct = h.length ? Math.round(ok / h.length * 100) : 0;
      var when = r.ts ? fmtTime(r.ts) : '';
      return '<p class="card-note"><b>' + esc((r.snapshot && r.snapshot.devName) || '另一台设备') +
        '</b>　练了 ' + ((r.snapshot && r.snapshot.sessions) || []).length + ' 次 · ' +
        h.length + ' 题 · 答对 ' + ok + ' 题（' + pct + '%）' +
        (when ? '　· 更新于 ' + esc(when) : '') + '</p>';
    }).join('');

    return '<div class="card card-quiet">' +
      '<h2 class="card-title">别的设备上</h2>' +
      '<p class="card-note">下面是另 ' + rows.length + ' 台设备最近一次上传的情况（本机在上面）。</p>' +
      list +
      '</div>';
  }

  // 跨设备同步的开关（只在家长报告页里，孩子碰不到）
  function syncCardHtml() {
    if (!F) return '';
    var s = F.sync();
    if (!s.on) {
      return '<div class="card">' +
        '<h2 class="card-title">跨设备同步</h2>' +
        '<p class="card-note">开了之后，你在自己手机上就能看到孩子在这台设备上练得怎么样。' +
        '不用点同步，数据仍然只在这台设备上（除非你开）。</p>' +
        // 先问"另一台设备是不是已经有码了"：各生成各的 = 两个互不相通的家庭
        '<p class="card-note"><b>已经有一台设备生成过家庭码了吗？把那个码填进来：</b></p>' +
        '<input id="famInput" class="pass-input" type="text" placeholder="xxxx-xxxx-xxxx" ' +
        'autocomplete="off" value="' + esc(app.famInput || '') + '">' +
        '<button class="btn btn-primary btn-block" data-act="sync-join">用这个码</button>' +
        '<p class="card-note">没有的话，在这台设备上生成一个 —— ' +
        '<b>另一台已经生成过就别点这个</b>，那就是两个家庭了。</p>' +
        '<button class="btn btn-ghost btn-block" data-act="sync-on">这台是第一个，生成新码</button>' +
        (app.cloudMsg ? '<div class="feedback warn">' + esc(app.cloudMsg) + '</div>' : '') +
        '</div>';
    }
    return '<div class="card">' +
      '<h2 class="card-title">跨设备同步</h2>' +
      '<p class="card-note">家庭码　<b>' + esc(s.fam) + '</b></p>' +
      '<p class="card-note">另一台设备在同一个地方填上这个码就对上了。' +
      '知道这个码的人能看到练习情况 —— 别发给外人。</p>' +
      '<p class="card-note">' + esc(F.statusText()) + '</p>' +
      '<button class="btn btn-ghost btn-block" data-act="sync-new">换一个码</button>' +
      '<button class="btn btn-soft btn-block" data-act="sync-off">关掉同步</button>' +
      '</div>';
  }
  // 跨设备同步单独一页。它以前只挂在家长报告页最底下，
  // 家长得先进报告、再一直滑到最底才看得见 —— 结果就是"哪儿都找不到填家庭码的地方"。
  function viewSync() {
    return '' +
      '<div class="topbar">' +
      '<button class="btn-icon" data-act="home">←</button>' +
      '<span class="topbar-title">跨设备同步</span>' +
      '<span class="topbar-right"></span>' +
      '</div>' +
      '<div class="card">' +
      '<h2 class="card-title">家庭码是干什么的</h2>' +
      '<p class="card-note">两台设备填同一个家庭码（比如孩子的平板 + 家长的手机），' +
      '孩子练完一场，家长在自己手机上就能看到进度。' +
      '语文小教练用的是同一个码 —— 一个码管两门课。</p>' +
      '<p class="card-note">填一次就够，以后不用再点同步。</p>' +
      '</div>' +
      cloudReportsHtml() +
      syncCardHtml();
  }

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

  // 报告要用的数据：本机 + 云端各设备（去重后合并）。
  //
  // 不合并的话，家长在自己手机上打开报告页会是空的 —— 那台设备一场都没练过，
  // 记录全在孩子那台设备上。跨设备看报告要成立，这一步是必须的。
  function mergedState() {
    var st = app.state;
    if (!F || !F.on() || !app.cloudReports || !app.cloudReports.length) return st;
    var myDev = F.sync().dev;

    var hist = (st.history || []).slice();
    var sessions = (st.sessions || []).slice();
    var stats = {};
    Object.keys(st.stats || {}).forEach(function (k) { stats[k] = Object.assign({}, st.stats[k]); });

    var seenH = {}, seenS = {};
    hist.forEach(function (h) { seenH[h.ts + '|' + (h.sessionId || '') + '|' + h.kpId] = 1; });
    sessions.forEach(function (s) { seenS[s.id] = 1; });

    app.cloudReports.forEach(function (r) {
      if (r.dev === myDev) return;   // 本机那份已经在上面算过了
      var snap = r.snapshot || {};
      (snap.history || []).forEach(function (h) {
        var k = h.ts + '|' + (h.sessionId || '') + '|' + h.kpId;
        if (seenH[k]) return;
        seenH[k] = 1;
        hist.push(h);
      });
      (snap.sessions || []).forEach(function (s) {
        if (seenS[s.id]) return;
        seenS[s.id] = 1;
        sessions.push(s);
      });
      // 知识点统计要累加，不是覆盖 —— 两台设备各练 5 题就是练过 10 题
      Object.keys(snap.stats || {}).forEach(function (kp) {
        var a = stats[kp] = stats[kp] || { attempts: 0, corrects: 0, wrongs: 0 };
        var b = snap.stats[kp] || {};
        a.attempts += b.attempts || 0;
        a.corrects += b.corrects || 0;
        a.wrongs += b.wrongs || 0;
      });
    });

    return { history: hist, sessions: sessions, stats: stats, mastery: st.mastery, passcode: st.passcode };
  }

  // 报告里切"看哪一段时间"。只影响场次 / 错题 / 每道题记录三块的明细；
  // 总览和"错误点都在哪"一直是累计的 —— 那些数字变小反而会让人以为数据丢了。
  function rangePickerHtml() {
    var cur = app.range || '7';
    return '<div class="card card-quiet">' +
      '<h2 class="card-title">看哪一段时间</h2>' +
      '<div class="unit-row">' + RANGES.map(function (r) {
        return '<button class="unit-btn' + (r.k === cur ? ' on' : '') +
          '" data-act="range" data-r="' + r.k + '">' + r.name + '</button>';
      }).join('') + '</div>' +
      '<p class="card-note">切换只影响下面「每次练习」「错题」「每道题的记录」三块；' +
      '上面的总览和「错误点都在哪」一直是全部（累计）。</p>' +
      '</div>';
  }

  function viewParent() {
    var state = mergedState();
    var hist = state.history || [];

    var topbar = function (title) {
      return '<div class="topbar">' +
        '<button class="btn-icon" data-act="home">←</button>' +
        '<span class="topbar-title">' + title + '</span>' +
        '<span class="topbar-right"></span>' +
        '</div>';
    };
    var passErr = function () {
      return app.passMsg ? '<div class="feedback warn">' + esc(app.passMsg) + '</div>' : '';
    };

    // 第一次进来先设口令。报告里有错题、正确答案和"清空所有数据"，
    // 没有这道门，孩子自己就能点清空，练几个月的记录一秒没了还查不出是谁点的。
    if (!state.passcode) {
      return topbar('家长报告') +
        '<div class="card">' +
        '<h2 class="card-title">先设一个口令</h2>' +
        '<p class="card-note">这里能看到错题、导出记录，还能清空数据，给孩子看不合适。设个 4～6 位数字。</p>' +
        '<p class="card-note">口令只存在这台设备上，所以换一台设备就要再设一次（可以和别的设备不一样）。</p>' +
        '<input id="passInput" class="pass-input" type="text" inputmode="numeric" autocomplete="off" ' +
        'placeholder="输入口令" value="' + esc(app.passInput) + '">' +
        '<button class="btn btn-primary btn-block" data-act="set-pass">设好，进去看报告</button>' +
        passErr() +
        '</div>';
    }

    if (!app.parentUnlocked) {
      return topbar('家长报告') +
        '<div class="card">' +
        '<h2 class="card-title">请输入家长口令</h2>' +
        '<input id="passInput" class="pass-input" type="password" inputmode="numeric" autocomplete="off" ' +
        'placeholder="家长口令" value="' + esc(app.passInput) + '">' +
        '<button class="btn btn-primary btn-block" data-act="unlock">确定</button>' +
        '<p class="card-note">忘了口令？只有清空数据重来（下方"清空所有数据"进不来，需清本地数据），' +
        '口令是明文存在这台设备上的，挡住的是孩子顺手点开，不防别人翻这台设备。</p>' +
        passErr() +
        '</div>';
    }

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

    // 一段时间内的记录：家长要看的是"这几天练了什么"，不是从头翻到尾
    var since = rangeStart(app.range || '7');
    var rangeTxt = rangeName(app.range || '7');
    var rangeHist = hist.filter(function (h) { return inRange(h.ts, since); });
    var okRange = rangeHist.filter(function (h) { return h.isCorrect; }).length;

    // ---- 每一场（按选的时间段筛）----
    var sessionRows = (state.sessions || []).filter(function (s) {
      return inRange(s.endedAt || s.startedAt, since);
    }).slice().reverse().slice(0, 30).map(function (s) {
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
    var wrongRows = rangeHist.filter(function (h) { return !h.isCorrect; }).slice(-20).reverse()
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

    // ---- 每道题的记录（对的也列）----
    // 只列错题的话，家长看不到"他做对了哪些、什么时候做的"，
    // 而报告的价值有一半恰恰在"对的那部分稳不稳"。
    var detailRows = rangeHist.slice(-60).reverse().map(function (h) {
      var dts = tagsOf(h).map(function (t) {
        return (T.ERROR_TAGS[t] || { label: '再算一遍试试' }).label;
      });
      return '<div class="kp-row">' +
        '<div class="kp-head"><span class="kp-name">' + esc(h.stem || '（无题干）') + '</span>' +
        '<span class="kp-label">' + (h.isCorrect ? '对' : '错') + '</span></div>' +
        '<div class="kp-foot">' +
        '<span>' + esc(fmtTime(h.ts)) + '　' + esc((K.byId(h.kpId) || {}).name || '') + '</span>' +
        '<span>' + (h.answer ? '他填的是 ' + esc(h.answer) : '') +
        (h.isCorrect ? '' : ((h.answer ? '　' : '') + esc(dts.join('、') || '再算一遍试试'))) +
        '</span></div></div>';
    }).join('');

    return '' +
      topbar('家长报告') +

      // 报告页只放报告：同步设置挪去它自己那页，别挡在报告中间
      '<div class="card card-quiet">' +
      '<p class="card-note">报告里包含练习和判定的全部内容。要在自己手机上看，' +
      '去「跨设备同步」填上同一个家庭码（一个码管语文和数学）。</p>' +
      '<button class="btn btn-ghost btn-block" data-act="sync">跨设备同步设置</button>' +
      // 家长在自己手机上看报告时，孩子那台设备可能刚练完 —— 给一条不用切后台的路
      '<button class="btn btn-ghost btn-block" data-act="reload-report">刷新（看看有没有新数据）</button>' +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">总览</h2>' +
      (hist.length
        ? '<p class="card-note">练了 ' + (state.sessions || []).length + ' 次 · 共 ' + hist.length +
          ' 题 · 答对 ' + totalOk + ' 题（' + Math.round(totalOk / hist.length * 100) + '%） · 做题用时 ' +
          esc(fmtDur(totalMs)) + '</p>' +
          '<p class="card-note">' + rangeTxt + '练了 ' + rangeHist.length + ' 题' +
          (rangeHist.length
            ? '，答对 ' + okRange + ' 题（' + Math.round(okRange / rangeHist.length * 100) + '%）' : '') +
          '。</p>'
        : '<p class="card-note">还没有练习记录。孩子做完一场，这里就能看到时间和正确率。</p>') +
      '<button class="btn btn-ghost btn-block" data-act="export-csv">导出全部记录（CSV，可用 Excel 打开）</button>' +
      '</div>' +

      rangePickerHtml() +

      '<div class="card">' +
      '<h2 class="card-title">每次练习（' + rangeTxt + '）</h2>' +
      '<p class="card-note">看「每题约多少秒」判断效率：明显变慢多半是卡住了。</p>' +
      (sessionRows || '<p class="card-note">这段时间没有练习记录 —— 换「最近 30 天」或「全部」看看。</p>') +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">错误点都在哪（累计）</h2>' +
      (kpRows || '<p class="card-note">还没有数据。</p>') +
      '</div>' +

      '<div class="card">' +
      '<h2 class="card-title">错题（' + rangeTxt + '，最多 20 条）</h2>' +
      (wrongRows || (rangeHist.length
        ? '<p class="card-note">这段时间没有错题，挺好。</p>'
        : '<p class="card-note">这段时间没有记录 —— 换「最近 30 天」或「全部」看看。</p>')) +
      '</div>' +

      // 每道题的判定记录：家长最需要的一块 —— 题干、他填的答案、对错、错因、日期。
      // 光看"错误点都在哪"的百分比，落不到"具体哪一道、他当时填的是什么"。
      '<div class="card">' +
      '<h2 class="card-title">每道题的记录（' + rangeTxt + '，' + detailRows.length + ' 条）</h2>' +
      '<p class="card-note">最近的在最上面。写着"他填的是"那一句，是孩子当时实际写下的答案。</p>' +
      (detailRows || '<p class="card-note">这段时间没有记录 —— 换「最近 30 天」或「全部」看看。</p>') +
      '</div>' +

      // 别的设备上练得怎么样：报告正文其实已经把它们的记录合并进来了，
      // 这一段是"数据来自哪几台设备"的来源说明，家长对不上数时靠它核对。
      cloudReportsHtml() +

      '<div class="card card-quiet">' +
      '<h2 class="card-title">清空数据</h2>' +
      '<p class="card-note">换孩子用、或者重新开始。会连同这条口令一起清掉，不能撤销。</p>' +
      '<button class="btn btn-ghost btn-block" data-act="reset">清空所有数据</button>' +
      '</div>';
  }

  function exportCsv() {
    var rows = [['时间', '知识点', '题干', '对错', '错因', '阶梯步错因', '用时（秒）', '提示到第几级']];
    // 用合并后的历史：家长在自己手机上导出时，导出来才有孩子那台设备上的记录
    (mergedState().history || []).forEach(function (h) {
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
    // 离开家长页就把解锁收回。下次点进来重新要口令 ——
    // 不然家长看完报告切回首页、孩子再点进去就是敞开的。
    if (app.view !== 'parent' && app.view !== 'sync') {
      app.parentUnlocked = false;
      app.passInput = '';
      app.passMsg = '';
      app.afterUnlock = '';
    }
    var html = app.view === 'home' ? viewHome()
      : app.view === 'practice' ? viewPractice()
        : app.view === 'result' ? viewResult()
          : app.view === 'records' ? viewRecords()
            : app.view === 'parent' ? viewParent()
              : app.view === 'sync' ? viewSync()
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
    if (!t) return;
    if (t.id === 'answerInput') { app.input = t.value; return; }
    // 口令框同理：只记账不 render，否则打一个字失焦一次，根本没法输完
    if (t.id === 'passInput') app.passInput = t.value;
    if (t.id === 'famInput') app.famInput = t.value;
  }

  // 口令这一关过了：从首页「跨设备同步」点进来的，直奔同步页；
  // 其余情况照旧进家长报告。
  function afterGate() {
    if (app.afterUnlock === 'sync') {
      app.afterUnlock = '';
      app.view = 'sync';
      app.famInput = '';
      app.passMsg = '';
      refreshReports();
    }
    return render();
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
    if (act === 'resume') return resumeDraft();
    if (act === 'drop-draft') { clearDraft(); return render(); }
    if (act === 'submit-report') return submitReport();
    if (act === 'my-records') { app.submitMsg = ''; app.view = 'records'; return render(); }
    // 报告里切"看哪一段时间"（今天 / 7 天 / 30 天 / 全部）
    if (act === 'range') { app.range = t.getAttribute('data-r') || '7'; return render(); }
    // 「刷新」：马上拉一次别的设备的统计，别让家长自己想到去切后台
    if (act === 'reload-report') { refreshReports(); return render(); }
    if (act === 'home') { app.session = null; app.view = 'home'; app.submitMsg = ''; return render(); }
    if (act === 'progress') { app.view = 'progress'; return render(); }
    if (act === 'parent') {
      app.view = 'parent';
      app.passInput = '';
      app.passMsg = '';
      refreshReports();   // 别的设备练得怎么样
      return render();
    }
    if (act === 'sync') {
      // 家庭码 = 全家的钥匙（拿到码的人能看到练习情况），所以和报告同一道门。
      if (!app.parentUnlocked) {
        app.view = 'parent';
        app.passInput = '';
        app.afterUnlock = 'sync';   // 口令一过就直接进同步页，不用家长再找一遍
        app.passMsg = '跨设备同步也要口令 —— 家庭码就是这家的钥匙，别让孩子拿着。';
        return render();
      }
      app.view = 'sync';
      app.afterUnlock = '';
      app.famInput = '';
      app.cloudMsg = '';
      refreshReports();
      return render();
    }
    if (act === 'set-pass') {
      var pv = (app.passInput || '').trim();
      if (!/^\d{4,6}$/.test(pv)) {
        app.passMsg = '口令要 4～6 位数字。';
        return render();
      }
      app.state.passcode = pv;
      app.parentUnlocked = true;
      app.passInput = '';
      app.passMsg = '';
      saveState();
      refreshReports();
      return afterGate();
    }
    if (act === 'unlock') {
      if ((app.passInput || '').trim() !== app.state.passcode) {
        app.passMsg = '口令不对。';
        app.passInput = '';
        return render();
      }
      app.parentUnlocked = true;
      app.passInput = '';
      app.passMsg = '';
      refreshReports();
      return afterGate();
    }

    /* ---- 跨设备同步（只在家长报告页里能点到） ---- */
    if (act === 'sync-on') {
      if (!F) return;
      // enable 自己会校验，返回"到底开没开"
      app.cloudMsg = F.enable(F.newCode()) ? '' : '没能开启同步，再点一次试试。';
      saveState();
      return render();
    }
    if (act === 'sync-new') {
      if (!F) return;
      // 换码 = 换家庭：已经填了旧码的设备会全部失联，得挨个重填
      if (!window.confirm('换码之后，已经填了旧码的设备会失联，得重新填新码。确定换吗？')) return;
      app.cloudMsg = F.enable(F.newCode()) ? '' : '没能换码，再点一次试试。';
      saveState();
      return render();
    }
    if (act === 'sync-join') {
      if (!F) return;
      var code = String(app.famInput || '').trim().toLowerCase();
      var why = F.codeError(code);
      if (why) {
        app.cloudMsg = why === 'checksum'
          ? '这个码抄错了一位（最后那位对不上），照着另一台设备再核一遍。'
          : '家庭码是 12 位，形如 xxxx-xxxx-xxxx（字母和数字，中间两道横杠）。';
        return render();
      }
      F.enable(code);
      F.enable(code);
      app.famInput = '';
      app.cloudMsg = '';
      saveState();
      refreshReports();
      return render();
    }
    if (act === 'sync-off') {
      if (!F) return;
      F.disable();
      app.cloudReports = [];
      saveState();
      return render();
    }
    if (act === 'unit') {
      app.state.unit = t.getAttribute('data-u') || 'all';
      saveState();
      return render();
    }
    // 导出和清空都只在口令门后面才认。孩子就算把按钮 HTML 印出来点了，
    // 没解锁也什么都不会发生。
    if (act === 'export-csv') {
      if (!app.parentUnlocked) return;
      return exportCsv();
    }
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
      if (!app.parentUnlocked) return;
      if (window.confirm('确定清空所有练习记录吗？这个操作不能撤销。')) {
        // 开了跨设备同步的话，云端这份也要跟着清 ——
        // 不然清空之后，别人那台设备还会看到这台设备的旧数据（墓碑挡住它）
        if (F && F.on()) F.clearDevice();
        app.state = S.reset();
        app.parentUnlocked = false;
        app.passInput = '';
        app.passMsg = '';
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

    if (F) {
      F.init(app.state, {
        onStatus: function () { if (app.view === 'parent') render(); }
        // 家庭码在语文 / 数学之间共用，第三参数把两边的数据隔开
      }, 'math');
    }

    // 从后台切回前台时拉一次别的设备的统计（点「家长报告」进页面时也会拉）。
    // 不做定时器，也不轮询 —— 联网只发生在"进报告页 / 切回来 / 自己点刷新"这几个时刻。
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && app.view === 'parent') refreshReports();
      });
    }

    render();
  }

  // 给测试挂的钩子：浏览器里它就是个没人理的对象，不影响任何行为
  if (typeof window !== 'undefined') {
    window.__mc = { app: app, reportSnapshot: reportSnapshot, pushReport: pushReport };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
