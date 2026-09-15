/* ============================================================
 * utils.js — 通用工具（随机数、格式化、时间换算）
 * 引擎无关，微信端可直接复用
 * ============================================================ */
window.SL = window.SL || {};

SL.utils = {
  /* 可播种随机数（存档恢复后序列可复现；换 Math.random 只需改这里） */
  _seed: (Date.now() % 2147483647),
  setSeed(s) { this._seed = s % 2147483647; if (this._seed <= 0) this._seed += 2147483646; },
  getSeed() { return this._seed; },
  rand() { // Park-Miller
    this._seed = (this._seed * 16807) % 2147483647;
    return (this._seed - 1) / 2147483646;
  },
  range(min, max) { return min + this.rand() * (max - min); },
  rangeInt(min, max) { return Math.floor(this.range(min, max + 1)); },
  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; },
  chance(p) { return this.rand() < p; },
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
  gauss() { // 近似正态，用于噪声
    return (this.rand() + this.rand() + this.rand() + this.rand() - 2) / 2;
  },

  clamp(v, min, max) { return Math.max(min, Math.min(max, v)); },

  /* ---- 格式化 ---- */
  fmtMoney(v) { // 12,345 或 -1,234
    const neg = v < 0;
    const abs = Math.abs(Math.round(v));
    return (neg ? '-' : '') + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },
  fmtMoneyWan(v) { // 大数额简写：123.4万
    const abs = Math.abs(v);
    if (abs >= 10000) return (v / 10000).toFixed(1) + '万';
    return this.fmtMoney(v);
  },
  fmtMoney2(v) { // 两位小数：1,234.56
    const neg = v < 0;
    const abs = Math.abs(v);
    const parts = abs.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  },
  fmtSigned2(v) { return (v >= 0 ? '+' : '') + this.fmtMoney2(v); },
  fmtPct(v, digits) { // 0.0123 → +1.23%
    const d = digits === undefined ? 2 : digits;
    return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
  },
  fmtSigned(v) { return (v >= 0 ? '+' : '') + this.fmtMoney(v); },

  /* ---- 游戏日历：day 从 0 开始；v1.6：day 0 = 第1年 START_MONTH 月1日（4月1日开局） ---- */
  dayToDate(day) {
    const cfg = SL.config;
    const year = Math.floor(day / (cfg.DAYS_PER_MONTH * cfg.MONTHS_PER_YEAR)) + 1;
    const rem = day % (cfg.DAYS_PER_MONTH * cfg.MONTHS_PER_YEAR);
    const m0 = (cfg.START_MONTH || 1) - 1;
    const month = (Math.floor(rem / cfg.DAYS_PER_MONTH) + m0) % 12 + 1;
    const d = (rem % cfg.DAYS_PER_MONTH) + 1;
    return { year, month, day: d };
  },
  dateToDay(y, m, d) {
    const cfg = SL.config;
    const m0 = (cfg.START_MONTH || 1) - 1;
    return (y - 1) * cfg.DAYS_PER_MONTH * cfg.MONTHS_PER_YEAR +
      ((m - 1 - m0 + 12) % 12) * cfg.DAYS_PER_MONTH + (d - 1);
  },
  fmtDate(day) {
    const t = this.dayToDate(day);
    return '第' + t.year + '年 ' + t.month + '月' + t.day + '日';
  },
  totalDays() {
    const cfg = SL.config;
    return (cfg.END_AGE - cfg.START_AGE) * cfg.DAYS_PER_MONTH * cfg.MONTHS_PER_YEAR;
  },
  ageAt(day) {
    const cfg = SL.config;
    return cfg.START_AGE + day / (cfg.DAYS_PER_MONTH * cfg.MONTHS_PER_YEAR);
  },
  isHoliday(day) {
    const t = this.dayToDate(day);
    for (const h of SL.config.HOLIDAYS) {
      if (t.month === h.month && t.day >= h.startDay && t.day <= h.endDay) return h;
    }
    return null;
  },

  /* 简易事件总线（模块解耦用） */
  events: (function () {
    const map = {};
    return {
      on(name, fn) { (map[name] = map[name] || []).push(fn); },
      emit(name, data) { (map[name] || []).forEach(fn => fn(data)); }
    };
  })()
};
