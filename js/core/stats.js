/* ============================================================
 * core/stats.js — 百度统计埋点（最简版）
 * 只统计两件事：开始玩的时刻 → 离开页面时上报「累计时长(秒) + 结束时回合数」
 *
 * 依赖 <head> 中的百度统计代码（window._hmt）。未安装时全部静默跳过，不影响游戏运行。
 * 事件结构（百度统计硬限制：category×action×label 组合数乘积 ≤ 10000）：
 *   category = 游戏时长（固定）
 *   action   = 离开页面（固定）
 *   label    = 回合N（有限取值，N 为整数，不会撑爆多样性）
 *   value    = 秒数（报表中可看平均值）
 * ============================================================ */
window.SL = window.SL || {};

SL.stats = {
  t0: 0,        // 本次游玩起始时间戳（ms），0 表示未开始
  _lastAt: 0,   // 上次上报时间，用于去重

  /* 开始计时。在 SL.main.boot() 末尾调用，一次覆盖新局 / 读档 / 重开三种进入方式 */
  start() {
    this.t0 = Date.now();
    this._lastAt = 0;
  },

  /* 上报累计时长。trigger 用于区分触发来源 */
  report(trigger) {
    if (!this.t0 || !window._hmt) return;
    const now = Date.now();
    if (now - this._lastAt < 3000) return;   // visibilitychange 与 pagehide 会接连触发，3秒内去重
    const sec = Math.round((now - this.t0) / 1000);
    if (sec < 5) return;                     // 过短视为误触 / 秒退，不计入
    const G = (SL.state && SL.state.G) || {};
    _hmt.push(['_trackEvent', '游戏时长', trigger, '回合' + (G.turn || 0), sec]);
    this._lastAt = now;
  },

  /* 绑定离开页面事件
   * visibilitychange：覆盖切标签页 / 关闭 / 移动端切后台（现代浏览器主推）
   * pagehide        ：覆盖部分浏览器卸载时不触发 visibilitychange 的场景 */
  bind() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.report('离开页面');
    });
    window.addEventListener('pagehide', () => this.report('离开页面'));
  }
};

SL.stats.bind();
