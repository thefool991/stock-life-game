/* ============================================================
 * core/player.js — 玩家属性 / 社会关系 / 账单工资 / 行业地位
 *
 * v0.6 模型（用户确认）：
 * - 心情 = 存储值，每回合向目标值漂移；目标值由关系均值+当轮盈亏决定
 * - 经验值 = 交易结算增长（盈多亏少），扛单递减，事件可增减
 * - 运气 = 仅特殊事件可改变
 * - 交易结果 = 区间引擎（宏观/行业/剧情）+ 收窄模型（经验/运气/心情）
 * ============================================================ */
window.SL = window.SL || {};

SL.player = {
  /* ---- 行业地位（按资金划分，v2.0：散户/专业投资者/中户/大户） ---- */
  rank(G) {
    const total = SL.state.totalAsset(G);
    const ranks = SL.config.RANKS;
    let cur = ranks[0];
    for (const r of ranks) if (total >= r.minAsset) cur = r;
    return cur;
  },
  /* 事件库等级（v2.0 用户确认：按历史最高资产解锁，人脉建立后不消失） */
  eventRank(G) {
    const highest = Math.max(G.highestTotalAsset || 0, SL.state.totalAsset(G));
    const ranks = SL.config.RANKS;
    let cur = ranks[0];
    for (const r of ranks) if (highest >= r.minAsset) cur = r;
    return cur;
  },
  /* v2.0：杠杆 = 资产达标(100万) + 解锁事件中选择"开通"（opt-in） */
  leverageUnlocked(G) { return !!(this.rank(G).leverage && G.leverageOptedIn); },
  /* 杠杆解锁事件是否应弹出：资产达标 + 本达标周期内未弹过 + 未开通
   * v2.1.4 用户确认：一旦开通（leverageOptedIn），事件永不再触发 */
  leverageEventDue(G) {
    return !G.ended && !G.leverageNotified && !G.leverageOptedIn &&
      SL.state.totalAsset(G) >= SL.config.LEVERAGE_UNLOCK_ASSET;
  },

  /* ---- 收窄因子（v0.6）：结算端修正系数，封顶、不翻转盈亏 ---- */
  narrowFactor(G) {
    const cfg = SL.config.NARROW, p = G.player;
    const f = cfg.expWeight * (p.exp / 100)
            + cfg.luckWeight * p.luck
            + cfg.psyWeight * (p.psy / 100);
    return Math.min(f, cfg.cap);
  },

  /* ---- 经验值 ---- */
  gainExp(G, amount) {
    const cfg = SL.config;
    G.player.exp = SL.utils.clamp(G.player.exp + amount, cfg.EXP_MIN, cfg.EXP_MAX);
  },

  clampAll(G) {
    const cfg = SL.config, p = G.player;
    p.psy = SL.utils.clamp(p.psy, cfg.PSY_MIN, cfg.PSY_MAX);
    p.exp = SL.utils.clamp(p.exp === undefined ? cfg.START_EXP : p.exp, cfg.EXP_MIN, cfg.EXP_MAX);
    p.luck = SL.utils.clamp(p.luck, cfg.LUCK_MIN, cfg.LUCK_MAX);
    for (const k of Object.keys(p.relations)) {
      p.relations[k] = SL.utils.clamp(p.relations[k], cfg.RELATION_MIN, cfg.RELATION_MAX);
    }
  },

  /* 身份加薪同步（v2.0.2 用户确认）：月薪 = 档位基准(按历史最高等级) + 事件偏移。
   * 档位基准：散户6000/专业7000/中户8000/大户9000；
   * 事件降薪/加薪累计进 salaryOffset（永久减项，不被档位同步重置）。 */
  syncRankSalary(G) {
    const cfg = SL.config;
    const highest = Math.max(G.highestTotalAsset || 0, SL.state.totalAsset(G));
    const ranks = cfg.RANKS;
    let tier = 0;
    for (let i = 0; i < ranks.length; i++) if (highest >= ranks[i].minAsset) tier = i;
    G.player.salary = cfg.SALARY_START + tier * cfg.SALARY_RANK_BONUS + (G.salaryOffset || 0);
    return G.player.salary;
  },

  relationMean(G) {
    const r = G.player.relations;
    return (r.friend + r.love + r.family) / 3;
  },

  /* ---- 心情漂移派生（v0.6 用户确认）：每回合向目标值漂移 ----
   * 目标值 = 基础 + (关系均值-60)×权重 + 盈亏率×100×权重(封顶)
   * "每个周期的盈亏小幅影响心情"即 PNL 修正项 */
  updatePsychology(G, pnlRate) {
    const cfg = SL.config, u = SL.utils;
    const relMean = this.relationMean(G);
    let target = cfg.PSY_TARGET_BASE
      + (relMean - 60) * cfg.PSY_REL_WEIGHT // v2.0：以关系均值60为中性基准（原引用已删除的START_RELATION）
      + u.clamp(pnlRate * 100 * cfg.PSY_PNL_WEIGHT, -cfg.PSY_PNL_CAP, cfg.PSY_PNL_CAP);
    target = u.clamp(target, cfg.PSY_MIN, cfg.PSY_MAX);
    G.player.psy += (target - G.player.psy) * cfg.PSY_DRIFT;
  },

  /* ---- 月薪（v0.6）：随账单同周期发放 ---- */
  paySalary(G) {
    G.cash += G.player.salary;
    return G.player.salary;
  },

  /* ---- 账单 ---- */
  monthlyBills(G) {
    return G.player.bills.reduce((s, b) => s + b.amount, 0);
  },
  /* 月末静默扣除（文档 §11：不弹提示），返回扣款总额 */
  deductMonthlyBills(G) {
    const total = this.monthlyBills(G);
    G.cash -= total;
    return total;
  },

  /* 石油联动（v2.0）：石油行业趋势向上（向好段）→ 月度账单新增/上涨加油费 */
  applyOilBill(G) {
    const cfg = SL.config, p = G.player;
    const sent = G.industrySent['oil']; // 行业key='oil'（石油）
    const exist = p.bills.find(b => b.key === 'fuel');
    if (sent !== undefined && sent > cfg.IND_SENT_DIR) {
      if (!exist) p.bills.push({ key: 'fuel', name: '加油费', amount: 400 });
      return { added: true, sent };
    }
    return { added: false, sent };
  },

  /* ---- 剧情事件效果应用 ----
   * v0.6 规则（用户确认）：
   * - 普通事件选项只影响 亲情/友情/爱情/经验（金钱与账单消耗保留）
   * - 心情由漂移模型派生、运气仅 special 事件可改 —— 数据层遵守，
   *   此处引擎不做强制（保留字段能力，便于特殊事件使用） */
  applyEffect(G, effect) {
    if (!effect) return;
    const u = SL.utils, p = G.player;

    /* 随机分支效果（如砍价50%概率） */
    if (effect.random) {
      let roll = u.rand(), acc = 0;
      for (const branch of effect.random) {
        acc += branch.p;
        if (roll <= acc) { this.applyEffect(G, branch.effect); break; }
      }
    }
    if (effect.cash) G.cash += effect.cash;
    if (effect.exp) this.gainExp(G, effect.exp);
    /* 事件改月薪（v2.0.2）：累计进永久偏移 salaryOffset（降薪不被档位重置），并重算当前月薪 */
    if (effect.salary) { G.salaryOffset = (G.salaryOffset || 0) + effect.salary; this.syncRankSalary(G); }
    /* 身份加薪（v2.0.2）：按历史最高等级重算月薪（档位基准+偏移） */
    if (effect.rankSalary) { this.syncRankSalary(G); }
    /* 意外收入（v0.6）：与运气挂钩 base + luck×luckScale */
    if (effect.windfall) {
      G.cash += effect.windfall.base + p.luck * effect.windfall.luckScale;
    }
    if (effect.psy) p.psy += effect.psy;   // 特殊事件专用
    if (effect.luck) p.luck += effect.luck; // 特殊事件专用
    /* 剧情内线（v1.6 假期事件）：强制生成一条带"内线"标记的消息链 */
    if (effect.chainTip && SL.newsChains) {
      SL.newsChains.forceChain(G, { ...effect.chainTip, revealed: true });
    }
    /* 机构朋友预警（v1.8）：揭示在途黑天鹅的保真行业 */
    if (effect.swanTip && SL.specialEvents) {
      SL.specialEvents.revealSwanIndustry(G);
    }
    /* 石油联动（v2.0）：若石油行业趋势向上 → 新增/上涨加油费账单 */
    if (effect.checkOilBill && SL.player.applyOilBill) {
      SL.player.applyOilBill(G);
    }
    /* 杠杆解锁（v2.0）：开通两融 */
    if (effect.unlockLeverage) { G.leverageOptedIn = true; }
    /* 现金比例变动（v2.0 运气库）：cashRatio>0=需扣当前现金×比例；require.cashRatio=支付能力门槛 */
    if (effect.cashRatio) { G.cash += Math.round(G.cash * effect.cashRatio); }
    if (effect.rel) {
      for (const k of Object.keys(effect.rel)) {
        if (p.relations[k] !== undefined) p.relations[k] += effect.rel[k];
      }
    }
    /* 账单增删改（文档 §7.2：剧情直接增删账单条目） */
    if (effect.billAdd) {
      const exist = p.bills.find(b => b.key === effect.billAdd.key);
      if (exist) exist.amount += effect.billAdd.amount;
      else p.bills.push({ ...effect.billAdd });
    }
    if (effect.billDel) {
      p.bills = p.bills.filter(b => b.key !== effect.billDel);
    }
    const mods = [];
    if (effect.billMod) mods.push(effect.billMod);
    if (effect.billMod2) mods.push(effect.billMod2);
    for (const m of mods) {
      const b = p.bills.find(x => x.key === m.key);
      if (b) b.amount = Math.max(0, b.amount + m.delta);
    }
    this.clampAll(G);
  }
};
