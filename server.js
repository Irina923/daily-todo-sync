const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = __dirname;
// 数据目录：默认放在仓库内的 data/；部署到 Render 并挂载持久磁盘时，设环境变量 DATA_DIR=/path 即可
const DATA_DIR = process.env.DATA_DIR ? process.env.DATA_DIR : path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "todos.json");
const PORT = process.env.PORT || 8787;

// ---------- 数据存储 ----------
let db = { rev: 0, data: {} };
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const o = JSON.parse(raw);
    if (o && typeof o === "object") db = { rev: o.rev || 0, data: o.data || {} };
  } catch (e) { db = { rev: 0, data: {} }; }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db));
  } catch (e) { console.error("save error:", e.message); }
}

// 按 id + updatedAt 合并，删除用 deleted 标记传播
function merge(a, b) {
  const out = JSON.parse(JSON.stringify(a || {}));
  const now = Date.now();
  for (const [date, items] of Object.entries(b || {})) {
    if (!Array.isArray(items)) continue;
    const map = new Map((out[date] || []).map((t) => [t.id, t]));
    for (const t of items) {
      if (!t || !t.id) continue;
      const ex = map.get(t.id);
      const tu = t.updatedAt || 0, eu = ex ? ex.updatedAt || 0 : 0;
      if (!ex || tu >= eu) map.set(t.id, t);
    }
    let arr = [...map.values()];
    // 清理 7 天前已删除的项
    arr = arr.filter((t) => !(t.deleted && now - (t.updatedAt || 0) > 7 * 864e5));
    if (arr.length) out[date] = arr; else delete out[date];
  }
  return out;
}

load();

// ---------- 静态文件服务 ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  // CORS（允许前端与同步服务分属不同域名/端口部署）
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }

  // 健康检查（云平台健康探测用）
  if (req.url.split("?")[0] === "/health" || req.url.split("?")[0] === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ ok: true, rev: db.rev, items: Object.keys(db.data).length }));
    return;
  }

  if (req.url.split("?")[0] === "/api/todos") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(db));
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const o = JSON.parse(body || "{}");
          db.data = merge(db.data, o.data);
          db.rev++;
          save();
          res.writeHead(200, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify(db));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json", ...cors });
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
      return;
    }
    res.writeHead(405, cors);
    res.end();
    return;
  }

  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404 Not Found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  let lan = "";
  const ifaces = os.networkInterfaces();
  for (const k of Object.keys(ifaces)) {
    for (const f of ifaces[k]) {
      if (f.family === "IPv4" && !f.internal) { lan = f.address; break; }
    }
    if (lan) break;
  }
  console.log("✅ 每日待办同步服务已启动");
  console.log("   本地访问:    http://localhost:" + PORT);
  if (lan) console.log("   局域网访问:  http://" + lan + ":" + PORT);
  console.log("   公网部署:    把本服务跑在任意公网主机(端口设为 " + PORT + ")，手机电脑打开同一地址即自动同步，无需同一WiFi");
  console.log("   数据文件: " + DATA_FILE);
});
