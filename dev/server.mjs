#!/usr/bin/env node
// 検証専用サーバー。公開物には含めない。
// プロジェクトルートを静的配信しつつ、ページの自己テスト結果(POST /report)を
// dev/reports.ndjson に追記する。実ブラウザごとのCORS実測に使う。

import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || 8765;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css" };

createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/report") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const line = JSON.stringify({ receivedAt: new Date().toISOString(), ...JSON.parse(body) });
    await appendFile(join(ROOT, "dev", "reports.ndjson"), line + "\n");
    console.log("[report]", line);
    res.writeHead(204).end();
    return;
  }
  const path = normalize(req.url.split("?")[0]).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, path === "/" ? "index.html" : path);
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}/`));
