// 每天自動：同步雲端資料 → 更新報價 → 按「備份」（直接用 index.html 本身的邏輯，數字與手動備份完全一致）
const { chromium } = require("playwright");
const path = require("path");
const need = ["GIST_TOKEN", "BACKUP_TOKEN", "BACKUP_REPO"];
const miss = need.filter((k) => !process.env[k]);
if (miss.length) { console.error("缺少 secrets：" + miss.join(", ")); process.exit(1); }
const cfg = {
  gh: process.env.GIST_TOKEN, fh: process.env.FINNHUB_KEY || "", fm: process.env.FINMIND_TOKEN || "",
  bt: process.env.BACKUP_TOKEN, br: process.env.BACKUP_REPO, gid: "",
};
const url = process.env.PAGE_URL || "file://" + path.resolve(__dirname, "..", "index.html");
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
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
