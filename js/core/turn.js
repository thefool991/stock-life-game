/* ============================================================
 * core/turn.js — 回合编排（文档 §1.2 核心循环）
 * 看盘/新闻 → 决策 → 时间推进 → 到期标记 → 回合盈亏
 *   → 月费静默扣除 → 剧情事件 → 下一回合
 * ============================================================ */
window.SL = window.SL || {};

SL.turn = {
  /* ---------------- 回合开始：黑天鹅进程 + 新闻生成 ---------------- */
  startTurn(G) {
    const u = SL.utils;
    G.turn++;
    G.turnStartTotal = SL.state.totalAsset(G);
    G.liquidations = [];
    G.swanRecords = [];   // v1.6.3：清空本回合天鹅影响记录
    G.closedThisTurn = {}; // v1.3：清空"本回合平仓方向"记录（平仓后禁同向建仓）

    /* ---- 特殊事件调度（v1.8：退市/IPO/黑天鹅统一管线，含黑天鹅预定与爆发） ---- */
    const specialNews = SL.specialEvents.process(G);

    /* ---- 随机段检测（v1.4：段尾才掷下一段，到期段立即切换） ---- */
    SL.market.syncSegments(G);

    /* ---- 宏观情报轮换（v0.8：世界经济3个月/轮，行业趋势每月/轮） ---- */
    this._refreshMacroNews(G);

    /* ---- 生成本回合新闻（§4） ---- */
    const periodDays = SL.config.PERIOD_DAYS; // v1.5：统一30天周期
    const expectedDays = this._calcDays(G, periodDays);
    const active = SL.state.activeStocks(G);
    const dueStocks = G.positions
      .filter(p => !p.expired && p.dueDay <= G.day + expectedDays)
      .map(p => ({ stock: SL.state.getStock(G, p.stockId), period: p.period }))
      .filter(d => d.stock && !d.stock.delisted);

    /* 区间偏移先清零，再走消息链（v1.2：链的"剩余40%"与一次性新闻叠加写入） */
    for (const s of active) s.rangeShift = 0;

    /* ---- 消息链（v1.2：传闻→进展→证实/证伪，A2定价） ---- */
    const chainNews = SL.newsChains.process(G);
    const chainStockIds = new Set((G.chains || []).map(c => c.stockId));

    const news = SL.content.generateNews({ stocks: active, dueStocks, G, chainStockIds });
    if (specialNews.length) news.unshift(...specialNews); // 特殊事件公告置顶（含黑天鹅爆发）
    if (chainNews.length) news.unshift(...chainNews);     // 消息链阶段新闻置顶
    if (G.afterHolidayNews) { news.unshift(G.afterHolidayNews); G.afterHolidayNews = null; } // v1.6 节后复盘公告

    /* 一次性新闻影响写入股票（v1.4.1：A2定价推广到全部个股新闻，与消息链一致——
     * 发布瞬间完成60%（直接改价，玩家看到消息时价格已反应大半），剩余40%随本回合区间消化。
     * 修复：此前全部延后到回合推进，出现"利空已出、价格未动"的时序失真） */
    for (const n of news) {
      if (n.stockId && n.impactPct) {
        const s = SL.state.getStock(G, n.stockId);
        if (s) {
          const instant = n.impactPct * SL.config.CHAIN_INSTANT;
          s.price = Math.max(0.01, +(s.price * (1 + instant)).toFixed(2));
          s.rangeShift += n.impactPct - instant;
        }
      }
    }

    /* v1.6.2：本回合各类瞬间定价（A2/消息链/黑天鹅/正面天鹅）后，
     * 分时线统一以实时价为末端锚定重生成——修复"列表下跌、分时上涨"的背离 */
    for (const s of active) {
      const pts = s.intraday && s.intraday.points;
      const end = pts && pts.length ? pts[pts.length - 1] : null;
      if (end === null || Math.abs(end - s.price) > 1e-9) {
        s.intraday = SL.market._genIntradayAnchored(s);
      }
    }
    G.news = news;
  },

  /* 黑天鹅爆发：v1.8 起由 specialEvents._detonateSwan 统一执行
   *（预定→机构朋友预警→爆发；原线索管线和本方法已删除） */

  /* ---------------- 回合推进天数（§2.2 核心规则） ---------------- */
  _calcDays(G, periodDays) {
    const earliest = SL.trade.earliestDueDay(G);
    if (earliest !== null && earliest > G.day) {
      return Math.min(earliest - G.day, periodDays);
    }
    return periodDays;
  },

  /* ---------------- 推进一回合（"下一回合"按钮） ---------------- */
  advance(G, period) {
    if (G.ended) return null;
    const cfg = SL.config, u = SL.utils;
    const periodDays = cfg.PERIOD_DAYS; // v1.5：统一30天周期（参数保留仅为API兼容）
    const days = this._calcDays(G, periodDays);

    /* 记录推进前已到期（扛单中）的持仓：到期当回合不扣经验，
     * 从下一回合仍扛着才开始扣（用户确认时机） */
    const preOverdueIds = new Set(G.positions.filter(p => p.expired).map(p => p.id));

    /* v2.0.5：预存天鹅股平仓方向——若玩家本回合内平仓了天鹅目标股，
     * 无持仓事件文案据此区分"幸好/可惜"（1=平多单 / -1=平空单） */
    if (G.pendingSwan) {
      const sp = G.positions.find(p => p.stockId === G.pendingSwan.stockId);
      G.swanClosedDir = sp ? sp.dir : 0;
    } else {
      G.swanClosedDir = 0;
    }
    G.swanEvent = null; // 清空上回合天鹅事件

    /* 0. 区间引擎（v0.6/v0.7）：区间采样回合收益 → 拟真路径分摊
     * 路径按"交易日"生成（休市日不交易不消耗路径）
     * v1.4：行业景气不再每回合游走，改随机段（startTurn 中 syncSegments）
     * v1.6：假期回合全程休市（tradingDays=0），跳过路径生成，价格不动 */
    let tradingDays = 0;
    for (let i = 0; i < days; i++) if (!u.isHoliday(G.day + i)) tradingDays++;
    if (tradingDays > 0) {
      for (const s of SL.state.activeStocks(G)) {
        const R = SL.market.rollPeriodReturn(G, s, tradingDays);
        s.turnPath = SL.market.genTurnPath(s, tradingDays, R);
      }
    }

    /* 1. 时间推进（含休市跳过、跳空、黑天鹅），每日检测爆仓；
     *    总资产≤0 立即中断推进（用户确认：直接结束游戏）
     * v2.0.5：黑天鹅爆发挪到推进中——到点后随机挑一个交易日爆发，
     *    盈亏即时作用于当时持仓，结算弹窗的事件化描述见 G.swanEvent */
    let swanBurstDay = null;
    if (G.pendingSwan && G.pendingSwan.turnsLeft <= 0 && tradingDays > 0) {
      swanBurstDay = u.rangeInt(1, tradingDays); // 本回合随机交易日爆发
    }
    let dayCounter = 0;
    const { crossedHoliday, daysDone } = SL.market.advanceDays(G, days, {
      onDay: () => {
        dayCounter++;
        SL.trade.checkLiquidations(G);
        /* 黑天鹅：推进到预定随机日时爆发（此时持仓状态=当时的真实持仓） */
        if (swanBurstDay !== null && dayCounter === swanBurstDay && G.pendingSwan) {
          SL.specialEvents._detonateSwan(G, G.pendingSwan);
          swanBurstDay = null;
        }
        return SL.state.totalAsset(G) > 0;
      }
    });
    /* 推进被打断/假期导致未爆发：保底在回合末爆发（持有即有影响） */
    if (swanBurstDay !== null && G.pendingSwan) {
      SL.specialEvents._detonateSwan(G, G.pendingSwan);
    }
    G.day += daysDone;
    SL.trade.markExpired(G);

    /* v2.1：宏观段尾检测（时间推进跨段时切换状态+生成提示事件）——
     * 宏观段lazy检测本在startTurn，但那样切换事件会延迟一回合才弹出；
     * 在advance推进后立即检测，让"进入牛/熊/危机"提示当回合弹出 */
    G.macroChangeEvent = null;
    if (!G.macroSeg || G.day >= G.macroSeg.endDay) {
      SL.market.rollMacroSeg(G, G.day);
    }

    /* 1.5 扛单扣经验：仅统计推进前已到期、本回合仍扛着的持仓，
     * 第N个扛单回合扣 0.8×N；本回合刚到期的持仓不扣
     * v1.3 用户确认：仅"到期且亏损"的持仓触发惩罚，盈利持有不扣也不累计次数
     * v1.6 用户确认：假期回合市场不开门，扛单惩罚暂停 */
    const holidayTurn = !!crossedHoliday && tradingDays === 0;
    let overdueExpLoss = 0;
    if (!holidayTurn) {
      for (const p of G.positions) {
        if (p.expired && preOverdueIds.has(p.id)) {
          if (SL.trade.positionPnl(G, p) >= 0) continue; // 盈利扛单不惩罚（v1.3）
          p.overdueTurns = (p.overdueTurns || 0) + 1;
          const loss = SL.config.EXP_OVERDUE_BASE * p.overdueTurns;
          SL.player.gainExp(G, -loss);
          overdueExpLoss += loss;
        }
      }
    }

    /* 1.6 节后冲击（v1.6 用户确认）：长假结束强制掷 好/坏/中性 × 单行业5%/全行业7%，
     * 100%瞬间定价（节中信息已发酵完毕，不留消化期），持仓过节部分通过价格即时结算 */
    let holidayShock = null;
    if (crossedHoliday) {
      holidayShock = this._rollHolidayShock(G, crossedHoliday);
      G.afterHolidayNews = holidayShock && holidayShock.news ? holidayShock.news : null;
    }

    /* 2. 月度结算（静默）：发工资（v0.6）- 扣账单
     * v1.4：宏观不再月度转移，改随机段（下一回合 startTurn 的 syncSegments 检测段尾） */
    const monthsCrossed = this._monthsCrossed(G, daysDone);
    let billsDeducted = 0, salaryPaid = 0;
    for (let i = 0; i < monthsCrossed; i++) {
      salaryPaid += SL.player.paySalary(G);
      billsDeducted += SL.player.deductMonthlyBills(G);
    }

    /* 4. 新股IPO：v1.0 起改为剧情事件，由 specialEvents.process 在回合开始阶段触发，
     *    以公告新闻呈现，不再在时间推进后静默补股 */

    /* 5. 结算数据
     * v2.0.6 用户确认（方案B）：交易损益与月度收支彻底分开——
     * pnl = 交易损益（总资产变动 - 工资 + 账单，即纯持仓/交易贡献），
     * livingNet = 月度收支净额（工资 - 账单），两者在结算弹窗独立展示，
     * 避免空仓时"工资-账单净额被误读为节后冲击盈亏" */
    const total = SL.state.totalAsset(G);
    const livingNet = salaryPaid - billsDeducted;
    const pnl = (total - G.turnStartTotal) - livingNet; // 纯交易损益
    const pnlRate = G.turnStartTotal > 0 ? pnl / G.turnStartTotal : 0;
    G.history.push({ day: G.day, total });
    /* v2.0：追踪历史最高资产（等级只升不降的依据）；资产跌破杠杆门槛时重置解锁标记 */
    const prevHighest = G.highestTotalAsset || 0;
    G.highestTotalAsset = Math.max(G.highestTotalAsset || 0, total);
    /* v2.0.2 身份加薪：跨越等级线时记录待弹事件（每局每级一次） */
    let rankUpEvent = null;
    {
      const crossed = cfg.RANKS.filter(r => prevHighest < r.minAsset && G.highestTotalAsset >= r.minAsset);
      if (crossed.length) {
        const top = crossed[crossed.length - 1];
        G.rankSalaryDone = G.rankSalaryDone || {};
        if (!G.rankSalaryDone[top.key]) {
          G.rankSalaryDone[top.key] = true;
          const bonus = SL.config.SALARY_RANK_BONUS * cfg.RANKS.indexOf(top);
          rankUpEvent = {
            id: 'rank_up_salary', type: '事业', title: '升职加薪',
            text: '随着你投资经验的上升，对工作也更加得心应手。主管找你谈话，给你涨了薪。',
            choices: [{ label: '新的台阶（' + top.label + '）', hint: '月薪 +' + bonus + '/月', effect: { rankSalary: true } }]
          };
        }
      }
    }
    /* v2.0.2 两融定期重问：拒开后资产仍≥100万，每6回合重弹一次 */
    if (!G.leverageOptedIn && total >= cfg.LEVERAGE_UNLOCK_ASSET && G.leverageNotified) {
      G.leverageReaskTurns = (G.leverageReaskTurns || 0) + 1;
      if (G.leverageReaskTurns >= cfg.LEVERAGE_REASK_TURNS) { G.leverageReaskTurns = 0; G.leverageNotified = false; }
    }
    if (total < cfg.LEVERAGE_UNLOCK_ASSET) { G.leverageNotified = false; G.leverageReaskTurns = 0; }

    /* 心情漂移派生（v0.6）：关系均值 + 当轮盈亏 → 目标值，漂移靠拢 */
    SL.player.updatePsychology(G, pnlRate);
    SL.player.clampAll(G);

    /* v2.2 经验觉醒事件：exp 上穿20的回合弹出（每局一次，永久生效）。
     * 含扛单扣经验的当回合：净结算后仍≥20 也视为"经验上升中"——
     * 看4个行业的认知不会因单次回撤消失（与新闻链经验提示同档联动） */
    let expSightEvent = null;
    if (!G.indSightAwakened && G.player.exp >= cfg.EXP_VIS_THRESHOLD) {
      G.indSightAwakened = true;
      expSightEvent = {
        id: 'exp_sight_awaken', type: '成长',
        title: '拨开迷雾',
        text: '随着经验的上升，你现在对行业轮动把握地更清楚了。',
        choices: [{ label: '继续盯盘', hint: '行业趋势可见 3 → 4 个', effect: {} }]
      };
    }

    /* 6. 结局判定（§1.3） */
    const ending = this.checkEnding(G);
    if (ending) { G.ended = true; G.ending = ending; }

    /* 7. 剧情事件（§8.1：35%；长假强制假期包；机制预警/加薪/解锁事件优先注入）
     * v2.0.2：一次性事件（once:true，如同居）触发后不再出现 */
    let event = null;
    if (!ending) {
      if (G.deferredEvent) {
        event = G.deferredEvent; G.deferredEvent = null; // v2.2：上回合被觉醒事件顺延的剧情事件补弹
      } else if (crossedHoliday) {
        event = SL.content.generateEvent({ G, holiday: true, holidayKey: crossedHoliday.key });
      } else if (rankUpEvent) {
        event = rankUpEvent; // v2.0.2 身份加薪（跨等级线）
      } else if (SL.player.leverageEventDue(G)) {
        event = SL.data.events.find(e => e.id === 'mid_leverage_unlock');
        G.leverageNotified = true;
      } else if (SL.specialEvents.swanTipDue(G)) {
        event = SL.specialEvents.mkSwanTipEvent(G);
      } else if (SL.specialEvents.ipoPreviewDue(G)) {
        event = SL.specialEvents.mkIpoPreviewEvent(G);
      } else if (u_chance(cfg.EVENT_RATE)) {
        /* 一次性事件过滤：已触发过的 once 事件不再进池 */
        const onceFired = G.onceEvents || {};
        event = SL.content.generateEvent({ G, holiday: false });
        if (event && event.once && onceFired[event.id]) {
          event = SL.content.generateEvent({ G, holiday: false }); // 重抽一次
          if (event && event.once && onceFired[event.id]) event = null;
        }
        if (event && event.once) { (G.onceEvents || (G.onceEvents = {}))[event.id] = true; }
      }
    }

    const result = {
      days: daysDone, pnl, pnlRate,
      livingNet, // v2.0.6 月度收支净额（工资-账单，与交易损益分开展示）
      expired: G.positions.filter(p => p.expired),
      liquidations: G.liquidations.slice(),
      swanRecords: (G.swanRecords || []).slice(), // v1.6.3 天鹅影响条目
      swanEvent: G.swanEvent || null, // v2.0.5 黑天鹅爆发事件（结算后弹窗）
      macroChangeEvent: G.macroChangeEvent || null, // v2.1 宏观切换提示事件
      billsDeducted, salaryPaid, monthsCrossed, overdueExpLoss,
      expSightEvent, // v2.2：经验突破20的觉醒事件（结算后弹窗）
      crossedHoliday: crossedHoliday || null,
      holidayShock, // v1.6：节后冲击（结算弹窗展示）
      ipoStock: null, // v1.0：IPO 改剧情事件公告（specialEvents），结算弹窗不再单独展示
      ending, event
    };

    /* 8. 自动存档（§12：每回合结束） */
    SL.storage.save(G);
    return result;
  },

  /* ---------------- 节后冲击（v1.6） ----------------
   * 方向：好/坏/中性等权；范围：单行业(3) : 全行业(2)；幅度：单行业±5%、全行业±7%
   * 100%瞬间定价；中性=无价格冲击纯剧情 */
  _rollHolidayShock(G, holiday) {
    const cfg = SL.config.HOLIDAY_SHOCK, u = SL.utils;
    /* 方向 */
    const dirEntries = Object.entries(cfg.DIR_WEIGHTS);
    const dirTotal = dirEntries.reduce((s, [, w]) => s + w, 0);
    let roll = u.rand() * dirTotal, dirKey = 'neutral';
    for (const [k, w] of dirEntries) { roll -= w; if (roll <= 0) { dirKey = k; break; } }
    const dir = dirKey === 'good' ? 1 : dirKey === 'bad' ? -1 : 0;
    /* 范围 */
    const scopeAll = u.chance(cfg.SCOPE_ALL_W / (cfg.SCOPE_ALL_W + cfg.SCOPE_INDUSTRY_W));
    /* 作用对象与幅度 */
    let industry = null, pct = 0, affected = [];
    if (dir !== 0) {
      if (scopeAll) {
        pct = cfg.ALL_PCT;
        affected = SL.state.activeStocks(G);
      } else {
        const indSet = [...new Set(SL.state.activeStocks(G).map(s => s.industryKey))];
        const indKey = u.pick(indSet);
        industry = SL.data.stocks.INDUSTRIES.find(i => i.key === indKey);
        pct = cfg.INDUSTRY_PCT;
        affected = SL.state.activeStocks(G).filter(s => s.industryKey === indKey);
      }
      for (const s of affected) {
        s.price = Math.max(0.01, +(s.price * (1 + pct * dir)).toFixed(2));
        s.intraday = SL.market._genIntradayAnchored(s); // v1.6.2：分时锚定
      }
    } else {
      /* v2.1.10 用户确认："平稳"≠价格冻结——长假期间正常市场漂移照常发生，
       * 只是没有额外的±5%/9%冲击。按普通区间引擎补一次长假正常涨跌，
       * 持仓盈亏结算逻辑与日常一致（原逻辑：休市日continue冻结+平稳dir=0不改价=过节前后一个价） */
      const holdDays = SL.config.DAYS_PER_MONTH; // 长假=1个月
      for (const s of SL.state.activeStocks(G)) {
        const r = SL.market.rollPeriodReturn(G, s, holdDays);
        s.price = Math.max(0.01, +(s.price * (1 + r)).toFixed(2));
        s.intraday = SL.market._genIntradayAnchored(s);
      }
    }
    /* 公告文案（下一回合新闻置顶） */
    const dirLabel = dirKey === 'good' ? '利好' : dirKey === 'bad' ? '利空' : '平稳';
    const scopeLabel = scopeAll ? '全市场' : (industry ? industry.label + '板块' : '部分板块');
    const news = {
      stockId: null, type: 'notice', special: 'holidayShock',
      text: holiday.name + '后市场复盘：' + scopeLabel + '迎来' + dirLabel +
        (dir !== 0 ? '，' + (scopeAll ? '整体' : '板块') + '瞬时' + (dir > 0 ? '上涨' : '下跌') +
        (pct * 100).toFixed(0) + '%' : '，市场平静开市'),
      impactPct: 0, dir, fake: false
    };
    return { dirKey, dir, scopeAll, industry, pct, affectedCount: affected.length, news };
  },

  /* 当前是否处于"假期回合的节前窗口"（假期月份1号，可交易+应弹预告） */
  isHolidayWindow(G) {
    const u = SL.utils;
    const h = u.isHoliday(G.day);
    return h ? (u.dayToDate(G.day).day === 1 ? h : null) : null;
  },

  /* 宏观情报按需生成/轮换（v0.8）：
   * 世界经济每3个月一轮，但宏观状态中途切换（如危机爆发）时立即更新——不能滞后于决策；
   * 行业趋势每月一轮，反映当月景气方向 */
  _refreshMacroNews(G) {
    const cfg = SL.config;
    const m = Math.floor(G.day / cfg.DAYS_PER_MONTH);
    const mn = G.macroNews || (G.macroNews = {});
    const worldCycle = Math.floor(m / cfg.MACRO_NEWS_WORLD_MONTHS);
    if (!mn.world || mn.world.cycle !== worldCycle || mn.world.regimeKey !== G.macro) {
      mn.world = { cycle: worldCycle, ...SL.content.generateMacroNews(G, 'world') };
    }
    /* v2.2：经验可见度档位（<20 见3个 / ≥20 见4个）参与缓存键，
     * 跨档当回合立即重抽可见行业并重渲染；同档内沿用原轮换节奏 */
    const visTier = G.player.exp >= cfg.EXP_VIS_THRESHOLD ? 1 : 0;
    const indCycle = Math.floor(m / cfg.MACRO_NEWS_IND_MONTHS);
    /* v1.4：行业段变化（方向/起止）时也立即刷新，不滞后到下个文案周期 */
    const segVer = Object.values(G.indSeg || {}).reduce((s, x) => s + x.startDay * 31 + x.endDay, 0);
    if (!mn.ind || mn.ind.cycle !== indCycle || mn.ind.segVer !== segVer || mn.ind.visTier !== visTier) {
      mn.ind = { cycle: indCycle, segVer, visTier, items: SL.content.generateMacroNews(G, 'industry') };
    }
    G.macroNews = mn;
  },

  /* 跨月数（按30天/月） */
  _monthsCrossed(G, days) {
    const cfg = SL.config;
    const before = Math.floor((G.day - days) / cfg.DAYS_PER_MONTH);
    const after = Math.floor(G.day / cfg.DAYS_PER_MONTH);
    return Math.max(0, after - before);
  },

  /* ---------------- 结局（§1.3 / §8.3 结局矩阵） ---------------- */
  /* 即时破产检测（用户确认：总资产≤0 直接结束）。
   * 在交易/事件等任何现金变动后调用；触发返回 true */
  hitBankrupt(G) {
    if (G.ended) return true;
    if (SL.state.totalAsset(G) <= 0) {
      const total = SL.state.totalAsset(G);
      G.ended = true;
      G.ending = this._mkEnding(G, 'bankrupt', total);
      SL.storage.save(G);
      return true;
    }
    return false;
  },

  checkEnding(G) {
    const cfg = SL.config, u = SL.utils;
    const total = SL.state.totalAsset(G);

    if (total <= 0) return this._mkEnding(G, 'bankrupt', total);
    if (total >= cfg.TARGET_ASSET && u.ageAt(G.day) <= cfg.END_AGE) return this._mkEnding(G, 'rich', total);
    if (u.ageAt(G.day) >= cfg.END_AGE) return this._mkEnding(G, 'timeout', total);
    return null;
  },

  _mkEnding(G, kind, total) {
    const cfg = SL.config;
    const mean = SL.player.relationMean(G);
    const relHigh = mean >= cfg.RELATION_HIGH;

    /* 财富分级 */
    let wealthKey;
    if (kind === 'bankrupt') wealthKey = 'poor';
    else if (kind === 'rich') wealthKey = 'rich';
    else {
      wealthKey = 'poor';
      for (const t of cfg.ENDING_ASSET_TIERS) if (total >= t.min) { wealthKey = t.key; break; }
      if (wealthKey === 'rich') wealthKey = 'mid'; // 时间到未达标不算富裕
    }

    /* 结局矩阵（§8.3） */
    const MATRIX = {
      rich: { high: '名利双收', low: '孤傲王者' },
      mid:  { high: '平淡是真', low: '浑噩半生' },
      poor: { high: '患难见真情', low: '众叛亲离' }
    };
    const title = MATRIX[wealthKey][relHigh ? 'high' : 'low'];
    const kindLabel = kind === 'rich' ? '财务自由' : kind === 'timeout' ? '时间到' : '爆仓';

    /* 失败传承（v0.6 用户确认）：失败结局为下局积累初始经验
     * 回合因子 + 盈利因子（亏损时盈利因子为0），财务自由无传承 */
    let legacy = 0;
    if (kind !== 'rich') {
      const L = SL.config.LEGACY;
      const turnsF = Math.min(L.turnsCap, G.turn * L.turnsRate);
      const profitF = total > SL.config.START_CASH
        ? Math.min(L.profitCap, (total / SL.config.START_CASH - 1) * L.profitRate)
        : 0;
      legacy = Math.min(L.totalCap, Math.round((turnsF + profitF) * 10) / 10);
      SL.storage.saveMeta({ legacyExp: legacy });
    }

    return {
      kind, kindLabel, title,
      wealthKey, relHigh, relMean: Math.round(mean),
      total, legacy,
      relations: { ...G.player.relations },
      turns: G.turn,
      stats: { ...G.stats }
    };
  }
};

/* 避免与 SL.utils 解构冲突的小工具 */
function u_chance(p) { return SL.utils.chance(p); }
