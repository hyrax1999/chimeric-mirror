# Chimeric

[English README](README.md)

Chimeric は、元のローカル研究ランタイムと研究ハーネスを保持しながら、プロバイダーに依存しないモデル層、ネイティブランチャー、ローカル認証情報管理、モデル検出、推論設定、画像入力、静的な DNA マーク、アニメーションする原子の製品表現を提供する研究ワークスペースです。公開されている統合ソースは [hyrax1999/chimeric-mirror](https://github.com/hyrax1999/chimeric-mirror) です。

公開ソースには Chimeric の統合コード、ビルドツール、テスト、ドキュメントを含めます。元のランタイムは固有の来歴を持つバージョン付き統合依存として扱い、復元済みランタイムバイナリ、パッケージ化ランタイムのプレビュー、非公開プロファイル、API キー、個人の研究データは別途扱います。

## 現在の準備状況

macOS arm64 の開発アプリ、AppKit/WKWebView ネイティブウィンドウ、プロバイダー接続、ChatGPT サブスクリプション接続、言語設定、ライブ更新経路を検証しています。現在のソース証拠は Bun テスト 60 件、11 ファイル、246 アサーション、Python 公開テスト 15 件です。最終パッケージ検証は継続中です。

ソース境界と新規ソースのライセンス確認は、レビュー済み出力で完了しています。新規インストールと復元、実行時サンドボックス分離、管理対象コンバーター、完全な Linux ハーネスと Docker、Linux arm64 パッケージ、音声の移植性、ブランドとロケールの最終監査、保存されたランタイムと同梱コンポーネントの再配布審査は確認を継続しています。新しい Chimeric ソースには Apache License 2.0 を選択していますが、上流の素材には適用されません。パッケージ化ランタイムは、これらの確認が完了するまで非公開の技術プレビューとして扱います。詳細は [docs/RELEASE-READINESS.md](docs/RELEASE-READINESS.md) を参照してください。

## プラットフォーム別インストール

- [macOS インストール](docs/INSTALL-MAC.md)
- [Linux インストール](docs/INSTALL-LINUX.md)
- [WSL2 インストール](docs/INSTALL-WSL.md)

## ソースからのビルド

互換性のある Chimeric ランタイムバイナリを別途用意し、ソースツリーの外に置きます。

必要なツールは Bun 1.4.3、Python 3、Xcode Command Line Tools、ネイティブアプリ入口をビルドする Swift です。依存パッケージのライフサイクルスクリプトを実行せずにインストールします。

```sh
bun install --frozen-lockfile --ignore-scripts
```

```sh
export CHIMERIC_RUNTIME_BINARY=/path/to/chimeric-runtime-binary
python3 tools/recover_runtime.py "$CHIMERIC_RUNTIME_BINARY" build/original
bun tools/build-runtime.ts build/original build/runtime
python3 tools/build-macos-app.py --runtime build/runtime --binary "$CHIMERIC_RUNTIME_BINARY" --out dist/macos-arm64
open dist/macos-arm64/Chimeric.app
```

macOS ではネイティブアプリを主な起動経路にします。組み込み CLI は `open`、`serve`、`url`、`status`、`stop`、`version` と `--profile DIRECTORY`、`--port PORT` を受け付けます。Bun 実行ファイルは `launcher.mjs` 経由で呼び出す必要があるため、[INSTALL-MAC.md](docs/INSTALL-MAC.md) のヘルパーを使用してください。ネイティブウィンドウやシェルを閉じてもバックエンドは動作を続けます。停止するときは **Stop Workspace** またはネイティブの **Quit** を使います。`CHIMERIC_DATA_DIR` と `CHIMERIC_PORT` も利用できます。新規インストールでは OS ごとの中立なユーザーデータディレクトリを使います。

Linux x64 のポータブル出力については `tools/build-portable.py` と出力された `BUNDLE-BUILD.json` を確認してください。Linux の実行、Docker、Linux arm64 の公開ビルドは完了した手順として扱いません。

## 接続と言語設定

**Settings → General → Language** で System、English、日本語を選びます。System はブラウザーの優先言語に従い、未対応の言語では英語になります。変更時にページを再読み込みするため、下書きや接続編集を先に保存してください。

**Settings → Connections** で名前、API ベース URL、API 種類、任意の API キーを入力します。`openai-completions` は `POST /chat/completions` を使用し、旧式の `/completions` は対応しません。`openai-responses` は Responses リクエストを使用します。モデル検出は `/models` を読み取ります。検出できない場合は正確なモデル ID を手動登録します。接続の変更は SSE で反映され、通常は再起動を要しません。

ChatGPT サブスクリプションは通常の API 接続と別の認証欄から接続します。切断もその欄から行います。

## セキュリティと未完了の範囲

API キーはプロファイル内の非公開 `local-auth` に暗号化して保存し、設定 API から再表示しません。接続 URL の認証情報、クエリ、フラグメント、Anthropic 宛先は拒否します。詳細は [SECURITY.md](SECURITY.md) と [docs/OPERATIONS.md](docs/OPERATIONS.md) を参照してください。

テレメトリーとネットワーク境界は [docs/PRIVACY.md](docs/PRIVACY.md) に記載しています。

PDF のローカル変換と音声連携は存在します。Office、OCR、ポータブルコンバーターのプロビジョニングは未完了です。

## 開発と来歴

```sh
bun install --frozen-lockfile --ignore-scripts
bun test
```

[CONTRIBUTING.md](CONTRIBUTING.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) に開発情報を記載しています。新しい Chimeric ソースのライセンスは [LICENSE](LICENSE) の Apache License 2.0 です。元のランタイムと同梱コンポーネントのライセンス表示は維持され、ランタイムの再配布審査は別途未完了です。

`release.manifest.json` はソース公開範囲を定義します。`python3 tools/release_check.py` はソース、認証情報らしい文字列、ローカル Markdown リンクを確認します。`tools/prepare-release.py --out DESTINATION` はマニフェストからソースのみの出力を作成します。これらはランタイムの正しさや再配布権を証明しません。
