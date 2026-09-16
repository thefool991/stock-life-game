/* ============================================================
 * core/market.js — 股票市场：价格模型 / 黑天鹅 / 退市与IPO / 休市
 *
 * 价格模型（文档 §3.3）：股价变化 = 隐藏趋势值 + 单日噪声 + 新闻影响
 *
 * 【因子管线 · 扩展点】
 * 策划确认后续会加入宏观、微观、行业、运气、人物状态等因子。
 * 扩展方式：向 SL.market.factors push 一个函数
 *   (stock, ctx) => 日收益率贡献（小数值，如 0.002）
 * 主循环会自动叠加所有因子，无需改其他代码。
 * ctx = { G, day, isDueDay, positionOnStock }
 * ============================================================ */
window.SL = window.SL || {};

SL.market = {
  _idSeq: 1,

  /* ---- 因子管线（v0.6 区间引擎：环境定区间，日内插值） ----
   * 扩展方式不变：push (stock, ctx) => 日收益率贡献 */
  factors: [
    function driftFactor(stock) {   // 区间引擎给出的日漂移（回合初按区间采样）
      return stock.dailyDrift !== undefined ? stock.dailyDrift : stock.trend;
    },
    function noiseFactor(stock) {   // 日内残余噪声
      return SL.utils.gauss() * stock.noiseAmp * 0.5;
    }
  ],

  /* ---------------- 区间引擎（v0.6 用户确认模型） ----------------
   * 环境层（宏观/行业/个股剧情）决定表现区间；
   * 区间内按偏中段三角分布采样（用户确认）；
   * 个体层（经验/运气/心情）的收窄在结算端实现（trade.close） */

  /* 计算股票在 days 天内的表现区间 [lo, hi] */
  computeRange(G, stock, days) {
    const cfg = SL.config;
    const regime = cfg.MACRO[G.macro] || cfg.MACRO.normal;
    const sent = G.industrySent[stock.industryKey] || 0;
    /* 区间中值 = 个股趋势 + 宏观偏移(按周缩放) + 行业偏移(按10天缩放) + 剧情偏移 */
    const mid = stock.trend * days
      + regime.shift * days / 7
      + sent * cfg.INDUSTRY_SHIFT * days / 10
      + (stock.rangeShift || 0);
    /* 区间半宽 = 个股波动 × 时间放大 × 宏观波动倍率 */
    const halfW = stock.noiseAmp * 2 * Math.sqrt(days) * regime.volMult;
    return [mid - halfW, mid + halfW];
  },

  /* 区间内采样：三角分布（均值偏中段，大趋势确定性更强）
   * 收益钳制在 [-95%, +1000%]：跌破-100%会导致复利校准出现NaN */
  rollPeriodReturn(G, stock, days) {
    const range = this.computeRange(G, stock, days);
    const t = (SL.utils.rand() + SL.utils.rand()) / 2;
    const r = range[0] + (range[1] - range[0]) * t;
    return SL.utils.clamp(r, -0.95, 10);
  },

  /* ---------------- 随机段机制（v1.4 用户确认） ----------------
   * 世界经济/行业趋势均为"随机段"：段尾才掷下一段，相邻段状态不重复，
   * 切换点落在月内 10/20/30 日（对齐最小推进粒度10天）。
   * G.macroSeg = { regime, startDay, endDay }
   * G.indSeg[行业key] = { dir, sent, startDay, endDay } */

  /* 段结束日 = 起始日 + (N-1)个月 + 月内随机tick日 */
  _rollSegEnd(startDay, monthsRange) {
    const cfg = SL.config, u = SL.utils;
    const N = u.rangeInt(monthsRange[0], monthsRange[1]);
    return startDay + (N - 1) * cfg.DAYS_PER_MONTH + u.pick(cfg.SEG_TICK_DAYS);
  },

  /* 加权抽取宏观状态（排除上一段状态后归一） */
  _rollMacroRegime(exclude) {
    const cfg = SL.config, u = SL.utils;
    const entries = Object.entries(cfg.MACRO_SEG_WEIGHTS).filter(([k]) => k !== exclude);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = u.rand() * total;
    for (const [key, w] of entries) {
      roll -= w;
      if (roll <= 0) return key;
    }
    return entries[entries.length - 1][0];
  },

  rollMacroSeg(G, fromDay) {
    const prevRegime = G.macroSeg ? G.macroSeg.regime : null;
    const regime = this._rollMacroRegime(prevRegime);
    G.macroSeg = { regime, startDay: fromDay, endDay: this._rollSegEnd(fromDay, SL.config.MACRO_SEG_MONTHS) };
    G.macro = regime;
    /* v2.1：宏观状态变化时生成提示事件（开局首段不触发） */
    if (prevRegime && prevRegime !== regime) {
      G.macroChangeEvent = this._mkMacroChangeEvent(regime);
    }
    return regime;
  },

  /* 宏观切换提示事件（v2.3：四种状态文案合并为单一"隐约察觉"版本。
   * 配合世界经济15%可见机制——玩家多数时候看不到真实状态，切换提示也不再剧透方向，
   * 只保留"感觉走势不同了"的模糊信号，具体方向留给玩家从行情中自行判断） */
  _mkMacroChangeEvent(regime) {
    return {
      id: 'macro_change', type: '生活', macroChange: true,
      title: '宏观经济发生了变化',
      text: '你隐约感觉到市场的走势和之前不同了',
      choices: [{ label: '记在心上', hint: '经验 +0.2', effect: { exp: 0.2 } }]
    };
  },

  rollIndSeg(G, indKey, fromDay) {
    const cfg = SL.config, u = SL.utils;
    const prev = (G.indSeg || {})[indKey];
    /* 相邻段方向不重复（与宏观段规则一致） */
    const dirs = ['good', 'flat', 'bad'].filter(d => !prev || d !== prev.dir);
    const dir = u.pick(dirs);
    const range = cfg.IND_SEG_SENT[dir];
    const sent = +u.range(range[0], range[1]).toFixed(3);
    (G.indSeg || (G.indSeg = {}))[indKey] = {
      dir, sent, startDay: fromDay, endDay: this._rollSegEnd(fromDay, cfg.IND_SEG_MONTHS)
    };
    G.industrySent[indKey] = sent; // computeRange 读取处不变
    return dir;
  },

  /* 每回合开始调用：到期段立即重掷（lazy，段尾才掷下一段） */
  syncSegments(G) {
    if (!G.macroSeg || G.day >= G.macroSeg.endDay) this.rollMacroSeg(G, G.day);
    for (const ind of SL.data.stocks.INDUSTRIES) {
      const seg = (G.indSeg || {})[ind.key];
      if (!seg || G.day >= seg.endDay) this.rollIndSeg(G, ind.key, G.day);
    }
  },

  /* ---------------- 股票生成 ---------------- */
  genStocks() {
    const cfg = SL.config, u = SL.utils;
    const industries = u.shuffle(SL.data.stocks.INDUSTRIES).slice(0, cfg.LISTED_COUNT);
    return industries.map(ind => this._mkStock(ind, null));
  },

  /* opts.noHistory：新股无历史K线（v1.8 用户确认），K线随交易日逐日积累 */
  _mkStock(ind, excludeNames, opts) {
    const cfg = SL.config, u = SL.utils;
    let names = ind.names;
    if (excludeNames) names = names.filter(n => !excludeNames.includes(n));
    if (!names.length) return null; // v1.8：名字用尽返回null（IPO全行业随机后由调用方处理）
    const stock = {
      id: 'stk' + (this._idSeq++),
      name: u.pick(names),
      industryKey: ind.key,
      industryLabel: ind.label,
      price: +u.range(cfg.INIT_PRICE_RANGE[0], cfg.INIT_PRICE_RANGE[1]).toFixed(2),
      trend: u.range(cfg.TREND_RANGE[0], cfg.TREND_RANGE[1]),
      noiseAmp: u.range(cfg.NOISE_RANGE[0], cfg.NOISE_RANGE[1]),
      rangeShift: 0,          // 个股剧情（新闻/事件）对本回合区间的偏移（v0.6）
      dailyDrift: undefined,  // 区间引擎采样后的日漂移（v0.6）
      history: [],      // [{o,c,h,l,v}] 日K
      intraday: [],     // 当日分时点（每回合重生成）
      delisted: false,
      swanDropPending: 0 // 黑天鹅待执行跌幅
    };
    if (!(opts && opts.noHistory)) stock.history = this._genHistory(stock, cfg.HISTORY_DAYS);
    stock.intraday = this._genIntraday(stock);
    return stock;
  },

  /* ---------------- 拟真价格路径（v0.7 用户要求） ----------------
   * 真实K线三特征：趋势分段持续、波动聚集（平静/剧烈交替）、量价配合
   * 区间模型不变：环境层仍决定回合收益区间，此处只负责"把收益拟真地铺到每天" */

  /* 历史K线（文档 §3.2：开局即有完整数据）：
   * 2~4段行情（上涨段/下跌段/盘整段）+ 波动聚集 + 偶发跳空，整体缩放收尾到当前价 */
  _genHistory(stock, days) {
    const u = SL.utils;
    const returns = [];
    let vol = stock.noiseAmp;
    let remaining = days;
    while (remaining > 0) {
      const legLen = Math.min(remaining, u.rangeInt(15, 45));
      const legType = u.rand();
      const drift = legType < 0.35 ? u.range(0.002, 0.007)    // 上涨段
                  : legType < 0.70 ? u.range(-0.006, -0.001)  // 下跌段
                  : u.range(-0.001, 0.001);                   // 盘整段
      for (let i = 0; i < legLen; i++) {
        /* 波动聚集：波动率自身随机游走，夹在 0.5~2.5 倍基准之间 */
        vol = u.clamp(vol * (1 + u.gauss() * 0.15), stock.noiseAmp * 0.5, stock.noiseAmp * 2.5);
        let r = drift + u.gauss() * vol;
        if (u.chance(0.03)) r += (u.chance(0.5) ? 1 : -1) * u.range(0.02, 0.05); // 跳空
        returns.push(r);
      }
      remaining -= legLen;
    }
    /* 前向生成收盘序列，再整体缩放使最后一根收在 stock.price */
    const closes = [100];
    for (const r of returns) closes.push(closes[closes.length - 1] * (1 + r));
    const factor = stock.price / closes[closes.length - 1];
    const candles = [];
    for (let i = 0; i < days; i++) {
      const o = +(closes[i] * factor).toFixed(2);
      const c = +(closes[i + 1] * factor).toFixed(2);
      candles.push(this._mkCandle(stock, o, c, returns[i]));
    }
    return candles;
  },

  /* 回合路径：把区间采样收益 R 拟真地分摊到 n 个交易日
   * 动量 AR(1) 持续 + 波动聚集，最后校准累计收益 = R（保住区间模型语义） */
  genTurnPath(stock, n, R) {
    const u = SL.utils;
    if (n <= 0) return [];
    R = u.clamp(R, -0.95, 10); // 防御：复利校准要求 1+R > 0
    const base = Math.pow(1 + R, 1 / n) - 1; // 日均复利
    let vol = stock.noiseAmp, m = base;
    const arr = [];
    for (let i = 0; i < n; i++) {
      vol = u.clamp(vol * (1 + u.gauss() * 0.2), stock.noiseAmp * 0.4, stock.noiseAmp * 2.5);
      m = base * 0.3 + m * 0.7 + u.gauss() * vol * 0.3; // 动量惯性：走势呈段而非逐日乱跳
      arr.push(m + u.gauss() * vol);
    }
    /* 校准：累计收益精确回到 R（小幅等比修正，不破坏路径形状） */
    let act = 1;
    for (const r of arr) act *= (1 + r);
    const c = Math.pow((1 + R) / act, 1 / n);
    return arr.map(r => (1 + r) * c - 1);
  },

  /* 蜡烛解剖：影线与实体分离 + 量价配合（大波动配大量） */
  _mkCandle(stock, o, c, r) {
    const u = SL.utils, wick = stock.noiseAmp;
    const h = +(Math.max(o, c) * (1 + Math.abs(u.gauss()) * wick * 0.4)).toFixed(2);
    const l = +(Math.max(0.01, Math.min(o, c) * (1 - Math.abs(u.gauss()) * wick * 0.4))).toFixed(2);
    const volBoost = 1 + Math.min(3, Math.abs(r) / Math.max(0.001, wick));
    return { o, c, h, l, v: Math.round(u.range(2000, 30000) * volBoost) };
  },

  _genVolume() {
    return Math.round(SL.utils.range(2000, 30000));
  },

  /* 分时序列（文档 §3.5）：走到约35%位置，白色分时线。
   * 语义 = 今日盘中 session：从昨收（最后一根K线收盘价）出发游走，
   * 末端点位即当前实时价，回写 stock.price（交易/盘口/盈亏均用它） */
  _genIntraday(stock) {
    const u = SL.utils, cfg = SL.config;
    const TOTAL = 240; // 模拟全天240个点
    const N = Math.round(TOTAL * cfg.INTRADAY_PROGRESS);
    const points = [];
    const prevClose = stock.history.length ? stock.history[stock.history.length - 1].c : stock.price;
    let p = prevClose;
    for (let i = 0; i < N; i++) {
      p = p * (1 + stock.trend / 20 + u.gauss() * stock.noiseAmp / 6);
      points.push(+p.toFixed(2));
    }
    /* 实时价 = 分时末端（自然偏离昨收） */
    if (points.length) stock.price = points[points.length - 1];
    return { prevClose, points, total: TOTAL };
  },

  /* 以当前实时价为末端锚定重生成分时（v1.6.2 修复）：
   * A2定价/消息链/黑天鹅/正面天鹅/节后冲击都是"瞬间改价"，旧分时线末端仍是改价前的价格，
   * 导致"列表显示下跌、分时曲线却在上涨"的背离——改价后调用本方法保持两者一致 */
  _genIntradayAnchored(stock) {
    const u = SL.utils, cfg = SL.config;
    const TOTAL = 240;
    const N = Math.round(TOTAL * cfg.INTRADAY_PROGRESS);
    const prevClose = stock.history.length ? stock.history[stock.history.length - 1].c : stock.price;
    let p = prevClose;
    const raw = [];
    for (let i = 0; i < N; i++) {
      p = p * (1 + stock.trend / 20 + u.gauss() * stock.noiseAmp / 6);
      raw.push(p);
    }
    /* 整体缩放，使分时末端=当前实时价（不改 stock.price） */
    const end = raw.length ? raw[raw.length - 1] : prevClose;
    const k = end > 0 ? stock.price / end : 1;
    const points = raw.map(x => +(x * k).toFixed(2));
    return { prevClose, points, total: TOTAL };
  },

  /* ---------------- 回合级推进 ----------------
   * days: 推进天数；hooks.onDay(dayNum) 每日回调（爆仓检测等），
   *   返回 false 立即中断推进（用于总资产≤0即时终局）
   * 返回 { crossedHoliday, daysDone } */
  advanceDays(G, days, hooks) {
    const u = SL.utils, cfg = SL.config;
    let crossedHoliday = false, daysDone = 0, td = 0; // td = 已过的交易日数（路径消费游标）
    for (let i = 0; i < days; i++) {
      const curDay = G.day + i;
      const holiday = u.isHoliday(curDay);
      if (holiday) { crossedHoliday = holiday; daysDone++; continue; } // 休市：价格不动（§2.4）

      for (const s of G.stocks) {
        if (s.delisted) continue;
        /* v0.7：优先消费拟真回合路径；无路径时退回因子管线 */
        let r;
        if (s.turnPath && s.turnPath[td] !== undefined) {
          r = s.turnPath[td];
        } else {
          r = 0;
          const ctx = { G, day: curDay };
          for (const f of this.factors) r += f(s, ctx);
        }

        /* 黑天鹅执行（单日暴跌） */
        if (s.swanDropPending) { r += s.swanDropPending; s.swanDropPending = 0; }

        this._applyDay(s, r);

        /* 面值退市检测（v2.1.2）：连续N日收盘低于阈值 → 强制退市 */
        if (s.price < cfg.PRICE_FLOOR_DELIST) {
          s._floorDays = (s._floorDays || 0) + 1;
          if (s._floorDays >= cfg.PRICE_FLOOR_DAYS && !G._floorDelistQueued) {
            /* 本回合标记强制退市（走匿名线索→摘牌流程），下一交易日由specialEvents触发 */
            s._forceFloorDelist = true;
          }
        } else {
          s._floorDays = 0; // 回到阈值上方则重置计数
        }
      }

      /* 触发面值强制退市（每交易日最多1只，避免连锁） */
      const floorVictim = G.stocks.find(x => !x.delisted && x._forceFloorDelist);
      if (floorVictim) {
        floorVictim._forceFloorDelist = false;
        SL.specialEvents.triggerDelist(G, floorVictim.id, 'floor');
      }

      daysDone++;
      td++;
      if (hooks && hooks.onDay && hooks.onDay(G.day + daysDone) === false) break;
    }

    /* 推进后刷新分时（新的一天），并消费掉回合路径 */
    for (const s of G.stocks) if (!s.delisted) { s.intraday = this._genIntraday(s); s.turnPath = null; }
    return { crossedHoliday, daysDone };
  },

  _applyDay(stock, r) {
    /* 开盘价沿用当前实时价（分时末端），保证价格序列连续 */
    const prevClose = stock.price;
    let np = +(prevClose * (1 + r)).toFixed(2);
    if (np < 0.01) np = 0.01;
    stock.price = np;
    /* 蜡烛解剖 + 量价配合（v0.7） */
    stock.history.push(this._mkCandle(stock, prevClose, np, r));
    if (stock.history.length > 400) stock.history.shift(); // 控制长度
  },

  /* 黑天鹅：v1.8 起统一由 specialEvents.js 调度（预定→机构朋友预警→爆发），
   * 原 rollBlackswan/executeBlackswan 线索管线已删除 */

  /* 新股IPO：v1.8 起由 specialEvents.js 调度（50万门槛/预告事件/同行业跟随） */

  /* ---------------- 盘口报价（§3.6） ---------------- */
  genQuoteBook(stock) {
    const u = SL.utils, cfg = SL.config;
    const rows = [];
    const tick = Math.max(0.01, +(stock.price * 0.001).toFixed(2));
    for (let i = cfg.QUOTE_LEVELS; i >= 1; i--) {
      rows.push({ side: 'sell', level: i, price: +(stock.price + tick * i * u.range(0.8, 1.2)).toFixed(2), vol: u.rangeInt(10, 2000) });
    }
    for (let i = 1; i <= cfg.QUOTE_LEVELS; i++) {
      rows.push({ side: 'buy', level: i, price: +(stock.price - tick * i * u.range(0.8, 1.2)).toFixed(2), vol: u.rangeInt(10, 2000) });
    }
    return rows;
  }
};
