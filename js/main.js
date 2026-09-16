/* ============================================================
 * main.js — 入口：读档或开新局
 * ============================================================ */
window.SL = window.SL || {};

/* 桌面场景：背景图注入 + UI 等比缩放（布局尺寸全为 em，缩放舞台 font-size 即可） */
SL.desk = {
  BASE_W: 1920,   // 基准舞台宽度（此时字号 13px）
  BASE_FS: 13,
  init() {
    const stage = document.getElementById('desk-stage');
    const bg = SL.assets.get('bg_desk');
    if (bg) stage.style.backgroundImage = 'url("' + bg + '")';
    const fit = () => {
      stage.style.fontSize = (stage.clientWidth / this.BASE_W * this.BASE_FS) + 'px';
      /* 窗口变化后 Canvas 需按新尺寸重绘 */
      if (SL.state.G && SL.ui && SL.ui.renderAll) SL.ui.renderAll(SL.state.G);
    };
    window.addEventListener('resize', fit);
    this._fit = fit;
    fit();
  }
};

SL.main = {
  boot(fresh) {
    let G = null;
    if (!fresh) G = SL.storage.load();

    if (G) {
      /* 读档恢复（§12：完整恢复资金、持仓、股票池、关系、账单、历史） */
      SL.state.G = G;
      /* 恢复持仓/股票 id 序列，避免新对象 id 冲突 */
      const maxStk = G.stocks.reduce((m, s) => Math.max(m, +(s.id.replace('stk', '') || 0)), 0);
      const maxPos = G.positions.reduce((m, p) => Math.max(m, +(p.id.replace('pos', '') || 0)), 0);
      SL.market._idSeq = maxStk + 1;
      SL.trade._posSeq = maxPos + 1;
      /* 终局存档不再继续，直接开新局 */
      if (G.ended) G = null;
    }

    if (!G) {
      G = SL.state.newGame();
      SL.state.G = G;
      SL.turn.startTurn(G); // 生成开局新闻
      SL.storage.save(G);
    }

    /* UI 初始化（幂等） */
    if (!this._inited) {
      G.chartTab = G.chartTab || 'intraday';
      SL.ui.init(G);
      this._inited = true;
    }
    SL.ui._tabSync();
    SL.ui.renderAll(G);

    /* v2.1.8 开局剧情弹窗：仅首次进入/读档时弹出（!fresh）；重开（fresh=true）不弹 */
    if (!fresh && !this._introShown) {
      this._introShown = true;
      SL.ui.M().intro(() => {});
    }

    /* 统计计时起点：新局 / 读档 / 重开三种进入方式都在此汇合，一处覆盖 */
    SL.stats.start();
  }
};

window.addEventListener('DOMContentLoaded', () => {
  SL.desk.init();
  /* v2.4：初始化背景音乐（挂首次交互自动启动监听，循环播放） */
  if (SL.audio && SL.audio.bgm) SL.audio.bgm.init();
  SL.main.boot(false);
});
