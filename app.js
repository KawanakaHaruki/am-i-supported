"use strict";

/* ============================================================
 * 最新バージョンの取得
 * まず各ブラウザの公式ソースへ直接fetch(リアルタイム)を試み、
 * CORS等で失敗したら CI が週次生成する versions.json にフォールバックする。
 * ============================================================ */

const SUPPORTED = ["chrome", "edge", "firefox", "safari"];
const BROWSER_LABEL = { chrome: "Google Chrome", edge: "Microsoft Edge", firefox: "Mozilla Firefox", safari: "Safari" };

const LIVE_SOURCES = {
  chrome: async () => {
    const j = await fetchJson("https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions?pageSize=1");
    return j.versions[0].version;
  },
  firefox: async () => {
    const j = await fetchJson("https://product-details.mozilla.org/1.0/firefox_versions.json");
    return j.LATEST_FIREFOX_VERSION;
  },
  edge: async () => {
    const j = await fetchJson("https://edgeupdates.microsoft.com/api/products");
    const stable = j.find((p) => p.Product === "Stable");
    const versions = stable.Releases.map((r) => r.ProductVersion).filter(Boolean).sort(compareVersions);
    return versions[versions.length - 1];
  },
  safari: async () => {
    const j = await fetchJson("https://developer.apple.com/tutorials/data/index/safari-release-notes");
    const versions = [];
    (function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        const m = typeof node.title === "string" && node.title.match(/^Safari ([\d.]+) Release Notes$/);
        if (m) versions.push(m[1]);
        Object.values(node).forEach(walk);
      }
    })(j);
    versions.sort(compareVersions);
    return versions[versions.length - 1];
  },
};

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// 戻り値: { version, via: "live" | "cached", updatedAt? } / 取得不能なら null
async function getLatestVersion(browserKey) {
  if (LIVE_SOURCES[browserKey]) {
    try {
      const version = await LIVE_SOURCES[browserKey]();
      if (version) return { version, via: "live" };
    } catch (e) {
      /* CORS・ネットワーク断など。フォールバックへ */
    }
  }
  try {
    const j = await fetchJson("versions.json?t=" + Date.now());
    const entry = j.browsers && j.browsers[browserKey];
    if (entry && entry.latest) return { version: entry.latest, via: "cached", updatedAt: j.updatedAt };
  } catch (e) {
    /* versions.json 未配置・オフライン */
  }
  return null;
}

/* ============================================================
 * 環境検出
 * ============================================================ */

function parseUA(ua) {
  const pick = (re) => {
    const m = ua.match(re);
    return m ? m[1] : null;
  };

  // アプリ内ブラウザ(WebView)を先に検出。LINEは外部ブラウザへ自動誘導できるため専用キーにする
  if (/ Line\//i.test(ua)) return { key: "line", name: "LINE アプリ内ブラウザ", version: pick(/ Line\/([\d.]+)/i) };
  const inApp =
    (/FBAN|FBAV/.test(ua) && "Facebook") ||
    (/Instagram/.test(ua) && "Instagram") ||
    (/YJApp/.test(ua) && "Yahoo! JAPAN") ||
    (/MicroMessenger/.test(ua) && "WeChat") ||
    null;
  if (inApp) return { key: "inapp", name: inApp + " アプリ内ブラウザ", version: null };

  let key = null, version = null;
  if ((version = pick(/EdgiOS\/([\d.]+)/) || pick(/EdgA\/([\d.]+)/) || pick(/Edg\/([\d.]+)/))) key = "edge";
  else if ((version = pick(/OPR\/([\d.]+)/))) key = "opera";
  else if ((version = pick(/SamsungBrowser\/([\d.]+)/))) key = "samsung";
  else if ((version = pick(/CriOS\/([\d.]+)/))) key = "chrome";
  else if ((version = pick(/FxiOS\/([\d.]+)/))) key = "firefox";
  else if ((version = pick(/Firefox\/([\d.]+)/))) key = "firefox";
  else if (/Chrome\//.test(ua)) { key = "chrome"; version = pick(/Chrome\/([\d.]+)/); }
  else if (/Safari\//.test(ua) && (version = pick(/Version\/([\d.]+)/))) key = "safari";

  if (!key) return { key: "unknown", name: "不明なブラウザ", version: null };
  const label = { opera: "Opera", samsung: "Samsung Internet" }[key] || BROWSER_LABEL[key];
  return { key, name: label, version };
}

function detectOS(ua, platformVersion) {
  if (/Windows NT 10\.0/.test(ua)) {
    // UAだけでは10と11を区別できない。Chromium系はplatformVersionで判別可能
    if (platformVersion) return parseInt(platformVersion) >= 13 ? "Windows 11" : "Windows 10";
    return "Windows 10 / 11";
  }
  const win = ua.match(/Windows NT ([\d.]+)/);
  if (win) return "Windows (NT " + win[1] + ")";
  const ios = ua.match(/iPhone OS (\d+)[._](\d+)/) || ua.match(/CPU OS (\d+)[._](\d+)/);
  if (ios) return (/iPad/.test(ua) ? "iPadOS " : "iOS ") + ios[1] + "." + ios[2];
  if (/Macintosh/.test(ua)) {
    // iPadのSafariは「Macintosh」を名乗るためタッチ点数で判別する
    if (navigator.maxTouchPoints > 1) return "iPadOS";
    return "macOS"; // UA上のバージョン(10_15_7)は固定値のため表示しない
  }
  const android = ua.match(/Android ([\d.]+)/);
  if (android) return "Android " + android[1];
  if (/Android/.test(ua)) return "Android";
  if (/Linux/.test(ua)) return "Linux";
  return "不明";
}

function deviceInfo(hints) {
  const parts = [navigator.maxTouchPoints > 0 ? "タッチ対応" : "タッチ非対応"];
  if (navigator.hardwareConcurrency) parts.push("CPU " + navigator.hardwareConcurrency + "スレッド");
  if (navigator.deviceMemory) parts.push("メモリ " + navigator.deviceMemory + "GB以上"); // 仕様上8GBに丸められる
  if (hints && hints.model) parts.push("機種: " + hints.model);
  if (hints && hints.architecture) parts.push(hints.architecture + (hints.bitness ? " " + hints.bitness + "bit" : ""));
  return parts.join(" / ");
}

function timezoneLabel() {
  const offset = -new Date().getTimezoneOffset() / 60;
  const utc = "UTC" + (offset >= 0 ? "+" : "") + offset;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone + "(" + utc + ")";
  } catch (e) {
    return utc;
  }
}

function storageState(name) {
  // プライベートモードや設定によってはアクセス自体が例外になる
  try {
    window[name].setItem("__probe__", "1");
    window[name].removeItem("__probe__");
    return "利用可";
  } catch (e) {
    return "利用不可";
  }
}

function networkLabel() {
  const conn = navigator.connection;
  return (navigator.onLine ? "オンライン" : "オフライン") + (conn && conn.effectiveType ? "(推定回線: " + conn.effectiveType + ")" : "");
}

/* ============================================================
 * LINEアプリ内ブラウザのエンジン判定
 * Android: システムWebView(Chromium)。Chrome本体と同一コードベースで
 *          同時リリースされるため、UAの Chrome/ メジャーをそのまま使える。
 * iOS: WKWebView(OS組み込みWebKit)。iOS 26以降、WebKitはUA内の
 *      OSバージョンを凍結値(18_6等)で報告するためUAからは世代が分からない。
 *      各Safari世代で初出荷された機能の有無(機能検出)で世代を判定する。
 * ============================================================ */

// 新しいSafariメジャーが出たら先頭にプローブを追加し、CEILINGも上げること。
// 追随漏れは scripts/update-versions.mjs(CI)が検知して失敗する。
const WEBKIT_PROBE_CEILING = 26;
const WEBKIT_PROBES = [
  // Safari 26.0: URLPattern / CSS Anchor Positioning
  { major: 26, test: () => "URLPattern" in window || (window.CSS && CSS.supports("anchor-name", "--x")) },
  // Safari 18.0: View Transitions
  { major: 18, test: () => typeof document.startViewTransition === "function" },
  // Safari 17.0: contain-intrinsic-size
  { major: 17, test: () => window.CSS && CSS.supports("contain-intrinsic-size", "100px") },
];

function webkitEngineMajor() {
  for (const p of WEBKIT_PROBES) {
    try {
      if (p.test()) return { major: p.major, atCeiling: p.major === WEBKIT_PROBE_CEILING, floor: false };
    } catch (e) { /* 次のプローブへ */ }
  }
  // 全プローブ不成立 = 最古のプローブ世代より前(それ以上細かくは判別しない)
  const oldest = WEBKIT_PROBES[WEBKIT_PROBES.length - 1].major;
  return { major: oldest - 1, atCeiling: false, floor: true };
}

function detectLineEngine(ua) {
  const m = ua.match(/Chrome\/(\d+)/);
  if (m) return { kind: "chrome", major: parseInt(m[1]), atCeiling: false, label: "Chrome " + m[1] + " 相当(Android WebView)" };
  const probe = webkitEngineMajor();
  const range = probe.atCeiling ? " 以上" : probe.floor ? " 以前" : "";
  return { kind: "safari", major: probe.major, atCeiling: probe.atCeiling, floor: probe.floor, label: "Safari " + probe.major + range + " 相当(WebKit)" };
}

async function detectEnvironment() {
  const ua = navigator.userAgent;
  let browser = parseUA(ua);
  let platformVersion = null;
  let hints = null;

  // Chromium系は User-Agent Client Hints の方が正確(完全なバージョンが取れる)
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    try {
      hints = await navigator.userAgentData.getHighEntropyValues(["fullVersionList", "platformVersion", "model", "architecture", "bitness"]);
      platformVersion = hints.platformVersion || null;
      // アプリ内ブラウザ(WebView)はブランドに"Google Chrome"を含むことがあるため上書きしない
      if (browser.key !== "line" && browser.key !== "inapp") {
        const known = { "Microsoft Edge": "edge", "Google Chrome": "chrome", "Opera": "opera" };
        for (const b of hints.fullVersionList || []) {
          if (known[b.brand]) {
            browser = { key: known[b.brand], name: b.brand, version: b.version };
            break;
          }
        }
      }
    } catch (e) { /* UA解析の結果をそのまま使う */ }
  }

  if (browser.key === "line") browser = Object.assign({}, browser, { engine: detectLineEngine(ua) });

  // 検証用: ?ver=100 で検出バージョンを上書きして旧バージョン判定を再現できる(LINEはエンジン側を上書き)
  const fake = new URLSearchParams(location.search).get("ver");
  if (fake && browser.engine) {
    browser = Object.assign({}, browser, { engine: { kind: browser.engine.kind, major: parseInt(fake), atCeiling: false, label: "検証用 " + fake } });
  } else if (fake && browser.version) {
    browser = Object.assign({}, browser, { version: fake });
  }

  // iOS 26以降、WebKitはUA内のOSバージョンを凍結値(18_6等)で報告する。
  // エンジン世代の方が新しいと分かる場合はそちらを優先して表示する
  let os = detectOS(ua, platformVersion) + (platformVersion ? "(platformVersion " + platformVersion + ")" : "");
  const webkitMajor =
    browser.engine && browser.engine.kind === "safari" ? browser.engine.major :
    browser.key === "safari" ? parseInt(browser.version) : null;
  const uaIOS = os.match(/^(iOS|iPadOS) (\d+)/);
  if (uaIOS && webkitMajor && webkitMajor > parseInt(uaIOS[2])) {
    os = uaIOS[1] + " " + webkitMajor + " 系(UAのOS表記「" + os + "」は凍結値)";
  }

  return {
    browser,
    os,
    device: deviceInfo(hints),
    screen: screen.width + "×" + screen.height + (devicePixelRatio !== 1 ? "(表示倍率 " + devicePixelRatio + ")" : ""),
    viewport: innerWidth + "×" + innerHeight,
    language: (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).join(", "),
    timezone: timezoneLabel(),
    storage: "Cookie: " + (navigator.cookieEnabled ? "有効" : "無効") + " / localStorage: " + storageState("localStorage") + " / sessionStorage: " + storageState("sessionStorage"),
    network: networkLabel(),
    url: location.href,
    ua,
    checkedAt: new Date(),
  };
}

/* ============================================================
 * 判定と描画
 * ============================================================ */

function judge(browser, latest) {
  // LINEアプリ内ブラウザはエンジン(iOS: WebKit / Android: WebView)のメジャーで
  // 他ブラウザと同じ基準の判定を行う
  if (browser.key === "line") {
    const eng = browser.engine;
    const latestMajor = latest ? parseInt(latest.version) : null;
    if (eng && eng.major && latestMajor && eng.major >= latestMajor) {
      return {
        status: "ok",
        title: "お使いの環境は対応しています",
        detail: "LINEアプリ内ブラウザのエンジン(" + eng.label + ")は最新バージョンです。",
        short: "対応範囲内(LINE内ブラウザ・エンジン最新)",
      };
    }
    if (eng && eng.major && latestMajor && !eng.atCeiling) {
      const how = eng.kind === "chrome"
        ? "Google Play で「Android System WebView」をアップデートすると新しくなります。"
        : "iOS(設定 > 一般 > ソフトウェア・アップデート)を更新すると新しくなります。";
      return {
        status: "warn",
        title: "ブラウザエンジンのアップデートをおすすめします",
        detail: "LINEアプリ内ブラウザのエンジン(" + eng.label + ")は最新(バージョン " + latestMajor + ")ではありません。そのままでもご利用いただけますが、一部の画面で表示や動作が最新の環境と異なる場合があります。" + how,
        short: "要アップデート(LINE内ブラウザ・エンジン最新: " + latestMajor + " / 現在: " + eng.major + (eng.floor ? "以前" : "") + ")",
      };
    }
    return {
      status: "unknown",
      title: "判定できませんでした",
      detail: "下記「お使いの環境」の内容をコピーしてお問い合わせに添えてください。",
      short: eng && eng.atCeiling ? "判定不能(エンジンは " + eng.major + " 以上・このページの検出上限)" : "判定不能(LINE内ブラウザ)",
    };
  }
  if (!SUPPORTED.includes(browser.key)) {
    return {
      status: "ng",
      title: "対応対象外のブラウザです",
      detail: "Google Chrome / Microsoft Edge / Firefox / Safari の最新版のご利用をおすすめします。",
      short: "対象外ブラウザ",
    };
  }
  if (!latest || !browser.version) {
    return {
      status: "unknown",
      title: "判定できませんでした",
      detail: "下記「お使いの環境」の内容をコピーしてお問い合わせに添えてください。",
      short: "判定不能",
    };
  }
  const current = parseInt(browser.version);
  const latestMajor = parseInt(latest.version);
  if (current >= latestMajor) {
    return {
      status: "ok",
      title: "お使いの環境は対応しています",
      detail: browser.name + " は最新バージョンです。",
      short: "対応範囲内(最新バージョン)",
    };
  }
  return {
    status: "warn",
    title: "ブラウザのアップデートをおすすめします",
    detail: "お使いの " + browser.name + "(バージョン " + current + ")は最新(バージョン " + latestMajor + ")ではありません。そのままでもご利用いただけますが、一部の画面で表示や動作が最新の環境と異なる場合があります。お時間のあるときにアップデートをお願いいたします。",
    short: "要アップデート(最新: " + latestMajor + " / 現在: " + current + ")",
  };
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function latestLabel(latest) {
  if (!latest) return "取得できませんでした";
  if (latest.via === "live") return latest.version + "(リアルタイム取得)";
  const when = latest.updatedAt ? formatDate(new Date(latest.updatedAt)) + " 時点" : "週次更新データ";
  return latest.version + "(" + when + ")";
}

function render(env, latest, verdict) {
  const banner = document.getElementById("verdict");
  banner.className = "banner" + (verdict.status === "unknown" ? "" : " " + verdict.status);
  banner.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = verdict.title;
  const p = document.createElement("p");
  p.textContent = verdict.detail;
  banner.append(strong, p);

  const rows = [
    ["判定結果", verdict.short],
    ["ブラウザ", env.browser.name + (env.browser.version ? " " + env.browser.version : "") + (env.browser.engine ? "(エンジン: " + env.browser.engine.label + ")" : "")],
    ["最新バージョン", latestLabel(latest)],
    ["OS", env.os],
    ["デバイス", env.device],
    ["画面サイズ", env.screen],
    ["ウィンドウサイズ", env.viewport],
    ["言語", env.language],
    ["タイムゾーン", env.timezone],
    ["ストレージ", env.storage],
    ["ネットワーク", env.network],
    ["ページURL", env.url],
    ["チェック日時", formatDate(env.checkedAt)],
    ["ユーザーエージェント", env.ua],
  ];
  const tbody = document.querySelector("#env-table tbody");
  tbody.innerHTML = "";
  for (const [k, v] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = k;
    const td = document.createElement("td");
    td.textContent = v;
    if (k === "ユーザーエージェント" || k === "ページURL") td.className = "ua";
    tr.append(th, td);
    tbody.append(tr);
  }
  return rows.map(([k, v]) => k + ": " + v).join("\n");
}

function setupCopy(getText) {
  const btn = document.getElementById("copy-btn");
  const done = document.getElementById("copy-done");
  btn.addEventListener("click", async () => {
    const text = "【動作環境チェック結果】\n" + getText();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      // clipboard API 不可(非HTTPS等)の場合のフォールバック
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.append(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    done.textContent = ok ? "コピーしました" : "コピーできませんでした。表を選択して手動でコピーしてください";
    done.style.visibility = "visible";
    setTimeout(() => (done.style.visibility = "hidden"), 3000);
  });
}

/* ============================================================
 * 起動
 * ============================================================ */

(async function main() {
  const env = await detectEnvironment();
  let copyText = render(env, null, { status: "unknown", title: "確認しています…", detail: "最新バージョン情報を取得しています。", short: "確認中" });
  setupCopy(() => copyText);

  // LINE内ブラウザは中身のエンジン(Safari/Chrome)の最新版と比較する
  const latestKey = env.browser.engine ? env.browser.engine.kind : env.browser.key;
  const latest = await getLatestVersion(latestKey);
  copyText = render(env, latest, judge(env.browser, latest));

  if (["localhost", "127.0.0.1"].includes(location.hostname)) reportForDev(env, latest);
})();

// 開発検証専用: localhost配信時のみ、全ソースへの直接fetch可否(CORS)と検出結果を
// dev/server.mjs に送る。公開ページでは動かない。
async function reportForDev(env, latest) {
  const cors = {};
  for (const key of Object.keys(LIVE_SOURCES)) {
    try {
      cors[key] = { ok: true, version: await LIVE_SOURCES[key]() };
    } catch (e) {
      cors[key] = { ok: false, error: String(e) };
    }
  }
  try {
    await fetch("/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browser: env.browser, os: env.os, latest, cors, ua: env.ua }, null, 2),
    });
  } catch (e) { /* dev server不在時は無視 */ }
}
