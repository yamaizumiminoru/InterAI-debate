// background.js
console.log("AI Debate Background Service Started");

// タブIDを追跡（ポートではなくタブIDで管理）
let agentTabs = {
  gemini: null,
  chatgpt: null
};

// ユーザーが確定したタブ（クリックで確定）
let confirmedTabs = {
  gemini: false,
  chatgpt: false
};

// 状態管理
let isDebateRunning = false;
let isPaused = false;
let currentTurn = null; // 'gemini' or 'chatgpt'
let lastResponses = {
  gemini: null,
  chatgpt: null
};
let pendingMessage = null; // Pause中に保留されたメッセージ

// タブを検出して記録（確定済みは上書きしない）
async function detectAgentTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.includes('gemini.google.com')) {
      if (!confirmedTabs.gemini) {
        agentTabs.gemini = tab.id;
        console.log("Detected Gemini tab:", tab.id);
      }
    } else if (tab.url && tab.url.includes('chatgpt.com')) {
      if (!confirmedTabs.chatgpt) {
        agentTabs.chatgpt = tab.id;
        console.log("Detected ChatGPT tab:", tab.id);
      }
    }
  }
  return {
    gemini: agentTabs.gemini !== null,
    chatgpt: agentTabs.chatgpt !== null
  };
}

// タブの更新を監視
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('gemini.google.com')) {
      agentTabs.gemini = tabId;
      console.log("Updated Gemini tab:", tabId);
    } else if (tab.url.includes('chatgpt.com')) {
      agentTabs.chatgpt = tabId;
      console.log("Updated ChatGPT tab:", tabId);
    }
  }
});

// タブが閉じられたら記録を削除
chrome.tabs.onRemoved.addListener((tabId) => {
  if (agentTabs.gemini === tabId) agentTabs.gemini = null;
  if (agentTabs.chatgpt === tabId) agentTabs.chatgpt = null;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_STATUS") {
    detectAgentTabs().then(status => {
      sendResponse({
        ...status,
        running: isDebateRunning,
        paused: isPaused,
        currentTurn: currentTurn
      });
    });
    return true; // async response
  }

  if (request.action === "START_DEBATE") {
    isDebateRunning = true;
    isPaused = false;
    pendingMessage = null;
    lastResponses = { gemini: null, chatgpt: null };

    const firstAgent = request.firstAgent || 'gemini';
    const prompt = request.prompt;
    currentTurn = firstAgent;

    console.log("Starting debate, first agent:", firstAgent);

    detectAgentTabs().then(() => {
      activateTabForAgent(firstAgent);
      setTimeout(() => {
        if (isDebateRunning && !isPaused) {
          sendToAgent(firstAgent, { action: "INPUT_PROMPT", text: prompt });
        }
      }, 1000);
    });
  }

  else if (request.action === "RESTART_DEBATE") {
    // Restart from the last response of the selected agent
    const restartFrom = request.restartFrom || 'gemini';
    const lastResponse = lastResponses[restartFrom];

    console.log("=== RESTART_DEBATE ===");
    console.log("Restart from:", restartFrom);
    console.log("Last response available:", !!lastResponse);
    console.log("Last response length:", lastResponse ? lastResponse.length : 0);
    console.log("All last responses:", JSON.stringify({
      gemini: lastResponses.gemini ? lastResponses.gemini.substring(0, 50) + "..." : null,
      chatgpt: lastResponses.chatgpt ? lastResponses.chatgpt.substring(0, 50) + "..." : null
    }));

    if (!lastResponse) {
      console.log("ERROR: No last response available from", restartFrom);
      sendResponse({ error: "No previous response available" });
      return;
    }

    isDebateRunning = true;
    isPaused = false;
    pendingMessage = null;

    // Send to the OTHER agent
    const targetAgent = restartFrom === 'gemini' ? 'chatgpt' : 'gemini';
    currentTurn = targetAgent;

    console.log(`Restarting debate: ${restartFrom}'s last response -> ${targetAgent}`);
    console.log("Target agent tab:", agentTabs[targetAgent]);

    detectAgentTabs().then(() => {
      console.log("After detectAgentTabs:", JSON.stringify(agentTabs));
      activateTabForAgent(targetAgent);
      setTimeout(() => {
        console.log("Timeout fired, sending INPUT_PROMPT to", targetAgent);
        if (isDebateRunning && !isPaused) {
          sendToAgent(targetAgent, { action: "INPUT_PROMPT", text: lastResponse });
        } else {
          console.log("Skipped: running=", isDebateRunning, "paused=", isPaused);
        }
      }, 1000);
    });

    sendResponse({ restarted: true });
  }

  else if (request.action === "TOGGLE_PAUSE") {
    if (!isDebateRunning) {
      sendResponse({ paused: false });
      return;
    }

    isPaused = !isPaused;
    console.log("Debate paused:", isPaused);

    if (!isPaused && pendingMessage) {
      // Resume: send the pending message
      console.log("Resuming with pending message for:", pendingMessage.target);
      const { target, text } = pendingMessage;
      pendingMessage = null;

      detectAgentTabs().then(() => {
        activateTabForAgent(target);
        setTimeout(() => {
          if (isDebateRunning && !isPaused) {
            sendToAgent(target, { action: "INPUT_PROMPT", text: text });
          }
        }, 1000);
      });
    }

    sendResponse({ paused: isPaused });
    return true;
  }

  else if (request.action === "STOP_DEBATE") {
    console.log("STOPPING DEBATE");
    isDebateRunning = false;
    isPaused = false;
    currentTurn = null;
    pendingMessage = null;

    // 確定タブをリセット（次回は再度クリックで確定が必要）
    confirmedTabs = { gemini: false, chatgpt: false };

    // 両方の content script に停止を通知
    sendToAgent('gemini', { action: "STOP" });
    sendToAgent('chatgpt', { action: "STOP" });

    sendResponse({ stopped: true });
  }

  else if (request.action === "RESPONSE_COMPLETE") {
    const source = request.source;
    const responseText = request.text;
    const target = source === 'gemini' ? 'chatgpt' : 'gemini';

    // ALWAYS store last response (for Restart functionality)
    lastResponses[source] = responseText;
    console.log(`Stored ${source}'s response (${responseText.length} chars)`);
    console.log("Current lastResponses:", JSON.stringify({
      gemini: lastResponses.gemini ? lastResponses.gemini.substring(0, 30) + "..." : null,
      chatgpt: lastResponses.chatgpt ? lastResponses.chatgpt.substring(0, 30) + "..." : null
    }));

    // Only relay if debate is still running
    if (!isDebateRunning) {
      console.log("Debate stopped, response stored but not relaying");
      return;
    }

    // Check if paused
    if (isPaused) {
      console.log("Debate is paused, storing pending message for", target);
      pendingMessage = { target, text: responseText };
      currentTurn = target; // Still update turn indicator
      return;
    }

    console.log(`Relaying response from ${source} to ${target}`);
    currentTurn = target;

    // まずタブを再検出
    detectAgentTabs().then(() => {
      if (!isDebateRunning) return; // 再確認
      if (isPaused) {
        // Paused during detection
        pendingMessage = { target, text: responseText };
        return;
      }

      activateTabForAgent(target);

      // 待機してからメッセージ送信
      setTimeout(() => {
        if (isDebateRunning && !isPaused) {
          sendToAgent(target, { action: "INPUT_PROMPT", text: responseText });
        } else if (isPaused) {
          pendingMessage = { target, text: responseText };
        }
      }, 3000);
    });
  }

  // Content script からの登録
  if (request.action === "REGISTER_AGENT") {
    const agent = request.agent;
    if (sender.tab && sender.tab.id) {
      // 確定済みでなければ登録
      if (!confirmedTabs[agent]) {
        agentTabs[agent] = sender.tab.id;
        console.log(`Registered ${agent} tab:`, sender.tab.id);
      }
    }
  }

  // ユーザーがクリックしてタブを確定
  if (request.action === "CONFIRM_TAB") {
    const agent = request.agent;
    if (sender.tab && sender.tab.id) {
      agentTabs[agent] = sender.tab.id;
      confirmedTabs[agent] = true;
      console.log(`CONFIRMED ${agent} tab:`, sender.tab.id, "(will not be overwritten)");
    }
  }
});

// chrome.tabs.sendMessage を使用（ポート不要）
async function sendToAgent(agentName, message) {
  const tabId = agentTabs[agentName];
  if (!tabId) {
    console.error(`No tab found for ${agentName}`);
    // タブを再検出
    await detectAgentTabs();
    const newTabId = agentTabs[agentName];
    if (!newTabId) {
      console.error(`Still no tab for ${agentName} after re-detection`);
      return;
    }
  }

  const targetTabId = agentTabs[agentName];
  console.log(`Sending to ${agentName} (tab ${targetTabId}):`, message.action);

  try {
    // メインフレームにのみ送信（frameId: 0）
    await chrome.tabs.sendMessage(targetTabId, message, { frameId: 0 });
    console.log(`Message sent to ${agentName} main frame`);
  } catch (e) {
    console.error(`Failed to send to main frame:`, e);
    // フォールバック: 全フレームに送信
    try {
      await chrome.tabs.sendMessage(targetTabId, message);
      console.log(`Message sent to ${agentName} all frames`);
    } catch (e2) {
      console.error(`Failed to send to ${agentName}:`, e2);
    }
  }
}

function activateTabForAgent(agentName) {
  const tabId = agentTabs[agentName];
  if (!tabId) {
    console.error(`No tab found for ${agentName}`);
    return;
  }

  console.log(`Activating ${agentName} -> Tab: ${tabId}`);

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error("Tab get error:", chrome.runtime.lastError);
      return;
    }

    const windowId = tab.windowId;

    // 1. ウィンドウをフォーカス + タスクバー点滅
    chrome.windows.update(windowId, {
      focused: true,
      drawAttention: true
    }, () => {
      // 2. タブをアクティブに
      chrome.tabs.update(tabId, { active: true }, () => {
        // 3. もう一度ウィンドウをフォーカス
        chrome.windows.update(windowId, { focused: true }, () => {
          console.log(`${agentName} activation complete`);

          // 4. フォーカス要求を送信
          sendToAgent(agentName, { action: "ENSURE_FOCUS" });
          setTimeout(() => sendToAgent(agentName, { action: "ENSURE_FOCUS" }), 500);
          setTimeout(() => sendToAgent(agentName, { action: "ENSURE_FOCUS" }), 1000);
        });
      });
    });
  });
}
