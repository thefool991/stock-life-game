/* ============================================================
 * core/contentProvider.js — 内容生成接口（新闻/剧情事件）
 *
 * 本期实现：LocalProvider（读取 data/ 下的模板库随机组合）。
 *
 * 【大模型接入方式】
 * 实现一个同接口的 Provider 并调用 SL.content.setProvider() 即可，
 * 玩法代码零改动。接口约定：
 *   - prefetch(ctx)  → Promise（可选）：在回合开始时预取并缓存内容，
 *                      供 generateNews/generateEvent 同步返回；
 *                      适合需要等待 LLM 异步返回的场景。
 *   - generateNews(ctx)   → NewsItem[]（见下方结构）
 *   - generateEvent(ctx)  → EventDef | null（结构同 data/eventData.js）
 * ctx 包含：{ day, stocks, player, G }，供 LLM 组织上下文。
 *
 * NewsItem 结构：
 *   { stockId, type: 'notice'|'rumor'|'opinion'|'noise'|'clue',
 *     text, impactPct(隐藏), dir(隐藏, 1/-1), fake(隐藏, bool) }
 * ============================================================ */
window.SL = window.SL || {};

(function () {
  const U = () => SL.utils;
  const CFG = () => SL.config;

  /* ---------------- 本地模板 Provider ---------------- */
  const LocalProvider = {
    name: 'local',

    prefetch() { return Promise.resolve(); },

    /* ctx: { stocks(未退市), dueStocks:[{stock,period}] 本回合到期的持仓股, G }
     * v1.8：黑天鹅公开线索已取消（改"机构朋友"事件），clueStock 分支删除 */
    generateNews(ctx) {
      const cfg = CFG(), u = U();
      const pool = SL.data.news;
      const items = [];
      const newsedIds = new Set();

      /* 1. 到期持仓股必出新闻（§2.3：B到期 → B出新闻大幅波动） */
      for (const d of ctx.dueStocks) {
        const type = u.pick(['notice', 'opinion']);
        const swing = cfg.POSITION_SWING; // v1.5：统一到期波动 ±3%~10%
        /* v1.4.2 修复：先掷方向（受隐藏趋势与运气偏置），再按方向选模板——
         * 原先反向掷影响但文案不变，导致"利好文字+价格下跌"的文影响不符，
         * 熊市（趋势为负→bias低）中高发，玩家做多看利好却结算亏损 */
        const bias = 0.5 + d.stock.trend * 30 + (ctx.G.player.luck - 0.5) * 0.1;
        const dir = u.chance(u.clamp(bias, 0.15, 0.85)) ? 1 : -1;
        const dirPool = pool[type].filter(t => t.dir === dir);
        const tpl = u.pick(dirPool.length ? dirPool : pool[type]);
        items.push(this._mkStockNews(d.stock, type, tpl, u.range(swing[0], swing[1]) * dir, false));
        newsedIds.add(d.stock.id);
      }

      /* 2. 常规：约30%股票产生新闻（§4.1）
       * v1.2：有消息链在途的股票不出一次性新闻（避免叙事冲突） */
      for (const s of ctx.stocks) {
        if (newsedIds.has(s.id)) continue;
        if (ctx.chainStockIds && ctx.chainStockIds.has(s.id)) continue;
        if (!u.chance(cfg.NEWS_STOCK_RATE)) continue;
        const type = this._rollType();
        const tpl = u.pick(pool[type]);
        const tcfg = cfg.NEWS_TYPES[type];
        const fake = u.chance(tcfg.fakeRate);
        const strength = u.range(tcfg.impact[0], tcfg.impact[1]);
        // 假新闻 → 反向波动（§4.4）
        const impact = strength * tpl.dir * (fake ? -1 : 1);
        items.push(this._mkStockNews(s, type, tpl, impact, fake));
        newsedIds.add(s.id);
      }

      /* 4. 干扰新闻 2~3 条（§4.1） */
      const noiseN = u.rangeInt(cfg.NEWS_NOISE_COUNT[0], cfg.NEWS_NOISE_COUNT[1]);
      const noisePool = u.shuffle(pool.noise);
      for (let i = 0; i < noiseN && i < noisePool.length; i++) {
        items.push({ stockId: null, type: 'noise', text: noisePool[i].text, impactPct: 0, dir: 0, fake: false });
      }

      return u.shuffle(items); // 打乱顺序，增加辨识难度
    },

    /* industry：对当前在市股票涉及的行业各出一条
     * v1.0：已移除行业（传媒/金融/银行）的存量存档股不再出现在行业趋势中
     * v2.2：可见度与经验挂钩——exp<20 每回合随机可见3个行业，exp≥20 可见4个，
     *       其余行业显示"不明"（行业轮动节奏本身不变，只限制情报可见数量） */
    generateMacroNews(G, kind) {
      const u = U(), cfg = CFG(), pool = SL.data.macroNews;
      if (kind === 'world') {
        const regime = cfg.MACRO[G.macro] || cfg.MACRO.normal;
        return { regimeKey: G.macro, regimeLabel: regime.label, text: u.pick(pool.world[G.macro] || pool.world.normal) };
      }
      const validKeys = new Set(SL.data.stocks.INDUSTRIES.map(i => i.key));
      const seen = {};
      const items = [];
      for (const s of G.stocks) {
        if (s.delisted || seen[s.industryKey]) continue;
        if (!validKeys.has(s.industryKey)) continue;
        seen[s.industryKey] = true;
        const sent = G.industrySent[s.industryKey] || 0;
        const dir = sent > cfg.IND_SENT_DIR ? 'good' : sent < -cfg.IND_SENT_DIR ? 'bad' : 'flat';
        items.push({
          industryKey: s.industryKey, industryLabel: s.industryLabel, dir, sent,
          text: u.pick(pool.industry[dir]).replace(/\{industry\}/g, s.industryLabel)
        });
      }
      /* v2.2：随机选取可见行业（每回合重抽），未选中项标记 unknown */
      const visN = G.player.exp >= cfg.EXP_VIS_THRESHOLD ? cfg.EXP_VIS_HIGH : cfg.EXP_VIS_LOW;
      const visKeys = new Set(u.shuffle(items.map(it => it.industryKey)).slice(0, Math.min(visN, items.length)));
      for (const it of items) if (!visKeys.has(it.industryKey)) { it.unknown = true; it.text = ''; }
      return items;
    },

    /* 从事件库抽一个符合条件的事件；holiday=true 只抽长假纯剧情
     * v1.6：holidayKey 限定事件包（spring/golden），无 pack 字段的为通用假期事件 */
    generateEvent(ctx) {
      const u = U();
      /* v2.0：事件库按历史最高等级解锁（人脉建立后不消失） */
      const rankKey = SL.player.eventRank(ctx.G).key;
      const rankIdx = CFG().RANKS.findIndex(r => r.key === rankKey);
      let pool = SL.data.events.filter(e => {
        if (ctx.holiday) {
          if (!e.holiday) return false;
          return !e.pack || e.pack === ctx.holidayKey;
        }
        if (e.holiday) return false;
        /* v2.1.11 用户确认：已开通杠杆后，"两融引导类"剧情事件不再出现
         * （它们的存在意义是引导开杠杆，开通后再弹无意义且造成"杠杆事件反复弹"的观感） */
        if (e.leverageGuide && ctx.G.leverageOptedIn) return false;
        /* v2.1.12：已开通杠杆后，"两融账户开通资格"事件也应从随机池剔除。
         * 此前该事件只走 turn.js 的强制注入路径（有 leverageOptedIn 拦截），
         * 但随机抽取路径未过滤，weight:99 导致开通后仍大概率反复弹出 */
        if (e.id === 'mid_leverage_unlock' && ctx.G.leverageOptedIn) return false;
        if (e.minRank) {
          const need = CFG().RANKS.findIndex(r => r.key === e.minRank);
          return rankIdx >= need;
        }
        return true;
      });
      if (!pool.length) return null;
      // 按 weight 加权抽取
      const total = pool.reduce((s, e) => s + (e.weight || 1), 0);
      let roll = u.rand() * total;
      for (const e of pool) {
        roll -= (e.weight || 1);
        if (roll <= 0) return e;
      }
      return pool[pool.length - 1];
    },

    /* ---- 内部 ---- */
    _rollType() {
      const w = CFG().NEWS_TYPE_WEIGHTS, u = U();
      const total = w.notice + w.rumor + w.opinion;
      let roll = u.rand() * total;
      if ((roll -= w.notice) < 0) return 'notice';
      if ((roll -= w.rumor) < 0) return 'rumor';
      return 'opinion';
    },
    _mkStockNews(stock, type, tpl, impactPct, fake) {
      return { stockId: stock.id, type, text: this._fill(tpl.text, stock), impactPct, dir: Math.sign(impactPct), fake };
    },
    _fill(text, stock) {
      return text.replace(/\{name\}/g, stock.name).replace(/\{industry\}/g, stock.industryLabel);
    }
  };

  /* ---------------- 接口门面 ---------------- */
  SL.content = {
    _provider: LocalProvider,
    setProvider(p) { this._provider = p; },
    getProvider() { return this._provider; },
    prefetch(ctx) { return this._provider.prefetch ? this._provider.prefetch(ctx) : Promise.resolve(); },
    generateNews(ctx) { return this._provider.generateNews(ctx); },
    generateEvent(ctx) { return this._provider.generateEvent(ctx); },
    generateMacroNews(G, kind) { return this._provider.generateMacroNews(G, kind); }
  };
})();
