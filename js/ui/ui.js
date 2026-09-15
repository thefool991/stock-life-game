/* ============================================================
 * ui/ui.js — UI 控制器：事件绑定与界面刷新编排
 * ============================================================ */
window.SL = window.SL || {};
SL.ui = SL.ui || {};

Object.assign(SL.ui, {
  P: () => SL.ui.panels,
  M: () => SL.ui.modals,

  init() {
    /* ⚠️ 所有处理器在触发时动态取 SL.state.G，禁止闭包捕获某一局的对象，
     *    否则重开新局后按钮仍操作旧局（画面"跳回上一局"的 bug 根因） */
    const G = () => SL.state.G;
    const P = this.P();

    /* v1.5：短线/长线合并为统一30天周期，交易从两步简化为一步（直接点操作） */

    /* 买卖操作（→ 确认弹窗） */
    document.querySelectorAll('.act-btn').forEach(b => {
      b.onclick = () => this._onAction(G(), b.dataset.action);
    });

    /* 平仓 */
    document.getElementById('btn-close-pos').onclick = () => {
      if (!G().positions.length) return;
      this.M().pickClose(G(), posId => {
        const r = SL.trade.close(G(), posId);
        if (r.ok) {
          /* v2.1.7：点击动作音统一为全局鼠标点击声（index.html），此处不再叠加deal */
          /* v0.9：退市股按冻结价正常结算（方向感知），不再有"血本无归"特判 */
          this._afterTrade(G());
        }
      });
    };

    /* 下一回合 */
    document.getElementById('btn-next-turn').onclick = () => this.nextTurn(G());

    /* 图表切换 */
    document.getElementById('tab-intraday').onclick = () => { G().chartTab = 'intraday'; this._tabSync(); this.renderAll(G()); };
    document.getElementById('tab-kline').onclick = () => { G().chartTab = 'kline'; this._tabSync(); this.renderAll(G()); };

    /* 存档 / 重开 */
    document.getElementById('btn-save').onclick = () => {
      SL.storage.save(G());
      this.M().alert('已存档', '<p>进度已保存，可随时关闭页面。</p>');
    };
    document.getElementById('btn-restart').onclick = () => {
      this.M()._show('<h2>重开新局</h2><div class="mt-body"><p>当前进度将被清除（爆仓只留经验）。确定吗？</p></div>' +
        '<div class="mt-actions"><button class="mt-btn" id="m-cancel">取消</button>' +
        '<button class="mt-btn danger" id="m-ok">重开</button></div>');
      document.getElementById('m-cancel').onclick = () => this.M().close();
      document.getElementById('m-ok').onclick = () => {
        this.M().close();
        SL.storage.clear();
        SL.main.boot(true);
      };
    };

    /* 窗口尺寸变化重绘图表 */
    window.addEventListener('resize', () => { P.renderChart(G()); });
  },

  _tabSync() {
    document.getElementById('tab-intraday').classList.toggle('active', SL.state.G.chartTab !== 'kline');
    document.getElementById('tab-kline').classList.toggle('active', SL.state.G.chartTab === 'kline');
  },

  _onAction(G, actionKey) {
    const stock = SL.state.getStock(G, G.selectedStockId);
    if (!stock) return;
    /* v1.5：统一30天周期，period 参数固定传 'uni'（仅作存档标记） */
    const info = SL.trade.previewOpen(G, stock, actionKey, 'uni');
    if (!info.ok) {
      this.M().alert('无法交易', '<p>' + info.reason + '</p>');
      return;
    }
    this.M().confirmOpen(info, stock, 'uni', () => {
      const r = SL.trade.open(G, stock, actionKey, 'uni');
      if (r.ok) {
        /* v2.1.7：点击动作音统一为全局鼠标点击声，此处不再叠加deal */
        this._afterTrade(G);
      }
    });
  },

  _afterTrade(G) {
    SL.storage.save(G);
    this.renderAll(G);
  },

  selectStock(id) {
    const G = SL.state.G;
    G.selectedStockId = id;
    this.renderAll(G);
  },

  /* ---------------- 下一回合主流程 ---------------- */
  nextTurn(G) {
    const result = SL.turn.advance(G, 'uni'); // v1.5：统一30天周期
    if (!result) return;

    /* 爆仓震屏 + 音效（§3.5 动效；v2.1.7：爆仓用坏事提示音，结算盈亏音由结算弹窗settle统一播放） */
    if (result.liquidations.length) {
      SL.audio.liquidate();
      const app = document.getElementById('app');
      app.classList.remove('shake');
      void app.offsetWidth;
      app.classList.add('shake');
    }
    /* v2.1.7：移除cash()——结算盈亏音已由结算弹窗按pnl播放（金币/坏事），避免重复 */

    this.renderAll(G);

    /* 结算 → 黑天鹅事件 → 剧情事件 → 结局 → 新回合 → 节前预告，依次弹出 */
    this.M().settlement(G, result, () => {
      const proceed = () => {
        if (result.ending) {
          this.M().ending(G, result.ending, () => SL.main.boot(true));
          this.renderAll(G);
          return;
        }
        SL.turn.startTurn(G);
        SL.storage.save(G);
        this.renderAll(G);
        /* v1.6：进入假期回合（月初1号窗口）→ 弹节前预告 */
        const hw = SL.turn.isHolidayWindow(G);
        if (hw) this.M().holidayWarn(G, hw);
      };
      /* 普通剧情事件（在天鹅事件之后弹出） */
      const showPlotEvent = () => {
        if (result.event) {
          this.M().event(result.event, G, choice => {
            SL.player.applyEffect(G, choice.effect);
            SL.storage.save(G);
            this.renderAll(G);
            if (SL.turn.hitBankrupt(G)) {
              this.M().ending(G, G.ending, () => SL.main.boot(true));
              this.renderAll(G);
              return;
            }
            proceed();
          });
        } else {
          proceed();
        }
      };
      /* v2.1：宏观切换提示事件（天鹅事件后、剧情事件前） */
      const showMacroEvent = () => {
        if (result.macroChangeEvent) {
          this.M().event(result.macroChangeEvent, G, choice => {
            SL.player.applyEffect(G, choice.effect);
            SL.storage.save(G);
            this.renderAll(G);
            showPlotEvent();
          });
        } else {
          showPlotEvent();
        }
      };
      /* v2.0.5：黑天鹅爆发事件（结算后优先弹出，盈亏已含在结算总额里） */
      if (result.swanEvent) {
        this.M().event(result.swanEvent, G, choice => {
          SL.player.applyEffect(G, choice.effect);
          SL.storage.save(G);
          this.renderAll(G);
          showMacroEvent();
        });
      } else {
        showMacroEvent();
      }
    });
  },

  /* ---------------- 全量刷新 ---------------- */
  renderAll(G) {
    const P = this.P();
    P.renderTopbar(G);
    P.renderMacroNews(G);
    P.renderRole(G);
    P.renderStockList(G);
    P.renderChart(G);
    P.renderQuote(G);
    P.renderPositions(G);
    P.renderNews(G);
    P.renderTradeBar(G);
  }
});
