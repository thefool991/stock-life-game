/* ============================================================
 * core/trade.js — 交易系统：开仓 / 平仓 / 杠杆 / 爆仓（文档 §5）
 * ============================================================ */
window.SL = window.SL || {};

SL.trade = {
  _posSeq: 1,

  /* 操作定义（§5.1：两步操作，先选周期再选操作）
   * v1.0 用户确认仓位语义：
   *   1/3  = 总资产的1/3；剩余现金不足总资产1/3时视为全仓（买入全部剩余现金）
   *   全仓 = 买入剩余所有现金
   *   杠杆 = 买入"剩余所有现金×2"的金额，其中一半属于融资（本金=现金，借款=现金） */
  ACTIONS: {
    long_third:  { dir: 1,  size: 'third', leverage: false, label: '做多 1/3' },
    short_third: { dir: -1, size: 'third', leverage: false, label: '做空 1/3' },
    long_full:   { dir: 1,  size: 'full',  leverage: false, label: '全仓做多' },
    short_full:  { dir: -1, size: 'full',  leverage: false, label: '全仓做空' },
    long_lev:    { dir: 1,  size: 'full',  leverage: true,  label: '杠杆做多' },
    short_lev:   { dir: -1, size: 'full',  leverage: true,  label: '杠杆做空' }
  },

  /* 计算开仓本金（v1.0 语义，见 ACTIONS 注释）
   * feeRate：本仓手续费率；本金上限=现金/(1+费率)，保证"本金+手续费=全部现金"，
   * 全仓/杠杆扣款后现金恰好归零、不出现负现金 */
  _principal(G, act, feeRate) {
    const maxOut = Math.floor(G.cash / (1 + feeRate));
    if (act.size === 'third') {
      return Math.min(Math.floor(SL.state.totalAsset(G) / 3), maxOut);
    }
    return maxOut; // full / 杠杆：全部剩余现金
  },

  canTrade(G) {
    if (G.ended) return false;
    const h = SL.utils.isHoliday(G.day);
    if (!h) return true;
    /* v1.6 假期回合：月初1号="节前交易窗口"，仍可正常开平仓；
     * 窗口期操作完毕后点"下一回合"进入30天休市 */
    return SL.utils.dayToDate(G.day).day === 1;
  },

  hasPosition(G, stockId) {
    return G.positions.some(p => p.stockId === stockId);
  },

  /* 开仓前校验，返回 {ok, reason} */
  validateOpen(G, stock, actionKey, period) {
    if (!this.canTrade(G)) return { ok: false, reason: '休市中，无法交易' };
    if (!stock || stock.delisted) return { ok: false, reason: '该股票已退市' };
    const act = this.ACTIONS[actionKey];
    if (!act) return { ok: false, reason: '未知操作' };
    if (this.hasPosition(G, stock.id)) return { ok: false, reason: '每只股票最多持有1个仓位' };
    /* v1.3 用户确认：当回合平仓某只股票后，不允许立即同方向建仓（可反向） */
    if ((G.closedThisTurn || {})[stock.id + ':' + act.dir]) {
      return { ok: false, reason: '本回合已平仓该股' + (act.dir === 1 ? '做多' : '做空') + '，不能再同向建仓（可反向操作）' };
    }
    if (act.leverage && !SL.player.leverageUnlocked(G)) {
      return { ok: false, reason: '资产达到100万并开通两融后解锁杠杆功能' };
    }
    const feeRate = SL.config.FEE_RATE; // v1.5：统一费率，period 参数保留仅为存档/API兼容
    const principal = this._principal(G, act, feeRate);
    if (principal <= 0) return { ok: false, reason: '可用资金不足' };
    return { ok: true, principal };
  },

  /* 开仓预览（确认弹窗用） */
  previewOpen(G, stock, actionKey, period) {
    const act = this.ACTIONS[actionKey];
    const v = this.validateOpen(G, stock, actionKey, period);
    if (!v.ok) return v;
    const cfg = SL.config;
    const fee = v.principal * cfg.FEE_RATE;
    const info = {
      ok: true, action: act, period,
      principal: v.principal, fee,
      borrowed: act.leverage ? v.principal : 0,
      totalIn: act.leverage ? v.principal * 2 : v.principal
    };
    if (act.leverage) {
      info.liqLine = act.dir === 1
        ? '跌幅≥' + (cfg.LIQ_LONG_DROP * 100) + '% 本金归零'
        : '涨幅≥' + (cfg.LIQ_SHORT_RISE * 100) + '% 本金归零';
    }
    return info;
  },

  /* 执行开仓 */
  open(G, stock, actionKey, period) {
    const info = this.previewOpen(G, stock, actionKey, period);
    if (!info.ok) return info;
    const cfg = SL.config;
    const periodDays = cfg.PERIOD_DAYS; // v1.5：统一30天周期

    G.cash -= (info.principal + info.fee);
    const pos = {
      id: 'pos' + (this._posSeq++),
      stockId: stock.id,
      stockName: stock.name,
      actionKey,                 // v1.8：退市重仓判定需要区分 全仓多/杠杆多
      dir: info.action.dir,
      period,
      leverage: info.action.leverage,
      principal: info.principal,
      borrowed: info.borrowed,
      openPrice: stock.price,
      openDay: G.day,
      dueDay: G.day + periodDays,
      expired: false,
      fees: info.fee
    };
    G.positions.push(pos);
    G.stats.trades++;
    return { ok: true, position: pos };
  },

  /* 持仓市值（§5.3：杠杆 = max(0, 总头寸×(1+涨跌幅) - 借款)）
   * v0.9 修复：退市股按冻结价估值，不再一律归零——退市时持仓已被强制结算（turn.js），
   * 此处仅兜底旧存档遗留；方向感知：做多退市≈血本无归，做空退市=盈利 */
  positionValue(G, p) {
    const stock = SL.state.getStock(G, p.stockId);
    if (!stock) return 0;
    const chg = (stock.price - p.openPrice) / p.openPrice;
    if (!p.leverage) {
      return p.principal * (1 + p.dir * chg);
    }
    const totalPos = p.principal + p.borrowed;
    return Math.max(0, totalPos * (1 + p.dir * chg) - p.borrowed);
  },

  positionPnl(G, p) {
    return this.positionValue(G, p) - p.principal;
  },

  positionPnlRate(G, p) {
    if (p.principal <= 0) return 0;
    return this.positionPnl(G, p) / p.principal;
  },

  /* 爆仓检测（§5.3）：每日调用，返回被强平的持仓 */
  checkLiquidations(G) {
    const cfg = SL.config;
    const out = [];
    for (const p of G.positions) {
      if (!p.leverage) continue;
      const stock = SL.state.getStock(G, p.stockId);
      if (!stock || stock.delisted) continue;
      const chg = (stock.price - p.openPrice) / p.openPrice;
      const bust = p.dir === 1 ? (chg <= -cfg.LIQ_LONG_DROP) : (chg >= cfg.LIQ_SHORT_RISE);
      if (bust) out.push(p);
    }
    for (const p of out) {
      G.positions = G.positions.filter(x => x.id !== p.id);
      G.stats.liquidated++;
      SL.player.gainExp(G, SL.config.EXP_GAIN_LOSS); // 爆仓=亏损结算，经验照加
      G.liquidations.push({ stockName: p.stockName, principal: p.principal, day: G.day });
    }
    return out;
  },

  /* 是否接近爆仓线（"·爆仓"红色预警，§3.6） */
  nearLiquidation(G, p) {
    if (!p.leverage) return false;
    const cfg = SL.config;
    const stock = SL.state.getStock(G, p.stockId);
    if (!stock) return false;
    const chg = (stock.price - p.openPrice) / p.openPrice;
    const ratio = p.dir === 1 ? (-chg / cfg.LIQ_LONG_DROP) : (chg / cfg.LIQ_SHORT_RISE);
    return ratio >= cfg.LIQ_WARN_RATIO;
  },

  /* 平仓 */
  close(G, posId) {
    const p = G.positions.find(x => x.id === posId);
    if (!p) return { ok: false, reason: '持仓不存在' };
    const stock = SL.state.getStock(G, p.stockId);
    /* v0.9：退市股不再特判清零，按冻结价走正常结算管线（方向感知） */
    const cfg = SL.config;
    let value = this.positionValue(G, p);
    let pnl = value - p.principal;

    /* v0.6 收窄模型（用户确认）：经验/运气/心情加权，
     * 盈利时多赚 ×(1+f)，亏损时少亏 ×(1-f)；封顶、不翻转盈亏符号 */
    const f = SL.player.narrowFactor(G);
    pnl = pnl > 0 ? pnl * (1 + f) : pnl * (1 - f);
    value = p.principal + pnl;

    /* 经验值：结算增长，盈多亏少（用户确认） */
    SL.player.gainExp(G, pnl > 0 ? cfg.EXP_GAIN_PROFIT : cfg.EXP_GAIN_LOSS);

    const fee = value * cfg.FEE_RATE; // v1.5：统一费率（旧档 period 字段忽略）
    G.cash += Math.max(0, value - fee);
    G.positions = G.positions.filter(x => x.id !== posId);
    /* v1.3：记录本回合平仓方向，禁止当回合同向再建仓（下一回合 startTurn 清空） */
    (G.closedThisTurn || (G.closedThisTurn = {}))[p.stockId + ':' + p.dir] = true;
    return { ok: true, pnl: pnl - fee, fee, stockName: p.stockName, narrow: f };
  },

  /* 退市强制结算（v1.0 用户确认：退市=极特殊剧情事件，固定结算规则）
   *   做多（含杠杆）：这笔金额归零，pnl = -本金（融资部分随仓位灭失）
   *   做空（含杠杆）：默认盈利100%本金并自动平仓，pnl = +本金
   * 固定剧情结算：不走势价、不适用收窄公式；经验照加，手续费照收 */
  settleDelist(G, p) {
    const cfg = SL.config;
    const win = p.dir === -1;
    const value = win ? p.principal * 2 : 0;
    const fee = value * cfg.FEE_RATE; // v1.5：统一费率（旧档 period 字段忽略）
    G.cash += Math.max(0, value - fee);
    SL.player.gainExp(G, win ? cfg.EXP_GAIN_PROFIT : cfg.EXP_GAIN_LOSS);
    G.positions = G.positions.filter(x => x.id !== p.id);
    return { pnl: (value - p.principal) - fee, fee, win };
  },

  /* 最早未到期持仓的到期日（§5.2：已到期持仓不再缩短推进天数） */
  earliestDueDay(G) {
    let min = null;
    for (const p of G.positions) {
      if (p.expired) continue;
      if (min === null || p.dueDay < min) min = p.dueDay;
    }
    return min;
  },

  markExpired(G) {
    for (const p of G.positions) {
      if (!p.expired && G.day >= p.dueDay) p.expired = true;
    }
  }
};
