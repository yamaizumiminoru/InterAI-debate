// content_gemini.js
console.log("AI Debate: Gemini Content Script Loaded");

// メインフレームのみで登録
const isMainFrame = window.top === window.self;
if (isMainFrame) {
    chrome.runtime.sendMessage({ action: "REGISTER_AGENT", agent: "gemini" });
    console.log("GEMINI: Registered as main frame");
}

let observer = null;
let isWaitingForResponse = false;
let lastUserFocusedInput = null;

function flashElement(el, color = "#00ff00") {
    if (!el) return;
    const originalOutline = el.style.outline;
    el.style.outline = `4px solid ${color}`;
    setTimeout(() => { el.style.outline = originalOutline; }, 500);
}

function isEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    if (el.getAttribute('role') === 'textbox') return true;
    return false;
}

document.addEventListener('click', (e) => {
    let target = e.target;
    const editable = target.closest('[contenteditable="true"], [role="textbox"], textarea, .ql-editor');
    if (editable) {
        console.log("User clicked input:", editable);
        lastUserFocusedInput = editable;
        flashElement(editable, "#00ff00");

        // このタブをGemini用として確定登録
        chrome.runtime.sendMessage({ action: "CONFIRM_TAB", agent: "gemini" });
        console.log("GEMINI: Confirmed this tab for debate");
    }
}, true);

document.addEventListener('focus', (e) => {
    if (isEditable(e.target)) {
        lastUserFocusedInput = e.target;
    }
}, true);

// ペンディングメッセージ（フォーカス待ち）
let pendingPrompt = null;

// chrome.runtime.onMessage を使用（ポート不要）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // メインフレームでのみ処理
    if (!isMainFrame) {
        return;
    }

    if (request.action === "INPUT_PROMPT") {
        console.log("=== GEMINI: Received INPUT_PROMPT ===");
        console.log("Text length:", request.text ? request.text.length : 0);
        console.log("Text preview:", request.text ? request.text.substring(0, 100) : "null");
        console.log("lastUserFocusedInput:", lastUserFocusedInput);
        console.log("isConnected:", lastUserFocusedInput ? lastUserFocusedInput.isConnected : "N/A");
        attemptInput(request.text, 0);
    } else if (request.action === "ENSURE_FOCUS") {
        console.log("GEMINI: Received ENSURE_FOCUS");
        window.focus();

        // ペンディングがあれば再試行
        if (pendingPrompt) {
            console.log("GEMINI: Retrying pending prompt after ENSURE_FOCUS");
            attemptInput(pendingPrompt, 0);
        }

        if (lastUserFocusedInput && lastUserFocusedInput.isConnected) {
            lastUserFocusedInput.focus();
            lastUserFocusedInput.click();
        }
    } else if (request.action === "STOP") {
        console.log("GEMINI: Received STOP command");
        isWaitingForResponse = false;
        pendingPrompt = null;
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (stabilityTimer) {
            clearTimeout(stabilityTimer);
            stabilityTimer = null;
        }
    }
});

// visibilitychange でタブが表示されたらペンディングを再試行
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingPrompt) {
        console.log("GEMINI: Tab became visible, retrying pending prompt");
        setTimeout(() => attemptInput(pendingPrompt, 0), 500);
    }
});

// リトライ機能付き入力試行
async function attemptInput(text, retryCount) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 1000;

    // まず入力欄を探す
    let input = null;
    if (lastUserFocusedInput && lastUserFocusedInput.isConnected) {
        input = lastUserFocusedInput;
    }
    if (!input) {
        input = findInputBoxDeep();
    }

    // 見つからない場合
    if (!input) {
        if (retryCount < MAX_RETRIES) {
            console.log(`GEMINI: Input not found, retry ${retryCount + 1}/${MAX_RETRIES} in ${RETRY_DELAY}ms...`);
            pendingPrompt = text; // 保存
            setTimeout(() => attemptInput(text, retryCount + 1), RETRY_DELAY);
            return;
        } else {
            console.log("GEMINI: No input field found after max retries. Skipping this frame.");
            pendingPrompt = null;
            return;
        }
    }

    // 見つかった！ペンディングをクリアして入力実行
    console.log("GEMINI: Input found, proceeding with setInput");
    pendingPrompt = null;
    lastUserFocusedInput = input;
    await setInput(text);
}

async function setInput(text) {
    let input = null;

    // 1. まず入力欄を探す（キャッシュまたはDeep Search）
    // キャッシュがあっても、接続が切れている可能性があるので常にチェック
    if (lastUserFocusedInput && lastUserFocusedInput.isConnected) {
        console.log("Using cached user input");
        input = lastUserFocusedInput;
    }

    // 2. キャッシュがない/無効な場合、Deep Search
    if (!input) {
        console.log("Cached input missing or invalid. Trying Deep Search...");
        input = findInputBoxDeep();
    }

    // 3. それでも見つからない場合、このフレームには入力欄がない
    // エラーを出さずに静かに終了（他のフレームに任せる）
    if (!input) {
        console.log("GEMINI: No input field in this frame. Skipping.");
        return; // 静かに終了
    }

    // 入力欄が見つかった！
    console.log("INPUT BOX FOUND:", input);
    lastUserFocusedInput = input; // Re-cache

    flashElement(input, "#0000ff"); // Blue for action

    // === Gemini 専用: フォーカスと Selection の確保 ===
    input.focus();
    await new Promise(r => setTimeout(r, 100));

    // Selection を設定（カーソルを入力欄の末尾に置く）
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false); // 末尾に移動
    selection.removeAllRanges();
    selection.addRange(range);

    // Clear placeholder
    if (input.innerText && input.innerText.length < 50 && input.innerText.trim() !== '') {
        input.innerHTML = '';
        await new Promise(r => setTimeout(r, 50));
    }

    // ===== Gemini Quill エディタ向け強化入力 =====
    let insertSuccess = false;

    // 方法0: 実際のクリップボードを使った貼り付け (最も確実)
    try {
        await navigator.clipboard.writeText(text);
        console.log("Method 0: Clipboard written, attempting paste...");

        // Ctrl+V をシミュレート
        const pasteKeyEvent = new KeyboardEvent('keydown', {
            key: 'v',
            code: 'KeyV',
            keyCode: 86,
            which: 86,
            ctrlKey: true,
            bubbles: true,
            cancelable: true
        });
        input.dispatchEvent(pasteKeyEvent);

        // execCommand paste も試す
        document.execCommand('paste');

        await new Promise(r => setTimeout(r, 200));
        if (input.innerText && input.innerText.includes(text.substring(0, 20))) {
            insertSuccess = true;
            console.log("Method 0 SUCCESS (Real Clipboard)");
        }
    } catch (e) {
        console.log("Method 0 failed:", e);
    }

    // 方法1: DataTransfer を使った Paste イベント
    if (!insertSuccess) {
        try {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', text);
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
            });
            input.dispatchEvent(pasteEvent);
            console.log("Method 1: DataTransfer paste dispatched");

            await new Promise(r => setTimeout(r, 100));
            if (input.innerText && input.innerText.includes(text.substring(0, 20))) {
                insertSuccess = true;
                console.log("Method 1 SUCCESS");
            }
        } catch (e) {
            console.log("Method 1 failed:", e);
        }
    }

    // 方法2: insertFromPaste タイプの InputEvent
    if (!insertSuccess) {
        try {
            const inputEvent = new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromPaste',
                data: text
            });
            input.dispatchEvent(inputEvent);

            const inputEvent2 = new InputEvent('input', {
                bubbles: true,
                cancelable: false,
                inputType: 'insertFromPaste',
                data: text
            });
            input.dispatchEvent(inputEvent2);
            console.log("Method 2: insertFromPaste InputEvent dispatched");

            await new Promise(r => setTimeout(r, 100));
            if (input.innerText && input.innerText.includes(text.substring(0, 20))) {
                insertSuccess = true;
                console.log("Method 2 SUCCESS");
            }
        } catch (e) {
            console.log("Method 2 failed:", e);
        }
    }

    // 方法3: 直接 innerHTML/textContent 代入 + イベント発火
    if (!insertSuccess) {
        console.log("Method 3: Direct DOM manipulation");

        // <p> タグで囲む (Quill 形式)
        input.innerHTML = `<p>${text}</p>`;

        // 各種イベントを発火
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));

        await new Promise(r => setTimeout(r, 100));
        if (input.innerText && input.innerText.includes(text.substring(0, 10))) {
            insertSuccess = true;
            console.log("Method 3 SUCCESS");
        }
    }

    // 方法4: キーボード入力シミュレーション (最終手段、短いテキスト向け)
    if (!insertSuccess && text.length < 500) {
        console.log("Method 4: Keyboard simulation (character by character)");
        input.innerHTML = '';

        for (let i = 0; i < text.length && i < 200; i++) { // 最大200文字
            const char = text[i];

            // keydown
            input.dispatchEvent(new KeyboardEvent('keydown', {
                key: char,
                code: `Key${char.toUpperCase()}`,
                bubbles: true,
                cancelable: true
            }));

            // beforeinput
            input.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char
            }));

            // 実際に文字を追加
            input.textContent += char;

            // input
            input.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: char
            }));

            // keyup
            input.dispatchEvent(new KeyboardEvent('keyup', {
                key: char,
                bubbles: true
            }));

            // 少し待つ（あまり速いと無視される）
            if (i % 10 === 0) await new Promise(r => setTimeout(r, 10));
        }

        if (text.length > 200) {
            // 残りは直接追加
            input.textContent += text.substring(200);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        console.log("Method 4 applied");
    }

    // 最終確認
    await new Promise(r => setTimeout(r, 300));
    const currentText = input.innerText || input.textContent || input.value || '';
    console.log("Final text check:", currentText.substring(0, 50));

    if (currentText.includes(text.substring(0, 10))) {
        flashElement(input, "#00ff00"); // 成功: 緑
        console.log("TEXT INSERT SUCCESS!");
    } else {
        flashElement(input, "#ff0000"); // 失敗: 赤
        console.error("TEXT INSERT FAILED - all methods exhausted. Current content:", currentText);
    }

    clickSend();
    isWaitingForResponse = true;
    startObserving();
}

function findInputBoxDeep() {
    // メインフレームかどうかをログ
    const isMainFrame = window.top === window.self;
    console.log(`Starting Deep Search... (isMainFrame: ${isMainFrame}, URL: ${window.location.href.substring(0, 50)})`);

    // メインフレームでない場合、Gemini の入力欄はないはずなのでスキップ
    if (!isMainFrame) {
        console.log("Not main frame, skipping Deep Search");
        return null;
    }

    // 1. Gemini 専用セレクタ（より多くのパターン）
    const geminiSelectors = [
        '.ql-editor',
        'div[role="textbox"][contenteditable="true"]',
        'div[role="textbox"]',
        'rich-textarea .ql-editor',
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"][aria-label]',
        'div[aria-label*="プロンプト"]',
        'div[aria-label*="prompt"]',
        'div[data-placeholder*="Gemini"]',
        '.textarea[contenteditable="true"]',
        // 汎用フォールバック
        'div[contenteditable="true"]'
    ];

    for (let sel of geminiSelectors) {
        try {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                // 可視性チェック（高さが0より大きいもの）
                for (let i = els.length - 1; i >= 0; i--) {
                    const el = els[i];
                    const rect = el.getBoundingClientRect();
                    if (rect.height > 10) { // 最低10px以上
                        console.log(`Deep Search: Found via selector "${sel}", element:`, el);
                        return el;
                    }
                }
            }
        } catch (e) {
            console.log(`Selector "${sel}" failed:`, e);
        }
    }

    console.log("Quick selectors found nothing, trying full traversal...");

    // 2. Full Tree Traversal (Fallback)
    // Ignores visibility/size because the tab might be backgrounded when this runs
    let candidates = [];

    function traverse(root) {
        if (!root) return;

        if (root.nodeType === 1 && isEditable(root)) {
            candidates.push(root);
        }

        if (root.children) {
            for (let child of root.children) traverse(child);
        }
        if (root.shadowRoot) {
            traverse(root.shadowRoot);
        }
    }

    traverse(document.body);

    console.log(`Deep Search found ${candidates.length} candidates (Traversal)`);

    if (candidates.length === 0) return null;

    // Prioritize
    const rich = candidates.find(el => el.classList.contains('ql-editor') || el.closest('rich-textarea'));
    if (rich) return rich;

    const roleBox = candidates.find(el => el.getAttribute('role') === 'textbox');
    if (roleBox) return roleBox;

    // Default to last
    return candidates[candidates.length - 1];
}

function clickSend() {
    setTimeout(() => {
        const sendButton = document.querySelector('button[aria-label*="送信"]') ||
            document.querySelector('button[aria-label*="Send"]') ||
            document.querySelector('button.send-button');
        if (sendButton) sendButton.click();
        else {
            const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true });
            if (lastUserFocusedInput) lastUserFocusedInput.dispatchEvent(event);
        }
    }, 1000);
}

function startObserving() {
    if (!isMainFrame) return; // メインフレームのみ

    console.log("GEMINI: Starting response observer");
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
        checkResponseCompletion();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

let stabilityTimer = null;
let checkCount = 0;

function checkResponseCompletion() {
    if (!isWaitingForResponse) return;

    checkCount++;
    if (checkCount % 50 === 0) {
        console.log(`GEMINI: Checking response completion (${checkCount} checks)...`);
    }

    // 停止ボタンがあれば生成中
    const stopButton = document.querySelector('button[aria-label*="Stop"]') ||
        document.querySelector('button[aria-label*="停止"]') ||
        document.querySelector('button[aria-label*="stop"]');

    if (stopButton) {
        if (stabilityTimer) clearTimeout(stabilityTimer);
        console.log("GEMINI: Stop button found, still generating...");
        return;
    }

    // 生成完了を待つ（安定するまで4秒）
    if (stabilityTimer) clearTimeout(stabilityTimer);
    stabilityTimer = setTimeout(() => {
        console.log("GEMINI: Stability timer fired, getting response...");
        const responseText = getLastResponse();
        if (responseText && responseText.length > 5) {
            console.log("GEMINI: Response detected! Length:", responseText.length);
            console.log("GEMINI: Response preview:", responseText.substring(0, 100));
            isWaitingForResponse = false;
            checkCount = 0;

            chrome.runtime.sendMessage({
                action: "RESPONSE_COMPLETE",
                source: "gemini",
                text: responseText
            });
            console.log("GEMINI: RESPONSE_COMPLETE sent to background");

            if (observer) observer.disconnect();
        } else {
            console.log("GEMINI: No valid response found yet");
        }
    }, 4000);
}

function getLastResponse() {
    // Gemini の応答要素を探す（複数のセレクタ）
    const selectors = [
        'model-response',
        'message-content[data-message-author="1"]',  // AI の応答
        '.model-response-text',
        'div[data-message-model-response="true"]',
        '.response-content',
        'div.markdown'  // フォールバック
    ];

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            const lastElement = elements[elements.length - 1];
            const text = lastElement.innerText || lastElement.textContent;
            if (text && text.trim().length > 5) {
                console.log(`GEMINI: Found response via selector "${selector}"`);
                return text.trim();
            }
        }
    }

    console.log("GEMINI: No response found with any selector");
    return null;
}

