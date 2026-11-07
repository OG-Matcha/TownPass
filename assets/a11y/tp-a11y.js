/*
 * tp-a11y.js：城市通「操作輔助層」
 *
 * 由 App（lib/util/a11y/a11y_layer.dart）注入每一個微服務網頁，微服務不用改任何程式碼。
 * 也可以在一般瀏覽器用 <script src="tp-a11y.js"></script> 載入，方便在桌面 Chrome 開發。
 *
 * 功能（交接包 docs/handoff/B_台北通操作層_交接包.md）：
 *   F1 按偏偵測：點在空白處但 24px 內有可按的東西、或同一元件 600ms 內連點，30 秒內 3 次 → 先問要不要放大
 *   F2 全域字級三段（整頁縮放，字和按鈕一起變大）＋高對比（把對比不足 7:1 的字自動加深）
 *   F3 朗讀這頁：按了才念，語速 0.85；App 內交給裝置端 TTS
 *   F4 單手浮動操作列：右下角（距底 104px），可切換左右手
 *   F5 用講的：規則解析，不用模型；也可以打字
 *   F6（部分）危險操作二次確認：用講的觸發「刪除、付款、送出」等按鈕前先確認
 *
 * 不送出任何資料：所有判斷在裝置上完成；App 內的語音辨識走 speech_to_text（onDevice: true）。
 * 頁面可宣告自己處理某些項目：<meta name="tp-a11y" content="own:font,own:misstap">
 *   off            這頁完全不載入
 *   own:font       不縮放頁面，只廣播設定（頁面自己調字級）
 *   own:contrast   不改頁面文字顏色，只廣播設定
 *   own:misstap    不做按偏偵測
 * 對外介面：window.__tpA11y、事件 "tp-a11y:settings"（detail = 設定）
 *
 * 授權：AGPL-3.0（同作品）。零相依套件；圖示為自繪 SVG。
 */
(function () {
  "use strict";

  // ===================================================================
  // 一、純函式（不碰 DOM，可在 Node 測試：scripts 見 tool/a11y/unit.mjs）
  // ===================================================================

  var FONT_LEVELS = [
    { id: "normal", label: "標準", zoom: 1 },
    { id: "large", label: "大", zoom: 1.25 },
    { id: "xlarge", label: "特大", zoom: 1.5 },
  ];
  var MISS = { NEAR_PX: 24, REPEAT_MS: 600, WINDOW_MS: 30000, THRESHOLD: 3 };
  var SPEECH_RATE = 0.85;
  var DEFAULTS = { enabled: true, fontLevel: "normal", highContrast: false, hand: "right" };
  var TARGET_CONTRAST = 7; // 城市通規範：文字對比 ≥ 7:1

  /** 只留下認得的欄位與值，避免頁面或 App 傳來奇怪的設定。 */
  function sanitizeSettings(raw) {
    var s = {};
    var src = raw && typeof raw === "object" ? raw : {};
    s.enabled = typeof src.enabled === "boolean" ? src.enabled : DEFAULTS.enabled;
    s.fontLevel = FONT_LEVELS.some(function (l) { return l.id === src.fontLevel; }) ? src.fontLevel : DEFAULTS.fontLevel;
    s.highContrast = typeof src.highContrast === "boolean" ? src.highContrast : DEFAULTS.highContrast;
    s.hand = src.hand === "left" || src.hand === "right" ? src.hand : DEFAULTS.hand;
    return s;
  }

  function levelIndex(id) {
    for (var i = 0; i < FONT_LEVELS.length; i++) if (FONT_LEVELS[i].id === id) return i;
    return 0;
  }

  /** 往大（+1）或往小（-1）一級；已到頭就不動。 */
  function stepLevel(id, dir) {
    var i = Math.max(0, Math.min(FONT_LEVELS.length - 1, levelIndex(id) + dir));
    return FONT_LEVELS[i].id;
  }

  /** 點 (x,y) 到矩形的距離（在矩形內為 0）。 */
  function distToRect(x, y, r) {
    var dx = Math.max(r.left - x, 0, x - r.right);
    var dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy);
  }

  /** 視窗內的事件數是否達門檻。 */
  function struggling(events, now) {
    var n = 0;
    for (var i = 0; i < events.length; i++) if (now - events[i].t <= MISS.WINDOW_MS) n++;
    return n >= MISS.THRESHOLD;
  }

  /** 語音文字正規化：臺→台、全形數字轉半形、去掉空白與標點、英文小寫。 */
  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/臺/g, "台")
      .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xfee0); })
      .replace(/[\s，。、！？!?,.;；:：「」『』（）()〔〕【】"'’‘“”…~～]/g, "")
      .toLowerCase();
  }

  // 意思相同的按鈕名稱：說「確定」也能按到「確認」
  var SYNONYMS = [
    ["確定", "確認", "好", "ok", "完成"],
    ["下一步", "繼續", "下一頁"],
    ["取消", "不用", "關閉"],
    ["送出", "提交", "送出申請"],
    ["搜尋", "查詢", "找"],
  ];

  /** 在按鈕名稱清單中找出最符合口說內容的一個，回傳索引；找不到回傳 -1。 */
  function matchTarget(spoken, names) {
    var t = norm(spoken);
    if (!t) return -1;
    var ns = names.map(norm);
    var i = ns.indexOf(t);
    if (i >= 0) return i;
    for (var g = 0; g < SYNONYMS.length; g++) {
      if (SYNONYMS[g].indexOf(t) < 0) continue;
      for (var w = 0; w < SYNONYMS[g].length; w++) {
        i = ns.indexOf(SYNONYMS[g][w]);
        if (i >= 0) return i;
      }
    }
    // 部分相符：名稱以口說開頭最好，其次名稱包含口說，再其次口說包含名稱；差越少越好
    var best = -1;
    var bestScore = Infinity;
    for (var k = 0; k < ns.length; k++) {
      var n = ns[k];
      if (!n) continue;
      var score;
      if (t.length >= 2 && n.indexOf(t) === 0) score = n.length - t.length;
      else if (t.length >= 2 && n.indexOf(t) > 0) score = 100 + n.length - t.length;
      else if (n.length >= 2 && t.indexOf(n) >= 0) score = 200 + t.length - n.length;
      else continue;
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return best;
  }

  /**
   * 把一句話轉成指令。names 是目前畫面上可按元件的名稱（依畫面順序）。
   * 頁面上剛好有同名按鈕時優先按按鈕（例：頁面有「上一步」按鈕，就不當成返回）。
   */
  function parseCommand(text, names) {
    names = names || [];
    var t = norm(text)
      .replace(/^(請你|請|麻煩|幫我|我要|我想|可以|能不能)+/, "")
      .replace(/(一下|好嗎|好了|吧|嗎|謝謝)+$/, "");
    if (!t) return { type: "unknown", text: text };

    var press = t.match(/^(按下|按|點選|點擊|點|選擇|選)(.+)$/);
    if (press) {
      var pi = matchTarget(press[2], names);
      return pi >= 0 ? { type: "press", index: pi } : { type: "notfound", target: press[2] };
    }
    var exact = names.map(norm).indexOf(t);
    if (exact >= 0) return { type: "press", index: exact };

    if (/^(停|停止|暫停|安靜|先停|停下來)$|停止朗讀|不要念|不要唸|別念|別唸/.test(t)) return { type: "stop" };
    if (/返回|上一頁|回上頁|回去|退回|上一步|回前頁/.test(t)) return { type: "back" };
    if (/最上面|回到頂端|回到最上|頂端/.test(t)) return { type: "scroll", dir: "top" };
    if (/往下|向下|下滑|捲下|看下面|下面/.test(t)) return { type: "scroll", dir: "down" };
    if (/往上|向上|上滑|捲上|看上面|上面/.test(t)) return { type: "scroll", dir: "up" };
    if (/(關掉|關閉|取消|不要)(高)?對比/.test(t)) return { type: "contrast", on: false };
    if (/對比/.test(t)) return { type: "contrast", on: true };
    if (/縮小|小一點|字太大|變小/.test(t)) return { type: "font", dir: -1 };
    if (/放大|大一點|字太小|看不清楚|看不到|變大/.test(t)) return { type: "font", dir: 1 };
    if (/念|唸|朗讀|讀給我聽|讀出來|讀這頁/.test(t)) return { type: "read" };
    if (/左手/.test(t)) return { type: "hand", hand: "left" };
    if (/右手/.test(t)) return { type: "hand", hand: "right" };
    if (/說什麼|怎麼用|說明|幫助|教我/.test(t)) return { type: "help" };

    var mi = matchTarget(t, names);
    if (mi >= 0) return { type: "press", index: mi };
    return { type: "unknown", text: text };
  }

  /** 用講的觸發這些按鈕前要再確認一次（辨識錯誤不能造成無法復原的結果）。 */
  function isDangerous(name) {
    return /刪除|付款|繳費|送出|申請|取消預約|取消訂單|登出|停用|轉帳|購買/.test(norm(name));
  }

  function parseRgb(s) {
    var m = String(s).match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    var p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    var a = p.length > 3 ? (p[3].slice(-1) === "%" ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
    return { r: parseFloat(p[0]), g: parseFloat(p[1]), b: parseFloat(p[2]), a: a };
  }

  function luminance(c) {
    var ch = [c.r, c.g, c.b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  /** WCAG 對比值。 */
  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** 半透明前景疊在背景上。 */
  function blend(fg, bg) {
    var a = fg.a == null ? 1 : fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }

  var INK = { r: 11, g: 13, b: 14, a: 1 }; // grayscale950
  var WHITE = { r: 255, g: 255, b: 255, a: 1 };

  /** 背景上對比較高的字色（深字或白字）。 */
  function bestInk(bg) {
    return contrast(INK, bg) >= contrast(WHITE, bg) ? INK : WHITE;
  }

  /** 估計朗讀秒數（中文約每秒 4 字，乘上語速）。 */
  function estimateSpeechMs(text, rate) {
    return Math.round((String(text).length / (4 * (rate || 1))) * 1000) + 1500;
  }

  // 找服務：「市民會怎麼說」對照表（我們整理的，不是官方資料），依 App 的 MyServiceItemId 名稱對應。
  // 服務清單本身在 App 內由 handler `service_catalog` 提供（lib/util/web_message_handler/service_catalog_message_handler.dart）；
  // 不在 App 內（瀏覽器開發）時用下面的 SERVICES，內容照抄 my_service_model.dart。沒有對照表的服務仍可用名稱與說明找到。
  var KEYWORDS = {
    districtOffice: ["申請", "申辦", "補助", "津貼", "證明", "身障", "身心障礙", "手冊", "低收", "謄本", "線上辦", "表單"],
    reportIssue: ["陳情", "檢舉", "反映", "抱怨", "建議", "路燈", "壞了", "坑洞", "噪音", "違停", "垃圾", "人行道"],
    reservation: ["叫號", "排隊", "預約", "臨櫃", "櫃台", "戶政", "區公所", "號碼", "等多久", "現場"],
    disasterReport: ["災情", "淹水", "積水", "倒樹", "颱風", "地震", "坍方", "土石", "停電", "危險", "通報"],
    library: ["借書", "還書", "圖書館", "書", "館藏", "續借"],
    locationSearch: ["附近", "地點", "哪裡", "廁所", "無障礙", "電梯", "停車", "公園", "怎麼去", "地圖", "設施"],
    dedicatedLine: ["電話", "打電話", "客服", "問人", "專人", "熱線", "不知道", "不會用", "幫忙"],
    dashboard: ["數據", "統計", "空氣", "資料"],
  };
  var SERVICES = [
    { id: "dedicatedLine", title: "1999", desc: "播打網路語音通話", tel: "1999" },
    { id: "districtOffice", title: "申辦服務", desc: "線上申辦市政府服務個項目（市民）", url: "https://taipei-pass-service.vercel.app/" },
    { id: "reportIssue", title: "有話要說", desc: "陳情系統", url: "https://taipei-pass-service.vercel.app/citizen-report/" },
    { id: "reservation", title: "臨櫃叫號", desc: "臨櫃服務查看叫號、預約", url: "https://taipei-pass-service.vercel.app/counter-calling/" },
    { id: "dashboard", title: "市政資訊儀表板", desc: "提供臺北市生活的重要數據", url: "https://dashboard.gov.taipei/" },
    { id: "disasterReport", title: "災情通報", desc: "立即通報發生災情地點", url: "https://taipei-pass-service.vercel.app/disaster-report" },
    { id: "library", title: "圖書借閱", desc: "市立圖書館借閱服務", url: "https://taipei-pass-service.vercel.app/library-service/" },
    { id: "locationSearch", title: "找地點", desc: "提供各區日常服務地圖查找", url: "https://taipei-pass-service.vercel.app/surrounding-service/" },
  ];

  /** App 回傳的服務清單 → 搜尋用的格式；只收 http(s) 網址或電話號碼，其他一律丟掉。 */
  function toCatalog(list) {
    if (!Array.isArray(list)) return null;
    var out = [];
    list.forEach(function (x) {
      if (!x || typeof x.title !== "string" || typeof x.id !== "string") return;
      var url = typeof x.url === "string" && /^https?:\/\//.test(x.url) ? x.url : "";
      var tel = typeof x.tel === "string" && /^[0-9+#*]{3,15}$/.test(x.tel) ? x.tel : "";
      if (!url && !tel) return;
      out.push({ id: x.id, title: x.title, desc: String(x.description || x.desc || ""), url: url, tel: tel });
    });
    return out.length ? out : null;
  }
  var SEARCH_EXAMPLES = ["預約臨櫃", "路燈壞了", "家門口淹水", "附近的無障礙廁所", "申請身障補助", "借書"];

  /**
   * 依市民的一句話找出可能的服務，回傳 [{ service, score, reasons }]（分數高的在前、最多 5 個）。
   * 規則：說到關鍵字 +3（越長越準），提到服務名稱 +5，與名稱或說明有相同的兩字詞 +1。
   */
  function searchServices(query, catalog) {
    var q = norm(query).replace(/^(我要|我想|請問|要怎麼|怎麼|如何|幫我)+/, "");
    if (!q) return [];
    var out = [];
    (catalog || SERVICES).forEach(function (sv) {
      var score = 0;
      var reasons = [];
      (sv.keywords || KEYWORDS[sv.id] || []).forEach(function (k) {
        if (q.indexOf(norm(k)) >= 0) {
          score += 2 + Math.min(k.length, 4);
          reasons.push(k);
        }
      });
      var title = norm(sv.title);
      if (q.indexOf(title) >= 0 || (q.length >= 2 && title.indexOf(q) >= 0)) {
        score += 5;
        if (reasons.indexOf(sv.title) < 0) reasons.push(sv.title);
      }
      var hay = title + norm(sv.desc);
      for (var i = 0; i + 1 < q.length; i++) if (hay.indexOf(q.slice(i, i + 2)) >= 0) score += 1;
      if (score > 0) out.push({ service: sv, score: score, reasons: reasons.slice(0, 3) });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 5);
  }

  var core = {
    SERVICES: SERVICES,
    KEYWORDS: KEYWORDS,
    toCatalog: toCatalog,
    searchServices: searchServices,
    FONT_LEVELS: FONT_LEVELS,
    MISS: MISS,
    DEFAULTS: DEFAULTS,
    sanitizeSettings: sanitizeSettings,
    stepLevel: stepLevel,
    distToRect: distToRect,
    struggling: struggling,
    norm: norm,
    matchTarget: matchTarget,
    parseCommand: parseCommand,
    isDangerous: isDangerous,
    parseRgb: parseRgb,
    contrast: contrast,
    blend: blend,
    bestInk: bestInk,
    estimateSpeechMs: estimateSpeechMs,
  };

  // Node 測試環境：只匯出純函式
  if (typeof window === "undefined" || typeof document === "undefined") {
    globalThis.__tpA11yCore = core;
    return;
  }
  // 只在最上層頁面執行（iframe 裡的廣告、地圖不加浮動列），也不重複載入
  try {
    // 展示頁（報告裡的模擬手機）可設 window.__TP_A11Y_ALLOW_FRAME__ = true 在 iframe 內執行
    if (window.top !== window && !window.__TP_A11Y_ALLOW_FRAME__) return;
  } catch (e) {
    return;
  }
  if (window.__tpA11y) return;

  // ===================================================================
  // 二、頁面宣告、App 橋接、設定
  // ===================================================================

  function readMeta() {
    var el = document.querySelector('meta[name="tp-a11y"]');
    var tokens = el ? String(el.getAttribute("content") || "").split(/[\s,]+/) : [];
    return {
      off: tokens.indexOf("off") >= 0,
      font: tokens.indexOf("own:font") >= 0,
      contrast: tokens.indexOf("own:contrast") >= 0,
      misstap: tokens.indexOf("own:misstap") >= 0,
    };
  }

  function flutter() {
    return window.flutterObject || null;
  }

  /** 送訊息給 App 並等同名回覆；不在 App 內或逾時回傳 null。 */
  function askApp(name, data, timeoutMs) {
    var f = flutter();
    if (!f) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var timer;
      var onMessage = function (e) {
        var msg;
        try {
          msg = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        if (!msg || msg.name !== name) return;
        cleanup();
        resolve(msg.data);
      };
      var cleanup = function () {
        clearTimeout(timer);
        f.removeEventListener("message", onMessage);
      };
      timer = setTimeout(function () {
        cleanup();
        resolve(null);
      }, timeoutMs || 10000);
      f.addEventListener("message", onMessage);
      f.postMessage(JSON.stringify({ name: name, data: data }));
    });
  }

  var STORE_KEY = "tp-a11y";
  function readLocal() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  function writeLocal(s) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /** 動畫一律走這裡：使用者偏好減少動態時直接跳到結果。 */
  function animate(el, frames, opts) {
    if (!el || !el.animate || reducedMotion()) return null;
    return el.animate(frames, Object.assign({ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)", fill: "none" }, opts || {}));
  }

  // ===================================================================
  // 三、主程式
  // ===================================================================

  function start() {
    var own = readMeta();
    if (own.off) return;

    // App 注入時會在本檔前面放 window.__TP_A11Y_SETTINGS__（同步，不閃爍）
    var settings = sanitizeSettings(window.__TP_A11Y_SETTINGS__ || readLocal() || DEFAULTS);
    if (!settings.enabled) {
      window.__tpA11y = { settings: settings, enabled: false };
      return;
    }

    var listeners = [];
    var host = document.createElement("tp-a11y-layer");
    host.setAttribute("lang", "zh-Hant-TW");
    host.setAttribute("data-miss-ignore", "");
    var root = host.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    document.documentElement.appendChild(host);

    var $ = function (sel) { return root.querySelector(sel); };
    var fab = $("#fab");
    var panel = $("#panel");
    var toast = $("#toast");
    var live = $("#live");
    var ask = $("#ask");
    var listenSheet = $("#listen");
    var confirmSheet = $("#confirm");
    var highlight = $("#hl");
    var scrim = $("#scrim");
    var dock = $("#dock");
    var findBtn = $("#find");
    var viewMain = $("#view-main");
    var viewSearch = $("#view-search");

    // ---------------- 設定套用 ----------------
    var pageStyle = document.createElement("style");
    pageStyle.id = "tp-a11y-page-style";
    (document.head || document.documentElement).appendChild(pageStyle);

    // 動態曲線：參考 GSAP 常用的 back.out／power3.out／expo.out，用 Web Animations API 實作
    var EASE = {
      pop: "cubic-bezier(.175,.885,.32,1.275)", // back.out：彈出時稍微超過再回來
      out: "cubic-bezier(.215,.61,.355,1)", // power3.out
      soft: "cubic-bezier(.16,1,.3,1)", // expo.out
      in: "cubic-bezier(.55,.055,.675,.19)", // power3.in：收起
    };

    function stateText() {
      return "字級" + FONT_LEVELS[levelIndex(settings.fontLevel)].label + "・高對比" + (settings.highContrast ? "開" : "關");
    }

    function applyFont() {
      var lv = FONT_LEVELS[levelIndex(settings.fontLevel)];
      // 整頁縮放而不是只放大字：按不準的人需要的是「按鈕也變大」。zoom 放在 body，浮動列（在 html 下）不受影響。
      var css = own.font || lv.zoom === 1 ? "" : "body{zoom:" + lv.zoom + " !important;}";
      if (settings.highContrast && !own.contrast) css += CONTRAST_PAGE_CSS;
      pageStyle.textContent = css;
      document.documentElement.setAttribute("data-tp-font", lv.id);
      var idx = levelIndex(lv.id);
      $(".seg").setAttribute("data-i", String(idx));
      var radios = root.querySelectorAll(".seg [role=radio]");
      for (var i = 0; i < radios.length; i++) {
        radios[i].setAttribute("aria-checked", String(i === idx));
        radios[i].tabIndex = i === idx ? 0 : -1;
      }
      $("#display-state").textContent = stateText();
    }

    function applyContrast() {
      host.toggleAttribute("data-contrast", settings.highContrast);
      $("#contrast").setAttribute("aria-checked", String(settings.highContrast));
      $("#contrast-state").textContent = settings.highContrast ? "開" : "關";
      $("#display-state").textContent = stateText();
      if (settings.highContrast) document.documentElement.setAttribute("data-tp-contrast", "high");
      else document.documentElement.removeAttribute("data-tp-contrast");
      if (own.contrast) return;
      if (settings.highContrast) contrastBooster.on();
      else contrastBooster.off();
    }

    function applyHand() {
      host.setAttribute("data-hand", settings.hand);
      $("#hand-label").textContent = settings.hand === "right" ? "換到左手" : "換到右手";
    }

    function broadcast() {
      var detail = Object.assign({}, settings);
      try {
        window.dispatchEvent(new CustomEvent("tp-a11y:settings", { detail: detail }));
      } catch (e) {}
      listeners.forEach(function (fn) {
        try {
          fn(detail);
        } catch (e) {}
      });
    }

    function applyAll() {
      applyFont();
      applyContrast();
      applyHand();
    }

    function update(partial, opts) {
      settings = sanitizeSettings(Object.assign({}, settings, partial));
      writeLocal(settings);
      applyAll();
      broadcast();
      if (!(opts && opts.fromApp)) askApp("a11y_settings", { action: "set", settings: settings }, 3000);
    }

    // ---------------- 高對比：把對比不足的字加深 ----------------
    var contrastBooster = (function () {
      var touched = []; // [el, 原本的 inline color, 原本的 priority]
      var mo = null;
      var timer = null;
      var canvas = null;
      var cache = {};

      // getComputedStyle 可能回傳 oklch() 等格式 → 畫到 1px canvas 讀回 sRGB
      function toRgb(s) {
        var c = parseRgb(s);
        if (c) return c;
        if (cache[s]) return cache[s];
        try {
          canvas = canvas || document.createElement("canvas");
          canvas.width = canvas.height = 1;
          var ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = s;
          ctx.fillRect(0, 0, 1, 1);
          var d = ctx.getImageData(0, 0, 1, 1).data;
          cache[s] = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
        } catch (e) {
          cache[s] = null;
        }
        return cache[s];
      }

      /** 往上找第一個不透明背景；遇到背景圖（無法判斷顏色）回傳 null。 */
      function backgroundOf(el) {
        for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
          var cs = getComputedStyle(n);
          if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
          var c = toRgb(cs.backgroundColor);
          if (c && c.a >= 0.5) return blend(c, WHITE);
        }
        return WHITE;
      }

      function hasOwnText(el) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
        for (var c = el.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3 && c.nodeValue.trim()) return true;
        }
        return false;
      }

      function run() {
        if (!document.body) return;
        var els = document.body.getElementsByTagName("*");
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (el.hasAttribute("data-tp-contrast-fixed") || !hasOwnText(el)) continue;
          if (el.closest("svg, tp-a11y-layer")) continue;
          var cs = getComputedStyle(el);
          var bg = backgroundOf(el);
          var fg = toRgb(cs.color);
          if (!bg || !fg) continue;
          if (contrast(blend(fg, bg), bg) >= TARGET_CONTRAST) continue;
          var ink = bestInk(bg);
          touched.push([el, el.style.getPropertyValue("color"), el.style.getPropertyPriority("color")]);
          el.setAttribute("data-tp-contrast-fixed", "");
          el.style.setProperty("color", "rgb(" + ink.r + "," + ink.g + "," + ink.b + ")", "important");
        }
      }

      function schedule() {
        clearTimeout(timer);
        timer = setTimeout(run, 250);
      }

      return {
        on: function () {
          run();
          if (!mo && window.MutationObserver) {
            mo = new MutationObserver(schedule);
            mo.observe(document.body, { childList: true, subtree: true, characterData: true });
          }
        },
        off: function () {
          if (mo) mo.disconnect();
          mo = null;
          clearTimeout(timer);
          touched.forEach(function (t) {
            t[0].removeAttribute("data-tp-contrast-fixed");
            if (t[1]) t[0].style.setProperty("color", t[1], t[2]);
            else t[0].style.removeProperty("color");
          });
          touched = [];
        },
        count: function () {
          return touched.length;
        },
      };
    })();

    // ---------------- 提示訊息 ----------------
    var toastTimer = null;
    function say(msg) {
      live.textContent = "";
      // 先清空再填，螢幕報讀器才會重念相同訊息
      setTimeout(function () {
        live.textContent = msg;
      }, 30);
      // 有底部卡片時卡片本身就在說明，不再疊一個泡泡蓋住它
      if (isOpen() || dockOpen || !ask.hidden || !listenSheet.hidden || !confirmSheet.hidden) {
        toast.hidden = true;
        return;
      }
      toast.textContent = msg;
      toast.hidden = false;
      animate(toast, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }]);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toast.hidden = true;
      }, 4000);
    }

    // ---------------- 浮動操作列（主選單：動作） ----------------
    // 兩層設計：主選單只放「動作」，背景虛化讓人專心選；
    // 字級與對比要「邊調邊看」，所以改成貼底的調整列，不虛化、不遮住頁面。
    // 開關狀態用變數記，不看 hidden：收起動畫播放中再按一次「輔助」也要能馬上打開
    var panelOpen = false;
    var dockOpen = false;
    var panelOut = null;
    var dockOut = null;
    function isOpen() {
      return panelOpen;
    }
    function setFab(open) {
      fab.setAttribute("aria-expanded", String(open));
      fab.setAttribute("aria-label", open ? "關閉操作輔助" : "操作輔助");
      $("#fab-label").textContent = open ? "關閉" : "輔助";
      animate(fab.querySelector(open ? ".i-close" : ".i-open"), [
        { transform: "rotate(" + (open ? -90 : 90) + "deg) scale(.4)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ], { duration: 260, easing: EASE.pop });
    }
    function openPanel() {
      closeSheets();
      closeDock(false);
      panelOpen = true;
      if (panelOut) panelOut.cancel();
      panelOut = null;
      toast.hidden = true;
      scrim.style.pointerEvents = "";
      panel.style.pointerEvents = "";
      scrim.hidden = false;
      animate(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE.out });
      panel.hidden = false;
      showView("main", false);
      findBtn.hidden = false;
      findBtn.style.pointerEvents = "";
      animate(findBtn, [{ opacity: 0, transform: "translateX(24px) scale(.6)" }, { opacity: 1, transform: "none" }], {
        duration: 300,
        delay: 60,
        easing: EASE.pop,
        fill: "backwards",
      });
      setFab(true);
      // 從「輔助」鈕的位置彈出（transform-origin 跟著慣用手）
      animate(panel, [
        { opacity: 0, transform: "translateY(16px) scale(.85)" },
        { opacity: 1, transform: "none" },
      ], { duration: 320, easing: EASE.pop });
      // 格子由靠近拇指的那一格開始依序浮現（GSAP stagger from: "end"）
      var tiles = panel.querySelectorAll(".tile");
      for (var i = 0; i < tiles.length; i++) {
        animate(tiles[tiles.length - 1 - i], [
          { opacity: 0, transform: "translateY(14px) scale(.92)" },
          { opacity: 1, transform: "none" },
        ], { duration: 300, delay: 40 + i * 35, easing: EASE.pop, fill: "backwards" });
      }
      var first = panel.querySelector(".tile");
      if (first) first.focus();
    }
    function closePanel(focusFab) {
      if (!isOpen()) return;
      panelOpen = false;
      setFab(false);
      // 淡出的這段時間不能擋住頁面：一開始收起就不再攔截點擊
      scrim.style.pointerEvents = "none";
      panel.style.pointerEvents = "none";
      findBtn.style.pointerEvents = "none";
      animate(findBtn, [{ opacity: 1 }, { opacity: 0, transform: "scale(.6)" }], { duration: 140, easing: EASE.in });
      var done = function () {
        if (panelOpen) return;
        panel.hidden = true;
        scrim.hidden = true;
        findBtn.hidden = true;
      };
      var a = (panelOut = animate(panel, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(10px) scale(.92)" }], {
        duration: 140,
        easing: EASE.in,
      }));
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 140 });
      if (a) a.finished.then(done, done);
      else done();
      if (focusFab) fab.focus();
    }
    fab.addEventListener("click", function () {
      if (isOpen()) closePanel(true);
      else openPanel();
    });
    // 點虛化的背景就收起（背景被遮住，這時候點不到頁面，也不會誤觸）
    scrim.addEventListener("click", function () {
      closePanel(true);
    });

    /** 被調整的那一項輕輕彈一下當作回饋（不另外跳泡泡蓋住畫面）。 */
    function flash(el) {
      animate(el, [{ transform: "scale(1)" }, { transform: "scale(1.05)", offset: 0.35 }, { transform: "scale(1)" }], {
        duration: 320,
        easing: EASE.out,
      });
    }

    // ---------------- 調整列（字級與對比：邊調邊看） ----------------
    function openDock() {
      closePanel(false);
      closeSheets();
      dockOpen = true;
      if (dockOut) dockOut.cancel();
      dockOut = null;
      dock.hidden = false;
      fab.hidden = true; // 調整列有自己的「完成」，浮動鈕先讓位
      animate(dock, [{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 340, easing: EASE.soft });
      var checked = dock.querySelector("[role=radio][aria-checked=true]");
      if (checked) checked.focus();
      say("字級與對比，調整後頁面會馬上變化");
    }
    function closeDock(focusFab) {
      if (!dockOpen) return;
      dockOpen = false;
      var done = function () {
        if (!dockOpen) dock.hidden = true;
      };
      var a = (dockOut = animate(dock, [{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 200, easing: EASE.in }));
      if (a) a.finished.then(done, done);
      else done();
      fab.hidden = false;
      animate(fab, [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE.pop });
      if (focusFab) fab.focus();
    }
    function pickLevel(id) {
      if (id === settings.fontLevel) return;
      update({ fontLevel: id });
      flash($(".seg .thumb"));
      say("字級：" + FONT_LEVELS[levelIndex(id)].label);
    }
    var radios = root.querySelectorAll(".seg [role=radio]");
    Array.prototype.forEach.call(radios, function (r, i) {
      r.addEventListener("click", function () {
        pickLevel(r.getAttribute("data-level"));
      });
      // 單選群組的鍵盤慣例：左右鍵換選項
      r.addEventListener("keydown", function (ev) {
        var d = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        ev.preventDefault();
        var j = Math.max(0, Math.min(radios.length - 1, i + d));
        pickLevel(radios[j].getAttribute("data-level"));
        radios[j].focus();
      });
    });
    $("#contrast").addEventListener("click", function () {
      update({ highContrast: !settings.highContrast });
      say(settings.highContrast ? "已開啟高對比" : "已關閉高對比");
    });
    $("#dock-done").addEventListener("click", function () {
      closeDock(true);
    });

    // 點在主選單以外就收起
    document.addEventListener(
      "pointerdown",
      function (ev) {
        if (!isOpen()) return;
        var path = ev.composedPath ? ev.composedPath() : [];
        if (path.indexOf(host) < 0) closePanel(false);
      },
      true,
    );
    root.addEventListener("keydown", function (ev) {
      if (ev.key === "Tab" && isOpen()) {
        var list = Array.prototype.slice
          .call(panel.querySelectorAll("button:not([disabled]), input"))
          .filter(function (el) { return el.getClientRects().length > 0; })
          .concat([findBtn, fab]);
        var i = list.indexOf(root.activeElement);
        var next = ev.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
        ev.preventDefault();
        list[next].focus();
        return;
      }
      if (ev.key !== "Escape") return;
      if (isOpen() && currentView === "search") showView("main", true);
      else if (isOpen()) closePanel(true);
      else if (dockOpen) closeDock(true);
      else if (!ask.hidden || !listenSheet.hidden || !confirmSheet.hidden) {
        closeSheets();
        fab.focus();
      }
    });

    $("#read").addEventListener("click", function () {
      closePanel(false);
      if (reading) stopReading();
      else readPage();
    });
    $("#voice").addEventListener("click", function () {
      closePanel(false);
      openListen();
    });
    $("#display").addEventListener("click", openDock);
    $("#back").addEventListener("click", function () {
      closePanel(false);
      goBack();
    });
    $("#hand").addEventListener("click", function () {
      update({ hand: settings.hand === "right" ? "left" : "right" });
      say(settings.hand === "right" ? "操作鈕已移到右手邊" : "操作鈕已移到左手邊");
      animate(panel, [{ opacity: 0.4, transform: "translateX(" + (settings.hand === "left" ? 24 : -24) + "px)" }, { opacity: 1, transform: "none" }], {
        duration: 300,
        easing: EASE.soft,
      });
      $("#hand").focus();
    });

    // ---------------- 找服務（主選單切換成搜尋頁） ----------------
    var currentView = "main";
    var catalog = SERVICES;
    var catalogFromApp = false;
    // App 內改用 App 的服務清單（新增服務不用改這支 JS）
    askApp("service_catalog", null, 2000).then(function (list) {
      var c = toCatalog(list);
      if (c) {
        catalog = c;
        catalogFromApp = true;
      }
    });
    function showView(name, animated) {
      var toSearch = name === "search";
      if (currentView === name && animated) return;
      currentView = name;
      viewMain.hidden = toSearch;
      viewSearch.hidden = !toSearch;
      findBtn.setAttribute("aria-pressed", String(toSearch));
      findBtn.setAttribute("aria-label", toSearch ? "回到操作輔助選單" : "找服務");
      $("#find-label").textContent = toSearch ? "選單" : "找服務";
      animate(findBtn.querySelector(toSearch ? ".i-menu" : ".i-find"), [{ transform: "scale(.4) rotate(-45deg)", opacity: 0 }, { transform: "none", opacity: 1 }], {
        duration: 240,
        easing: EASE.pop,
      });
      if (animated) {
        animate(toSearch ? viewSearch : viewMain, [
          { opacity: 0, transform: "translateX(" + (toSearch ? 40 : -40) + "px)" },
          { opacity: 1, transform: "none" },
        ], { duration: 260, easing: EASE.soft });
      }
      if (toSearch) {
        $("#q-mic").hidden = voiceSource() === "none";
        renderResults($("#q").value);
        if (animated) $("#q").focus();
      } else if (animated) {
        var t = panel.querySelector("#display");
        if (t) t.focus();
      }
    }
    findBtn.addEventListener("click", function () {
      showView(currentView === "search" ? "main" : "search", true);
    });
    $("#search-back").addEventListener("click", function () {
      showView("main", true);
    });

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function goService(sv) {
      if (sv.tel) {
        var f = flutter();
        if (f) f.postMessage(JSON.stringify({ name: "phone_call", data: sv.tel }));
        else location.href = "tel:" + sv.tel;
        return;
      }
      say("前往「" + sv.title + "」");
      closePanel(false);
      // 在同一個 WebView 裡打開，App 左上角的返回鍵可以回到這裡
      setTimeout(function () {
        location.href = sv.url;
      }, reducedMotion() ? 0 : 180);
    }

    var searchTimer = null;
    function renderResults(query) {
      var list = $("#results");
      var examples = $("#examples");
      list.textContent = "";
      var q = String(query || "").trim();
      examples.hidden = !!q;
      $("#search-help").hidden = !q;
      if (!q) {
        $("#search-status").textContent = "";
        return;
      }
      var hits = searchServices(q, catalog);
      $("#search-status").textContent = hits.length ? "找到 " + hits.length + " 個可能的服務" : "找不到相關的服務，可以換個說法，或打電話問 1999";
      hits.forEach(function (h, i) {
        var li = el("li");
        var b = el("button", "result");
        b.type = "button";
        var ic = el("span", "ic", h.service.title.slice(0, 1));
        ic.setAttribute("aria-hidden", "true");
        var t = el("span", "t");
        t.appendChild(el("span", "l", h.service.title));
        t.appendChild(el("span", "s", h.service.desc));
        if (h.reasons.length) t.appendChild(el("span", "why", "因為提到「" + h.reasons.join("」「") + "」"));
        var go = el("span", "go", h.service.tel ? "撥打" : "前往");
        go.setAttribute("aria-hidden", "true");
        b.appendChild(ic);
        b.appendChild(t);
        b.appendChild(go);
        b.addEventListener("click", function () {
          goService(h.service);
        });
        li.appendChild(b);
        list.appendChild(li);
        animate(li, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
          duration: 240,
          delay: i * 40,
          easing: EASE.out,
          fill: "backwards",
        });
      });
    }
    $("#q").addEventListener("input", function () {
      clearTimeout(searchTimer);
      var v = this.value;
      searchTimer = setTimeout(function () {
        renderResults(v);
      }, 250);
    });
    $("#search-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      clearTimeout(searchTimer);
      renderResults($("#q").value);
      var first = $("#results button");
      if (first) first.focus();
    });
    Array.prototype.forEach.call(root.querySelectorAll("#examples button"), function (b) {
      b.addEventListener("click", function () {
        $("#q").value = b.textContent;
        renderResults(b.textContent);
      });
    });
    $("#call-1999").addEventListener("click", function () {
      var line = catalog.filter(function (x) { return x.tel; })[0] || SERVICES[0];
      goService(line);
    });
    // 用講的輸入問題（裝置端辨識；瀏覽器只在本機開發時可用）
    $("#q-mic").addEventListener("click", function () {
      $("#search-status").textContent = "請說你想辦什麼事";
      listenOnce().then(
        function (text) {
          $("#q").value = text;
          renderResults(text);
        },
        function (err) {
          $("#search-status").textContent = err.message;
        },
      );
    });

    function goBack() {
      if (history.length > 1) history.back();
      else say("這是第一頁了，要離開請按右上角的關閉");
    }

    // ---------------- 底部詢問卡（按偏、確認） ----------------
    function closeSheets() {
      ask.hidden = true;
      confirmSheet.hidden = true;
      if (!listenSheet.hidden) cancelListen();
    }
    function showSheet(el, focusSel) {
      closePanel(false);
      closeDock(false);
      toast.hidden = true;
      el.hidden = false;
      animate(el, [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { duration: 220 });
      var f = el.querySelector(focusSel);
      if (f) f.focus();
    }

    // F1：按偏偵測
    var askMuted = false;
    try {
      askMuted = sessionStorage.getItem("tp-a11y-noask") === "1";
    } catch (e) {}
    var INTERACTIVE =
      'button, a[href], input:not([type="hidden"]), select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [onclick]';

    function askBigger() {
      if (askMuted || !ask.hidden || levelIndex(settings.fontLevel) === FONT_LEVELS.length - 1) return;
      var next = FONT_LEVELS[levelIndex(settings.fontLevel) + 1];
      $("#ask-desc").textContent = "字和按鈕會放大到「" + next.label + "」，之後打開其他服務也會維持。隨時可以從右下角的「輔助」調回來。";
      showSheet(ask, "#ask-yes");
      say("看起來按鈕不太好按，要不要放大一點");
    }
    $("#ask-yes").addEventListener("click", function () {
      ask.hidden = true;
      update({ fontLevel: stepLevel(settings.fontLevel, 1) });
      say("已放大到「" + FONT_LEVELS[levelIndex(settings.fontLevel)].label + "」");
      fab.focus();
    });
    $("#ask-no").addEventListener("click", function () {
      ask.hidden = true;
      askMuted = true;
      try {
        sessionStorage.setItem("tp-a11y-noask", "1");
      } catch (e) {}
      say("好的，這次不會再問");
      fab.focus();
    });

    if (!own.misstap) {
      var events = [];
      var last = null;
      var record = function (kind) {
        var now = performance.now();
        events = events.filter(function (e) { return now - e.t <= MISS.WINDOW_MS; });
        events.push({ kind: kind, t: now });
        if (struggling(events, now)) {
          events = [];
          // 等這次點擊整個結束（觸控的 mousedown／click 在 pointerup 之後才來，會把焦點搶回頁面）再跳出詢問
          var shown = false;
          var showOnce = function () {
            if (shown) return;
            shown = true;
            document.removeEventListener("click", onClick, true);
            setTimeout(askBigger, 0);
          };
          var onClick = function () { showOnce(); };
          document.addEventListener("click", onClick, true);
          setTimeout(showOnce, 700);
        }
      };
      var onPointer = function (ev) {
        if (!ev.isPrimary || askMuted) return;
        var path = ev.composedPath ? ev.composedPath() : [];
        if (path.indexOf(host) >= 0) return;
        var target = ev.target;
        if (!target || !target.closest) return;
        if (target.closest(".maplibregl-map, .leaflet-container, canvas, [data-miss-ignore]")) return;
        var hit = target.closest(INTERACTIVE);
        var now = performance.now();
        if (hit) {
          if (last && last.el === hit && now - last.t < MISS.REPEAT_MS) record("repeat");
          last = { el: hit, t: now };
          return;
        }
        last = null;
        var els = document.querySelectorAll(INTERACTIVE);
        for (var i = 0; i < els.length; i++) {
          var r = els[i].getBoundingClientRect();
          if (r.width && r.height && distToRect(ev.clientX, ev.clientY, r) <= MISS.NEAR_PX) {
            record("miss");
            return;
          }
        }
      };
      document.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
    }

    // ---------------- F3：朗讀 ----------------
    var reading = false;
    var readTimer = null;
    var BLOCK = "h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,caption,figcaption,blockquote,legend,label,button,a,summary,option,pre";

    function visible(el) {
      if (el.closest("[hidden], [aria-hidden='true'], tp-a11y-layer, script, style, noscript, template")) return false;
      if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    }

    function labelOf(el) {
      var al = el.getAttribute && el.getAttribute("aria-label");
      if (al && al.trim()) return al.trim();
      var lb = el.getAttribute && el.getAttribute("aria-labelledby");
      if (lb) {
        var t = lb
          .split(/\s+/)
          .map(function (id) {
            var n = document.getElementById(id);
            return n ? n.textContent : "";
          })
          .join(" ")
          .trim();
        if (t) return t;
      }
      if (el.tagName === "INPUT" && /^(submit|button|reset)$/.test(el.type)) return el.value || "";
      if (el.labels && el.labels.length) return (el.labels[0].innerText || el.labels[0].textContent || "").trim();
      var txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (txt) return txt;
      var img = el.querySelector && el.querySelector("img[alt]");
      if (img && img.alt) return img.alt;
      return el.getAttribute("title") || el.getAttribute("placeholder") || "";
    }

    var SECRET_AUTOCOMPLETE = /(password|one-time-code|cc-|tel|email|bday|street-address|postal-code)/i;
    /** 不能念出內容的欄位：只有一般文字、數字、日期、下拉選單才念值。 */
    function isSecretField(n) {
      if (n.hasAttribute("data-tp-a11y-secret")) return true;
      if (n.tagName === "SELECT") return SECRET_AUTOCOMPLETE.test(n.getAttribute("autocomplete") || "");
      var type = (n.getAttribute("type") || "text").toLowerCase();
      if (["text", "search", "number", "date", "time", "month", "week", "range"].indexOf(type) < 0 && n.tagName !== "TEXTAREA") return true;
      return SECRET_AUTOCOMPLETE.test(n.getAttribute("autocomplete") || "");
    }

    /** 依畫面順序收集要念的段落：主要內容優先（main／article），每段記住元素以便標示。 */
    function collectBlocks() {
      var scope = document.querySelector("main, [role='main'], article") || document.body;
      var out = [];
      var seen = [];
      var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      var total = 0;
      for (var n = walker.currentNode; n && total < 3000; n = walker.nextNode()) {
        var el = null;
        var text = "";
        if (n.nodeType === 1) {
          if (n.tagName === "IMG" && n.alt && visible(n) && !n.closest(BLOCK)) {
            el = n;
            text = "圖片：" + n.alt;
          } else if (/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName) && n.type !== "hidden" && visible(n)) {
            if (n.tagName === "INPUT" && /^(submit|button|reset)$/.test(n.type)) {
              el = n;
              text = "按鈕：" + (n.value || labelOf(n));
            } else {
              el = n;
              var v = n.tagName === "SELECT" ? (n.options[n.selectedIndex] || {}).text : n.value;
              // 密碼、驗證碼、卡號、電話、email 等不念內容（念出來等於在公共場所公開，也會傳給 App 的語音引擎）
              text = "輸入欄：" + labelOf(n) + (v ? (isSecretField(n) ? "，已輸入" : "，目前是" + v) : "");
            }
          } else continue;
        } else {
          if (!n.nodeValue.trim()) continue;
          var parent = n.parentElement;
          if (!parent || !visible(parent) || parent.closest("label") && parent.closest("label").control) continue;
          el = parent.closest(BLOCK) || parent;
          if (seen.indexOf(el) >= 0) continue;
          var name = labelOf(el);
          if (!name) continue;
          if (el.matches("button, [role='button']")) text = "按鈕：" + name;
          else if (el.matches("a[href], [role='link']")) text = "連結：" + name;
          else text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        }
        if (!text) continue;
        seen.push(el);
        out.push({ el: el, text: text });
        total += text.length;
      }
      // 主要內容以外的按鈕（例如固定在底部的「下一步」）也要讓人知道有哪些可以按
      if (scope !== document.body) {
        var extra = controls()
          .filter(function (c) { return !scope.contains(c.el) && seen.indexOf(c.el) < 0; })
          .map(function (c) { return c.name; });
        if (extra.length) out.push({ el: null, text: "這頁的按鈕還有：" + extra.join("、") });
      }
      return out;
    }

    function showHighlight(el) {
      if (!el) {
        highlight.hidden = true;
        return;
      }
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      var place = function () {
        var r = el.getBoundingClientRect();
        highlight.style.transform = "translate(" + (r.left - 6) + "px," + (r.top - 6) + "px)";
        highlight.style.width = r.width + 12 + "px";
        highlight.style.height = r.height + 12 + "px";
        highlight.hidden = false;
      };
      place();
      setTimeout(place, 350);
    }

    function setReading(on) {
      reading = on;
      var btn = $("#read");
      btn.setAttribute("aria-pressed", String(on));
      $("#read-label").textContent = on ? "停止朗讀" : "念這頁";
      fab.toggleAttribute("data-busy", on);
      if (!on) showHighlight(null);
    }

    function stopReading() {
      clearTimeout(readTimer);
      if (flutter()) askApp("tts", { text: "" }, 2000);
      else if (window.speechSynthesis) speechSynthesis.cancel();
      setReading(false);
      say("已停止朗讀");
    }

    function speakAll(text) {
      // App 內：交給裝置端 TTS（handler `tts`）
      if (flutter()) {
        askApp("tts", { text: text, rate: SPEECH_RATE, locale: "zh-TW" }, 4000).then(function (r) {
          if (r && r.error) {
            setReading(false);
            say(r.error);
          } else if (r === null) {
            setReading(false);
            say("這個版本的城市通還不能朗讀");
          }
        });
        clearTimeout(readTimer);
        readTimer = setTimeout(function () { setReading(false); }, estimateSpeechMs(text, SPEECH_RATE));
        return true;
      }
      return false;
    }

    function readPage() {
      var blocks = collectBlocks();
      if (!blocks.length) {
        say("這頁沒有可以念的文字");
        return;
      }
      setReading(true);
      var title = document.title ? document.title + "。" : "";
      if (speakAll(title + blocks.map(function (b) { return b.text; }).join("。"))) return;
      if (!window.speechSynthesis) {
        setReading(false);
        say("這個瀏覽器不能朗讀");
        return;
      }
      // 瀏覽器：一段一段念，念到哪段就框到哪段
      speechSynthesis.cancel();
      var queue = (title ? [{ el: null, text: title }] : []).concat(blocks);
      queue.forEach(function (b, i) {
        var u = new SpeechSynthesisUtterance(b.text);
        u.lang = "zh-TW";
        u.rate = SPEECH_RATE;
        u.onstart = function () {
          if (reading) showHighlight(b.el);
        };
        if (i === queue.length - 1) {
          u.onend = function () { setReading(false); };
        }
        u.onerror = function (e) {
          if (e.error !== "interrupted" && e.error !== "canceled") setReading(false);
        };
        speechSynthesis.speak(u);
      });
    }

    function speak(text) {
      if (speakAll(String(text))) return;
      if (!window.speechSynthesis) return;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = "zh-TW";
      u.rate = SPEECH_RATE;
      speechSynthesis.speak(u);
    }

    // ---------------- F5：用講的 ----------------
    function webRecognition() {
      return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }
    // Chrome 的 webkitSpeechRecognition 會把聲音送到雲端辨識 → 只在本機開發時開放；App 內一律走裝置端
    var devHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    function voiceSource() {
      if (flutter()) return "app";
      if (devHost && webRecognition()) return "browser-dev";
      return "none";
    }

    var recognition = null;
    var listenToken = 0;

    function listenOnce() {
      var src = voiceSource();
      if (src === "app") {
        return askApp("speech_to_text", { locale: "zh-TW" }, 22000).then(function (d) {
          if (d && d.text) return d.text;
          throw new Error(d && d.error ? d.error : "沒有聽到聲音，請再說一次");
        });
      }
      if (src === "none") return Promise.reject(new Error("這台裝置不能用講的，可以在下面打字"));
      return new Promise(function (resolve, reject) {
        var R = webRecognition();
        var r = new R();
        recognition = r;
        r.lang = "zh-TW";
        r.interimResults = false;
        r.maxAlternatives = 1;
        var got = false;
        r.onresult = function (e) {
          got = true;
          resolve(e.results[0][0].transcript);
        };
        r.onerror = function (e) {
          reject(new Error(e.error === "not-allowed" ? "請允許使用麥克風" : "沒有聽清楚，請再說一次"));
        };
        r.onend = function () {
          recognition = null;
          if (!got) reject(new Error("沒有聽到聲音，請再說一次"));
        };
        r.start();
      });
    }

    function controls() {
      var els = document.querySelectorAll(
        'button, a[href], input[type="submit"], input[type="button"], summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"]',
      );
      var list = [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.disabled || el.getAttribute("aria-disabled") === "true" || !visible(el)) continue;
        var name = labelOf(el);
        if (name) list.push({ el: el, name: name.slice(0, 40) });
      }
      // 畫面內的排前面：同名時優先按看得到的
      var vh = window.innerHeight;
      list.sort(function (a, b) {
        var ra = a.el.getBoundingClientRect();
        var rb = b.el.getBoundingClientRect();
        var ia = ra.bottom > 0 && ra.top < vh ? 0 : 1;
        var ib = rb.bottom > 0 && rb.top < vh ? 0 : 1;
        return ia - ib;
      });
      return list;
    }

    var HELP = "可以照下面的例子說。";

    function setListenState(state, msg) {
      listenSheet.setAttribute("data-state", state);
      $("#listen-status").textContent = msg;
    }

    function openListen() {
      showSheet(listenSheet, voiceSource() === "none" ? "#typed" : "#listen-cancel");
      $("#typed").value = "";
      if (voiceSource() === "none") {
        setListenState("idle", "這台裝置不能用講的，可以在下面打字。");
        return;
      }
      startListening();
    }

    function startListening() {
      var token = ++listenToken;
      setListenState("listening", "請說要做什麼");
      $("#listen-again").hidden = true;
      listenOnce().then(
        function (text) {
          if (token !== listenToken) return;
          runCommand(text);
        },
        function (err) {
          if (token !== listenToken) return;
          setListenState("idle", err.message);
          $("#listen-again").hidden = false;
        },
      );
    }

    function cancelListen() {
      listenToken++;
      if (recognition) {
        try {
          recognition.abort();
        } catch (e) {}
      }
      listenSheet.hidden = true;
    }

    $("#listen-cancel").addEventListener("click", function () {
      cancelListen();
      fab.focus();
    });
    $("#listen-again").addEventListener("click", startListening);
    $("#typed-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = $("#typed").value.trim();
      if (v) runCommand(v);
    });

    function scrollPage(dir) {
      var behavior = reducedMotion() ? "auto" : "smooth";
      if (dir === "top") window.scrollTo({ top: 0, behavior: behavior });
      else window.scrollBy({ top: (dir === "down" ? 1 : -1) * window.innerHeight * 0.7, behavior: behavior });
    }

    function press(item) {
      var el = item.el;
      el.scrollIntoView({ block: "center", behavior: "auto" });
      showHighlight(el);
      setTimeout(function () {
        highlight.hidden = true;
        if (el.focus) el.focus();
        el.click();
      }, reducedMotion() ? 0 : 450);
    }

    var pendingPress = null;
    $("#confirm-yes").addEventListener("click", function () {
      confirmSheet.hidden = true;
      if (pendingPress) press(pendingPress);
      pendingPress = null;
    });
    $("#confirm-no").addEventListener("click", function () {
      confirmSheet.hidden = true;
      pendingPress = null;
      say("沒有按下");
      fab.focus();
    });

    /** 執行一句話；回傳解析結果（給測試與頁面使用）。 */
    function runCommand(text) {
      var list = controls();
      var cmd = parseCommand(text, list.map(function (c) { return c.name; }));
      var heard = "聽到「" + String(text).trim() + "」";
      var done = function (msg) {
        listenSheet.hidden = true;
        say(heard + "，" + msg);
      };
      switch (cmd.type) {
        case "press":
          var item = list[cmd.index];
          if (isDangerous(item.name)) {
            listenSheet.hidden = true;
            pendingPress = item;
            $("#confirm-title").textContent = "要按「" + item.name + "」嗎";
            showSheet(confirmSheet, "#confirm-no");
            say(heard + "，要按「" + item.name + "」嗎");
          } else {
            done("按下「" + item.name + "」");
            press(item);
          }
          break;
        case "back":
          done("回上一頁");
          goBack();
          break;
        case "scroll":
          done(cmd.dir === "top" ? "回到最上面" : cmd.dir === "down" ? "往下" : "往上");
          scrollPage(cmd.dir);
          break;
        case "font":
          update({ fontLevel: stepLevel(settings.fontLevel, cmd.dir) });
          done("字級：" + FONT_LEVELS[levelIndex(settings.fontLevel)].label);
          break;
        case "contrast":
          update({ highContrast: cmd.on });
          done(cmd.on ? "已開啟高對比" : "已關閉高對比");
          break;
        case "read":
          listenSheet.hidden = true;
          readPage();
          break;
        case "stop":
          listenSheet.hidden = true;
          stopReading();
          break;
        case "hand":
          update({ hand: cmd.hand });
          done(cmd.hand === "left" ? "操作鈕已移到左手邊" : "操作鈕已移到右手邊");
          break;
        case "help":
          setListenState("idle", HELP);
          $("#listen-again").hidden = false;
          break;
        case "notfound":
          setListenState("idle", "這頁找不到「" + cmd.target + "」，" + HELP);
          $("#listen-again").hidden = false;
          break;
        default:
          setListenState("idle", heard + "，不知道要做什麼，" + HELP);
          $("#listen-again").hidden = false;
      }
      return cmd;
    }

    // ---------------- 啟動 ----------------
    applyAll();
    broadcast();
    animate(fab, [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }], { duration: 240 });

    // App 內：以 App 存的設定為準（跨微服務共用；localStorage 每個網域各自一份）
    askApp("a11y_settings", { action: "get" }, 1500).then(function (s) {
      if (!s || typeof s !== "object") return;
      var next = sanitizeSettings(s);
      if (!next.enabled) return destroy();
      if (JSON.stringify(next) !== JSON.stringify(settings)) update(next, { fromApp: true });
    });

    function destroy() {
      contrastBooster.off();
      if (reading) stopReading();
      pageStyle.remove();
      host.remove();
      document.documentElement.removeAttribute("data-tp-font");
      document.documentElement.removeAttribute("data-tp-contrast");
      window.__tpA11y = { settings: settings, enabled: false };
    }

    window.__tpA11y = {
      enabled: true,
      version: "1.0.0",
      get settings() {
        return Object.assign({}, settings);
      },
      own: own,
      setSettings: function (partial) {
        update(partial);
      },
      onChange: function (fn) {
        listeners.push(fn);
        return function () {
          listeners = listeners.filter(function (f) { return f !== fn; });
        };
      },
      speak: speak,
      stop: stopReading,
      read: readPage,
      listen: listenOnce,
      runCommand: runCommand,
      openPanel: openPanel,
      serviceCatalog: function () {
        return { fromApp: catalogFromApp, count: catalog.length };
      },
      contrastFixed: function () {
        return contrastBooster.count();
      },
      destroy: destroy,
    };
  }

  // ===================================================================
  // 四、樣式與畫面（Shadow DOM：不受微服務 CSS 影響，也不影響微服務）
  // ===================================================================

  // 高對比時加在頁面上的規則（文字顏色由 contrastBooster 逐一處理）
  var CONTRAST_PAGE_CSS =
    "html[data-tp-contrast=high] body :focus-visible{outline:3px solid #0b0d0e !important;outline-offset:2px !important;box-shadow:0 0 0 6px #fff !important}" +
    "html[data-tp-contrast=high] body :is(input,select,textarea){border:2px solid #0b0d0e !important}" +
    "html[data-tp-contrast=high] body ::placeholder{color:#30383d !important;opacity:1 !important}" +
    "html[data-tp-contrast=high] body a[href]{text-decoration:underline !important}";

  function icon(path) {
    return '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
  }
  var I = {
    person: '<circle cx="12" cy="4.5" r="2"/><path d="M4 8.5h16M12 8.5v5.5M8 21l4-7 4 7"/>',
    speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    smaller: '<path d="M3 19 8 6l5 13M5 15h6M15 12h6"/>',
    bigger: '<path d="M3 19 8 6l5 13M5 15h6M18 9v6M15 12h6"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    textsize: '<path d="M3 7V5h11v2M8.5 5v14M6.5 19h4"/><path d="M14 12v-1.5h7V12M17.5 10.5V19M16 19h3"/>',
  };

  var TEMPLATE =
    "<style>" +
    ":host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;" +
    "font-family:'PingFang TC','Noto Sans TC','Microsoft JhengHei',Roboto,system-ui,sans-serif;" +
    "--primary:#5ab4c5;--primary-50:#edf8fa;--primary-800:#22474e;--on-primary:#171b1d;--ink:#171b1d;--sub:#475259;" +
    "--line:#738995;--surface:#fff;--ring:#22474e;--shadow:0 8px 24px rgba(11,13,14,.18);" +
    "--side:16px;--lift:calc(104px + env(safe-area-inset-bottom,0px));color:var(--ink);font-size:18px;line-height:1.4}" +
    ":host{--tile:#f1f3f4;--chip:#dbf1f5}" +
    ":host([data-contrast]){--primary:#0b0d0e;--on-primary:#fff;--primary-50:#fff;--line:#0b0d0e;--sub:#0b0d0e;--ink:#0b0d0e;--ring:#0b0d0e;--tile:#fff;--chip:#fff;--primary-800:#0b0d0e}" +
    "*{box-sizing:border-box}" +
    "[hidden]{display:none !important}" +
    "button,input{font:inherit;color:inherit}" +
    "button{cursor:pointer;-webkit-tap-highlight-color:transparent}" +
    "button:focus-visible,input:focus-visible{outline:3px solid var(--ring);outline-offset:3px}" +
    "button:disabled{cursor:not-allowed;opacity:.45}" +
    // 浮動鈕：64×64，主色底＋深字（7.2:1）；展開時圖示轉成 ×、字變「關閉」
    "#fab{pointer-events:auto;position:fixed;bottom:var(--lift);right:var(--side);width:64px;height:64px;border-radius:32px;" +
    "border:2px solid var(--primary-800);background:var(--primary);color:var(--on-primary);box-shadow:var(--shadow);" +
    "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:0;font-size:14px;font-weight:600;" +
    "transition:transform .18s cubic-bezier(.175,.885,.32,1.275)}" +
    "#fab:active{transform:scale(.9)}" +
    "#fab svg{width:26px;height:26px}" +
    "#fab .i-open,#fab .i-close{display:block;height:26px}#fab .i-close{display:none}#fab[aria-expanded=true] .i-close{display:block}#fab[aria-expanded=true] .i-open{display:none}" +
    ":host([data-hand=left]) #fab{right:auto;left:var(--side)}" +
    "#fab[data-busy]::after{content:'';position:absolute;inset:-6px;border-radius:40px;border:3px solid var(--primary-800);animation:pulse 1.6s ease-out infinite}" +
    // 主選單：2 欄大格子，從浮動鈕的位置彈出
    "#panel{pointer-events:auto;position:fixed;bottom:calc(var(--lift) + 76px);right:var(--side);width:min(344px,calc(100vw - 32px));" +
    "max-height:calc(100vh - var(--lift) - 96px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:24px;" +
    "box-shadow:0 18px 48px rgba(11,13,14,.28);padding:14px;transform-origin:calc(100% - 32px) calc(100% + 44px)}" +
    ":host([data-hand=left]) #panel{right:auto;left:var(--side);transform-origin:32px calc(100% + 44px)}" +
    ".ph{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:2px 6px 12px}" +
    ".ph b{font-size:17px}" +
    ".grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
    ".tile{position:relative;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:10px;min-height:112px;" +
    "padding:14px;border:2px solid transparent;border-radius:18px;background:var(--tile);text-align:left;" +
    "transition:transform .18s cubic-bezier(.175,.885,.32,1.275),background-color .15s ease}" +
    ".tile:active{transform:scale(.95)}" +
    ".tile.wide{grid-column:1 / -1;flex-direction:row;align-items:center;justify-content:flex-start;min-height:84px}" +
    ".tile .ic{flex:none;width:48px;height:48px;border-radius:24px;background:var(--chip);color:var(--primary-800);display:flex;align-items:center;justify-content:center}" +
    ":host([data-contrast]) .tile{border-color:#0b0d0e}:host([data-contrast]) .tile .ic{border:2px solid #0b0d0e}" +
    ".tile .t{display:flex;flex-direction:column}" +
    ".tile .l{font-weight:600;font-size:18px}" +
    ".tile .s{font-size:15px;color:var(--sub)}" +
    ".tile .go{margin-left:auto;font-size:26px;line-height:1;color:var(--sub)}" +
    ".tile[aria-pressed=true]{background:var(--chip);border-color:var(--primary-800)}" +
    // 「找服務」鈕：主選單打開時出現在「關閉」旁邊
    "#find{pointer-events:auto;position:fixed;bottom:var(--lift);right:calc(var(--side) + 76px);width:64px;height:64px;border-radius:32px;" +
    "border:2px solid var(--primary-800);background:var(--surface);color:var(--primary-800);box-shadow:var(--shadow);" +
    "display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;font-size:13px;font-weight:600;" +
    "transition:transform .18s cubic-bezier(.175,.885,.32,1.275)}" +
    "#find:active{transform:scale(.9)}#find svg{width:24px;height:24px}" +
    "#find .i-find,#find .i-menu{display:block;height:24px}#find .i-menu{display:none}#find[aria-pressed=true] .i-menu{display:block}#find[aria-pressed=true] .i-find{display:none}" +
    "#find[aria-pressed=true]{background:var(--primary);color:var(--on-primary)}" +
    ":host([data-hand=left]) #find{right:auto;left:calc(var(--side) + 76px)}" +
    // 搜尋頁
    ".sh{display:flex;align-items:center;gap:8px;margin:-4px 0 10px}" +
    "#search-back{min-width:64px;min-height:64px;border:0;border-radius:16px;background:var(--tile);display:flex;align-items:center;justify-content:center}" +
    ".sh b{font-size:20px}" +
    "#search-form{display:flex;flex-direction:column;gap:8px;margin:0 0 10px}" +
    ".qa{display:flex;gap:8px}" +
    "#search-form label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
    "#q{width:100%;min-height:64px;border:2px solid var(--line);border-radius:16px;padding:0 14px;background:var(--surface);font-size:18px}" +
    "#q::placeholder{color:#5e6d76}" +
    "#q-mic,#q-go{flex:1;min-height:64px;border-radius:16px;border:2px solid var(--primary-800);display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600}" +
    "#q-mic{background:var(--surface);color:var(--primary-800)}#q-go{background:var(--primary);color:var(--on-primary)}" +
    "#search-status{margin:0 4px 8px;font-size:16px;font-weight:600;min-height:1em}" +
    "#search-status:empty{display:none}" +
    "#examples .cap{display:block;font-size:15px;color:var(--sub);margin:4px 4px 8px}" +
    "#examples .chips{display:flex;flex-wrap:wrap;gap:8px}" +
    "#examples button{min-height:64px;padding:8px 16px;border-radius:32px;border:2px solid var(--line);background:var(--tile);font-weight:600}" +
    "#results{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}" +
    ".result{width:100%;display:flex;align-items:center;gap:12px;min-height:80px;padding:12px;border:2px solid transparent;border-radius:18px;background:var(--tile);text-align:left;" +
    "transition:transform .18s cubic-bezier(.175,.885,.32,1.275)}" +
    ".result:active{transform:scale(.97)}" +
    ".result .ic{flex:none;width:48px;height:48px;border-radius:24px;background:var(--chip);color:var(--primary-800);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px}" +
    ".result .t{flex:1;display:flex;flex-direction:column;min-width:0}.result .l{font-weight:600;font-size:18px}.result .s{font-size:15px;color:var(--sub)}" +
    ".result .why{font-size:14px;color:var(--primary-800);margin-top:2px}" +
    ".result .go{flex:none;padding:6px 12px;border-radius:16px;background:var(--primary);color:var(--on-primary);font-weight:600;font-size:15px}" +
    ":host([data-contrast]) .result{border-color:#0b0d0e}" +
    "#search-help{margin-top:10px}" +
    "#call-1999{width:100%;min-height:64px;border-radius:16px;border:2px solid var(--line);background:var(--surface);display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600}" +
    // 調整列：貼底、不虛化背景，邊調邊看
    "#dock{pointer-events:auto;position:fixed;left:0;right:0;bottom:0;max-width:560px;margin:0 auto;background:var(--surface);" +
    "border:1px solid var(--line);border-bottom:0;border-radius:24px 24px 0 0;box-shadow:0 -10px 32px rgba(11,13,14,.22);" +
    "padding:10px 16px max(28px, calc(12px + env(safe-area-inset-bottom,0px)))}" +
    ".grab{width:44px;height:5px;border-radius:3px;background:#adb8be;margin:0 auto 10px}" +
    "#dock h2{margin:0;font-size:20px;font-weight:600}" +
    "#dock .ds{margin:2px 0 12px;font-size:15px;color:var(--sub)}" +
    ".seg{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:0;padding:4px;border-radius:18px;background:var(--tile);border:2px solid var(--line);margin-bottom:12px}" +
    ".seg .thumb{position:absolute;top:4px;bottom:4px;left:4px;width:calc((100% - 8px) / 3);border-radius:14px;background:var(--primary);" +
    "border:2px solid var(--primary-800);box-shadow:0 4px 12px rgba(11,13,14,.18);transition:transform .38s cubic-bezier(.175,.885,.32,1.275)}" +
    ".seg[data-i='1'] .thumb{transform:translateX(100%)}.seg[data-i='2'] .thumb{transform:translateX(200%)}" +
    ".seg button{position:relative;z-index:1;min-height:80px;border:0;background:transparent;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-weight:600}" +
    ".seg button[aria-checked=true]{color:var(--on-primary)}" +
    ".seg .g{line-height:1;font-weight:700}" +
    ".row2{display:flex;gap:10px}" +
    "#contrast{flex:1;display:flex;align-items:center;gap:12px;min-height:64px;padding:8px 14px;border:2px solid var(--line);border-radius:16px;background:var(--surface);text-align:left}" +
    "#contrast .t{display:flex;flex-direction:column;flex:1}#contrast .l{font-weight:600}#contrast .s{font-size:15px;color:var(--sub)}" +
    ".track{flex:none;position:relative;width:56px;height:32px;border-radius:16px;background:#adb8be;border:2px solid #475259;transition:background-color .2s ease}" +
    ".knob{position:absolute;top:2px;left:2px;width:24px;height:24px;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .3s cubic-bezier(.175,.885,.32,1.275)}" +
    "#contrast[aria-checked=true] .track{background:var(--primary-800);border-color:var(--primary-800)}#contrast[aria-checked=true] .knob{transform:translateX(24px)}" +
    "#dock-done{flex:none;width:112px}" +
    // 底部卡片：詢問、確認、用講的
    ".sheet{pointer-events:auto;position:fixed;left:var(--side);right:var(--side);bottom:max(28px, calc(12px + env(safe-area-inset-bottom,0px)));" +
    "max-width:480px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:20px}" +
    ".sheet h2{margin:0 0 8px;font-size:22px;line-height:1.35;font-weight:600}" +
    ".sheet p{margin:0 0 16px;color:var(--sub)}" +
    ".actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}" +
    ".btn{min-height:64px;border-radius:12px;font-weight:600;padding:8px 12px}" +
    ".btn.primary{background:var(--primary);color:var(--on-primary);border:2px solid var(--primary-800)}" +
    ".btn.secondary{background:var(--surface);color:var(--ink);border:2px solid var(--line)}" +
    ".mic{display:flex;align-items:center;gap:14px;margin-bottom:12px}" +
    ".mic .dot{position:relative;flex:none;width:56px;height:56px;border-radius:28px;background:var(--primary);color:var(--on-primary);display:flex;align-items:center;justify-content:center}" +
    "#listen[data-state=listening] .dot::after{content:'';position:absolute;inset:-6px;border-radius:34px;border:3px solid var(--primary);animation:pulse 1.4s ease-out infinite}" +
    "#listen-status{margin:0;color:var(--ink);font-weight:600}" +
    ".hint{font-size:15px;color:var(--sub);margin:0 0 12px}" +
    "form{display:flex;gap:8px;margin-bottom:12px}" +
    "form label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
    "#typed{flex:1;min-width:0;min-height:64px;border:2px solid var(--line);border-radius:12px;padding:0 14px;background:var(--surface)}" +
    "#typed::placeholder{color:#5e6d76}" +
    "form button{flex:none;width:64px;min-height:64px;border-radius:12px;border:2px solid var(--primary-800);background:var(--primary);color:var(--on-primary);display:flex;align-items:center;justify-content:center}" +
    // 提示與朗讀框
    "#scrim{pointer-events:auto;position:fixed;inset:0;background:rgba(11,13,14,.35);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}" +
    ":host([data-contrast]) #scrim{background:rgba(11,13,14,.6)}" +
    "#toast{position:fixed;left:50%;top:calc(16px + env(safe-area-inset-top,0px));transform:translateX(-50%);max-width:calc(100vw - 32px);width:max-content;" +
    "background:#171b1d;color:#fff;border-radius:12px;padding:12px 16px;font-size:17px;box-shadow:var(--shadow)}" +
    "#hl{position:fixed;left:0;top:0;border:4px solid #f5ba4b;outline:2px solid #171b1d;border-radius:10px;transition:transform .2s ease,width .2s ease,height .2s ease}" +
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
    "@keyframes pulse{0%{transform:scale(.9);opacity:.9}100%{transform:scale(1.25);opacity:0}}" +
    "@media (prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important}}" +
    "</style>" +
    '<div id="hl" hidden></div>' +
    '<div id="scrim" aria-hidden="true" hidden></div>' +
    '<div id="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" hidden>' +
    '<div id="view-main"><div class="ph"><b id="panel-title">操作輔助</b></div><div class="grid">' +
    '<button class="tile" id="read" type="button" aria-pressed="false"><span class="ic">' + icon(I.speaker) + '</span>' +
    '<span class="t"><span class="l" id="read-label">念這頁</span><span class="s">再按一次停止</span></span></button>' +
    '<button class="tile" id="voice" type="button"><span class="ic">' + icon(I.mic) + '</span>' +
    '<span class="t"><span class="l">用講的</span><span class="s">說按鈕上的字</span></span></button>' +
    '<button class="tile wide" id="display" type="button"><span class="ic">' + icon(I.textsize) + '</span>' +
    '<span class="t"><span class="l">字級與對比</span><span class="s" id="display-state">字級標準・高對比關</span></span><span class="go" aria-hidden="true">›</span></button>' +
    '<button class="tile" id="back" type="button"><span class="ic">' + icon(I.back) + '</span><span class="t"><span class="l">回上一頁</span></span></button>' +
    '<button class="tile" id="hand" type="button"><span class="ic">' + icon(I.swap) + '</span><span class="t"><span class="l" id="hand-label">換到左手</span></span></button>' +
    "</div></div>" +
    '<div id="view-search" hidden><div class="sh"><button id="search-back" type="button" aria-label="回到操作輔助選單">' + icon(I.back) + '</button><b>找服務</b></div>' +
    '<form id="search-form" role="search"><label for="q">想辦什麼事</label>' +
    '<input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="想辦什麼事？例如：繳水費">' +
    '<div class="qa"><button id="q-mic" type="button">' + icon(I.mic) + "用講的</button>" +
    '<button id="q-go" type="submit">' + icon(I.search) + "搜尋</button></div></form>" +
    '<p id="search-status" role="status" aria-live="polite"></p>' +
    '<div id="examples"><span class="cap">常見的問題，點一下就幫你找</span><div class="chips">' +
    SEARCH_EXAMPLES.map(function (t) { return '<button type="button">' + t + "</button>"; }).join("") +
    "</div></div>" +
    '<ul id="results" aria-label="可能的服務"></ul>' +
    '<div id="search-help" hidden><button id="call-1999" type="button">' + icon(I.phone) + "都不是？打電話問 1999</button></div>" +
    "</div></div>" +
    '<button id="find" type="button" aria-pressed="false" aria-label="找服務" hidden><span class="i-find">' + icon(I.search) + '</span><span class="i-menu">' + icon(I.grid) + '</span><span id="find-label" aria-hidden="true">找服務</span></button>' +
    '<div id="dock" role="dialog" aria-modal="false" aria-labelledby="dock-title" aria-describedby="dock-desc" hidden>' +
    '<div class="grab" aria-hidden="true"></div><h2 id="dock-title">字級與對比</h2><p class="ds" id="dock-desc">邊調邊看，頁面會馬上變化</p>' +
    '<div class="seg" role="radiogroup" aria-label="字級" data-i="0"><span class="thumb" aria-hidden="true"></span>' +
    '<button type="button" role="radio" aria-checked="true" data-level="normal"><span class="g" aria-hidden="true" style="font-size:20px">字</span>標準</button>' +
    '<button type="button" role="radio" aria-checked="false" data-level="large" tabindex="-1"><span class="g" aria-hidden="true" style="font-size:26px">字</span>大</button>' +
    '<button type="button" role="radio" aria-checked="false" data-level="xlarge" tabindex="-1"><span class="g" aria-hidden="true" style="font-size:32px">字</span>特大</button></div>' +
    '<div class="row2"><button id="contrast" type="button" role="switch" aria-checked="false">' + icon(I.contrast) +
    '<span class="t"><span class="l">高對比</span><span class="s" id="contrast-state">關</span></span><span class="track" aria-hidden="true"><span class="knob"></span></span></button>' +
    '<button class="btn primary" id="dock-done" type="button">完成</button></div></div>' +
    '<button id="fab" type="button" aria-expanded="false" aria-controls="panel" aria-label="操作輔助"><span class="i-open">' + icon(I.person) +
    '</span><span class="i-close">' + icon(I.close) + '</span><span id="fab-label" aria-hidden="true">輔助</span></button>' +
    '<div class="sheet" id="ask" role="dialog" aria-modal="false" aria-labelledby="ask-title" aria-describedby="ask-desc" hidden>' +
    '<h2 id="ask-title">按鈕不太好按嗎？要不要放大一點</h2><p id="ask-desc"></p>' +
    '<div class="actions"><button class="btn secondary" id="ask-no" type="button">不用</button>' +
    '<button class="btn primary" id="ask-yes" type="button">放大</button></div></div>' +
    '<div class="sheet" id="confirm" role="alertdialog" aria-modal="false" aria-labelledby="confirm-title" aria-describedby="confirm-desc" hidden>' +
    '<h2 id="confirm-title">要按這個按鈕嗎</h2><p id="confirm-desc">這個動作可能無法復原，請再確認一次。</p>' +
    '<div class="actions"><button class="btn secondary" id="confirm-no" type="button">不要</button>' +
    '<button class="btn primary" id="confirm-yes" type="button">確定按下</button></div></div>' +
    '<div class="sheet" id="listen" role="dialog" aria-modal="false" aria-labelledby="listen-status" data-state="idle" hidden>' +
    '<div class="mic"><span class="dot">' + icon(I.mic) + '</span><p id="listen-status" aria-live="polite">請說要做什麼</p></div>' +
    '<p class="hint" id="listen-hint">可以說：返回、往下、往上、放大、縮小、念這頁、停止，或直接說按鈕上的字，例如「下一步」。</p>' +
    '<form id="typed-form"><label for="typed">也可以打字</label><input id="typed" type="text" enterkeyhint="go" autocomplete="off" placeholder="也可以打字，例如：下一步">' +
    '<button type="submit" aria-label="執行">' + icon(I.send) + "</button></form>" +
    '<div class="actions"><button class="btn secondary" id="listen-cancel" type="button">取消</button>' +
    '<button class="btn primary" id="listen-again" type="button" hidden>再說一次</button></div></div>' +
    '<div id="toast" aria-hidden="true" hidden></div>' +
    '<div id="live" class="sr" role="status" aria-live="polite"></div>';

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
