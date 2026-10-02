const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(2);
  }
  throw new Error("condition was not reached before timeout");
}

function loadContentScript(filename, html, url, timerCap = 15) {
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  if (!Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "innerText")) {
    Object.defineProperty(window.HTMLElement.prototype, "innerText", {
      get() { return this.textContent; },
      set(value) { this.textContent = value; },
    });
  }

  const nativeSetTimeout = global.setTimeout;
  window.setTimeout = (fn, ms, ...args) =>
    nativeSetTimeout(fn, Math.min(Number(ms) || 0, timerCap), ...args);
  window.clearTimeout = global.clearTimeout;

  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => {} },
  });
  window.document.execCommand = () => false;

  if (!window.DataTransfer) {
    window.DataTransfer = class {
      setData() {}
    };
  }
  if (!window.ClipboardEvent) {
    window.ClipboardEvent = class extends window.Event {
      constructor(type, init = {}) {
        super(type, init);
        this.clipboardData = init.clipboardData;
      }
    };
  }

  let messageListener = null;
  const runtimeMessages = [];
  window.chrome = {
    runtime: {
      sendMessage(message) {
        runtimeMessages.push(message);
        return Promise.resolve();
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
  };

  const code = fs.readFileSync(path.join(ROOT, filename), "utf8");
  window.eval(code);
  assert.ok(messageListener, `${filename} did not register a message listener`);

  return {
    dom,
    window,
    listener: messageListener,
    runtimeMessages,
  };
}

function chatGptHarness(timerCap = 20) {
  const h = loadContentScript(
    "content_chatgpt.js",
    '<div id="prompt-textarea" contenteditable="true"></div>' +
      '<button data-testid="send-button">Send</button>',
    "https://chatgpt.com/c/test",
    timerCap,
  );
  const input = h.window.document.querySelector("#prompt-textarea");
  const button = h.window.document.querySelector('button[data-testid="send-button"]');
  let clicks = 0;
  button.addEventListener("click", () => { clicks += 1; });
  return { ...h, input, getClicks: () => clicks };
}

function geminiHarness(withInput = true, timerCap = 10) {
  const html = withInput
    ? '<div class="ql-editor" role="textbox" contenteditable="true"></div>' +
      '<button aria-label="Send message">Send</button>'
    : '<div id="empty"></div>';
  const h = loadContentScript(
    "content_gemini.js",
    html,
    "https://gemini.google.com/app/test",
    timerCap,
  );
  const input = h.window.document.querySelector(".ql-editor");
  const button = h.window.document.querySelector('button[aria-label="Send message"]');
  let clicks = 0;
  if (button) button.addEventListener("click", () => { clicks += 1; });
  return { ...h, input, getClicks: () => clicks };
}

test("ChatGPT: STOP immediately after INPUT_PROMPT cancels scheduled send", async () => {
  const h = chatGptHarness();
  h.listener({ action: "INPUT_PROMPT", text: "old prompt", generation: 1 });
  h.listener({ action: "STOP", generation: 2 });
  await sleep(50);
  assert.equal(h.getClicks(), 0);
});

test("ChatGPT: STOP just before send cancels click", async () => {
  const h = chatGptHarness(30);
  h.listener({ action: "INPUT_PROMPT", text: "old prompt", generation: 1 });
  await sleep(18);
  h.listener({ action: "STOP", generation: 2 });
  await sleep(40);
  assert.equal(h.getClicks(), 0);
});

test("ChatGPT: restart sends only the new generation", async () => {
  const h = chatGptHarness();
  h.listener({ action: "INPUT_PROMPT", text: "old prompt", generation: 1 });
  h.listener({ action: "STOP", generation: 2 });
  h.listener({ action: "INPUT_PROMPT", text: "new prompt", generation: 3 });
  await waitUntil(() => h.getClicks() === 1);
  assert.equal(h.input.textContent, "new prompt");
  assert.equal(h.getClicks(), 1);
});

test("ChatGPT: user-edited draft is not overwritten after STOP", async () => {
  const h = chatGptHarness();
  h.listener({ action: "INPUT_PROMPT", text: "old prompt", generation: 1 });
  h.listener({ action: "STOP", generation: 2 });
  h.input.textContent = "my draft";
  h.listener({ action: "INPUT_PROMPT", text: "new prompt", generation: 3 });
  await sleep(50);
  assert.equal(h.input.textContent, "my draft");
  assert.equal(h.getClicks(), 0);
});

test("Gemini: STOP during input/await pipeline prevents send", async () => {
  const h = geminiHarness(true);
  h.listener({ action: "INPUT_PROMPT", text: "old prompt", generation: 1 });
  await sleep(2);
  h.listener({ action: "STOP", generation: 2 });
  await sleep(80);
  assert.equal(h.getClicks(), 0);
});

test("Gemini: STOP during retry wait prevents later retry/send", async () => {
  const h = geminiHarness(false, 20);
  h.listener({ action: "INPUT_PROMPT", text: "old prompt", generation: 1 });
  await sleep(5);
  h.listener({ action: "STOP", generation: 2 });
  await sleep(70);
  assert.equal(h.getClicks(), 0);
});

test("Gemini: STOP after insertion but before click prevents send", async () => {
  const h = geminiHarness(true, 15);
  h.listener({ action: "INPUT_PROMPT", text: "old prompt", generation: 1 });
  await waitUntil(() => h.input.textContent.includes("old prompt"));
  h.listener({ action: "STOP", generation: 2 });
  await sleep(60);
  assert.equal(h.getClicks(), 0);
});

test("Gemini: restart sends only the new generation", async () => {
  const h = geminiHarness(true, 10);
  h.listener({ action: "INPUT_PROMPT", text: "old prompt", generation: 1 });
  h.listener({ action: "STOP", generation: 2 });
  h.listener({ action: "INPUT_PROMPT", text: "new prompt", generation: 3 });
  await waitUntil(() => h.getClicks() === 1);
  assert.equal(h.getClicks(), 1);
  assert.ok(h.input.textContent.includes("new prompt"));
});

function backgroundHarness(timerCap = 15) {
  const sent = [];
  let listener = null;

  const chrome = {
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      lastError: null,
    },
    tabs: {
      query: async () => [
        { id: 1, url: "https://gemini.google.com/app/test", windowId: 10 },
        { id: 2, url: "https://chatgpt.com/c/test", windowId: 10 },
      ],
      sendMessage: async (tabId, message) => {
        sent.push({ tabId, message });
      },
      get(tabId, cb) { cb({ id: tabId, windowId: 10 }); },
      update(tabId, options, cb) { if (cb) cb({ id: tabId }); },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
    windows: {
      update(windowId, options, cb) { if (cb) cb({ id: windowId }); },
    },
  };

  const context = vm.createContext({
    chrome,
    console: { log() {}, error() {}, warn() {} },
    setTimeout: (fn, ms, ...args) =>
      global.setTimeout(fn, Math.min(Number(ms) || 0, timerCap), ...args),
    clearTimeout: global.clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), context);
  assert.ok(listener, "background did not register runtime listener");
  return { listener, sent };
}

test("background: STOP cancels START_DEBATE queued INPUT_PROMPT", async () => {
  const h = backgroundHarness();
  h.listener(
    { action: "START_DEBATE", firstAgent: "gemini", prompt: "old" },
    {},
    () => {},
  );
  await sleep(2);
  h.listener({ action: "STOP_DEBATE" }, {}, () => {});
  await sleep(50);
  assert.equal(h.sent.filter(x => x.message.action === "INPUT_PROMPT").length, 0);
});

test("background: STOP cancels queued relay after RESPONSE_COMPLETE", async () => {
  const h = backgroundHarness();
  h.listener(
    { action: "START_DEBATE", firstAgent: "gemini", prompt: "first" },
    {},
    () => {},
  );
  await waitUntil(() => h.sent.some(x => x.message.action === "INPUT_PROMPT"));
  const before = h.sent.filter(x => x.message.action === "INPUT_PROMPT").length;

  h.listener(
    { action: "RESPONSE_COMPLETE", source: "gemini", text: "reply", generation: 1 },
    {},
    () => {},
  );
  h.listener({ action: "STOP_DEBATE" }, {}, () => {});
  await sleep(50);

  assert.equal(
    h.sent.filter(x => x.message.action === "INPUT_PROMPT").length,
    before,
  );
});

test("background: STOP then new START emits only new-generation prompt", async () => {
  const h = backgroundHarness();
  h.listener(
    { action: "START_DEBATE", firstAgent: "gemini", prompt: "old" },
    {},
    () => {},
  );
  h.listener({ action: "STOP_DEBATE" }, {}, () => {});
  h.listener(
    { action: "START_DEBATE", firstAgent: "chatgpt", prompt: "new" },
    {},
    () => {},
  );

  await waitUntil(() =>
    h.sent.some(x => x.message.action === "INPUT_PROMPT" && x.message.text === "new")
  );
  const prompts = h.sent.filter(x => x.message.action === "INPUT_PROMPT");
  assert.deepEqual(prompts.map(x => x.message.text), ["new"]);
});
