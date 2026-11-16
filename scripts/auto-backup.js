// 每天自動：同步雲端資料 → 更新報價 → 按「備份」（直接用 index.html 本身的邏輯，數字與手動備份完全一致）
let pw; try { pw = require("playwright-core"); } catch (e) { pw = require("playwright"); }
const { chromium } = pw;
const path = require("path");
const need = ["GIST_TOKEN", "BACKUP_TOKEN", "BACKUP_REPO"];
const miss = need.filter((k) => !process.env[k]);
if (miss.length) { console.error("缺少 secrets：" + miss.join(", ")); process.exit(1); }
const cfg = {
  gh: process.env.GIST_TOKEN, fh: process.env.FINNHUB_KEY || "", fm: process.env.FINMIND_TOKEN || "",
  bt: process.env.BACKUP_TOKEN, br: process.env.BACKUP_REPO, gid: "",
};
const url = process.env.PAGE_URL || "file://" + path.resolve(__dirname, "..", "index.html");
// 台股交易日檢查：用 FinMind 的「TaiwanStockTradingDate」交易日曆。
// 只有「查得到今天之後的交易日、但今天不在其中」才判定休市；查不到或出錯一律照常備份（寧可多備一次，不要漏）。
async function marketClosedToday(fetchFn = fetch) {
  const f = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const now = new Date(), today = f(now), end = f(new Date(now.getTime() + 21 * 864e5));
  try {
    const h = process.env.FINMIND_TOKEN ? { Authorization: "Bearer " + process.env.FINMIND_TOKEN } : {};
    const r = await fetchFn(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockTradingDate&start_date=${today}&end_date=${end}`, { headers: h });
    const j = await r.json();
    const ds = ((j && j.data) || []).map((x) => String(x.date).slice(0, 10));
    if (!r.ok || !ds.length) return { closed: false, why: "查不到交易日曆，照常備份" };
    return ds.includes(today) ? { closed: false, why: today + " 是交易日" } : { closed: true, why: today + " 台股休市" };
  } catch (e) { return { closed: false, why: "交易日曆查詢失敗（" + e.message + "），照常備份" }; }
}
module.exports = { marketClosedToday };
if (require.main !== module) return;

(async () => {
  const cal = await marketClosedToday();
  console.log("交易日檢查：", cal.why);
  if (cal.closed && process.env.GITHUB_EVENT_NAME === "schedule") { console.log("休市日，跳過本次備份"); return; }
  const b = await chromium.launch(process.env.CI ? { channel: "chrome" } : {}); // GitHub 主機內建 Chrome，不必下載瀏覽器
  const pg = await b.newPage({ timezoneId: "Asia/Taipei", locale: "zh-TW" }); // 主機是 UTC，指定台灣時區，備份時間才會是台灣時間
  pg.on("pageerror", (e) => console.error("pageerror:", e.message));
  await pg.addInitScript((c) => { try { localStorage.setItem("portfolio-cfg-v1", JSON.stringify(c)); } catch (e) {} }, cfg);
  await pg.goto(url);
  const txt = (s) => pg.$eval(s, (e) => e.textContent).catch(() => "");
  const until = async (sel, re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await txt(sel); if (re.test(t)) return t; await pg.waitForTimeout(500); } return await txt(sel); };
  const s1 = await until("#sync", /已同步|已建立雲端/, 60000);
  console.log("同步：", s1);
  if (!/已同步|已建立雲端/.test(s1)) { console.error("雲端資料同步失敗，停止（避免用舊資料備份）"); process.exit(1); }
  await pg.click("#rf");
  const s2 = await until("#rfs", /已更新|失敗/, 90000);
  console.log("報價：", s2);
  await pg.waitForTimeout(3000);
  await pg.click("#bk");
  const s3 = await until("#bkm", /已備份到 GitHub|上傳失敗/, 60000);
  console.log("備份：", s3);
  await b.close();
  if (!/已備份到 GitHub/.test(s3)) process.exit(1);
  if (/失敗/.test(s2)) { console.warn("注意：部分報價更新失敗，備份用的是上一次的價格"); }
})().catch((e) => { console.error(e); process.exit(1); });
