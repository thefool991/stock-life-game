/* ============================================================
 * core/storage.js — 存档适配器（文档 §12）
 * localStorage 自动存档（每回合结束）+ 手动存档
 *
 * 【微信移植】只需把 backend 替换为：
 *   { get: k => wx.getStorageSync(k), set: (k,v) => wx.setStorageSync(k,v), del: k => wx.removeStorageSync(k) }
 * ============================================================ */
window.SL = window.SL || {};

SL.storage = {
  backend: {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { window.localStorage.removeItem(k); } catch (e) {} }
  },

  setBackend(b) { this.backend = b; }, // 微信端注入点

  save(G) {
    const data = {
      G,
      seed: SL.utils.getSeed(),
      savedAt: Date.now()
    };
    this.backend.set(SL.config.SAVE_KEY, JSON.stringify(data));
  },

  load() {
    const raw = this.backend.get(SL.config.SAVE_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      SL.utils.setSeed(data.seed);
      return data.G;
    } catch (e) { return null; }
  },

  has() { return !!this.backend.get(SL.config.SAVE_KEY); },
  clear() { this.backend.del(SL.config.SAVE_KEY); },

  /* ---- 跨局元数据（失败传承等，v0.6） ----
   * 独立于对局存档：重开/清档后仍保留 */
  META_KEY: 'stocklife_meta_v1',
  saveMeta(meta) { this.backend.set(this.META_KEY, JSON.stringify(meta)); },
  loadMeta() {
    try {
      const raw = this.backend.get(this.META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
};
