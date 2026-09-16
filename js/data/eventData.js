/* ============================================================
 * data/eventData.js — 剧情事件库（v2.0 分级事件库大改版）
 *
 * v2.0 规则（用户确认）：
 * - 等级：散户(<50万)/专业投资者(50万)/中户(100万)/大户(300万)
 * - 事件库按"历史最高等级"解锁（人脉建立后不消失，contentProvider 用 eventRank）
 * - minRank: 'pro'|'middle'|'big' 标记分级事件，无标记=散户池（所有人共享）
 * - pack: 'luck' = 运气事件库（都市怪谈风，可改运气）
 * - 账单联动：billAdd/billMod/checkOilBill 等效果字段见 player.applyEffect
 *
 * 事件总数控制在55个以内（用户确认上限）。
 * ============================================================ */
window.SL = window.SL || {};
SL.data = SL.data || {};

SL.data.events = [
  /* ============================================================
   * 散户池（所有等级共享）—— 生活/事业/亲情/友情/爱情基础盘
   * ============================================================ */
  /* ---- 友情 ---- */
  {
    id: 'friend_party', type: '友情', weight: 3,
    title: '朋友聚会邀请',
    text: '老同桌打来电话："周末攒了个局，都是以前的老朋友，就等你了。"看了一眼复盘计划，你有些犹豫。',
    choices: [
      { label: '爽快赴约，主动买单', hint: '现金 -1000，友情 +4',
        effect: { cash: -1000, rel: { friend: 4 } } },
      { label: '去，但只 AA 自己的那份', hint: '现金 -200，友情 +1',
        effect: { cash: -200, rel: { friend: 1 } } },
      { label: '推说有事，不去了', hint: '友情 -4，经验 +0.4（抓紧复盘）',
        effect: { rel: { friend: -4 }, exp: 0.4 } }
    ]
  },
  {
    id: 'friend_borrow', type: '友情', weight: 1,
    title: '朋友开口借钱',
    text: '发小吞吞吐吐地打来电话，说生意周转不开，想借两万块，三个月就还。',
    choices: [
      { label: '借！谁还没个难处', hint: '现金 -20000，友情 +7',
        effect: { cash: -20000, rel: { friend: 7 } } },
      { label: '借五千意思一下', hint: '现金 -5000，友情 +3',
        effect: { cash: -5000, rel: { friend: 3 } } },
      { label: '婉拒：钱都套在股市里', hint: '友情 -8',
        effect: { rel: { friend: -8 } } }
    ]
  },
  /* ---- 爱情 ---- */
  {
    id: 'love_anniversary', type: '爱情', weight: 1,
    title: '纪念日晚餐',
    text: '伴侣提前一周就订好了餐厅："这次你可不许再看手机了。"而那天下午，你的持仓正好出财报。',
    choices: [
      { label: '准时赴约，手机关机', hint: '现金 -1000，爱情 +6',
        effect: { cash: -1000, rel: { love: 6 } } },
      { label: '赴约，但中途溜出去看了几眼，有些心不在焉', hint: '现金 -1000，爱情 +2，经验 +0.4',
        effect: { cash: -1000, rel: { love: 2 }, exp: 0.4 } },
      { label: '打个电话：今晚很重要，改天补偿你', hint: '爱情 -10，经验 +1.0',
        effect: { rel: { love: -10 }, exp: 1.0 } }
    ]
  },
  {
    id: 'love_movein', type: '爱情', weight: 1, once: true, // v2.0.2：最多触发一次
    title: '同居的提议',
    text: '伴侣认真地和你算了笔账："搬过来一起住吧，房租能省下一半，就是上班远了点。"',
    choices: [
      { label: '搬！两个人一起扛', hint: '房租 -1000/月，爱情 +8，通讯交通 +300/月',
        effect: { rel: { love: 8 }, billMod: { key: 'rent', delta: -1000 }, billMod2: { key: 'commute', delta: 300 } } },
      { label: '再等等，现在状态不稳定', hint: '爱情 -5',
        effect: { rel: { love: -5 } } }
    ]
  },
  {
    id: 'love_fight', type: '爱情', weight: 2,
    title: '深夜的争吵',
    text: '"你心里到底还有没有这个家？涨了你兴奋，跌了你摔门，我像个看客！"伴侣红着眼睛。',
    choices: [
      { label: '道歉，答应每天留出不看盘的时间', hint: '爱情 +5，经验 -1.0（复盘时间被挤占）',
        effect: { rel: { love: 5 }, exp: -1.0 } },
      { label: '"我这是在为我们将来搏！"', hint: '爱情 -3',
        effect: { rel: { love: -3 } } }
    ]
  },
  /* ---- 亲情 ---- */
  {
    id: 'family_sick', type: '亲情', weight: 1,
    title: '父母身体不适',
    text: '母亲在电话里轻描淡写："你爸最近总说胸闷，去医院查了，医生让住院观察几天。"',
    choices: [
      { label: '立刻请假回老家陪床', hint: '亲情 +7，经验 -1.5（离开市场一段时间）',
        effect: { rel: { family: 7 }, exp: -1.5 } },
      { label: '转一笔钱，请最好的医生', hint: '现金 -12000，亲情 +4',
        effect: { cash: -12000, rel: { family: 4 } } },
      { label: '"应该没事吧，我忙完这阵就回去"', hint: '亲情 -5',
        effect: { rel: { family: -5 } } }
    ]
  },
  {
    id: 'family_call', type: '亲情', weight: 3,
    title: '母亲的来电',
    text: '你正盯着分时线，母亲的电话进来了。她絮絮叨叨说着家里的琐事，菜价、邻居、你爸的血压。',
    choices: [
      { label: '耐心听完，陪她聊了半小时', hint: '亲情 +3，经验 -0.4（打断了盯盘）',
        effect: { rel: { family: 3 }, exp: -0.4 } },
      { label: '"妈，我在忙，晚点说。"挂断', hint: '亲情 -1',
        effect: { rel: { family: -1 } } }
    ]
  },
  {
    id: 'family_home', type: '亲情', weight: 2,
    title: '回家看看',
    text: '表姐发来消息："舅舅总念叨你，说你快一年没回家了。"',
    choices: [
      { label: '买张票，周末就回', hint: '现金 -1400，亲情 +4',
        effect: { cash: -1400, rel: { family: 4 } } },
      { label: '寄点保健品回去', hint: '现金 -700，亲情 +2',
        effect: { cash: -700, rel: { family: 2 } } }
    ]
  },
  /* ---- 事业 ---- */
  {
    id: 'career_overtime', type: '事业', weight: 2,
    title: '加班 vs 陪家人',
    text: '主管在群里@你：项目冲刺，这周晚上都得在岗。而家里，伴侣已经连续三天一个人吃晚饭了。',
    choices: [
      { label: '留下加班，拼一把绩效', hint: '现金 +3000，爱情 -2，亲情 -1',
        effect: { cash: 3000, rel: { love: -2, family: -1 } } },
      { label: '到点就走，工作明天再说', hint: '爱情 +2，亲情 +1',
        effect: { rel: { love: 2, family: 1 } } }
    ]
  },
  {
    id: 'career_promotion', type: '事业', weight: 1,
    title: '加薪的机会',
    text: '主管找你谈话："有个硬骨头项目，接下来加薪幅度好谈，但基本告别准时下班。"你摸了摸兜里的手机，盘面还在跳。',
    choices: [
      { label: '接下项目，全力加薪', hint: '工资 +1500/月，经验 -0.8，亲情 -2（没精力复盘和顾家）',
        effect: { salary: 1500, exp: -0.8, rel: { family: -2 } } },
      { label: '婉拒，保住自己的生活节奏', hint: '经验 +0.4，亲情 +2',
        effect: { exp: 0.4, rel: { family: 2 } } }
    ]
  },
  {
    id: 'career_quit', type: '事业', weight: 1,
    title: '辞职的念头',
    text: '连续第三个深夜，你盯着天花板想：要不辞了职，全职炒股？',
    choices: [
      { label: '再忍忍，两条腿走路稳', hint: '经验 +0.5（想通了一些事）',
        effect: { exp: 0.5 } },
      { label: '把辞职信写好了，存在草稿箱', hint: '月薪 -1000/月（工作热情消退），经验 +3（破釜沉舟的决心）',
        effect: { salary: -1000, exp: 3 } }
    ]
  },
  /* ---- 生活 ---- */
  {
    id: 'life_rent', type: '生活', weight: 1,
    title: '房东涨租',
    text: '房东发来消息："小伙子，周边都涨了，下个月起房租加600，你看着办。"',
    choices: [
      { label: '忍了，接受涨租', hint: '房租 +600/月',
        effect: { billMod: { key: 'rent', delta: 600 } } },
      { label: '搬家！换个便宜点的地方', hint: '现金 -3000（搬家费），房租 -300/月',
        effect: { cash: -3000, billMod: { key: 'rent', delta: -300 } } },
      { label: '跟房东软磨硬泡砍价', hint: '50%概率房租不变，失败则 +400/月',
        effect: { random: [
          { p: 0.5, effect: {} },
          { p: 0.5, effect: { billMod: { key: 'rent', delta: 400 } } }
        ] } }
    ]
  },
  {
    id: 'life_luxury', type: '生活', weight: 1,
    title: '消费升级的诱惑',
    text: '最近赚了一笔，购物APP给你推了块表。戴上它，酒局上确实更有面子。',
    choices: [
      { label: '买！赚钱不就是为了这个', hint: '现金 -4500，友情 +3（面子也是社交货币）',
        effect: { cash: -4500, rel: { friend: 3 }, billMod: { key: 'food', delta: 200 } } },
      { label: '忍住，本金要紧', hint: '经验 +0.8（纪律性+1）',
        effect: { exp: 0.8 } }
    ]
  },
  {
    id: 'life_review', type: '生活', weight: 3,
    title: '周末怎么过',
    text: '难得的周末。朋友组了局喊你出门，但你翻了翻这个月的交易记录，好几笔操作现在看来都莫名其妙。',
    choices: [
      { label: '留在家复盘，写三条纪律', hint: '经验 +0.4',
        effect: { exp: 0.4 } },
      { label: '出门玩！劳逸结合', hint: '现金 -500，友情 +3',
        effect: { cash: -500, rel: { friend: 3 } } }
    ]
  },
  /* ---- 账单联动（v2.0：收支随身份变化） ---- */
  {
    id: 'life_sidejob', type: '事业', weight: 1,
    title: '副业的机会',
    text: '大学同学在做短视频账号，问你周末能不能帮忙剪片子，按条结算，一个月能多一两千。',
    choices: [
      { label: '接下来，多条腿走路', hint: '工资 +1500/月，爱情 -5（周末没了），经验 -0.5（复盘时间被挤占）',
        effect: { salary: 1500, rel: { love: -5 }, exp: -0.5 } },
      { label: '算了，精力有限', hint: '经验 +0.1',
        effect: { exp: 0.1 } }
    ]
  },
  {
    id: 'life_rel_upkeep', type: '生活', weight: 2, minRank: 'pro',
    title: '维护关系的开销',
    text: '最近组局的人越来越"有分量"，饭局档次也水涨船高。这个月的社交支出单看着有点肉疼。',
    choices: [
      { label: '继续，圈子就是资源', hint: '社交 +600/月，友情 +5',
        effect: { billMod: { key: 'social', delta: 600 }, rel: { friend: 5 } } },
      { label: '收敛一点，回归家庭', hint: '社交 -300/月，亲情 +3',
        effect: { billMod: { key: 'social', delta: -300 }, rel: { family: 3 } } }
    ]
  },
  {
    id: 'life_fuel', type: '生活', weight: 1,
    title: '油价又涨了',
    text: '加油站排队时刷到新闻：石油行业景气度持续走高。你看了眼自己的油箱，突然觉得每个月多了一笔固定开销。',
    choices: [
      { label: '看看石油板块是不是要起飞', hint: '若石油行业趋势向上 → 月度账单+加油费400/月（联动盘面）',
        effect: { checkOilBill: true } },
      { label: '想多了，加满就走', hint: '无效果',
        effect: null }
    ]
  },

  /* ============================================================
   * 专业投资者池（minRank:'pro'，50万解锁）—— 券商圈初入门
   * ============================================================ */
  {
    id: 'pro_broker_approach', type: '人脉', weight: 3, minRank: 'pro',
    title: '券商员工前来接触',
    text: '你的客户经理换了人，新来的小伙子格外热情："您这个资金量，很多服务都可以升级了，方便约个时间聊聊吗？"',
    choices: [
      { label: '聊聊，看看有什么资源', hint: '现金 -500（请客），友情 +3，经验 +0.4',
        effect: { cash: -500, rel: { friend: 3 }, exp: 0.4 } },
      { label: '不必了，我自己看盘', hint: '经验 +0.1',
        effect: { exp: 0.1 } }
    ]
  },
  {
    id: 'pro_margin_intro', type: '人脉', weight: 2, minRank: 'pro', leverageGuide: true,
    title: '两融业务的推介',
    text: '券商朋友递来一份材料："您的资质可以申请融资融券了，放大收益——当然，也放大风险。要不要先了解下？"',
    choices: [
      { label: '认真学习规则，先模拟一下', hint: '经验 +0.6（为杠杆做准备）',
        effect: { exp: 0.6 } },
      { label: '风险太大，暂时不碰', hint: '经验 +0.2（纪律性）',
        effect: { exp: 0.2 } }
    ]
  },
  {
    id: 'pro_research_report', type: '人脉', weight: 2, minRank: 'pro',
    title: '内部研报的试读',
    text: '客户经理发来一份"机构专享"研报试读版："这份是VIP服务的内容，您先看看质量，觉得值再谈订阅。"',
    choices: [
      { label: '订阅一年', hint: '现金 -5000，经验 +0.8，社交 +200/月',
        effect: { cash: -5000, exp: 0.8, billMod: { key: 'social', delta: 200 } } },
      { label: '内容一般，婉拒', hint: '经验 +0.1',
        effect: { exp: 0.1 } }
    ]
  },
  {
    id: 'pro_car_upgrade', type: '生活', weight: 1, minRank: 'pro',
    title: '换辆像样的车',
    text: '几次饭局下来，你发现大家聊车比聊股还起劲。那辆开了五年的代步车，似乎有点拿不出手了。',
    choices: [
      { label: '换！面子也是生产力', hint: '现金 -80000，友情 +10，通讯交通 +300/月（保险保养）',
        effect: { cash: -80000, rel: { friend: 10 }, billMod: { key: 'commute', delta: 300 } } },
      { label: '车能开就行，本金要紧', hint: '经验 +0.8',
        effect: { exp: 0.8 } }
    ]
  },

  /* ============================================================
   * 中户池（minRank:'middle'，100万解锁）—— 机构圈、私行、杠杆
   * ============================================================ */
  {
    id: 'mid_privatebank', type: '人脉', weight: 2, minRank: 'middle', special: true, leverageGuide: true,
    title: '私行客户经理',
    text: '券商工作人员打来电话，态度恭敬："您已达到我们的资金门槛，有专属理财和两融优惠利率，要不要聊聊？"',
    choices: [
      { label: '约时间详谈', hint: '运气 +0.05，经验 +1.2',
        effect: { luck: 0.05, exp: 1.2, } },
      { label: '婉拒，自己的节奏自己掌握', hint: '经验 +0.2',
        effect: { exp: 0.2 } }
    ]
  },
  {
    id: 'mid_media', type: '人脉', weight: 1, minRank: 'middle', special: true,
    title: '财经节目邀约',
    text: '一档财经节目想请你做嘉宾，聊聊"散户逆袭"的故事。镜头前说错话，可是要被截图的。',
    choices: [
      { label: '上！打出名气', hint: '运气 +0.05，爱情 -3（伴侣担心你太高调）',
        effect: { luck: 0.05, rel: { love: -3 } } },
      { label: '低调为上，推掉', hint: '经验 +0.6',
        effect: { exp: 0.6 } }
    ]
  },
  {
    id: 'mid_club', type: '人脉', weight: 1, minRank: 'middle',
    title: '投资者俱乐部',
    text: '有人拉你进一个"百万俱乐部"的私密群，群里每天分享盘口观察和行业调研，年费两万。',
    choices: [
      { label: '付费加入，抱团取暖', hint: '现金 -20000，经验 +1.5，友情 +4，社交 +500/月',
        effect: { cash: -20000, exp: 1.5, rel: { friend: 4 }, billMod: { key: 'social', delta: 500 } } },
      { label: '先观望，怕是收割群', hint: '经验 +0.2',
        effect: { exp: 0.2 } }
    ]
  },
  {
    id: 'mid_charity', type: '生活', weight: 1, minRank: 'big', special: true, // v2.0.2：300万（大户）才触发
    title: '慈善晚宴的请柬',
    text: '本地商会寄来一张慈善晚宴请柬，"各界精英"都会到场。捐赠席位十万起，但名单会印在会刊上。',
    choices: [
      { label: '捐，名利双收', hint: '现金 -50000，友情 +6，运气 +0.1（人脉带来机会）',
        effect: { cash: -50000, rel: { friend: 6 }, luck: 0.1 } },
      { label: '婉拒，钱要花在刀刃上', hint: '经验 +1.6',
        effect: { exp: 1.6 } }
    ]
  },
  {
    id: 'mid_home_upgrade', type: '生活', weight: 1, minRank: 'middle',
    title: '改善居住条件',
    text: '伴侣看中了一套离市中心更近的房子："现在负担得起了，要不换个大点的？"中介已经在催了。',
    choices: [
      { label: '换！生活质量要跟上', hint: '现金 -100000（首付），房租 -1200/月，爱情 +10',
        effect: { cash: -100000, billMod: { key: 'rent', delta: -1200 }, rel: { love: 10 } } },
      { label: '先不换，股市里用钱的地方多', hint: '爱情 -4',
        effect: { rel: { love: -4 } } }
    ]
  },
  /* ---- 杠杆解锁（v2.0：100万达成回合强制弹出，双选项） ---- */
  {
    id: 'mid_leverage_unlock', type: '事业', weight: 99, minRank: 'middle', special: true,
    title: '两融账户开通资格',
    text: '券商正式通知：您的资产已满足融资融券开通条件。杠杆能放大收益——但请记住，35% 的反向波动就会让您的本金归零，爆仓只在一瞬间。高收益的另一面，从来都是高风险。',
    choices: [
      { label: '开通两融，接受风险', hint: '解锁杠杆交易（做多/做空杠杆按钮开放）',
        effect: { unlockLeverage: true } },
      { label: '暂不开通，先稳扎稳打', hint: '经验 +1.2（自律），杠杆按钮暂时锁定（资产再次达标时可再开）',
        effect: { exp: 0.3 } }
    ]
  },

  /* ============================================================
   * 运气事件库（pack:'luck'，都市怪谈风，可改运气；special:true）
   * ============================================================ */
  {
    id: 'luck_jade', type: '生活', weight: 1, pack: 'luck', special: true,
    title: '街边的算命先生',
    text: '那天你走在街上，旁边的算命先生一把拉住你："这位先生，你印堂发亮，但财运卡在瓶颈——这块玉佩，开过光的，要不要请一块？"玉佩标价是你现金的四分之一。',
    choices: [
      { label: '请一块，宁可信其有', hint: '运气 +0.2，现金 -25%（当前现金）',
        require: { cash: 1 },
        effect: { luck: 0.2, cashRatio: -0.25 } },
      { label: '江湖骗子，走了', hint: '经验 +0.5',
        effect: { exp: 0.5 } }
    ]
  },
  {
    id: 'luck_coin', type: '生活', weight: 1, pack: 'luck', special: true,
    title: '许愿池的硬币',
    text: '路过商场许愿池，你摸出一枚硬币。身后小孩突然说："叔叔，扔反了要倒霉的。"你手一抖——硬币立着卡在了池边。',
    choices: [
      { label: '捞起来，重新许个愿', hint: '运气 +0.1，现金 -100（给小孩买糖）',
        effect: { luck: 0.1, cash: -100 } },
      { label: '不理会，走了', hint: '无效果', effect: null }
    ]
  },
  {
    id: 'luck_mirror', type: '生活', weight: 1, pack: 'luck', special: true,
    title: '凌晨四点的镜子',
    text: '连续亏损后，你在凌晨四点惊醒。卫生间的镜子里，你看见自己身后站着一个模糊的人影，穿着和你一样的衣服，只是表情平静得可怕。第二天开盘，你的直觉异常敏锐。',
    choices: [
      { label: '相信那个"自己"', hint: '运气 +0.15，心情 -10（精神压力的代价）',
        effect: { luck: 0.15, psy: -10 } },
      { label: '只是太累了，继续睡', hint: '经验 +0.1',
        effect: { exp: 0.1 } }
    ]
  },
  {
    id: 'luck_oldbook', type: '人脉', weight: 1, pack: 'luck', special: true,
    title: '旧书摊的笔记本',
    text: '旧书摊上，你花十块钱买了本泛黄的《炒股手记》。扉页写着："赠有缘人——1987年，我在这本书里躲过了三次股灾。"当晚你做了个梦，梦里有人对你说："第二根涨停的阳线，别追。"',
    choices: [
      { label: '把手记供在电脑旁', hint: '运气 +0.15，经验 +0.3（前人的智慧）',
        effect: { luck: 0.18, exp: 0.3 } },
      { label: '当故事会看完就扔', hint: '经验 +0.1',
        effect: { exp: 0.1 } }
    ]
  },

  /* ============================================================
   * 玩法提示事件（v2.0.8 用户新增，pack:'tip'）
   * 教学性质：以事件形式向玩家提示游戏机制；weight 统一1；
   * 按等级分层（minRank），向下兼容——高等级仍可触发低等级提示，
   * 散户无法触发高等级提示（eventRank 按历史最高等级过滤已实现）
   * ============================================================ */
  /* ---- 散户阶段（经验+0.4） ---- */
  {
    id: 'tip_retail_rumor', type: '生活', weight: 1, pack: 'tip',
    title: '复盘时的醒悟',
    text: '某一天你在复盘的时候意识到，个股传闻不一定为真——那些"内幕"和"小道消息"，可能只是市场喂给你的饵料。',
    choices: [{ label: '记下来：传闻要验证', hint: '经验 +0.4', effect: { exp: 0.4 } }]
  },
  {
    id: 'tip_retail_position', type: '生活', weight: 1, pack: 'tip',
    title: '仓位的余地',
    text: '你看着满仓的账户，忽然明白：留出一些仓位，也许会有更多的选择——机会来临时，手里有钱才抓得住。',
    choices: [{ label: '记下来：别打满', hint: '经验 +0.4', effect: { exp: 0.4 } }]
  },
  {
    id: 'tip_retail_luck', type: '生活', weight: 1, pack: 'tip',
    title: '运气的成分',
    text: '连续几次"操作正确却亏损"之后，你不得不服：有时候，投资结果也是要看运气的。尽力而为，剩下的交给概率。',
    choices: [{ label: '记下来：接受不确定性', hint: '经验 +0.4', effect: { exp: 0.4 } }]
  },
  {
    id: 'tip_retail_mood', type: '生活', weight: 1, pack: 'tip',
    title: '心情的账户',
    text: '盯着盘的日子久了，你发现状态越来越差。除了复盘，偶尔也该关注一下心情——疲惫的判断，往往是最差的判断。',
    choices: [{ label: '记下来：照顾自己', hint: '经验 +0.4', effect: { exp: 0.4 } }]
  },
  {
    id: 'tip_retail_stoploss', type: '生活', weight: 1, pack: 'tip',
    title: '止损的代价',
    text: '那笔扛了很久的单子最终还是爆了。你默默写下：有时候该止损就止损，扛单是有后果的。',
    choices: [{ label: '记下来：别硬扛', hint: '经验 +0.4', effect: { exp: 0.4 } }]
  },
  /* ---- 资深投资者阶段（经验+0.8，minRank:'pro'） ---- */
  {
    id: 'tip_pro_industry_cycle', type: '生活', weight: 1, pack: 'tip', minRank: 'pro',
    title: '行业趋势的周期',
    text: '翻了几个月的行业趋势图，你隐约摸到一个规律：好像一个行业趋势很难超过7个月——再强的景气，也有转段的一天。',
    choices: [{ label: '记下来：趋势有期限', hint: '经验 +0.8', effect: { exp: 0.8 } }]
  },
  {
    id: 'tip_pro_industry_first', type: '生活', weight: 1, pack: 'tip', minRank: 'pro',
    title: 'K线前的明悟',
    text: '你看着K线突然有所明悟——比起个股，选好行业更重要。风口上，平庸的公司也会起飞；逆风里，再强的个股也挣扎。',
    choices: [{ label: '记下来：先看行业', hint: '经验 +0.8', effect: { exp: 0.8 } }]
  },
  {
    id: 'tip_pro_crisis_swan', type: '生活', weight: 1, pack: 'tip', minRank: 'pro',
    title: '危机中的雷',
    text: '几轮行情下来你发现一个规律：金融危机时，黑天鹅好像更多一些。越是风声鹤唳，越要系紧安全带。',
    choices: [{ label: '记下来：危机防雷', hint: '经验 +0.8', effect: { exp: 0.8 } }]
  },
  /* ---- 中户阶段（经验+1.2，minRank:'middle'） ---- */
  {
    id: 'tip_mid_bull_length', type: '生活', weight: 1, pack: 'tip', minRank: 'middle',
    title: '牛市的长度',
    text: '这轮牛市能超过11个月吗？你翻着历史数据琢磨——宏观周期有它的节奏，别在鱼尾行情里加仓。',
    choices: [{ label: '记下来：牛市也有尽头', hint: '经验 +1.2', effect: { exp: 1.2 } }]
  },
  {
    id: 'tip_mid_leverage_risk', type: '生活', weight: 1, pack: 'tip', minRank: 'middle',
    title: '杠杆的双刃',
    text: '看着两融账户，你提醒自己：轻易上杠杆会有爆仓的风险，谨慎使用——35%的反向波动，就足以让本金归零。',
    choices: [{ label: '记下来：敬畏杠杆', hint: '经验 +1.2', effect: { exp: 1.2 } }]
  },
  {
    id: 'tip_mid_ipo_hint', type: '生活', weight: 1, pack: 'tip', minRank: 'middle',
    title: '新股的风声',
    text: '要是能提前知道哪个行业有新股上市，这个行业似乎可以提前埋伏？上市当天的联动效应，值得琢磨。',
    choices: [{ label: '记下来：留意新股动向', hint: '经验 +1.2', effect: { exp: 1.2 } }]
  },

  /* ============================================================
   * 长假纯剧情（休市强制触发；v2.0 门槛调整）
   * ============================================================ */
  {
    id: 'spring_table_tip', type: '亲情', weight: 3, holiday: true, pack: 'spring',
    title: '餐桌上的小道消息',
    text: '新春长假的家宴上，在上市公司做财务的表哥喝高了，凑到你耳边："我们隔壁那家公司，节后有个大单子要官宣……"',
    choices: [
      { label: '竖起耳朵，追问细节', hint: '提前得知一家公司节后的利好消息（需亲情≥' + (SL.config.HOLIDAY_TIP_FAMILY || 68) + '）',
        require: { rel: { family: SL.config.HOLIDAY_TIP_FAMILY || 68 } },
        effect: { chainTip: { dir: 1, truth: true }, rel: { family: 2 } } },
      { label: '给表哥倒酒，岔开话题', hint: '亲情 +1',
        effect: { rel: { family: 1 } } }
    ]
  },
  {
    id: 'golden_friend_tip', type: '友情', weight: 3, holiday: true, pack: 'golden',
    title: '老友的风险提示',
    text: '金秋长假，你做东请券商工作的老友吃饭。酒过三巡，老友压低声音："有家公司，我们内部已经把它列入风险名单了……这顿不能让你白请。"',
    choices: [
      { label: '这顿我请，细说', hint: '现金 -4000，提前得知一家公司存在风险（需友情≥70、现金≥4000）',
        require: { rel: { friend: 70 }, cash: 4000 },
        effect: { cash: -4000, chainTip: { dir: -1, truth: true } } },
      { label: '还是聊点别的吧', hint: '友情 +2',
        effect: { rel: { friend: 2 } } }
    ]
  },
  {
    id: 'holiday_travel', type: '生活', weight: 2, holiday: true,
    title: '难得的假期',
    text: '休市了，盘也不用看了。伴侣把手机递过来："机票我看了好几天了，就等你点头。"',
    choices: [
      { label: '走！好好玩一趟', hint: '现金 -5000，爱情 +8',
        effect: { cash: -5000, rel: { love: 8 } } },
      { label: '在家复盘这周的操作', hint: '经验 +0.6，爱情 -2',
        effect: { exp: 0.6, rel: { love: -2 } } }
    ]
  },
  {
    id: 'holiday_think', type: '生活', weight: 2, holiday: true,
    title: '深夜复盘',
    text: '假期最后一晚，你翻开交易记录，一笔一笔复盘。窗外的烟花响了一阵，又归于平静。',
    choices: [
      { label: '认真总结，写下三条纪律', hint: '经验 +0.8',
        effect: { exp: 0.8 } },
      { label: '算了，假期就该放空', hint: '亲情 +2（陪家人看了场晚会）',
        effect: { rel: { family: 2 } } }
    ]
  }
];

