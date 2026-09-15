/* ============================================================
 * core/newsChains.js — 消息链机制（v1.2 用户确认）
 *
 * 核心思想：影响后续走势的不是消息本身，而是消息后续被
 * "证实/证伪、强化/减弱"——玩家博弈的是消息的演化方向。
 *
 * 链结构（生成时确定隐藏真值 truth，玩家不可见）：
 *   阶段1「传闻」→ 阶段2「进展」→ 阶段3「证实/证伪揭晓」（30%链无阶段3，自然消散）
 *   阶段1/2 文案真假共用，不泄露结局；只有"经验疑点提示"和"剧情内线"能提前泄露
 *
 * A2定价（用户确认）：阶段消息在回合开始发布瞬间完成 60% 价格影响（直接改价，
 * 在K线上形成自然跳空），剩余 40% 写入 rangeShift 随本回合区间引擎消化。
 *
 * 经验提示（概率性分级）：假链在阶段1/2发布时，按 exp 档位概率附加"疑点"新闻：
 *   exp≥20→30%，每+10经验+5%，封顶75%（exp<20 无提示）
 *
 * 剧情联动：SL.newsChains.reveal(G, chainId) 标记"内线"，
 *   该链后续阶段文案附带真实结局方向（供剧情事件效果调用）。
 * ============================================================ */
window.SL = window.SL || {};

SL.newsChains = {
  _seq: 1,

  /* ---------------- 每回合调度（turn.startTurn 调用） ----------------
   * 返回本回合产生的新闻条目数组（阶段新闻 + 疑点提示） */
  process(G) {
    const cfg = SL.config, u = SL.utils;
    const chains = G.chains || (G.chains = []);
    const news = [];

    /* 1. 推进在途链 */
    for (let i = chains.length - 1; i >= 0; i--) {
      const c = chains[i];
      const stock = SL.state.getStock(G, c.stockId);
      if (!stock || stock.delisted) { chains.splice(i, 1); continue; }
      c.turnsLeft--;
      if (c.turnsLeft > 0) continue;
      if (c.stage === 1) {
        c.stage = 2;
        c.turnsLeft = u.rangeInt(cfg.CHAIN_STAGE_TURNS[0], cfg.CHAIN_STAGE_TURNS[1]);
        news.push(...this._publish(G, c, stock));
      } else if (c.stage === 2) {
        if (c.hasS3) {
          c.stage = 3;
          news.push(...this._publish(G, c, stock));
        }
        chains.splice(i, 1); // 揭晓后或消散：链结束
      }
    }

    /* 2. 尝试开新链（每只股票最多1条在途） */
    if (!G.ended && chains.length < cfg.CHAIN_MAX && u.chance(cfg.CHAIN_RATE)) {
      const busy = new Set(chains.map(c => c.stockId));
      const cands = SL.state.activeStocks(G).filter(s => !busy.has(s.id));
      if (cands.length) {
        const c = this._mkChain(G, u.pick(cands));
        chains.push(c);
        news.push(...this._publish(G, c, SL.state.getStock(G, c.stockId))); // 阶段1当回合发布
      }
    }

    return news;
  },

  /* ---------------- 建链（隐藏真值在此掷定） ---------------- */
  _mkChain(G, stock) {
    const cfg = SL.config, u = SL.utils;
    /* 方向偏置：隐藏趋势+行业景气抬高利好链概率（宏观/行业逻辑保留） */
    const sent = G.industrySent[stock.industryKey] || 0;
    const upProb = u.clamp(0.5 + stock.trend * 20 + sent * 0.1, 0.2, 0.8);
    return {
      id: 'chain' + (this._seq++),
      stockId: stock.id,
      dir: u.chance(upProb) ? 1 : -1,
      truth: u.chance(cfg.CHAIN_TRUTH_RATE),
      stage: 1,
      hasS3: !u.chance(cfg.CHAIN_NO_S3_RATE),
      turnsLeft: u.rangeInt(cfg.CHAIN_STAGE_TURNS[0], cfg.CHAIN_STAGE_TURNS[1]),
      revealed: false
    };
  },

  /* ---------------- 发布当前阶段（分阶段定价 + 文案 + 疑点提示） ----------------
   * v1.9 用户确认：
   * - 阶段1/2（传闻/进展）= 温和区间平移：影响只写入 rangeShift（区间中值偏移），
   *   不改价格、不跳空——利好是在逆风里抬高结算点，而不是"先乘回去"
   * - 阶段3（证实/证伪揭晓）= 保留瞬间定价特权：A2（60%跳空+40%消化），戏剧张力所在
   * - 返回 1~2 条新闻（阶段新闻 [+ 疑点提示]） */
  _publish(G, c, stock) {
    const cfg = SL.config, u = SL.utils;
    const impact = this._impact(cfg, u, c);

    if (c.stage === 3) {
      /* 揭晓：A2 瞬间60%直接改价（K线跳空），剩余40%随本回合区间消化。
       * v2.0.3 用户确认（方案A）：揭晓前清零该股残留的链区间偏移——
       * 阶段1/2累积的区间氛围在结局揭晓时作废，赌对方向=确定赚，
       * 避免"证伪大涨被残留利空区间拖回"导致方向相反的玩家反而获利 */
      const instant = impact * cfg.CHAIN_INSTANT;
      stock.price = Math.max(0.01, +(stock.price * (1 + instant)).toFixed(2));
      stock.rangeShift = impact - instant;
    } else {
      /* 传闻/进展：仅区间平移（全部写入 rangeShift，不改价格）；
       * v1.9 修复：阶段1先清零残余偏移——新链新起点，不得背负上回合一次性新闻的
       * 残留 rangeShift（否则阶段1利好会"假传圣旨"地继续执行残留利空） */
      if (c.stage === 1) stock.rangeShift = 0;
      stock.rangeShift = (stock.rangeShift || 0) + impact;
    }

    /* 文案：阶段1/2 按方向取公共池；阶段3 按真值取结局池 */
    const pool = SL.data.news.chain;
    const dirKey = c.dir === 1 ? 'up' : 'down';
    let tpls, stageLabel;
    if (c.stage === 1) { tpls = pool['s1_' + dirKey]; stageLabel = '传闻'; }
    else if (c.stage === 2) { tpls = pool['s2_' + dirKey]; stageLabel = '进展'; }
    else { tpls = pool['s3_' + dirKey + '_' + (c.truth ? 'true' : 'false')]; stageLabel = c.truth ? '证实' : '证伪'; }

    let text = u.pick(tpls).text.replace(/\{name\}/g, stock.name);
    /* 剧情内线：附真实结局方向 */
    if (c.revealed && c.stage < 3) {
      text += '（内线消息：此事大概率被' + (c.truth ? '证实' : '证伪') + '）';
    }

    const items = [{
      stockId: stock.id, type: 'chain', chainId: c.id, stage: c.stage, stageLabel,
      text, impactPct: 0, dir: Math.sign(impact), fake: false
    }];

    /* 经验疑点提示：仅假链、仅阶段1/2，概率分级 */
    if (!c.truth && c.stage < 3 && u.chance(this.expHintRate(G))) {
      items.push({
        stockId: stock.id, type: 'hint', chainId: c.id,
        text: u.pick(pool.hint_trap).text.replace(/\{name\}/g, stock.name),
        impactPct: 0, dir: 0, fake: false
      });
    }

    return items;
  },

  /* 阶段影响（含方向）：阶段2 无论真假维持链方向（假象维持/趋势延续） */
  _impact(cfg, u, c) {
    const I = cfg.CHAIN_IMPACT;
    if (c.stage === 1) return c.dir * u.range(I.S1[0], I.S1[1]);
    if (c.stage === 2) return c.dir * u.range(I.S2[0], I.S2[1]);
    return c.truth ? c.dir * u.range(I.S3_TRUE[0], I.S3_TRUE[1])
                   : -c.dir * u.range(I.S3_FALSE[0], I.S3_FALSE[1]);
  },

  /* 经验提示概率：exp<20→0；exp≥20→30%，每+10经验+5%，封顶75%（用户确认数值） */
  expHintRate(G) {
    const cfg = SL.config;
    const exp = G.player.exp === undefined ? cfg.START_EXP : G.player.exp;
    if (exp < cfg.EXP_HINT_TIER0) return 0;
    const tier = Math.floor(exp / cfg.EXP_HINT_TIER_STEP) - (cfg.EXP_HINT_TIER0 / cfg.EXP_HINT_TIER_STEP);
    return Math.min(cfg.EXP_HINT_MAX, cfg.EXP_HINT_RATE0 + tier * cfg.EXP_HINT_RATE_STEP);
  },

  /* ---------------- 剧情联动接口 ---------------- */
  /* 标记"内线"：该链后续阶段文案附真实结局方向（供剧情事件效果调用） */
  reveal(G, chainId) {
    const c = (G.chains || []).find(x => x.id === chainId);
    if (c) c.revealed = true;
    return !!c;
  },

  /* 当前可联动的链列表（剧情事件选材用：只给阶段1/2的链才有"提前知情"价值） */
  activeChains(G) {
    return (G.chains || []).filter(c => c.stage < 3);
  },

  /* 强制创建一条链（剧情联动接口，v1.6 假期事件用）：
   * opts: { stockId(缺省随机), dir, truth, revealed(内线标记), delayTurns(默认1=下回合启动) }
   * 例：假期餐桌上得知利好 → forceChain(G, { dir:1, truth:true, revealed:true }) */
  forceChain(G, opts) {
    const u = SL.utils;
    const chains = G.chains || (G.chains = []);
    const busy = new Set(chains.map(c => c.stockId));
    const cands = SL.state.activeStocks(G).filter(s => !busy.has(s.id));
    if (!cands.length) return null;
    const stock = opts && opts.stockId ? SL.state.getStock(G, opts.stockId) : u.pick(cands);
    if (!stock || stock.delisted) return null;
    const c = {
      id: 'chain' + (this._seq++),
      stockId: stock.id,
      dir: (opts && opts.dir) || 1,
      truth: !!(opts && opts.truth),
      stage: 1,
      hasS3: true, // 剧情给的链必有揭晓（玩家买的就是这个结局）
      turnsLeft: Math.max(1, (opts && opts.delayTurns) || 1),
      revealed: !!(opts && opts.revealed)
    };
    chains.push(c);
    return c;
  }
};
