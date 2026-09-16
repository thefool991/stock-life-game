/* ============================================================
 * core/specialEvents.js — 特殊个股事件调度器（v1.8 用户确认大改版）
 *
 * 三类事件，与涨跌因子体系的关系：
 * - 退市：剧情事件，固定规则结算（做多归零/做空+100%），宏观/行业无法阻止
 * - 黑天鹅（正负统一）：独立事件，预定1~2回合后爆发直接改价，盈亏按价格自然传导
 * - IPO：剧情事件，补充新股 + 同行业跟随上涨
 *
 * 【v1.8 要点】
 * - 退市线索匿名化：不点名公司（防无风险做空）；全仓多/杠杆多持仓时概率2.5%→5%（目标仍全池随机）
 * - 黑天鹅取消公开线索：每股独立2%（危机5%）正负各半，预定1~2回合爆发；
 *   爆发前窗口内触发"机构朋友"事件（友情≥70可获保真行业信息，不提个股/正负）
 * - 免死机制重构：仅"亏损方向"判定，概率=运气×0.6，减亏=影响×(1-运气×0.5)
 * - IPO：总资产>50万解锁，8~12个月一次，全行业随机（可同行业）；
 *   上市前1~2回合出预告事件（3候选行业2假1真）；同行业跟随上涨（真实利好走A2）；新股无历史K线
 *
 * 【联动扩展空间】
 * - 外部剧情模块可调用 triggerDelist / triggerIpo / triggerSurge 强制触发。
 * - 数值全部在 config.js。
 * ============================================================ */
window.SL = window.SL || {};

SL.specialEvents = {
  /* ---------------- 事件处理器注册表 ---------------- */
  HANDLERS: {
    delist: {
      /* 到点执行：固定规则结算持仓（做多归零/做空+100%），标记退市，发公告
       * v2.1.5 面值退市翻盘：reason='floor'时50%概率股价翻倍重生（取消退市），
       * 防"跌到地板=免费做空翻倍"；玩家赌方向（做空博退市/做多博重生） */
      execute(G, pending) {
        const u = SL.utils, cfg = SL.config;
        const stock = SL.state.getStock(G, pending.stockId);
        if (!stock || stock.delisted) return null;

        /* 面值退市翻盘判定（50%）：股价翻倍，取消退市，重置地板计数，恢复正常波动 */
        if (pending.reason === 'floor' && u.chance(cfg.FLOOR_REVIVE_RATE)) {
          stock.price = +(stock.price * cfg.FLOOR_REVIVE_MULT).toFixed(2);
          stock._floorDays = 0; // 重置连续低于阈值计数
          stock._forceFloorDelist = false;
          stock.intraday = SL.market._genIntradayAnchored ? SL.market._genIntradayAnchored(stock) : stock.intraday;
          return [{
            stockId: stock.id, type: 'notice', special: 'surge',
            text: stock.name + ' 绝地反击：濒临退市之际突然暴涨' + Math.round((cfg.FLOOR_REVIVE_MULT - 1) * 100) +
              '%，退市危机解除！（有人说这是末日狂欢，有人说这是涅槃重生）',
            impactPct: 0, dir: 1, fake: false
          }];
        }

        const held = G.positions.filter(p => p.stockId === stock.id);
        for (const p of held) {
          const r = SL.trade.settleDelist(G, p);
          G.liquidations.push({
            stockName: stock.name, principal: p.principal,
            pnl: r.pnl, day: G.day, delisted: true
          });
        }
        stock.delisted = true;
        const tpl = u.pick(SL.data.news.delistNotice);
        return [{
          stockId: stock.id, type: 'notice', special: 'delist',
          text: tpl.text.replace(/\{name\}/g, stock.name),
          impactPct: 0, dir: -1, fake: false
        }];
      }
    },

    ipo: {
      /* 到点执行：全行业随机（v1.8 可同行业），新股无历史K线；
       * 同行业其他在市股票触发"跟随上涨"（真实利好，impactPct 走 A2 定价） */
      execute(G, pending) {
        const cfg = SL.config, u = SL.utils;
        const ind = SL.data.stocks.INDUSTRIES.find(i => i.key === pending.industryKey);
        if (!ind) return null;
        const usedNames = G.stocks.map(s => s.name);
        const stock = SL.market._mkStock(ind, usedNames, { noHistory: true });
        if (!stock) return null; // 该行业名字用尽
        G.stocks.push(stock);
        const tpl = u.pick(SL.data.news.ipoNotice);
        const items = [{
          stockId: stock.id, type: 'notice', special: 'ipo',
          text: tpl.text.replace(/\{name\}/g, stock.name).replace(/\{industry\}/g, stock.industryLabel),
          impactPct: 0, dir: 1, fake: false
        }];
        /* 同行业跟随上涨（v1.8：真实利好新闻，A2定价） */
        const peers = SL.state.activeStocks(G).filter(s => s.industryKey === ind.key && s.id !== stock.id);
        for (const s of peers) {
          items.push({
            stockId: s.id, type: 'opinion', special: 'ipoFollow',
            text: '新股效应：' + stock.name + '上市带动，' + ind.label + '板块关注度骤升，资金流入明显',
            impactPct: u.range(cfg.IPO_FOLLOW_RANGE[0], cfg.IPO_FOLLOW_RANGE[1]),
            dir: 1, fake: false
          });
        }
        return items;
      }
    }
  },

  /* ---------------- 黑天鹅统一管线（v1.8：预定→预警事件→爆发） ---------------- */

  /* 爆发：正负已在预定时掷定；免死仅对亏损方向判定
   * v2.0.5 用户确认：爆发时机从startTurn挪到advance推进中（随机交易日），
   * 并生成事件数据（G.swanEvent）在结算后弹窗——消除"平仓后仍显示天鹅盈亏"的时序错位。 */
  _detonateSwan(G, pending) {
    const cfg = SL.config, u = SL.utils;
    const stock = SL.state.getStock(G, pending.stockId);
    G.pendingSwan = null;
    if (!stock || stock.delisted) return null;

    const mag = pending.dir === 1
      ? u.range(cfg.SURGE_RANGE[0], cfg.SURGE_RANGE[1])
      : u.range(Math.abs(cfg.BLACKSWAN_DROP[0]), Math.abs(cfg.BLACKSWAN_DROP[1]));
    let impact = pending.dir * mag;

    /* 免死：仅当该方向导致玩家持仓亏损时判定（概率=运气×0.6，减亏=影响×(1-运气×0.5)） */
    const heldPos = G.positions.find(p => p.stockId === stock.id);
    let saved = false;
    if (heldPos) {
      const loses = heldPos.dir * impact < 0;
      if (loses && u.chance(G.player.luck * cfg.SWAN_SAVE_RATE)) {
        saved = true;
        impact = impact * (1 - G.player.luck * cfg.SWAN_SAVE_REDUCE);
      }
    }

    /* 记录持仓瞬时影响（结算总额 + 弹窗描述） */
    const valueBefore = heldPos ? SL.trade.positionValue(G, heldPos) : 0;
    SL.market._applyDay(stock, impact);
    let delta = 0;
    if (heldPos) {
      delta = SL.trade.positionValue(G, heldPos) - valueBefore;
      (G.swanRecords || (G.swanRecords = [])).push({
        stockName: stock.name, dir: heldPos.dir, delta, drop: impact, saved,
        kind: impact > 0 ? 'surge' : 'swan'
      });
    }

    /* v2.0.5：生成事件数据（结算后弹窗，区分持仓/无持仓四种情况） */
    G.swanEvent = this._mkSwanEvent(G, stock, impact, heldPos, delta, saved);

    const tpl = u.pick(impact > 0 ? SL.data.news.surgeNotice : SL.data.news.blackswan);
    return [{
      stockId: stock.id, type: 'notice', special: impact > 0 ? 'surge' : 'swan', swan: impact < 0,
      text: tpl.text.replace(/\{name\}/g, stock.name),
      impactPct: 0, dir: Math.sign(impact), fake: false
    }];
  },

  /* 天鹅事件文案（v2.0.5 用户确认）：
   * 持仓中：盈亏描述 + "有所感悟"；无持仓：四种平仓方向的"幸好/可惜" + 同选项 */
  _mkSwanEvent(G, stock, impact, heldPos, delta, saved) {
    const isSurge = impact > 0;
    let text;
    if (heldPos) {
      const dirLabel = heldPos.dir === 1 ? '多单' : '空单';
      const pnlWord = delta >= 0 ? '盈利' : '亏损';
      const amt = SL.utils.fmtMoney(Math.abs(delta));
      text = '你的持仓' + stock.name +
        (isSurge ? '出现超预期利好，股价瞬间暴涨' : '爆发了黑天鹅事件，股价瞬间暴跌') +
        '，你的' + dirLabel + '瞬间' + pnlWord + '：' + amt;
      if (saved) text += '（你的直觉在最后一刻让你减了仓）';
    } else {
      /* 无持仓：本回合平仓方向（G.swanClosedDir），缺省按"看戏"处理 */
      const cd = G.swanClosedDir || 0;
      if (cd !== 0) {
        const closedLabel = cd === 1 ? '多单' : '空单';
        /* 平仓方向×涨跌 → 躲过=幸好 / 错过=可惜
         * 多单平仓后暴跌=幸好（躲亏）；多单平仓后暴涨=可惜（错过赚）
         * 空单平仓后暴跌=可惜（错过赚）；空单平仓后暴涨=幸好（躲亏） */
        const dodge = (cd === 1 && !isSurge) || (cd === -1 && isSurge);
        text = '你刚平仓的' + stock.name + closedLabel +
          (isSurge ? '出现超预期利好，股价瞬间暴涨' : '爆发了黑天鹅事件，股价瞬间暴跌') +
          (dodge ? '，幸好你早已平仓' : '，可惜你早已平仓');
      } else {
        text = stock.name + (isSurge ? '出现超预期利好，股价瞬间暴涨。' : '爆发了黑天鹅事件，股价瞬间暴跌。') +
          '你没有持仓，旁观了这场风暴。';
      }
    }
    return {
      id: 'swan_burst', type: '生活', swanEvent: true,
      title: isSurge ? '🚀 超预期利好' : '🦢 黑天鹅爆发',
      text,
      choices: [{ label: '经历这次波动，你有所感悟', hint: '经验 +0.4', effect: { exp: 0.4 } }]
    };
  },

  /* "机构朋友/券商朋友"预警事件：爆发前窗口内触发一次；行业保真，不提个股/正负
   * v2.0：机构版需中户(100万)；50~100万(专业投资者)给弱化版"券商朋友"（友情门槛60） */
  swanTipDue(G) {
    const cfg = SL.config;
    if (!G.pendingSwan || G.pendingSwan.tipped) return false;
    return SL.state.totalAsset(G) >= cfg.IPO_UNLOCK_ASSET; // 50万起才有预警资格
  },
  mkSwanTipEvent(G) {
    const cfg = SL.config;
    G.pendingSwan.tipped = true;
    const isMiddle = SL.state.totalAsset(G) >= cfg.SWAN_TIP_MIN_ASSET; // 100万=机构版
    if (isMiddle) {
      return {
        id: 'swan_friend_tip', type: '友情',
        title: '饭桌上的风声',
        text: '和在机构工作的朋友吃饭，酒过三巡，朋友忽然压低声音："有个行业，后面的波动可能会很大。具体是哪家、是好是坏，我真不能说。"',
        choices: [
          { label: '敬酒打听详情', hint: '获知是哪个行业（需友情≥' + cfg.SWAN_TIP_FRIEND + '）',
            require: { rel: { friend: cfg.SWAN_TIP_FRIEND } },
            effect: { swanTip: true, rel: { friend: 1 } } },
          { label: '不为难朋友，换个话题', hint: '友情 +1', effect: { rel: { friend: 1 } } }
        ]
      };
    }
    /* 弱化版：券商朋友（50~100万），友情门槛60 */
    return {
      id: 'swan_broker_tip', type: '友情',
      title: '券商朋友的消息',
      text: '券商的朋友打来电话，闲聊中提了一句："最近有个行业资金面不太对劲，你自己留意着点。"再多问，他就只剩笑了。',
      choices: [
        { label: '请顿饭套出详情', hint: '获知是哪个行业（需友情≥' + cfg.SWAN_TIP_LITE_FRIEND + '）',
          require: { rel: { friend: cfg.SWAN_TIP_LITE_FRIEND } },
          effect: { swanTip: true, rel: { friend: 1 } } },
        { label: '谢过了，自己多留意', hint: '友情 +1', effect: { rel: { friend: 1 } } }
      ]
    };
  },
  /* 揭示保真行业（effect.swanTip 的落点，player.applyEffect 调用） */
  revealSwanIndustry(G) {
    const s = G.pendingSwan;
    if (!s) return;
    const stock = SL.state.getStock(G, s.stockId);
    if (!stock) return;
    (G.news || (G.news = [])).unshift({
      stockId: null, type: 'opinion', special: 'swanTip',
      text: '知情人透露：' + stock.industryLabel + '行业近期波动可能明显加大（具体标的与方向不详）',
      impactPct: 0, dir: 0, fake: false
    });
  },

  /* ---------------- IPO 预告事件（v1.8：3候选行业，2假1真） ---------------- */
  ipoPreviewDue(G) {
    const p = G.specialPending;
    return !!(p && p.type === 'ipo' && !p.previewed);
  },
  mkIpoPreviewEvent(G) {
    const u = SL.utils;
    const p = G.specialPending;
    p.previewed = true;
    const real = SL.data.stocks.INDUSTRIES.find(i => i.key === p.industryKey);
    const others = SL.data.stocks.INDUSTRIES.filter(i => i.key !== p.industryKey);
    const fakes = [u.pick(others), u.pick(others)];
    const candidates = u.shuffle ? u.shuffle([real, ...fakes]) : [real, ...fakes].sort(() => u.rand() - 0.5);
    return {
      id: 'ipo_preview', type: '友情',
      title: '券商朋友聊到快上市的新股',
      text: '和券商的朋友吃饭，他随口聊起："最近有几家公司在排队过会，看进度快了。"目前传闻集中在三个行业：' +
        candidates.map(i => i.label).join('、') + '。真假难辨，自己掂量。',
      choices: [
        { label: '记下来，重点关注', hint: '三个候选行业中有一个是真的', effect: null }
      ]
    };
  },

  /* ---------------- 每回合调度（turn.startTurn 调用） ---------------- */
  process(G) {
    const cfg = SL.config, u = SL.utils;
    const news = [];
    const push = r => { if (Array.isArray(r)) news.push(...r); else if (r) news.push(r); };

    /* 0. 黑天鹅预定倒计时推进（v2.0.5：爆发已挪到turn.advance推进中，
     *    此处只负责掷签预定与倒计时递减，爆发见 _detonateSwan 由 advance 逐日调用） */
    if (G.pendingSwan) {
      G.pendingSwan.turnsLeft--;
      // 到点不爆发，等 advance 推进到随机交易日时爆发（消除结算时序错位）
    }

    /* 1. 推进在途剧情事件（退市/IPO）倒计时，到点执行 */
    const pending = G.specialPending || null;
    if (pending) {
      pending.turnsLeft--;
      if (pending.turnsLeft <= 0) {
        G.specialPending = null;
        const h = this.HANDLERS[pending.type];
        push(h && h.execute(G, pending));
      }
    }

    /* 2. 触发新退市剧情（v2.0.7：概率与等级挂钩，全仓多/杠杆多持仓时翻倍，目标仍全池随机） */
    if (!G.specialPending && !G.ended) {
      const heavyLong = G.positions.some(p => p.actionKey === 'long_full' || p.actionKey === 'long_lev');
      const rankKey = SL.player.rank(G).key;
      const tier = cfg.DELIST_RATE_BY_RANK[rankKey] || cfg.DELIST_RATE_BY_RANK.retail;
      const rate = heavyLong ? tier.heavy : tier.base;
      const candidates = SL.state.activeStocks(G);
      if (candidates.length && u.chance(rate)) {
        this.triggerDelist(G, u.pick(candidates).id);
      }
    }

    /* 3. 黑天鹅掷签：每股独立（常态2%/危机5%），命中后正负各半，全池最多1个在途 */
    if (!G.pendingSwan && !G.ended) {
      const rate = G.macro === 'crisis' ? cfg.BLACKSWAN_RATE_CRISIS : cfg.BLACKSWAN_RATE;
      for (const s of SL.state.activeStocks(G)) {
        if (u.chance(rate)) {
          G.pendingSwan = {
            stockId: s.id, dir: u.chance(0.5) ? 1 : -1,
            turnsLeft: u.rangeInt(cfg.SWAN_PENDING_TURNS[0], cfg.SWAN_PENDING_TURNS[1]),
            tipped: false
          };
          break;
        }
      }
    }

    /* 4. IPO 计时触发（v1.8：总资产>50万解锁，未达门槛顺延1个月） */
    if (!G.ended && G.day >= G.nextIpoDay) {
      if (SL.state.totalAsset(G) > cfg.IPO_UNLOCK_ASSET && !G.specialPending) {
        const ind = this._rollIpoIndustry(G);
        if (ind) {
          /* v2.1.10 用户确认：IPO 预告后需给玩家决策时间（埋伏/观望），再上市。
           * turnsLeft 强制保底2——预告事件弹出后玩家有1个完整交易回合可操作，
           * 避免"预告当回合就上市、零决策窗口"（原复用SWAN_PENDING_TURNS[1,2]会随到1） */
          G.specialPending = {
            type: 'ipo', industryKey: ind.key,
            turnsLeft: cfg.IPO_PREVIEW_TURNS,
            previewed: false
          };
          G.nextIpoDay = SL.state._rollNextIpoDay(G.day);
        } else {
          G.nextIpoDay = SL.state._rollNextIpoDay(G.day); // 名字用尽，重排
        }
      } else {
        G.nextIpoDay = G.day + cfg.DAYS_PER_MONTH; // 未解锁/有在途，顺延一个月再查
      }
    }

    /* 5. 在途退市预警：匿名线索（v1.8：不点名公司，防无风险做空；醒目样式）
     * v2.1.2：面值退市给专属线索文案（股价持续低迷触发） */
    const cur = G.specialPending;
    if (cur && cur.type === 'delist') {
      const isFloor = cur.reason === 'floor';
      news.push({
        stockId: null, type: 'clue', special: 'delist',
        text: isFloor
          ? '有股票因股价持续低于面值，已被交易所启动退市程序（连续多日收盘低于' + cfg.PRICE_FLOOR_DELIST +
            '元）。注意：接近退市的股票有暴涨的可能——是涅槃重生还是彻底退市，下一回合见分晓。'
          : u.pick(SL.data.news.delistClue).text,
        impactPct: 0, dir: 0, fake: false
      });
    }

    return news;
  },

  /* IPO 行业抽取（全行业随机可同行业；名字用尽的行业剔除） */
  _rollIpoIndustry(G) {
    const u = SL.utils;
    const usedNames = new Set(G.stocks.map(s => s.name));
    const pool = SL.data.stocks.INDUSTRIES.filter(i => i.names.some(n => !usedNames.has(n)));
    return pool.length ? u.pick(pool) : null;
  },

  /* ---------------- 外部触发接口（剧情联动预留） ---------------- */
  /* 强制对某只股票启动退市流程（匿名预警，N回合后执行）；已在途则返回 false
   * reason：'random'(默认概率触发) / 'floor'(v2.1.2 面值退市，文案区分) */
  triggerDelist(G, stockId, reason) {
    const cfg = SL.config, u = SL.utils;
    if (G.specialPending) return false;
    const stock = SL.state.getStock(G, stockId);
    if (!stock || stock.delisted) return false;
    /* v2.0.7：预警1回合——turnsLeft=2（本回合出匿名线索，下回合摘牌）。
     * process 先递减：2→1（>0出线索），1→0（执行摘牌），保证玩家有1个完整预警回合 */
    G.specialPending = {
      type: 'delist', stockId,
      reason: reason || 'random',
      turnsLeft: cfg.DELIST_CLUE_TURNS[0] + 1
    };
    return true;
  },

  /* 强制触发一次IPO（可指定行业 key；立即执行，跳过预告） */
  triggerIpo(G, industryKey) {
    const key = industryKey || (this._rollIpoIndustry(G) || {}).key;
    if (!key) return null;
    return this.HANDLERS.ipo.execute(G, { type: 'ipo', industryKey: key });
  },

  /* 强制对某只股票触发正向黑天鹅（立即爆发，幅度25~35%） */
  triggerSurge(G, stockId) {
    return this._detonateSwan(G, { stockId, dir: 1 });
  },

  /* 强制对某只股票触发负向黑天鹅（立即爆发，幅度25~35%） */
  triggerCrash(G, stockId) {
    return this._detonateSwan(G, { stockId, dir: -1 });
  }
};
