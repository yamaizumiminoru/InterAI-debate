// content_gemini.js
console.log("AI Debate: Gemini Content Script Loaded");

const isMainFrame = window.top === window.self;
if (isMainFrame) {
    chrome.runtime.sendMessage({ action: "REGISTER_AGENT", agent: "gemini" });
    console.log("GEMINI: Registered as main frame");
}

let observer = null;
let isWaitingForResponse = false;
let lastUserFocusedInput = null;
let pendingPrompt = null;
let stabilityTimer = null;
let checkCount = 0;
let activeGeneration = 0;
let stopped = true;

// timer -> resolver for awaited delays; null for fire-and-forget timers.
const scheduledWork = new Map();

function conversationKey() {
    return `${window.location.origin}${window.location.pathname}`;
}

function isCurrentRun(generation, conversation) {
    return !stopped &&
        generation === activeGeneration &&
        conversation === conversationKey();
}

function clearScheduledWork() {
    for (const [timer, resolver] of scheduledWork.entries()) {
        clearTimeout(timer);
        if (resolver) resolver(false);
    }
    scheduledWork.clear();
    stabilityTimer = null;
}

function scheduleRunTimer(generation, conversation, delay, callback) {
    const timer = setTimeout(() => {
        scheduledWork.delete(timer);
        if (!isCurrentRun(generation, conversation)) return;
        callback();
    }, delay);
    scheduledWork.set(timer, null);
    return timer;
}

function guardedDelay(delay, generation, conversation) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            scheduledWork.delete(timer);
            resolve(isCurrentRun(generation, conversation));
        }, delay);
        scheduledWork.set(timer, resolve);
    });
}

function flashElement(el, color = "#00ff00") {
    if (!el) return;
    const originalOutline = el.style.outline;
    el.style.outline = `4px solid ${color}`;
    setTimeout(() => { el.style.outline = originalOutline; }, 500);
}

function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute("contenteditable") === "true") return true;
    if (el.getAttribute("role") === "textbox") return true;
    return false;
}

function readInputText(input) {
    if (!input) return "";
    if (typeof input.value === "string") return input.value;
    return input.innerText || input.textContent || "";
}

document.addEventListener("click", (e) => {
    const editable = e.target.closest('[contenteditable="true"], [role="textbox"], textarea, .ql-editor');
    if (editable) {
        lastUserFocusedInput = editable;
        flashElement(editable);
        chrome.runtime.sendMessage({ action: "CONFIRM_TAB", agent: "gemini" });
        console.log("GEMINI: Confirmed this tab for debate");
    }
}, true);

document.addEventListener("focus", (e) => {
    if (isEditable(e.target)) lastUserFocusedInput = e.target;
}, true);

chrome.runtime.onMessage.addListener((request) => {
    if (!isMainFrame) return;

    if (request.action === "INPUT_PROMPT") {
        const generation = Number(request.generation);
        if (!Number.isInteger(generation) || generation < activeGeneration) {
            console.log("GEMINI: Ignoring stale/invalid INPUT_PROMPT", request.generation);
            return;
        }

        clearScheduledWork();
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        activeGeneration = generation;
        stopped = false;
        isWaitingForResponse = false;

        const conversation = conversationKey();
        pendingPrompt = { text: request.text, generation, conversation, retryCount: 0 };
        attemptInput(request.text, 0, generation, conversation);
    } else if (request.action === "ENSURE_FOCUS") {
        const generation = Number(request.generation);
        if (Number.isInteger(generation) && generation < activeGeneration) return;
        if (Number.isInteger(generation) && generation > activeGeneration) {
            clearScheduledWork();
            activeGeneration = generation;
        }

        window.focus();
        if (lastUserFocusedInput && lastUserFocusedInput.isConnected) {
            lastUserFocusedInput.focus();
            lastUserFocusedInput.click();
        }

        if (pendingPrompt &&
            pendingPrompt.generation === activeGeneration &&
            isCurrentRun(pendingPrompt.generation, pendingPrompt.conversation)) {
            const p = pendingPrompt;
            attemptInput(p.text, p.retryCount, p.generation, p.conversation);
        }
    } else if (request.action === "STOP") {
        const generation = Number(request.generation);
        if (Number.isInteger(generation) && generation < activeGeneration) return;

        activeGeneration = Number.isInteger(generation) ? generation : activeGeneration + 1;
        stopped = true;
        isWaitingForResponse = false;
        pendingPrompt = null;
        clearScheduledWork();
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        // Do not clear the editor on STOP. Any text the user has typed remains.
        console.log("GEMINI: STOP invalidated pending send/retry work");
    }
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !pendingPrompt) return;
    const p = pendingPrompt;
    if (!isCurrentRun(p.generation, p.conversation)) return;
    scheduleRunTimer(p.generation, p.conversation, 500, () => {
        attemptInput(p.text, p.retryCount, p.generation, p.conversation);
    });
});

async function attemptInput(text, retryCount, generation, conversation) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 1000;

    if (!isCurrentRun(generation, conversation)) return;

    let input = null;
    if (lastUserFocusedInput && lastUserFocusedInput.isConnected) {
        input = lastUserFocusedInput;
    }
    if (!input) input = findInputBoxDeep();

    if (!isCurrentRun(generation, conversation)) return;

    if (!input) {
        if (retryCount < MAX_RETRIES) {
            pendingPrompt = { text, generation, conversation, retryCount: retryCount + 1 };
            scheduleRunTimer(generation, conversation, RETRY_DELAY, () => {
                attemptInput(text, retryCount + 1, generation, conversation);
            });
        } else {
            pendingPrompt = null;
            console.log("GEMINI: No input field found after max retries");
        }
        return;
    }

    pendingPrompt = null;
    lastUserFocusedInput = input;
    await setInput(text, input, generation, conversation);
}

async function setInput(text, input, generation, conversation) {
    if (!isCurrentRun(generation, conversation) || !input || !input.isConnected) return;

    // Do not erase text the user was already composing. Gemini normally renders
    // placeholder text outside innerText/textContent, so a non-empty editor is
    // treated as user-owned content.
    if (readInputText(input).trim()) {
        console.log("GEMINI: Input already contains text; automated relay will not overwrite it");
        return;
    }

    flashElement(input, "#0000ff");
    input.focus();
    if (!(await guardedDelay(100, generation, conversation))) return;
    if (!input.isConnected) return;

    try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (e) {
        console.log("GEMINI: Selection setup skipped:", e);
    }

    let insertSuccess = false;

    // Method 0: preserve the existing clipboard-based path, but stop immediately
    // if STOP/navigation invalidates the run before or after the await.
    if (isCurrentRun(generation, conversation)) {
        try {
            await navigator.clipboard.writeText(text);
            if (!isCurrentRun(generation, conversation)) return;

            input.dispatchEvent(new KeyboardEvent("keydown", {
                key: "v", code: "KeyV", keyCode: 86, which: 86,
                ctrlKey: true, bubbles: true, cancelable: true
            }));
            document.execCommand("paste");

            if (!(await guardedDelay(200, generation, conversation))) return;
            insertSuccess = readInputText(input).includes(text.substring(0, 20));
        } catch (e) {
            console.log("GEMINI: Clipboard insertion failed:", e);
        }
    }

    if (!insertSuccess && isCurrentRun(generation, conversation)) {
        try {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData("text/plain", text);
            input.dispatchEvent(new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
            }));
            if (!(await guardedDelay(100, generation, conversation))) return;
            insertSuccess = readInputText(input).includes(text.substring(0, 20));
        } catch (e) {
            console.log("GEMINI: DataTransfer insertion failed:", e);
        }
    }

    if (!insertSuccess && isCurrentRun(generation, conversation)) {
        try {
            input.dispatchEvent(new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertFromPaste",
                data: text
            }));
            input.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                cancelable: false,
                inputType: "insertFromPaste",
                data: text
            }));
            if (!(await guardedDelay(100, generation, conversation))) return;
            insertSuccess = readInputText(input).includes(text.substring(0, 20));
        } catch (e) {
            console.log("GEMINI: InputEvent insertion failed:", e);
        }
    }

    if (!insertSuccess && isCurrentRun(generation, conversation)) {
        // Direct DOM fallback. Only reached after the pre-existing-content guard.
        input.textContent = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        try {
            input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
        } catch (e) {
            // CompositionEvent is not available in every test/runtime.
        }
        if (!(await guardedDelay(100, generation, conversation))) return;
        insertSuccess = readInputText(input).includes(text.substring(0, 10));
    }

    if (!insertSuccess && text.length < 500 && isCurrentRun(generation, conversation)) {
        input.textContent = "";
        for (let i = 0; i < text.length && i < 200; i++) {
            if (!isCurrentRun(generation, conversation)) return;
            const char = text[i];
            input.dispatchEvent(new KeyboardEvent("keydown", {
                key: char,
                code: `Key${char.toUpperCase()}`,
                bubbles: true,
                cancelable: true
            }));
            input.dispatchEvent(new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: char
            }));
            input.textContent += char;
            input.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: char
            }));
            input.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
            if (i % 10 === 0 && !(await guardedDelay(10, generation, conversation))) return;
        }
        if (text.length > 200) {
            if (!isCurrentRun(generation, conversation)) return;
            input.textContent += text.substring(200);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    if (!(await guardedDelay(300, generation, conversation))) return;
    if (!input.isConnected || !isCurrentRun(generation, conversation)) return;

    const currentText = readInputText(input).trim();
    if (!currentText.includes(text.substring(0, 10))) {
        flashElement(input, "#ff0000");
        console.error("GEMINI: Text insertion failed; not sending");
        return;
    }

    flashElement(input, "#00ff00");
    const expectedSnapshot = currentText;
    clickSend(input, expectedSnapshot, generation, conversation);
    isWaitingForResponse = true;
    startObserving(generation, conversation);
}

function findInputBoxDeep() {
    if (!isMainFrame) return null;

    const selectors = [
        ".ql-editor",
        'div[role="textbox"][contenteditable="true"]',
        'div[role="textbox"]',
        "rich-textarea .ql-editor",
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"][aria-label]',
        'div[aria-label*="プロンプト"]',
        'div[aria-label*="prompt"]',
        'div[data-placeholder*="Gemini"]',
        '.textarea[contenteditable="true"]',
        'div[contenteditable="true"]'
    ];

    for (const selector of selectors) {
        try {
            const elements = document.querySelectorAll(selector);
            for (let i = elements.length - 1; i >= 0; i--) {
                const el = elements[i];
                const rect = el.getBoundingClientRect();
                if (rect.height > 10) return el;
            }
        } catch (e) {
            console.log("GEMINI: selector failed", selector, e);
        }
    }

    const candidates = [];
    function traverse(root) {
        if (!root) return;
        if (root.nodeType === 1 && isEditable(root)) candidates.push(root);
        if (root.children) {
            for (const child of root.children) traverse(child);
        }
        if (root.shadowRoot) traverse(root.shadowRoot);
    }
    traverse(document.body);

    if (!candidates.length) return null;
    return candidates.find(el => el.classList.contains("ql-editor") || el.closest("rich-textarea")) ||
        candidates.find(el => el.getAttribute("role") === "textbox") ||
        candidates[candidates.length - 1];
}

function clickSend(input, expectedSnapshot, generation, conversation) {
    scheduleRunTimer(generation, conversation, 1000, () => {
        if (!input || !input.isConnected) return;

        // Do not send if the user changed the editor during the delay.
        if (readInputText(input).trim() !== expectedSnapshot) {
            console.log("GEMINI: Input changed before send; automated send cancelled");
            return;
        }

        const sendButton = document.querySelector('button[aria-label*="送信"]') ||
            document.querySelector('button[aria-label*="Send"]') ||
            document.querySelector("button.send-button");

        if (!isCurrentRun(generation, conversation)) return;
        if (sendButton && !sendButton.disabled) {
            sendButton.click();
        } else {
            input.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true
            }));
        }
    });
}

function startObserving(generation, conversation) {
    if (!isCurrentRun(generation, conversation)) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => checkResponseCompletion(generation, conversation));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function checkResponseCompletion(generation, conversation) {
    if (!isWaitingForResponse || !isCurrentRun(generation, conversation)) return;

    checkCount++;
    const stopButton = document.querySelector('button[aria-label*="Stop"]') ||
        document.querySelector('button[aria-label*="停止"]') ||
        document.querySelector('button[aria-label*="stop"]');

    if (stopButton) {
        if (stabilityTimer) {
            clearTimeout(stabilityTimer);
            scheduledWork.delete(stabilityTimer);
            stabilityTimer = null;
        }
        return;
    }

    if (stabilityTimer) {
        clearTimeout(stabilityTimer);
        scheduledWork.delete(stabilityTimer);
    }
    stabilityTimer = scheduleRunTimer(generation, conversation, 4000, () => {
        stabilityTimer = null;
        if (!isWaitingForResponse || !isCurrentRun(generation, conversation)) return;

        const responseText = getLastResponse();
        if (!responseText || responseText.length <= 5) return;

        isWaitingForResponse = false;
        checkCount = 0;
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        clearScheduledWork();

        if (!isCurrentRun(generation, conversation)) return;
        chrome.runtime.sendMessage({
            action: "RESPONSE_COMPLETE",
            source: "gemini",
            text: responseText,
            generation
        });
    });
}

function getLastResponse() {
    const selectors = [
        "model-response",
        'message-content[data-message-author="1"]',
        ".model-response-text",
        'div[data-message-model-response="true"]',
        ".response-content",
        "div.markdown"
    ];

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            const lastElement = elements[elements.length - 1];
            const text = lastElement.innerText || lastElement.textContent;
            if (text && text.trim().length > 5) return text.trim();
        }
    }
    return null;
}
