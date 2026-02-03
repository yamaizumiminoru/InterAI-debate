# 🤖 AI Debate Controller

GeminiとChatGPTを自動で対話させるChrome拡張機能です。

## 機能

- **▶ Start**: 指定したトピックでディベートを開始
- **⏸ Pause / Resume**: 一時停止して応答を読む、その後再開
- **🔄 Restart**: 最後の応答から続きを再開
- **⏹ Stop**: ディベートを完全終了
- **💎 ターン表示**: 現在どちらのAIのターンかを表示

## インストール方法

1. このリポジトリをクローンまたはダウンロード
2. Chromeで `chrome://extensions` を開く
3. 右上の「デベロッパーモード」をON
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. ダウンロードしたフォルダを選択

## 使い方

1. [Gemini](https://gemini.google.com/) と [ChatGPT](https://chatgpt.com/) を開く
   - **推奨**: ChromeのSplit-viewで左右に並べる（両方見えて安定）
   - 別タブでも可（ただし各1タブずつ）
2. **重要**: 各サイトの入力欄を一度クリックして認識させる（緑色にフラッシュします）
3. 拡張機能のアイコンをクリックしてポップアップを開く
4. 初期トピック（プロンプト）を入力
5. 「(Re)start from」でどちらのAIから開始するか選択
6. 「Start」ボタンをクリック

## コントロール

| ボタン | 説明 |
|--------|------|
| **Start** | 新しいディベートを開始 |
| **Restart** | 選択したAIの最後の応答から再開 |
| **Pause** | 一時停止（応答は保存され、Resumeで継続） |
| **Stop** | 完全停止（Restartで再開可能） |

## 注意事項

- **GeminiとChatGPTは各1タブずつ**にしてください（複数開くと誤検出します）
- ディベート中はブラウザを触らないでください（タブ切り替えが自動で行われます）
- スクロールして読みたい場合は「Pause」を使用してください
- AIが「沈黙」を選択すると、ディベートが自然に終了することがあります

## 技術仕様

- Chrome Extension Manifest V3
- Service Worker (background.js)
- Content Scripts (Gemini / ChatGPT用)

## ライセンス

MIT License
