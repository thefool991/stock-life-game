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
      a.volume = 0.5;   // ← 加这行，所有 MP3 音效统一音量
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
  click()     { this.play('sfx_click', { freq: 1200, dur: 0.05, type: 'square' }); },

  /* ---------------- 背景音乐（v2.4 用户确认：打开游戏自动循环，喇叭开关静音） ----------------
   * 浏览器自动播放策略：无用户交互时 audio.play() 会被拒，故采用
   * "首次任意点击/按键时启动 BGM，之后循环"。enabled=false 时连同音效一起静默。 */
  bgm: {
    _el: null, _started: false,
    VOLUME: 0.4,           // 背景音乐音量（避免盖过音效）
    /* 初始化：创建 Audio 并挂首次交互启动监听（main.js 启动时调用一次） */
    init() {
      const url = SL.assets.get('bgm_main');
      if (!url || this._el) return;
      const a = new Audio(url);
      a.loop = true;
      a.volume = this.VOLUME;
      this._el = a;
      const kick = () => {
        if (!SL.audio.enabled) return; // 已静音则不自动启动，等玩家取消静音时手动播
        this.start();
      };
      /* pointerdown/keydown 任一首次交互即尝试启动；一旦成功播放就移除监听 */
      document.addEventListener('pointerdown', kick);
      document.addEventListener('keydown', kick);
      this._kick = kick;
    },
    start() {
      const a = this._el;
      if (!a || !SL.audio.enabled) return;
      a.play().then(() => {
        this._started = true;
        if (this._kick) {
          document.removeEventListener('pointerdown', this._kick);
          document.removeEventListener('keydown', this._kick);
          this._kick = null;
        }
        SL.ui && SL.ui.syncMuteBtn && SL.ui.syncMuteBtn();
      }).catch(() => { /* 仍被策略拦截则留待下次交互 */ });
    },
    stop() {
      if (this._el) this._el.pause();
    },
    /* 静音开关（与全局 SL.audio.enabled 联动） */
    setMuted(muted) {
      SL.audio.enabled = !muted;
      if (muted) this.stop();
      else this.start(); // 取消静音时立即恢复播放（此时已有过用户交互）
    },
    isMuted() { return !SL.audio.enabled; }
  }
};
