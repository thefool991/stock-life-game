/* ============================================================
 * render/audio.js — 音效接口（文档 §13：Web Audio API 合成）
 * 本期为轻量合成音；接入真实音频文件后，在 data/assets.js
 * 的 MANIFEST 填入路径即自动改用文件播放，无需改本模块逻辑。
 * ============================================================ */
window.SL = window.SL || {};

SL.audio = {
  _ctx: null,
  enabled: true,

  _ac() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this._ctx = new AC();
    }
    return this._ctx;
  },

  /* key: assets.MANIFEST 中的键；fallback: 合成参数 {freq, dur, type} */
  play(key, fallback) {
    if (!this.enabled) return;
    const url = SL.assets.get(key);
    if (url) {
      const a = new Audio(url);
      a.play().catch(() => {});
      return;
    }
    if (!fallback) return;
    const ac = this._ac();
    if (!ac) return;
    try {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = fallback.type || 'sine';
      osc.frequency.value = fallback.freq || 440;
      gain.gain.setValueAtTime(0.08, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + (fallback.dur || 0.15));
      osc.connect(gain); gain.connect(ac.destination);
      osc.start(); osc.stop(ac.currentTime + (fallback.dur || 0.15));
    } catch (e) {}
  },

  deal()      { this.play('sfx_deal', { freq: 660, dur: 0.1, type: 'square' }); },
  cash()      { this.play('sfx_cash', { freq: 880, dur: 0.2 }); },
  /* v2.1.7：爆仓用坏事提示音（sfx_loss）；事件弹窗用鼠标点击声（sfx_click） */
  liquidate() { this.play('sfx_loss', { freq: 160, dur: 0.5, type: 'sawtooth' }); },
  event()     { this.play('sfx_click', { freq: 520, dur: 0.18 }); },
  /* v2.1.6 接入真实音频（用户选定） */
  settle(pnl) { pnl >= 0 ? this.play('sfx_profit', { freq: 880, dur: 0.25 }) : this.play('sfx_loss', { freq: 200, dur: 0.4, type: 'sawtooth' }); },
  click()     { this.play('sfx_click', { freq: 1200, dur: 0.05, type: 'square' }); }
};
