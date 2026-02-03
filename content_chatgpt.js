// content_chatgpt.js
console.log("AI Debate: ChatGPT Content Script Loaded");

// メインフレームのみで登録
const isMainFrame = window.top === window.self;
if (isMainFrame) {
    chrome.runtime.sendMessage({ action: "REGISTER_AGENT", agent: "chatgpt" });
    console.log("ChatGPT: Registered as main frame");
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
    return el.isContentEditable || el.tagName === 'TEXTAREA' || el.getAttribute('role') === 'textbox';
}

document.addEventListener('focus', (e) => {
    if (isEditable(e.target)) {
        lastUserFocusedInput = e.target;
        flashElement(e.target);
    }
}, true);

document.addEventListener('click', (e) => {
    const editable = e.target.closest('textarea, [contenteditable="true"]');
    if (editable) {
        lastUserFocusedInput = editable;
        flashElement(editable);

        // このタブをChatGPT用として確定登録
        chrome.runtime.sendMessage({ action: "CONFIRM_TAB", agent: "chatgpt" });
        console.log("ChatGPT: Confirmed this tab for debate");
    }
}, true);

// chrome.runtime.onMessage を使用（ポート不要）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // メインフレームでのみ処理
    if (!isMainFrame) {
        return;
    }

    if (request.action === "INPUT_PROMPT") {
        console.log("ChatGPT: Received prompt:", request.text.substring(0, 50) + "...");
        setInput(request.text);
    } else if (request.action === "ENSURE_FOCUS") {
        console.log("ChatGPT: Received ENSURE_FOCUS");
        window.focus();
        if (lastUserFocusedInput && lastUserFocusedInput.isConnected) {
            lastUserFocusedInput.focus();
            lastUserFocusedInput.click();
        }
    } else if (request.action === "STOP") {
        console.log("ChatGPT: Received STOP command");
        isWaitingForResponse = false;
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

function setInput(text) {
    let input = lastUserFocusedInput;

    if (!input && isEditable(document.activeElement)) {
        input = document.activeElement;
    }

    // ChatGPT fallback - 直接セレクタで探す
    if (!input) {
        input = document.querySelector('#prompt-textarea') ||
            document.querySelector('textarea') ||
            document.querySelector('div[contenteditable="true"]');
    }

    if (input) {
        console.log("ChatGPT: Input found:", input);
        flashElement(input, "#0000ff"); // Blue flash
        lastUserFocusedInput = input;

        input.focus();
        input.value = text;
        if (input.innerText !== undefined) input.innerText = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        clickSend();
        isWaitingForResponse = true;
        startObserving();
    } else {
        console.error("ChatGPT: Input box not found!");
    }
}

function clickSend() {
    setTimeout(() => {
        const sendButton = document.querySelector('button[data-testid="send-button"]');
        if (sendButton) {
            console.log("ChatGPT: Clicking send button");
            sendButton.click();
        } else {
            console.error("ChatGPT: Send button not found");
        }
    }, 1000);
}

function startObserving() {
    console.log("ChatGPT: Starting response observer");
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
        console.log(`ChatGPT: Checking response completion (${checkCount} checks)...`);
    }

    // 停止ボタンがあれば生成中
    const stopButton = document.querySelector('button[aria-label="Stop generating"]') ||
        document.querySelector('button[aria-label="Stop streaming"]') ||
        document.querySelector('button[data-testid="stop-button"]') ||
        document.querySelector('button[aria-label*="Stop"]');

    if (stopButton) {
        if (stabilityTimer) clearTimeout(stabilityTimer);
        if (checkCount % 50 === 0) {
            console.log("ChatGPT: Stop button found, still generating...");
        }
        return;
    }

    // 送信ボタンが戻ってきたか確認（複数のセレクタ）
    const sendButton = document.querySelector('button[data-testid="send-button"]') ||
        document.querySelector('button[aria-label="Send prompt"]') ||
        document.querySelector('button[aria-label*="Send"]');

    // 送信ボタンがない場合も、生成完了の可能性がある
    const isReady = (sendButton && !sendButton.disabled) || !stopButton;

    if (isReady) {
        if (stabilityTimer) clearTimeout(stabilityTimer);
        stabilityTimer = setTimeout(() => {
            console.log("ChatGPT: Stability timer fired, getting response...");
            finish();
        }, 3000);
    }
}

function finish() {
    if (!isWaitingForResponse) return;
    const responseText = getLastResponse();
    if (responseText && responseText.length > 5) {
        console.log("ChatGPT: Response complete, length:", responseText.length);
        console.log("ChatGPT: Response preview:", responseText.substring(0, 100));
        isWaitingForResponse = false;
        checkCount = 0;
        if (observer) observer.disconnect();

        chrome.runtime.sendMessage({
            action: "RESPONSE_COMPLETE",
            source: "chatgpt",
            text: responseText
        });
        console.log("ChatGPT: RESPONSE_COMPLETE sent to background");
    } else {
        console.log("ChatGPT: No valid response found yet");
    }
}

function getLastResponse() {
    // ChatGPT の応答要素（複数セレクタ）
    const selectors = [
        'div[data-message-author-role="assistant"]',
        'div[data-message-id] .markdown',
        '.agent-turn .markdown',
        'div.prose'
    ];

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            const lastElement = elements[elements.length - 1];
            const text = lastElement.innerText || lastElement.textContent;
            if (text && text.trim().length > 5) {
                console.log(`ChatGPT: Found response via selector "${selector}"`);
                return text.trim();
            }
        }
    }

    console.log("ChatGPT: No response found with any selector");
    return null;
}

