/* ============================================================
 * ui/modals.js — 弹窗：交易确认 / 回合结算 / 剧情事件 / 结局（文档 §5.1/§8/§11）
 * ============================================================ */
window.SL = window.SL || {};
SL.ui = SL.ui || {};

SL.ui.modals = {
  _root() { return document.getElementById('modal-root'); },

  _show(html) {
    this._root().innerHTML = '<div class="modal-mask"><div class="modal">' + html + '</div></div>';
  },
  close() { this._root().innerHTML = ''; },

  _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },

  /* ---------------- 开仓确认（§5.1；v1.5 统一30天周期，不再显示长短标签） ---------------- */
  confirmOpen(info, stock, period, onOk) {
    const u = SL.utils;
    let html = '<h2>交易确认</h2><div class="mt-body">' +
      '<p>你确定要<strong>' + info.action.label + '</strong>【' + this._esc(stock.name) + '】吗？（30天周期）</p>' +
      '<p>当前价格：<b>' + stock.price.toFixed(2) + '</b></p>' +
      '<p>预计投入：<b>' + u.fmtMoney(info.principal) + '</b> 元（手续费 ' + u.fmtMoney(info.fee) + '）</p>';
    if (info.action.leverage) {
      html += '<p>融资借款：<b>' + u.fmtMoney(info.borrowed) + '</b> 元，合计投入 <b class="up">' +
        u.fmtMoney(info.totalIn) + '</b> 元</p>' +
        '<p class="up">⚠ 爆仓线：' + info.liqLine + '</p>';
    }
    html += '</div><div class="mt-actions">' +
      '<button class="mt-btn" id="m-cancel">取消</button>' +
      '<button class="mt-btn primary" id="m-ok">确认</button></div>';
    this._show(html);
    document.getElementById('m-cancel').onclick = () => this.close();
    document.getElementById('m-ok').onclick = () => { this.close(); onOk(); };
  },

  /* ---------------- 平仓选择 ---------------- */
  pickClose(G, onPick) {
    const u = SL.utils;
    const rows = G.positions.map(p => {
      const pnl = SL.trade.positionPnl(G, p);
      const cls = pnl >= 0 ? 'up' : 'down';
      return '<button class="ev-choice" data-id="' + p.id + '">' + this._esc(p.stockName) +
        ' <span class="hint">（' + (p.dir === 1 ? '多' : '空') +
        (p.leverage ? '·杠杆' : '') + (p.expired ? '·已到期' : '') + '）</span>' +
        ' <span class="' + cls + '" style="float:right">' + u.fmtSigned(pnl) + '</span></button>';
    }).join('');
    this._show('<h2>选择要平仓的持仓</h2><div class="mt-body">' + rows +
      '</div><div class="mt-actions"><button class="mt-btn" id="m-cancel">取消</button></div>');
    document.getElementById('m-cancel').onclick = () => this.close();
    this._root().querySelectorAll('.ev-choice').forEach(el => {
      el.onclick = () => { this.close(); onPick(el.dataset.id); };
    });
  },

  /* ---------------- 通用提示（爆仓等） ---------------- */
  alert(title, bodyHtml, onOk, danger) {
    this._show('<h2>' + title + '</h2><div class="mt-body">' + bodyHtml + '</div>' +
      '<div class="mt-actions"><button class="mt-btn ' + (danger ? 'danger' : 'primary') + '" id="m-ok">知道了</button></div>');
    document.getElementById('m-ok').onclick = () => { this.close(); if (onOk) onOk(); };
  },

  /* ---------------- 开局剧情（v2.1.8 用户确认）：仅首次进入/读档时弹出，重开不弹 ---------------- */
  intro(onStart) {
    /* 文案用回用户原文；弹窗高度约2.5倍（intro-modal），行距加宽，"8年，1000万"1.5倍加粗 */
    const html = '<h2 style="text-align:center">股市人生</h2>' +
      '<div class="mt-body intro-body">' +
      '<p>刚过完了生日，转眼已经是27岁</p>' +
      '<p>离家漂泊这些年，没混出什么名堂，棱角却被打磨干净了</p>' +
      '<p>虽说日子还算过得去，兜里也有些积蓄，但还是觉得前路茫茫</p>' +
      '<p>嘴上说着平淡是真，可午夜梦回，胸中仍有余温</p>' +
      '<p>某天瞥见同事花花绿绿的屏幕，他说这叫"投资"</p>' +
      '<p>怎么开始的你已经忘了，只记得心里开始多了一个目标</p>' +
      '<p class="intro-goal">8年，1000万</p>' +
      '</div>' +
      '<div class="mt-actions" style="justify-content:center"><button class="mt-btn primary" id="m-ok" style="min-width:140px">开始</button></div>';
    this._show(html);
    /* 加大弹窗：高度约2.5倍（长度/max-width不变） */
    const modal = this._root().querySelector('.modal');
    if (modal) modal.classList.add('intro-modal');
    document.getElementById('m-ok').onclick = () => {
      if (SL.audio && SL.audio.click) SL.audio.click(); // 鼠标点击声（v2.1.8 用户特别叮嘱）
      this.close();
      if (onStart) onStart();
    };
  },

  /* ---------------- 回合结算（§11：交易损益 + 月度收支 + 持仓概览 + 资产曲线） ----------------
   * v2.0.6（方案B）：交易损益(pnl)与月度收支(livingNet)彻底分开两条线展示，
   * 避免空仓时"工资-账单净额被误读为市场波动盈亏" */
  settlement(G, result, onNext) {
    const u = SL.utils;
    const cls = result.pnl >= 0 ? 'up' : 'down';
    let html = '<h2>回合结算 · 推进' + result.days + '天</h2>' +
      '<div class="settle-banner ' + cls + '">本回合交易损益 ' + u.fmtSigned(result.pnl) + ' 元（' + u.fmtPct(result.pnlRate) + '）</div>';
    /* 月度收支单列（v2.0.6）：工资/账单净额，与交易损益分开 */
    if (result.monthsCrossed > 0) {
      const ln = result.livingNet !== undefined ? result.livingNet : (result.salaryPaid - result.billsDeducted);
      const lc = ln >= 0 ? 'up' : 'down';
      html += '<div class="settle-pos dim">月度收支：工资 <span class="up">+' + u.fmtMoney(result.salaryPaid) + '</span>' +
        '，账单 -' + u.fmtMoney(result.billsDeducted) + '，净额 <span class="' + lc + '">' + u.fmtSigned(ln) + '</span>（与交易损益分开）</div>';
    }
    html += '<div class="mt-body">';

    if (result.liquidations.length) {
      for (const l of result.liquidations) {
        /* v0.9：退市强平显示实际盈亏（做空退市可为盈利），爆仓仍是损失本金 */
        if (l.delisted && l.pnl !== undefined) {
          const lc = l.pnl >= 0 ? 'up' : 'down';
          html += '<div class="settle-pos ' + lc + '">📛 ' + this._esc(l.stockName) + ' 退市强平，结算盈亏 ' +
            u.fmtSigned(l.pnl) + ' 元（本金 ' + u.fmtMoney(l.principal) + '）</div>';
        } else {
          html += '<div class="settle-pos up">💥 ' + this._esc(l.stockName) + ' 触发爆仓，损失本金 ' +
            u.fmtMoney(l.principal) + ' 元</div>';
        }
      }
    }

    /* v1.6.3：黑天鹅/正面天鹅对持仓的瞬时影响（条目化展示） */
    if (result.swanRecords && result.swanRecords.length) {
      for (const r of result.swanRecords) {
        const dc = r.delta >= 0 ? 'up' : 'down';
        const dirLabel = r.dir === 1 ? '多单' : '空单';
        const pct = Math.abs(r.drop * 100).toFixed(0);
        const head = r.kind === 'surge'
          ? '🚀 ' + this._esc(r.stockName) + ' 正面黑天鹅 +' + pct + '%'
          : '🦢 ' + this._esc(r.stockName) + ' 黑天鹅 -' + pct + '%' + (r.saved ? '（运气免死）' : '');
        html += '<div class="settle-pos ' + dc + '">' + head + '，你的' + dirLabel + '瞬时盈亏 ' +
          u.fmtSigned(r.delta) + ' 元</div>';
      }
    }

    /* v1.6：节后冲击复盘（v2.0.6：空仓时明确标注"未受影响"，避免误读） */
    if (result.holidayShock && result.holidayShock.news) {
      const noPos = G.positions.length === 0;
      html += '<div class="settle-pos' + (noPos ? ' dim' : '') + '">' + this._esc(result.holidayShock.news.text) +
        (noPos ? '（你无持仓，未受影响）' : '') + '</div>';
    }

    if (result.expired.length) {
      for (const p of result.expired) {
        const pnl = SL.trade.positionPnl(G, p);
        const c2 = pnl >= 0 ? 'up' : 'down';
        html += '<div class="settle-pos">' + this._esc(p.stockName) + ' 已到期，当前盈亏 ' +
          '<span class="' + c2 + '">' + u.fmtSigned(pnl) + '</span>（请手动平仓）</div>';
      }
    } else if (!result.liquidations.length) {
      html += '<div class="settle-pos dim">本回合无到期持仓，市场平稳运行</div>';
    }

    if (result.crossedHoliday) html += '<div class="settle-pos dim">期间经历' + result.crossedHoliday.name + '休市，持仓过节存在跳空风险</div>';
    if (result.ipoStock) html += '<div class="settle-pos">📢 新股上市：' + this._esc(result.ipoStock.name) + '（' + result.ipoStock.industryLabel + '）</div>';
    if (result.overdueExpLoss > 0) html += '<div class="settle-pos tag-due">扛单惩罚：经验值 -' + result.overdueExpLoss.toFixed(1) + '（到期持仓请尽快处理）</div>';

    /* v2.0.4：当前持仓浮盈概览——不看持仓面板也能知道上回合各仓位变化 */
    if (G.positions.length) {
      html += '<div class="settle-sec">当前持仓</div>';
      for (const p of G.positions) {
        const pnl = SL.trade.positionPnl(G, p);
        const pc = pnl >= 0 ? 'up' : 'down';
        const dirLabel = p.dir === 1 ? '多' : '空';
        const lev = p.actionKey && p.actionKey.includes('lev') ? '·杠杆' : '';
        const due = p.expired ? ' <span class="tag-due">已到期</span>' : '';
        html += '<div class="settle-pos">· ' + this._esc(p.stockName) + '（' + dirLabel + lev + '）' +
          '<span class="' + pc + '">' + u.fmtSigned(pnl) + '</span>' + due + '</div>';
      }
    }

    html += '</div><canvas id="asset-canvas"></canvas>' +
      '<div class="mt-actions"><button class="mt-btn primary" id="m-ok">' +
      (result.event ? '继续（查看事件）' : '继续') + '</button></div>';
    this._show(html);
    /* v2.1.6：结算弹出时按盈亏播放提示音（盈利=金币撞击声/亏损=坏事提示音） */
    if (SL.audio && SL.audio.settle) SL.audio.settle(result.pnl);
    SL.charts.drawAssetCurve(document.getElementById('asset-canvas'), G.history);
    document.getElementById('m-ok').onclick = () => { this.close(); onNext(); };
  },

  /* ---------------- 剧情事件（§8；v1.6 支持门槛选项） ---------------- */
  event(ev, G, onChoice) {
    let html = '<h2>📅 ' + this._esc(ev.title) + ' <span class="dim" style="font-size:12px">（' + this._esc(ev.type) + '）</span></h2>' +
      '<div class="mt-body"><p>' + this._esc(ev.text) + '</p>';
    /* v1.6：选项门槛（require），不满足=灰色可见不可点+原因 */
    ev.choices.forEach((c, i) => {
      const req = this._reqState(G, c);
      const cls = req.ok ? 'ev-choice' : 'ev-choice locked';
      const hint = req.ok ? (c.hint || '') : (c.hint ? c.hint + '｜' : '') + '🔒 ' + req.reason;
      html += '<button class="' + cls + '" data-i="' + i + '"' + (req.ok ? '' : ' disabled') + '>' +
        this._esc(c.label) + (hint ? '<div class="hint">' + this._esc(hint) + '</div>' : '') + '</button>';
    });
    html += '</div>';
    this._show(html);
    SL.audio.event();
    this._root().querySelectorAll('.ev-choice:not(.locked)').forEach(el => {
      el.onclick = () => { this.close(); onChoice(ev.choices[+el.dataset.i]); };
    });
  },

  /* 选项门槛检查（v1.6）：rel=关系值下限，cash=现金下限
   * v1.6.1：隐性现金门槛——效果含负现金（含随机分支最坏情况）时，现金不足不可选 */
  _reqState(G, c) {
    const reasons = [];
    const REL_LABEL = { friend: '友情', love: '爱情', family: '亲情' };
    if (c.require && c.require.rel) {
      for (const k of Object.keys(c.require.rel)) {
        if ((G.player.relations[k] || 0) < c.require.rel[k]) {
          reasons.push((REL_LABEL[k] || k) + '需≥' + c.require.rel[k]);
        }
      }
    }
    /* 显性门槛与隐性成本（含随机分支）取较大者——"钱不够就选不了" */
    let need = (c.require && c.require.cash) || 0;
    if (c.effect) {
      if (c.effect.cash < 0) need = Math.max(need, -c.effect.cash);
      if (c.effect.random) {
        for (const b of c.effect.random) {
          if (b.effect && b.effect.cash < 0) need = Math.max(need, -b.effect.cash);
        }
      }
    }
    /* 比例成本（v2.0 运气库）：require.cashRatio=需有当前现金×该比例的支付能力 */
    const ratio = (c.require && c.require.cashRatio) || (c.effect && c.effect.cashRatio < 0 ? -c.effect.cashRatio : 0);
    if (ratio > 0) need = Math.max(need, Math.ceil(G.cash * ratio));
    if (need > 0 && G.cash < need) reasons.push('现金需≥' + SL.utils.fmtMoney(need));
    return { ok: !reasons.length, reason: reasons.join('、') };
  },

  /* 节前预告（v1.6）：进入假期回合时弹出，列出将过节的持仓 */
  holidayWarn(G, holiday) {
    const posHtml = G.positions.length
      ? '<p>以下持仓将过节：</p>' + G.positions.map(p =>
          '<p style="margin:2px 0">· ' + this._esc(p.stockName) + '（' + (p.dir === 1 ? '多' : '空') + '）</p>').join('')
      : '<p class="dim">当前无持仓。</p>';
    this._show('<h2>🏖 ' + this._esc(holiday.name) + '休市预告</h2><div class="mt-body">' +
      '<p>即将进入' + this._esc(holiday.name) + '休市（30天），节后市场可能出现大幅波动，请做好资金规划。</p>' +
      '<p class="dim">本月1日为节前最后交易窗口，仍可正常开仓/平仓。</p>' + posHtml +
      '</div><div class="mt-actions"><button class="mt-btn primary" id="m-ok">知道了</button></div>');
    document.getElementById('m-ok').onclick = () => this.close();
  },

  /* ---------------- 结局结算（§11） ---------------- */
  ending(G, ending, onRestart) {
    const u = SL.utils;
    const kindColor = ending.kind === 'rich' ? 'up' : ending.kind === 'bankrupt' ? 'down' : 'dim';
    const relTxt = r => r >= SL.config.RELATION_HIGH ? '<span class="up">高</span>' : '<span class="down">低</span>';
    const html = '<h2 style="text-align:center">' + ending.kindLabel + '</h2>' +
      '<div class="ending-title ' + kindColor + '">「' + ending.title + '」</div>' +
      '<div class="ending-sub">' + u.ageAt(G.day).toFixed(1) + '岁 · 共经历 ' + ending.turns + ' 回合</div>' +
      '<div class="ending-stats">' +
      '<div>最终资产<b>' + u.fmtMoneyWan(ending.total) + '</b></div>' +
      '<div>友情<b>' + Math.round(ending.relations.friend) + '</b></div>' +
      '<div>爱情<b>' + Math.round(ending.relations.love) + '</b></div>' +
      '<div>亲情<b>' + Math.round(ending.relations.family) + '</b></div>' +
      '</div>' +
      '<div class="ending-sub">交易 ' + ending.stats.trades + ' 次 · 爆仓 ' + ending.stats.liquidated + ' 次 · 关系均值 ' + ending.relMean + '</div>' +
      (ending.kind !== 'rich'
        ? '<div class="ending-sub">📜 爆仓只留经验：传承经验 <b class="up">+' + ending.legacy + '</b>，下局初始经验 ' +
          (Math.min(100, SL.config.START_EXP + ending.legacy)) + '</div>'
        : '') +
      '<canvas id="asset-canvas"></canvas>' +
      '<div class="mt-actions" style="justify-content:center">' +
      '<button class="mt-btn primary" id="m-restart">重新开始</button></div>';
    this._show(html);
    SL.charts.drawAssetCurve(document.getElementById('asset-canvas'), G.history);
    document.getElementById('m-restart').onclick = () => { this.close(); onRestart(); };
  }
};
