// content_chatgpt.js
console.log("AI Debate: ChatGPT Content Script Loaded");

const isMainFrame = window.top === window.self;
if (isMainFrame) {
    chrome.runtime.sendMessage({ action: "REGISTER_AGENT", agent: "chatgpt" });
    console.log("ChatGPT: Registered as main frame");
}

let observer = null;
let isWaitingForResponse = false;
let lastUserFocusedInput = null;
let stabilityTimer = null;
let checkCount = 0;
let activeGeneration = 0;
let stopped = true;
const scheduledTimers = new Set();

function conversationKey() {
    return `${window.location.origin}${window.location.pathname}`;
}

function isCurrentRun(generation, conversation) {
    return !stopped &&
        generation === activeGeneration &&
        conversation === conversationKey();
}

function clearScheduledWork() {
    for (const timer of scheduledTimers) clearTimeout(timer);
    scheduledTimers.clear();
    stabilityTimer = null;
}

function scheduleRunTimer(generation, conversation, delay, callback) {
    const timer = setTimeout(() => {
        scheduledTimers.delete(timer);
        if (!isCurrentRun(generation, conversation)) return;
        callback();
    }, delay);
    scheduledTimers.add(timer);
    return timer;
}

function flashElement(el, color = "#00ff00") {
    if (!el) return;
    const originalOutline = el.style.outline;
    el.style.outline = `4px solid ${color}`;
    setTimeout(() => { el.style.outline = originalOutline; }, 500);
}

function isEditable(el) {
    if (!el) return false;
    return el.isContentEditable || el.tagName === "TEXTAREA" || el.getAttribute("role") === "textbox";
}

function readInputText(input) {
    if (!input) return "";
    if (typeof input.value === "string") return input.value;
    return input.innerText || input.textContent || "";
}

document.addEventListener("focus", (e) => {
    if (isEditable(e.target)) {
        lastUserFocusedInput = e.target;
        flashElement(e.target);
    }
}, true);

document.addEventListener("click", (e) => {
    const editable = e.target.closest('textarea, [contenteditable="true"]');
    if (editable) {
        lastUserFocusedInput = editable;
        flashElement(editable);
        chrome.runtime.sendMessage({ action: "CONFIRM_TAB", agent: "chatgpt" });
        console.log("ChatGPT: Confirmed this tab for debate");
    }
}, true);

chrome.runtime.onMessage.addListener((request) => {
    if (!isMainFrame) return;

    if (request.action === "INPUT_PROMPT") {
        const generation = Number(request.generation);
        if (!Number.isInteger(generation) || generation < activeGeneration) {
            console.log("ChatGPT: Ignoring stale/invalid INPUT_PROMPT", request.generation);
            return;
        }

        clearScheduledWork();
        activeGeneration = generation;
        stopped = false;
        isWaitingForResponse = false;
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        const conversation = conversationKey();
        console.log("ChatGPT: Received prompt for generation", generation);
        setInput(request.text, generation, conversation);
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
    } else if (request.action === "STOP") {
        const generation = Number(request.generation);
        if (Number.isInteger(generation) && generation < activeGeneration) return;

        activeGeneration = Number.isInteger(generation) ? generation : activeGeneration + 1;
        stopped = true;
        isWaitingForResponse = false;
        clearScheduledWork();
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        // Deliberately do not clear or rewrite the input element: text the user is
        // editing remains untouched.
        console.log("ChatGPT: STOP invalidated pending send work");
    }
});

function setInput(text, generation, conversation) {
    if (!isCurrentRun(generation, conversation)) return;

    let input = lastUserFocusedInput;
    if ((!input || !input.isConnected) && isEditable(document.activeElement)) {
        input = document.activeElement;
    }
    if (!input || !input.isConnected) {
        input = document.querySelector("#prompt-textarea") ||
            document.querySelector("textarea") ||
            document.querySelector('div[contenteditable="true"]');
    }

    if (!input || !isCurrentRun(generation, conversation)) {
        console.error("ChatGPT: Input box not found or run stopped");
        return;
    }

    lastUserFocusedInput = input;
    flashElement(input, "#0000ff");
    input.focus();

    if (typeof input.value === "string") input.value = text;
    if (input.isContentEditable || input.getAttribute("contenteditable") === "true") {
        input.innerText = text;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    if (!isCurrentRun(generation, conversation)) return;

    const expectedSnapshot = readInputText(input).trim();
    clickSend(input, expectedSnapshot, generation, conversation);
    isWaitingForResponse = true;
    startObserving(generation, conversation);
}

function clickSend(input, expectedSnapshot, generation, conversation) {
    scheduleRunTimer(generation, conversation, 1000, () => {
        if (!input || !input.isConnected) return;

        // If the user edited the box during the one-second delay, do not send
        // their text as part of an automated relay.
        if (readInputText(input).trim() !== expectedSnapshot) {
            console.log("ChatGPT: Input changed before send; automated click cancelled");
            return;
        }

        const sendButton = document.querySelector('button[data-testid="send-button"]') ||
            document.querySelector('button[aria-label="Send prompt"]') ||
            document.querySelector('button[aria-label*="Send"]');
        if (!isCurrentRun(generation, conversation)) return;
        if (sendButton && !sendButton.disabled) {
            console.log("ChatGPT: Clicking send button");
            sendButton.click();
        } else {
            console.error("ChatGPT: Send button not found/enabled");
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
    const stopButton = document.querySelector('button[aria-label="Stop generating"]') ||
        document.querySelector('button[aria-label="Stop streaming"]') ||
        document.querySelector('button[data-testid="stop-button"]') ||
        document.querySelector('button[aria-label*="Stop"]');

    if (stopButton) {
        if (stabilityTimer) {
            clearTimeout(stabilityTimer);
            scheduledTimers.delete(stabilityTimer);
            stabilityTimer = null;
        }
        return;
    }

    if (stabilityTimer) {
        clearTimeout(stabilityTimer);
        scheduledTimers.delete(stabilityTimer);
    }
    stabilityTimer = scheduleRunTimer(generation, conversation, 3000, () => {
        stabilityTimer = null;
        finish(generation, conversation);
    });
}

function finish(generation, conversation) {
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
        source: "chatgpt",
        text: responseText,
        generation
    });
}

function getLastResponse() {
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
            if (text && text.trim().length > 5) return text.trim();
        }
    }
    return null;
}
