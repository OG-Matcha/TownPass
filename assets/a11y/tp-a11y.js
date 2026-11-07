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

  var core = {
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
    if (window.top !== window) return;
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

    // ---------------- 設定套用 ----------------
    var pageStyle = document.createElement("style");
    pageStyle.id = "tp-a11y-page-style";
    (document.head || document.documentElement).appendChild(pageStyle);

    function applyFont() {
      var lv = FONT_LEVELS[levelIndex(settings.fontLevel)];
      // 整頁縮放而不是只放大字：按不準的人需要的是「按鈕也變大」。zoom 放在 body，浮動列（在 html 下）不受影響。
      var css = own.font || lv.zoom === 1 ? "" : "body{zoom:" + lv.zoom + " !important;}";
      if (settings.highContrast && !own.contrast) css += CONTRAST_PAGE_CSS;
      pageStyle.textContent = css;
      document.documentElement.setAttribute("data-tp-font", lv.id);
      $("#font-state").textContent = "字級：" + lv.label;
      $("#font-down").disabled = levelIndex(lv.id) === 0;
      $("#font-up").disabled = levelIndex(lv.id) === FONT_LEVELS.length - 1;
    }

    function applyContrast() {
      host.toggleAttribute("data-contrast", settings.highContrast);
      var btn = $("#contrast");
      btn.setAttribute("aria-pressed", String(settings.highContrast));
      $("#contrast-state").textContent = settings.highContrast ? "目前：開" : "目前：關";
      if (settings.highContrast) document.documentElement.setAttribute("data-tp-contrast", "high");
      else document.documentElement.removeAttribute("data-tp-contrast");
      if (own.contrast) return;
      if (settings.highContrast) contrastBooster.on();
      else contrastBooster.off();
    }

    function applyHand() {
      host.setAttribute("data-hand", settings.hand);
      $("#hand-label").textContent = settings.hand === "right" ? "換到左手邊" : "換到右手邊";
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
      if (!ask.hidden || !listenSheet.hidden || !confirmSheet.hidden) {
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

    // ---------------- 浮動操作列 ----------------
    function isOpen() {
      return !panel.hidden;
    }
    function openPanel() {
      closeSheets();
      panel.hidden = false;
      fab.setAttribute("aria-expanded", "true");
      var items = panel.querySelectorAll(".item, .row");
      for (var i = 0; i < items.length; i++) {
        animate(items[items.length - 1 - i], [{ opacity: 0, transform: "translateY(12px) scale(.96)" }, { opacity: 1, transform: "none" }], {
          delay: i * 24,
          fill: "backwards",
        });
      }
      var first = panel.querySelector("button:not([disabled])");
      if (first) first.focus();
    }
    function closePanel(focusFab) {
      if (!isOpen()) return;
      panel.hidden = true;
      fab.setAttribute("aria-expanded", "false");
      if (focusFab) fab.focus();
    }
    fab.addEventListener("click", function () {
      if (isOpen()) closePanel(true);
      else openPanel();
    });

    // 點在操作列以外就收起
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
      if (ev.key !== "Escape") return;
      if (isOpen()) closePanel(true);
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
    $("#font-up").addEventListener("click", function () {
      update({ fontLevel: stepLevel(settings.fontLevel, 1) });
      say("字級：" + FONT_LEVELS[levelIndex(settings.fontLevel)].label);
    });
    $("#font-down").addEventListener("click", function () {
      update({ fontLevel: stepLevel(settings.fontLevel, -1) });
      say("字級：" + FONT_LEVELS[levelIndex(settings.fontLevel)].label);
    });
    $("#contrast").addEventListener("click", function () {
      update({ highContrast: !settings.highContrast });
      say(settings.highContrast ? "已開啟高對比" : "已關閉高對比");
    });
    $("#back").addEventListener("click", function () {
      closePanel(false);
      goBack();
    });
    $("#hand").addEventListener("click", function () {
      update({ hand: settings.hand === "right" ? "left" : "right" });
      say(settings.hand === "right" ? "操作鈕已移到右手邊" : "操作鈕已移到左手邊");
      fab.focus();
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
              text = "輸入欄：" + labelOf(n) + (v ? "，目前是" + v : "");
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
  };

  var TEMPLATE =
    "<style>" +
    ":host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;" +
    "font-family:'PingFang TC','Noto Sans TC','Microsoft JhengHei',Roboto,system-ui,sans-serif;" +
    "--primary:#5ab4c5;--primary-50:#edf8fa;--primary-800:#22474e;--on-primary:#171b1d;--ink:#171b1d;--sub:#475259;" +
    "--line:#738995;--surface:#fff;--ring:#22474e;--shadow:0 8px 24px rgba(11,13,14,.18);" +
    "--side:16px;--lift:calc(104px + env(safe-area-inset-bottom,0px));color:var(--ink);font-size:18px;line-height:1.4}" +
    ":host([data-contrast]){--primary:#0b0d0e;--on-primary:#fff;--primary-50:#fff;--line:#0b0d0e;--sub:#0b0d0e;--ink:#0b0d0e;--ring:#0b0d0e}" +
    "*{box-sizing:border-box}" +
    "[hidden]{display:none !important}" +
    "button,input{font:inherit;color:inherit}" +
    "button{cursor:pointer;-webkit-tap-highlight-color:transparent}" +
    "button:focus-visible,input:focus-visible{outline:3px solid var(--ring);outline-offset:3px}" +
    "button:disabled{cursor:not-allowed;opacity:.45}" +
    // 浮動鈕：64×64，主色底＋深字（7.2:1）
    "#fab{pointer-events:auto;position:fixed;bottom:var(--lift);right:var(--side);width:64px;height:64px;border-radius:32px;" +
    "border:2px solid var(--primary-800);background:var(--primary);color:var(--on-primary);box-shadow:var(--shadow);" +
    "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:0;font-size:14px;font-weight:600;" +
    "transition:transform .15s ease}" +
    "#fab:active{transform:scale(.94)}" +
    "#fab svg{width:26px;height:26px}" +
    ":host([data-hand=left]) #fab{right:auto;left:var(--side)}" +
    "#fab[data-busy]::after{content:'';position:absolute;inset:-6px;border-radius:40px;border:3px solid var(--primary-800);animation:pulse 1.6s ease-out infinite}" +
    // 操作列
    "#panel{pointer-events:auto;position:fixed;bottom:calc(var(--lift) + 76px);right:var(--side);width:min(300px,calc(100vw - 32px));" +
    "max-height:calc(100vh - var(--lift) - 96px);overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:16px;" +
    "box-shadow:var(--shadow);padding:8px;display:flex;flex-direction:column;gap:6px}" +
    ":host([data-hand=left]) #panel{right:auto;left:var(--side)}" +
    ".item{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:8px 14px;border:0;border-radius:12px;background:transparent;text-align:left}" +
    ".item:hover{background:var(--primary-50)}" +
    ".item[aria-pressed=true]{background:var(--primary-50);box-shadow:inset 0 0 0 2px var(--primary-800)}" +
    ".item .t{display:flex;flex-direction:column}" +
    ".item .l{font-weight:600}" +
    ".item .s{font-size:15px;color:var(--sub)}" +
    ".row{display:flex;flex-direction:column;gap:4px;padding:6px 6px 4px}" +
    ".row .cap{font-size:15px;color:var(--sub);padding:0 8px}" +
    ".row .pair{display:grid;grid-template-columns:1fr 1fr;gap:6px}" +
    ".pair button{min-height:64px;border-radius:12px;border:2px solid var(--line);background:var(--surface);display:flex;align-items:center;justify-content:center;gap:6px;font-weight:600}" +
    "hr{border:0;border-top:1px solid #cad1d5;margin:2px 8px;width:auto}" +
    // 底部卡片：詢問、確認、用講的
    ".sheet{pointer-events:auto;position:fixed;left:var(--side);right:var(--side);bottom:calc(16px + env(safe-area-inset-bottom,0px));" +
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
    "#toast{position:fixed;left:50%;bottom:calc(var(--lift) + 80px);transform:translateX(-50%);max-width:calc(100vw - 32px);width:max-content;" +
    "background:#171b1d;color:#fff;border-radius:12px;padding:12px 16px;font-size:17px;box-shadow:var(--shadow)}" +
    "#hl{position:fixed;left:0;top:0;border:4px solid #f5ba4b;outline:2px solid #171b1d;border-radius:10px;transition:transform .2s ease,width .2s ease,height .2s ease}" +
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
    "@keyframes pulse{0%{transform:scale(.9);opacity:.9}100%{transform:scale(1.25);opacity:0}}" +
    "@media (prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important}}" +
    "</style>" +
    '<div id="hl" hidden></div>' +
    '<div id="panel" role="group" aria-label="操作輔助" hidden>' +
    '<button class="item" id="read" type="button" aria-pressed="false">' + icon(I.speaker) +
    '<span class="t"><span class="l" id="read-label">念這頁</span><span class="s">按了才念，再按停止</span></span></button>' +
    '<button class="item" id="voice" type="button">' + icon(I.mic) +
    '<span class="t"><span class="l">用講的</span><span class="s">說「返回」「往下」或按鈕上的字</span></span></button>' +
    '<div class="row" role="group" aria-labelledby="font-state"><span class="cap" id="font-state">字級：標準</span><div class="pair">' +
    '<button id="font-down" type="button">' + icon(I.smaller) + "字變小</button>" +
    '<button id="font-up" type="button">' + icon(I.bigger) + "字變大</button></div></div>" +
    '<button class="item" id="contrast" type="button" aria-pressed="false">' + icon(I.contrast) +
    '<span class="t"><span class="l">高對比</span><span class="s" id="contrast-state">目前：關</span></span></button>' +
    "<hr>" +
    '<button class="item" id="back" type="button">' + icon(I.back) + '<span class="t"><span class="l">回上一頁</span></span></button>' +
    '<button class="item" id="hand" type="button">' + icon(I.swap) + '<span class="t"><span class="l" id="hand-label">換到左手邊</span></span></button>' +
    "</div>" +
    '<button id="fab" type="button" aria-expanded="false" aria-controls="panel" aria-label="操作輔助">' + icon(I.person) + '<span aria-hidden="true">輔助</span></button>' +
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
