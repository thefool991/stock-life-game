/* ============================================================
 * render/charts.js — Canvas 图表（文档 §3.5 / §11）
 * 日K：红涨绿跌蜡烛 + 底部成交量柱
 * 分时：白色分时线（约35%位置）+ 密集成交量红绿柱
 * 资产曲线：结算弹窗核心反馈元素
 * ============================================================ */
window.SL = window.SL || {};

SL.charts = {
  /* HiDPI 适配 */
  _setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: rect.width, H: rect.height };
  },

  _colors() {
    return {
      up: SL.config.UP_COLOR, down: SL.config.DOWN_COLOR,
      grid: '#22282f', text: '#8b949e', white: '#e6e6e6', vol: '#3a4149'
    };
  },

  /* ---------------- 周K（v0.7：5天=1根，红涨绿跌） ----------------
   * 短线10天=2根、长线30天=6根，对齐结算周期 */
  drawKline(canvas, stock) {
    const { ctx, W, H } = this._setup(canvas);
    const C = this._colors();
    ctx.clearRect(0, 0, W, H);

    /* 日K聚合为周K：从最新向前每5天1根（最后一根含最近交易日） */
    const cfg = SL.config, CD = cfg.CANDLE_DAYS;
    let dailies = stock.history.slice(-(cfg.KLINE_SHOW_WEEKS * CD));
    const dropN = dailies.length % CD;
    if (dropN) dailies = dailies.slice(dropN);
    const data = [];
    for (let i = 0; i + CD <= dailies.length; i += CD) {
      const g = dailies.slice(i, i + CD);
      let h = -Infinity, l = Infinity, v = 0;
      for (const d of g) { h = Math.max(h, d.h); l = Math.min(l, d.l); v += d.v; }
      data.push({ o: g[0].o, c: g[g.length - 1].c, h, l, v });
    }
    /* v1.8：新股无历史K线 → 占位提示（数据随交易日积累） */
    if (!data.length) {
      ctx.fillStyle = C.text; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('新股上市，K线数据积累中…', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }
    const volH = H * 0.18, priceH = H - volH - 8;
    let min = Infinity, max = -Infinity, maxV = 0;
    for (const d of data) { min = Math.min(min, d.l); max = Math.max(max, d.h); maxV = Math.max(maxV, d.v); }
    if (max - min < 0.01) { max += 0.01; min -= 0.01; }

    const y = p => 6 + (max - p) / (max - min) * (priceH - 12);
    const bw = W / data.length;
    const bodyW = Math.max(1, bw * 0.6);

    /* 网格与价格刻度 */
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.text; ctx.font = '10px sans-serif';
    for (let i = 0; i <= 4; i++) {
      const p = max - (max - min) * i / 4;
      const yy = y(p);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
      ctx.fillText(p.toFixed(2), 4, yy - 2);
    }

    /* 蜡烛（收盘≥开盘红色实心，反之为绿色实心，§3.5） */
    data.forEach((d, i) => {
      const x = i * bw + bw / 2;
      const up = d.c >= d.o;
      ctx.strokeStyle = ctx.fillStyle = up ? C.up : C.down;
      ctx.beginPath(); ctx.moveTo(x, y(d.h)); ctx.lineTo(x, y(d.l)); ctx.stroke();
      const top = y(Math.max(d.o, d.c)), hgt = Math.max(1, Math.abs(y(d.o) - y(d.c)));
      ctx.fillRect(x - bodyW / 2, top, bodyW, hgt);
      /* 成交量柱 */
      const vh = maxV ? (d.v / maxV) * (volH - 4) : 0;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x - bodyW / 2, H - vh, bodyW, vh);
      ctx.globalAlpha = 1;
    });
  },

  /* ---------------- 分时（白线 + 密集量柱，§3.5） ----------------
   * 基准规则（用户确认）：昨日收盘价垂直居中为基准；
   * 当前价 > 昨收 → 涨（红），否则 → 跌（绿） */
  drawIntraday(canvas, stock) {
    const { ctx, W, H } = this._setup(canvas);
    const C = this._colors();
    ctx.clearRect(0, 0, W, H);

    const it = stock.intraday;
    if (!it || !it.points.length) return;
    const pts = it.points, prev = it.prevClose;

    /* y轴围绕昨收对称：基准线固定在垂直居中 */
    let dev = 0;
    for (const p of pts) dev = Math.max(dev, Math.abs(p - prev));
    dev = Math.max(dev, prev * 0.005); // 最小振幅，避免直线贴边
    const min = prev - dev * 1.15, max = prev + dev * 1.15;

    const volH = H * 0.16, priceH = H - volH - 6;
    const y = p => 4 + (max - p) / (max - min) * (priceH - 8);
    const x = i => i / (it.total - 1) * W; // 按全天刻度，停在35%位置

    /* 昨收基准线（居中） */
    ctx.strokeStyle = '#4a5568'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, y(prev)); ctx.lineTo(W, y(prev)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.text; ctx.font = '10px sans-serif';
    ctx.fillText('昨收 ' + prev.toFixed(2), 4, y(prev) - 3);

    /* 密集成交量柱：该点位价格 ≥ 昨收为红，否则为绿 */
    const barW = Math.max(1, (W / it.total) * 0.5);
    let maxDelta = 0.0001;
    for (let i = 1; i < pts.length; i++) maxDelta = Math.max(maxDelta, Math.abs(pts[i] - pts[i - 1]));
    for (let i = 1; i < pts.length; i++) {
      ctx.fillStyle = pts[i] > prev ? C.up : C.down;
      const hgt = 2 + (Math.abs(pts[i] - pts[i - 1]) / maxDelta) * (volH - 6);
      ctx.fillRect(x(i) - barW / 2, H - hgt, barW, hgt);
    }

    /* 白色分时线 */
    ctx.strokeStyle = C.white; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x(0), y(pts[0]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(pts[i]));
    ctx.stroke();
    ctx.lineWidth = 1;

    /* 最新价标签：> 昨收为涨（红），否则为跌（绿） */
    const last = pts[pts.length - 1];
    ctx.fillStyle = last > prev ? C.up : C.down;
    ctx.font = '12px sans-serif';
    ctx.fillText(last.toFixed(2), x(pts.length - 1) + 4, y(last) + 4);
  },

  /* ---------------- 资产曲线（结算弹窗，§11 核心反馈） ---------------- */
  drawAssetCurve(canvas, history) {
    const { ctx, W, H } = this._setup(canvas);
    const C = this._colors();
    ctx.clearRect(0, 0, W, H);
    if (!history || history.length < 2) {
      ctx.fillStyle = C.text; ctx.font = '12px sans-serif';
      ctx.fillText('资产曲线将从下一回合开始绘制', 10, H / 2);
      return;
    }
    let min = Infinity, max = -Infinity;
    for (const h of history) { min = Math.min(min, h.total); max = Math.max(max, h.total); }
    const pad = (max - min) * 0.1 || 1000;
    min -= pad; max += pad;

    const x = i => 8 + i / (history.length - 1) * (W - 16);
    const y = v => 6 + (max - v) / (max - min) * (H - 24);

    /* 目标线（TARGET_ASSET，v2.0.9：1000万） */
    const target = SL.config.TARGET_ASSET;
    if (target >= min && target <= max) {
      ctx.strokeStyle = '#6b5a2a'; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(0, y(target)); ctx.lineTo(W, y(target)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#a08545'; ctx.font = '10px sans-serif';
      ctx.fillText('目标 1000万', 10, y(target) - 3);
    }

    /* 曲线：末点相对首点定涨跌色 */
    const upOverall = history[history.length - 1].total >= history[0].total;
    ctx.strokeStyle = upOverall ? C.up : C.down;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    history.forEach((h, i) => { i === 0 ? ctx.moveTo(x(i), y(h.total)) : ctx.lineTo(x(i), y(h.total)); });
    ctx.stroke();
    ctx.lineWidth = 1;

    /* 末点数值 */
    const last = history[history.length - 1].total;
    ctx.fillStyle = upOverall ? C.up : C.down;
    ctx.font = '11px sans-serif';
    ctx.fillText(SL.utils.fmtMoneyWan(last), x(history.length - 1) - 52, y(last) - 5);
  }
};
