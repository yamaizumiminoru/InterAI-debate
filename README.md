# 🤖 AI Debate Controller

A Chrome extension that automates conversations between Google Gemini and OpenAI ChatGPT.

GeminiとChatGPTを自動で対話させるChrome拡張機能です。

---

## Features / 機能

- **▶ Start**: Begin a debate with your chosen topic / 指定したトピックでディベートを開始
- **⏸ Pause / Resume**: Temporarily stop to read responses, then continue / 一時停止して応答を読む、その後再開
- **🔄 Restart**: Resume from the last response / 最後の応答から続きを再開
- **⏹ Stop**: End the debate completely / ディベートを完全終了
- **💎 Turn Indicator**: Shows which AI is currently responding / 現在どちらのAIのターンかを表示

---

## Installation / インストール方法

1. Clone or download this repository / このリポジトリをクローンまたはダウンロード
2. Open `chrome://extensions` in Chrome / Chromeで `chrome://extensions` を開く
3. Enable "Developer mode" (top right) / 右上の「デベロッパーモード」をON
4. Click "Load unpacked" / 「パッケージ化されていない拡張機能を読み込む」をクリック
5. Select the downloaded folder / ダウンロードしたフォルダを選択

---

## Usage / 使い方

1. Open [Gemini](https://gemini.google.com/) and [ChatGPT](https://chatgpt.com/)
   - **Recommended**: Use Chrome's Split-view for side-by-side display / ChromeのSplit-viewで左右に並べる（推奨）
   - Separate tabs also work (one tab each) / 別タブでも可（各1タブずつ）

2. **Important**: Click the input box on each site to register it (flashes green) / 各サイトの入力欄をクリックして認識させる（緑色にフラッシュ）

3. Click the extension icon to open the popup / 拡張機能のアイコンをクリック

4. Enter your initial topic/prompt / 初期トピック（プロンプト）を入力

5. Select which AI starts from "(Re)start from" / 「(Re)start from」でどちらから開始するか選択

6. Click "Start" / 「Start」ボタンをクリック

---

## Controls / コントロール

| Button | Description |
|--------|-------------|
| **Start** | Begin a new debate / 新しいディベートを開始 |
| **Restart** | Resume from selected AI's last response / 選択したAIの最後の応答から再開 |
| **Pause** | Temporarily stop (Resume to continue) / 一時停止（Resumeで継続） |
| **Stop** | End completely (use Restart to resume) / 完全停止（Restartで再開可能） |

---

## Notes / 注意事項

- **Use only one tab each** for Gemini and ChatGPT (multiple tabs cause detection issues) / GeminiとChatGPTは各1タブずつ（複数開くと誤検出）
- Don't interact with the browser during debate (tabs switch automatically) / ディベート中はブラウザを触らない
- Use "Pause" if you want to scroll and read / スクロールして読みたい場合は「Pause」を使用
- AIs may choose to end the conversation naturally / AIが「沈黙」を選択して自然終了することがあります

---

## Technical Specs / 技術仕様

- Chrome Extension Manifest V3
- Service Worker (background.js)
- Content Scripts (Gemini / ChatGPT)

---

## License / ライセンス

MIT License
