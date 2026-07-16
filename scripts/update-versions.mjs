#!/usr/bin/env node
// 各ブラウザの公式ソースから最新安定版バージョンを取得し versions.json を書き出す。
// Node 20+ / 依存パッケージなし。GitHub Actions から週次+手動で実行される想定。

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "versions.json");

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function chrome() {
  const j = await fetchJson(
    "https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions?pageSize=1"
  );
  const v = j.versions?.[0]?.version;
  if (!v) throw new Error("chrome: version not found");
  return v;
}

async function firefox() {
  const j = await fetchJson("https://product-details.mozilla.org/1.0/firefox_versions.json");
  const v = j.LATEST_FIREFOX_VERSION;
  if (!v) throw new Error("firefox: LATEST_FIREFOX_VERSION not found");
  return v;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function edge() {
  const j = await fetchJson("https://edgeupdates.microsoft.com/api/products");
  const stable = j.find((p) => p.Product === "Stable");
  if (!stable?.Releases?.length) throw new Error("edge: Stable releases not found");
  const versions = stable.Releases.map((r) => r.ProductVersion).filter(Boolean);
  versions.sort(compareVersions);
  return versions[versions.length - 1];
}

async function safari() {
  // Apple公式のリリースノートindex。"Safari X.Y Release Notes"(Beta除く)の最大値を取る。
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
  if (!versions.length) throw new Error("safari: no release notes found");
  versions.sort(compareVersions);
  return versions[versions.length - 1];
}

const results = await Promise.allSettled([chrome(), firefox(), edge(), safari()]);
const names = ["chrome", "firefox", "edge", "safari"];
const browsers = {};
const errors = [];
results.forEach((r, i) => {
  if (r.status === "fulfilled") browsers[names[i]] = { latest: r.value };
  else errors.push(`${names[i]}: ${r.reason}`);
});

if (errors.length) {
  // 1ソースでも落ちたら失敗させる(部分更新で古い値が混ざるのを防ぐ)
  console.error("failed sources:\n" + errors.join("\n"));
  process.exit(1);
}

const data = { updatedAt: new Date().toISOString(), browsers };
await writeFile(OUT, JSON.stringify(data, null, 2) + "\n");
console.log(JSON.stringify(data, null, 2));
