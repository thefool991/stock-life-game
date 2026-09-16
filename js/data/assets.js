/* ============================================================
 * data/assets.js — 资源清单与占位接口
 *
 * 【立绘 / 音乐接入方式】
 * 1. 把文件放入 assets/img 或 assets/audio 目录；
 * 2. 在下方 MANIFEST 对应条目填入文件路径；
 * 3. 代码统一通过 SL.assets.get(key) 取用，填写后自动生效，
 *    未填写时使用占位实现（色块 / 静音），无需改任何玩法代码。
 *
 * 【素材规格】详细制作参数见 assets/ASSETS_SPEC.md
 * - 桌面背景：2560×1440 JPG，屏幕净区 x:512~2048, y:144~979
 * - 人物立绘：1000×1500 PNG 透明，表情差分 normal/happy/sad/angry
 * - 音乐：BGM MP3 循环；音效短 MP3/WAV
 * - 微信小游戏首包 4MB 限制：大文件放 CDN，路径直接填 http(s) URL。
 * ============================================================ */
window.SL = window.SL || {};

SL.assets = {
  MANIFEST: {
    /* 桌面场景背景 */
    bg_desk: 'assets/img/bg_desk.png',

    /* 人物立绘（剧情事件用，4角色×4表情） */
    char_partner_normal: '', char_partner_happy: '', char_partner_sad: '', char_partner_angry: '',
    char_mother_normal: '',  char_mother_happy: '',  char_mother_sad: '',  char_mother_angry: '',
    char_friend_normal: '',  char_friend_happy: '',  char_friend_sad: '',  char_friend_angry: '',
    char_mentor_normal: '',  char_mentor_happy: '',  char_mentor_sad: '',  char_mentor_angry: '',

    /* 主角头像（角色面板用，400~600px PNG 透明） */
    avatar_normal: '',
    avatar_happy:  '',
    avatar_sad:    '',
    avatar_angry:  '',

    /* 音乐音效 — 例：'assets/audio/bgm_main.mp3' */
    bgm_main:      'assets/audio/bgm_main.mp3',   // 背景音乐：肖邦夜曲 Op.9 No.2（CC0），循环播放
    sfx_deal:      '',   // 成交
    sfx_cash:      '',   // 盈利入账（旧键，v2.1.6 起结算用 sfx_profit）
    sfx_liquidate: '',   // 爆仓
    sfx_event:     '',   // 剧情事件弹出
    sfx_phone:     '',   // 来电（剧情场景）
    /* v2.1.6 接入真实音频（用户选定） */
    sfx_profit:    'assets/audio/sfx_coin.mp3',   // 结算盈利：金币撞击声
    sfx_loss:      'assets/audio/sfx_bad.mp3',    // 结算亏损：坏事提示音
    sfx_click:     'assets/audio/sfx_click.mp3'   // UI点击：鼠标点击声
  },

  get(key) {
    return this.MANIFEST[key] || null;
  },

  /* 图片加载（带占位回退）：返回 Promise<Image|null> */
  loadImage(key) {
    const url = this.get(key);
    if (!url) return Promise.resolve(null);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
};
