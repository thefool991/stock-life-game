/* ============================================================
 * core/state.js — 全局游戏状态 G 与新局构建
 * G 是唯一状态源；存档 = 序列化 G
 * ============================================================ */
window.SL = window.SL || {};

SL.state = {
  G: null,

  newGame() {
    const cfg = SL.config, u = SL.utils;
    u.setSeed(Date.now() % 2147483647);

    /* 失败传承（v0.6）：上一局失败结局积累的经验加成 */
    const meta = SL.storage.loadMeta();
    const legacyExp = meta && meta.legacyExp ? meta.legacyExp : 0;

    const G = {
      version: 1,
      day: 0,                      // 游戏日（从0起）
      turn: 0,                     // 回合计数
      cash: cfg.START_CASH,
      stocks: SL.market.genStocks(),
      selectedStockId: null,
      positions: [],               // 持仓数组
      news: [],                    // 本回合新闻
      player: {
        psy: cfg.START_PSYCHOLOGY,
        exp: u.clamp(cfg.START_EXP + legacyExp, cfg.EXP_MIN, cfg.EXP_MAX), // 经验值（含传承）
        salary: cfg.SALARY_START,    // 月薪（v0.6）
        relations: { friend: cfg.START_REL_FRIEND, love: cfg.START_REL_LOVE, family: cfg.START_REL_FAMILY }, // v2.0 分级初始
        luck: cfg.START_LUCK,      // v1.7：初始固定0.2（用户确认），特殊事件可提升
        bills: cfg.BILLS_INIT.map(b => ({ ...b }))
      },
      highestTotalAsset: cfg.START_CASH, // 历史最高总资产（v2.0：等级只升不降/事件库按最高等级解锁）
      salaryOffset: 0,                   // 事件对月薪的永久增减（v2.0.2：档位基准+事件偏移，降薪不被身份同步重置）
      leverageNotified: false,           // 杠杆解锁事件是否已弹出（v2.0；资产跌破门槛后重置，再次达标可重开）
      leverageOptedIn: false,            // 玩家是否已在解锁事件中开通两融（v2.0：杠杆生效的前提）
      legacyExp,                   // 本局带入了多少传承经验（结算展示用）
      macro: cfg.MACRO_START,        // 宏观市场状态（当前段状态，syncSegments 维护）
      industrySent: {},              // 行业景气值（当前段值，syncSegments 维护）
      macroSeg: null,                // 世界经济当前段 { regime, startDay, endDay }（v1.4）
      indSeg: {},                    // 行业趋势当前段 { key: { dir, sent, startDay, endDay } }（v1.4）
      macroNews: null,               // 宏观情报缓存（v0.8，startTurn 按需生成/轮换）
      pendingClue: null,           // ⚠️ v1.8 已废弃（黑天鹅公开线索取消），保留字段仅为旧档兼容
      pendingSwan: null,           // { stockId, dir, turnsLeft, tipped } 在途黑天鹅（v1.8：预定→爆发）
      specialPending: null,        // { type, stockId, turnsLeft } 特殊剧情事件在途（v1.0：退市/IPO）
      chains: [],                  // 消息链在途（v1.2：传闻→进展→证实/证伪）
      nextIpoDay: null,
      history: [{ day: 0, total: cfg.START_CASH }], // 资产曲线
      turnStartTotal: cfg.START_CASH,
      liquidations: [],            // 本回合爆仓记录（结算展示用）
      swanRecords: [],             // 本回合黑天鹅/正面天鹅对持仓的影响（v1.6.3 结算条目化）
      stats: { trades: 0, liquidated: 0 },
      ended: false,
      ending: null
    };

    G.selectedStockId = G.stocks[0].id;
    G.nextIpoDay = this._rollNextIpoDay(G.day);
    this.G = G;
    return G;
  },

  _rollNextIpoDay(fromDay) {
    const cfg = SL.config, u = SL.utils;
    const months = u.rangeInt(cfg.IPO_INTERVAL_MONTHS[0], cfg.IPO_INTERVAL_MONTHS[1]);
    return fromDay + months * cfg.DAYS_PER_MONTH;
  },

  /* 总资产 = 现金 + 持仓市值（杠杆仓按 max(0, 总头寸×(1+涨跌幅)-借款)，文档 §5.3） */
  totalAsset(G) {
    let total = G.cash;
    for (const p of G.positions) total += SL.trade.positionValue(G, p);
    return total;
  },

  targetProgress(G) {
    return this.totalAsset(G) / SL.config.TARGET_ASSET;
  },

  getStock(G, id) {
    return G.stocks.find(s => s.id === id) || null;
  },

  activeStocks(G) {
    return G.stocks.filter(s => !s.delisted);
  }
};
