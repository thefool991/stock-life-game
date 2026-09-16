/* ============================================================
 * ui/panels.js — 界面各面板渲染（布局尺寸按文档 §10）
 * ============================================================ */
window.SL = window.SL || {};
SL.ui = SL.ui || {};

SL.ui.panels = {
  $: id => document.getElementById(id),

  /* ---------------- 顶部栏 ---------------- */
  renderTopbar(G) {
    const u = SL.utils;
    const holiday = u.isHoliday(G.day);
    this.$('tb-date').innerHTML = '<span class="v">' + u.fmtDate(G.day) + '</span>';
    this.$('tb-age').innerHTML = '年龄 <span class="v">' + u.ageAt(G.day).toFixed(1) + '岁</span>';
    const total = SL.state.totalAsset(G);
    const te = this.$('tb-total');
    te.innerHTML = '总资产 <span class="v">' + u.fmtMoney(total) + '</span>';
    const cashE = this.$('tb-cash');
    cashE.innerHTML = '现金 <span class="v">' + u.fmtMoney(G.cash) + '</span>';
    this.$('tb-target').innerHTML = '目标进度 <span class="v">' +
      (SL.state.targetProgress(G) * 100).toFixed(1) + '%</span> / 800万';
    const me = this.$('tb-market');
    const regime = SL.config.MACRO[G.macro] || SL.config.MACRO.normal;
    /* v2.3：世界经济不可见的回合，顶部不透露真实状态，统一显示"不明确" */
    const worldHidden = G.macroNews && G.macroNews.worldVisible === false;
    const regimeText = worldHidden ? '不明确' : regime.label;
    const inWindow = holiday && u.dayToDate(G.day).day === 1; // v1.6 节前交易窗口
    if (G.ended) { me.textContent = '已终局'; me.style.color = '#8b949e'; }
    else if (inWindow) { me.textContent = holiday.name + '前最后交易日 · ' + regimeText; me.style.color = '#f0a53a'; }
    else if (holiday) { me.textContent = holiday.name + '休市中 · ' + regimeText; me.style.color = '#f0a53a'; }
    else {
      me.textContent = '交易中 · ' + regimeText;
      me.style.color = worldHidden ? '#8b949e'
        : G.macro === 'bull' ? '#e54545' : G.macro === 'normal' ? '#2eb85c' : G.macro === 'bear' ? '#3a9e5f' : '#b03030';
    }
  },

  /* ---------------- 角色面板（195px） ---------------- */
  renderRole(G) {
    const p = G.player, cfg = SL.config;
    this.$('rp-psy').textContent = Math.round(p.psy);
    const bar = this.$('rp-psy-bar');
    bar.style.width = p.psy + '%';
    bar.style.background = p.psy >= 50 ? '#2eb85c' : '#e54545';
    /* 经验值（v0.6） */
    const exp = Math.round((p.exp === undefined ? cfg.START_EXP : p.exp) * 10) / 10;
    this.$('rp-exp').textContent = exp;
    this.$('rp-exp-bar').style.width = exp + '%';
    this.$('rp-exp-bar').style.background = '#6cb6ff';
    this.$('rp-rank').textContent = SL.player.rank(G).label;
    /* 运气（v2.0.9：进度条格式，颜色区别于心理/经验——金色） */
    this.$('rp-luck').textContent = p.luck.toFixed(2);
    const luckBar = this.$('rp-luck-bar');
    if (luckBar) { luckBar.style.width = (p.luck * 100) + '%'; luckBar.style.background = '#e0a53a'; }

    const r = p.relations;
    this._relEl('rel-friend', r.friend);
    this._relEl('rel-love', r.love);
    this._relEl('rel-family', r.family);

    /* 立绘占位（资源填入后自动生效） */
    const avatar = this.$('rp-avatar');
    const url = SL.assets.get('avatar_normal');
    if (url) { avatar.style.backgroundImage = 'url(' + url + ')'; avatar.textContent = ''; }
    else { avatar.style.backgroundImage = 'none'; avatar.textContent = '立绘占位'; }

    /* 账单（含工资行，v0.6） */
    const list = this.$('bills-list');
    const salaryRow = '<div class="bill-row"><span>工资</span><b class="up">+' + SL.utils.fmtMoney(p.salary === undefined ? SL.config.SALARY_START : p.salary) + '</b></div>';
    list.innerHTML = salaryRow + p.bills.map(b =>
      '<div class="bill-row"><span>' + b.label + '</span><b>-' + SL.utils.fmtMoney(b.amount) + '</b></div>'
    ).join('');
    this.$('bills-total').textContent = SL.utils.fmtMoney(SL.player.monthlyBills(G)) + '/月';
  },

  _relEl(id, v) {
    const el = this.$(id);
    el.textContent = Math.round(v);
    el.style.color = v >= SL.config.RELATION_HIGH ? '#2eb85c' : v < 40 ? '#e54545' : '#d6dde6';
  },

  /* ---------------- 个股列表（200px） ---------------- */
  renderStockList(G) {
    const u = SL.utils;
    const box = this.$('stock-list');
    box.innerHTML = SL.state.activeStocks(G).map(s => {
      /* 涨跌幅对比昨收（最后一根K线收盘价） */
      const prev = s.history.length ? s.history[s.history.length - 1].c : s.price;
      const chg = (s.price - prev) / prev;
      const cls = chg >= 0 ? 'up' : 'down';
      const active = s.id === G.selectedStockId ? ' active' : '';
      const held = SL.trade.hasPosition(G, s.id) ? ' ●' : '';
      return '<div class="stock-item' + active + '" data-id="' + s.id + '">' +
        '<div class="nm"><span>' + s.name + held + '</span><span class="pr ' + cls + '">' + s.price.toFixed(2) + '</span></div>' +
        '<div class="nm"><span class="ind">' + s.industryLabel + '</span><span class="pr ' + cls + '">' + u.fmtPct(chg) + '</span></div>' +
        '</div>';
    }).join('');
    box.querySelectorAll('.stock-item').forEach(el => {
      el.onclick = () => SL.ui.selectStock(el.dataset.id);
    });
  },

  /* ---------------- 宏观情报板块（v0.8：世界经济/行业趋势） ---------------- */
  renderMacroNews(G) {
    const mn = G.macroNews;
    const wEl = this.$('mn-world'), iEl = this.$('mn-ind');
    if (!wEl || !iEl) return;
    if (!mn || !mn.world) { wEl.textContent = '--'; iEl.textContent = '--'; return; }
    /* v2.3：世界经济可见性——仅 15% 回合展示真实状态，其余显示"不明确"（顶部"交易中"同步） */
    if (mn.worldVisible === false) {
      wEl.innerHTML = '<span class="mn-regime dim">世界经济 · 不明确</span>' +
        '<span class="mn-ind-text">当前世界经济走向不明确，难以判断。</span>';
    } else {
      const w = mn.world;
      const regimeCls = w.regimeKey === 'bull' ? 'up' : w.regimeKey === 'normal' ? '' : 'down';
      /* v1.4：显示"已持续X个月"（信息公开度）；v1.4.1：提示集中到"?"图标，悬停弹出 */
      const segMonths = G.macroSeg ? Math.max(0, Math.floor((G.day - G.macroSeg.startDay) / SL.config.DAYS_PER_MONTH)) : 0;
      wEl.innerHTML = '<i class="tip-icon" title="每段经济周期至少持续3个月">?</i>' +
        '<span class="mn-regime ' + regimeCls + '">' + w.regimeLabel + ' · 已持续' + segMonths + '个月</span>' + w.text;
    }
    if (!mn.ind || !mn.ind.items || !mn.ind.items.length) { iEl.textContent = '--'; return; }
    /* v2.2：经验可见度——未抽中的行业只显示行业名 + "不明"（无方向与文案） */
    iEl.innerHTML = mn.ind.items.map(it =>
      it.unknown
        ? '<div class="mn-ind-item">' +
          '<span class="mn-ind-label">' + it.industryLabel + '</span>' +
          '<span class="mn-ind-dir dim">不明</span></div>'
        : '<div class="mn-ind-item">' +
          '<span class="mn-ind-label">' + it.industryLabel + '</span>' +
          '<span class="mn-ind-dir ' + (it.dir === 'good' ? 'up' : it.dir === 'bad' ? 'down' : 'dim') + '">' +
          (it.dir === 'good' ? '向好' : it.dir === 'bad' ? '走弱' : '平稳') + '</span>' +
          '<span class="mn-ind-text">' + it.text + '</span></div>'
    ).join('');
  },

  /* ---------------- 图表区 ---------------- */
  renderChart(G) {
    const s = SL.state.getStock(G, G.selectedStockId);
    if (!s) return;
    const u = SL.utils;
    this.$('chart-stock-name').textContent = s.name + '（' + s.industryLabel + '）';
    const prev = s.history.length ? s.history[s.history.length - 1].c : s.price;
    const chg = (s.price - prev) / prev;
    const pe = this.$('chart-stock-price');
    pe.textContent = s.price.toFixed(2);
    pe.className = chg >= 0 ? 'up' : 'down';
    const ce = this.$('chart-stock-chg');
    ce.textContent = u.fmtPct(chg);
    ce.className = chg >= 0 ? 'up' : 'down';

    const canvas = this.$('chart-canvas');
    if (G.chartTab === 'kline') SL.charts.drawKline(canvas, s);
    else SL.charts.drawIntraday(canvas, s);
  },

  /* ---------------- 报价栏（241px，20档盘口 + 持仓150px） ---------------- */
  renderQuote(G) {
    const s = SL.state.getStock(G, G.selectedStockId);
    if (!s) return;
    const rows = SL.market.genQuoteBook(s);
    this.$('quote-book').innerHTML = rows.map(r => {
      if (r.side === 'buy' && r.level === 1) {
        return '<div class="q-divider"></div>' + this._qRow(r);
      }
      return this._qRow(r);
    }).join('') ;
  },

  _qRow(r) {
    const cls = r.side === 'sell' ? 'down' : 'up'; // 卖价高于现价→绿? 同花顺惯例：卖红买绿？此处卖档显示上方用现价色系
    const label = (r.side === 'sell' ? '卖' : '买') + r.level;
    return '<div class="q-row"><span class="lb">' + label + '</span>' +
      '<span class="' + (r.side === 'sell' ? 'up' : 'down') + '">' + r.price.toFixed(2) + '</span>' +
      '<span class="vol">' + r.vol + '</span></div>';
  },

  /* ---------------- 持仓区（150px） ---------------- */
  renderPositions(G) {
    const u = SL.utils;
    const box = this.$('position-list');
    if (!G.positions.length) {
      box.innerHTML = '<div class="dim" style="padding:8px 0">暂无持仓</div>';
      return;
    }
    box.innerHTML = G.positions.map(p => {
      const val = SL.trade.positionValue(G, p);
      const pnl = SL.trade.positionPnl(G, p);
      const rate = SL.trade.positionPnlRate(G, p);
      const cls = pnl >= 0 ? 'up' : 'down';
      const tags = (p.dir === 1 ? '多' : '空') + (p.leverage ? '·杠杆' : ''); // v1.5：不再显示长短标签
      let mark = '';
      if (p.expired) mark = '<span class="tag-due">·到期</span>';
      else if (SL.trade.nearLiquidation(G, p)) mark = '<span class="tag-liq">·爆仓</span>';
      return '<div class="pos-item" data-id="' + p.id + '">' +
        '<div class="line1"><span>' + p.stockName + mark + '</span><span>' + u.fmtMoney2(val) + '</span></div>' +
        '<div class="line2"><span class="pos-tags">' + tags + ' 剩' + Math.max(0, p.dueDay - G.day) + '天</span>' +
        '<span class="' + cls + '">' + u.fmtSigned2(pnl) + '（' + u.fmtPct(rate) + '）</span></div></div>';
    }).join('');
    box.querySelectorAll('.pos-item').forEach(el => {
      el.onclick = () => {
        const p = G.positions.find(x => x.id === el.dataset.id);
        if (p) SL.ui.selectStock(p.stockId);
      };
    });
  },

  /* ---------------- 新闻栏（全部股票新闻同时展示，§4.3） ---------------- */
  renderNews(G) {
    const box = this.$('news-list');
    if (!G.news.length) {
      box.innerHTML = '<div class="news-item dim">本回合暂无市场资讯</div>';
      return;
    }
    box.innerHTML = G.news.map(n => {
      const stock = n.stockId ? SL.state.getStock(G, n.stockId) : null;
      let srcLabel, srcCls;
      if (n.type === 'noise') { srcLabel = '杂闻'; srcCls = 'src-noise'; }
      else if (n.type === 'clue' && n.special === 'delist') { srcLabel = '预警'; srcCls = 'src-hint'; } // v1.8 匿名退市预警（醒目）
      else if (n.type === 'clue') { srcLabel = '市场'; srcCls = 'src-noise'; }
      /* v1.2 消息链：阶段标签 + 经验疑点提示 */
      else if (n.type === 'chain') {
        srcLabel = n.stageLabel || '消息';
        srcCls = n.stage === 1 ? 'src-rumor' : n.stage === 2 ? 'src-opinion' : 'src-notice';
      }
      else if (n.type === 'hint') { srcLabel = '疑点'; srcCls = 'src-hint'; }
      else { srcLabel = SL.config.NEWS_TYPES[n.type] ? SL.config.NEWS_TYPES[n.type].label : '资讯'; srcCls = 'src-' + n.type; }
      const stk = stock ? '<span class="stk">[' + stock.name + ']</span>' : '';
      const cls = n.type === 'clue' && n.special !== 'delist' ? ' news-clue' : '';
      return '<div class="news-item' + cls + '"><span class="src ' + srcCls + '">【' + srcLabel + '】</span>' + stk + n.text + '</div>';
    }).join('');
  },

  /* ---------------- 交易栏状态（两步强制，§5.1） ---------------- */
  renderTradeBar(G) {
    /* v1.5：周期按钮已移除，交易一步完成 */
    const canTrade = SL.trade.canTrade(G);
    const stock = SL.state.getStock(G, G.selectedStockId);
    const hasPos = stock && SL.trade.hasPosition(G, stock.id);
    const levOk = SL.player.leverageUnlocked(G);

    /* 休市时给出明确原因（v1.4.1：此前按钮无声禁用，玩家误以为bug） */
    const holiday = SL.utils.isHoliday(G.day);
    const noTradeReason = holiday ? holiday.name + '休市中，无法交易（节后恢复）' : '';

    document.querySelectorAll('.act-btn').forEach(b => {
      const isLev = b.classList.contains('lev');
      let disabled = !canTrade || !stock || hasPos;
      if (isLev && !levOk) disabled = true;
      b.disabled = disabled;
      if (isLev) b.classList.toggle('locked', !levOk);
      b.title = !canTrade && noTradeReason ? noTradeReason
        : isLev && !levOk ? '资产达到100万后开通两融解锁杠杆' : (hasPos ? '该股已有持仓' : '');
    });

    const closeBtn = this.$('btn-close-pos');
    closeBtn.disabled = !canTrade || !G.positions.length;
    closeBtn.title = !canTrade && noTradeReason ? noTradeReason : (!G.positions.length ? '当前无持仓' : '');
    this.$('btn-next-turn').disabled = !!G.ended;
  }
};
