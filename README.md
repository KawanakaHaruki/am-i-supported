# 動作環境チェック

アクセスしたブラウザの環境(ブラウザ名・バージョン・OSなど)を表示し、
対応ブラウザ(Chrome / Edge / Firefox / Safari)の最新バージョンかどうかを判定する静的ページ。
表示内容はワンクリックでコピーでき、問い合わせ時に添えてもらう用途を想定。

## 仕組み

- ビルド不要の静的サイト(`index.html` + `app.js`)。GitHub Pages で配信。
- 最新バージョンは、まずページから各ブラウザの公式ソースへ直接 fetch(リアルタイム)を試み、
  CORS 等で失敗した場合は `versions.json` にフォールバックする。
- `versions.json` は GitHub Actions が週1回(+手動実行)更新する。

### バージョン情報の取得元(すべて公式)

| ブラウザ | ソース                                             |
| -------- | -------------------------------------------------- |
| Chrome   | versionhistory.googleapis.com (VersionHistory API) |
| Firefox  | product-details.mozilla.org                        |
| Edge     | edgeupdates.microsoft.com                          |
| Safari   | developer.apple.com のリリースノート index         |

## 運用

- **手動更新**: GitHub の Actions タブ → `Update browser versions` → `Run workflow`。
  差分があれば `versions.json` がコミットされ、Pages に自動反映される。
- **判定基準**: メジャーバージョンが最新と一致していれば「対応」。

## 開発

```sh
node dev/server.mjs          # http://localhost:8765/ で配信
node scripts/update-versions.mjs  # versions.json をローカル生成
```

`dev/server.mjs` は検証用で、ページの自己テスト(検出結果と各ソースへの
直接 fetch 可否)を `dev/reports.ndjson` に記録する。
旧バージョンの判定表示は `http://localhost:8765/?ver=100` のように
`ver` クエリで検出バージョンを上書きして再現できる。
