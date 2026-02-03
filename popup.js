const DEFAULT_PROMPT = `これはGeminiとChatGPTの直接対話です。

【応答ルール】
・各返答は簡潔に（3文以内）
・相手の意見に反応してから自分の考えを述べる
・必ず冒頭に「→」を付けて応答開始を明示`;

// 保存されたプロンプトを読み込み
chrome.storage.local.get(['defaultPrompt'], (result) => {
    if (result.defaultPrompt) {
        document.getElementById('prompt').value = result.defaultPrompt;
    }
});

// Start Debate
document.getElementById('startBtn').addEventListener('click', () => {
    const prompt = document.getElementById('prompt').value;
    const startAgent = document.getElementById('startAgent').value;

    chrome.runtime.sendMessage({
        action: "START_DEBATE",
        prompt: prompt,
        firstAgent: startAgent
    });

    updateLocalStatus("Running...", "#4CAF50");
});

// Restart Debate (use last response from selected agent)
document.getElementById('restartBtn').addEventListener('click', () => {
    const restartFrom = document.getElementById('startAgent').value;

    chrome.runtime.sendMessage({
        action: "RESTART_DEBATE",
        restartFrom: restartFrom
    });

    updateLocalStatus("Restarting...", "#2196F3");
});

// Pause/Resume
document.getElementById('pauseBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "TOGGLE_PAUSE" }, (response) => {
        if (response && response.paused !== undefined) {
            const pauseBtn = document.getElementById('pauseBtn');
            if (response.paused) {
                pauseBtn.textContent = "▶ Resume";
                pauseBtn.style.background = "#4CAF50";
                updateLocalStatus("Paused", "#ff9800");
            } else {
                pauseBtn.textContent = "⏸ Pause";
                pauseBtn.style.background = "#ff9800";
                updateLocalStatus("Running...", "#4CAF50");
            }
        }
    });
});

// Stop
document.getElementById('stopBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "STOP_DEBATE" });
    updateLocalStatus("Stopped.", "#f44336");
    document.getElementById('pauseBtn').disabled = true;
    document.getElementById('pauseBtn').textContent = "⏸ Pause";
    document.getElementById('pauseBtn').style.background = "#ff9800";
});

// Save Default
document.getElementById('saveDefaultBtn').addEventListener('click', () => {
    const prompt = document.getElementById('prompt').value;
    chrome.storage.local.set({ defaultPrompt: prompt }, () => {
        const msg = document.getElementById('savedMsg');
        msg.style.display = 'inline';
        setTimeout(() => { msg.style.display = 'none'; }, 2000);
    });
});

// Reset
document.getElementById('resetBtn').addEventListener('click', () => {
    document.getElementById('prompt').value = DEFAULT_PROMPT;
});

function updateLocalStatus(text, color) {
    document.getElementById('status').textContent = text;
    document.getElementById('status').style.color = color;
}

function updateTurnIndicator(currentTurn, isPaused, isRunning) {
    const indicator = document.getElementById('turnIndicator');

    if (!isRunning) {
        indicator.textContent = "⏸ 待機中";
        indicator.className = "turn-indicator turn-idle";
    } else if (isPaused) {
        indicator.textContent = "⏸ 一時停止中";
        indicator.className = "turn-indicator turn-paused";
    } else if (currentTurn === 'gemini') {
        indicator.textContent = "💎 Gemini のターン...";
        indicator.className = "turn-indicator turn-gemini";
    } else if (currentTurn === 'chatgpt') {
        indicator.textContent = "🤖 ChatGPT のターン...";
        indicator.className = "turn-indicator turn-chatgpt";
    } else {
        indicator.textContent = "⏸ 待機中";
        indicator.className = "turn-indicator turn-idle";
    }
}

function updateStatus() {
    chrome.runtime.sendMessage({ action: "GET_STATUS" }, (response) => {
        if (!response) return;

        const gStatus = document.getElementById('geminiStatus');
        const cStatus = document.getElementById('chatgptStatus');

        gStatus.textContent = response.gemini ? "Connected" : "Disconnected";
        gStatus.style.color = response.gemini ? "green" : "red";

        cStatus.textContent = response.chatgpt ? "Connected" : "Disconnected";
        cStatus.style.color = response.chatgpt ? "green" : "red";

        // Update turn indicator
        updateTurnIndicator(response.currentTurn, response.paused, response.running);

        // Update pause button state
        const pauseBtn = document.getElementById('pauseBtn');
        if (response.running) {
            pauseBtn.disabled = false;
            if (response.paused) {
                pauseBtn.textContent = "▶ Resume";
                pauseBtn.style.background = "#4CAF50";
                updateLocalStatus("Paused", "#ff9800");
            } else {
                pauseBtn.textContent = "⏸ Pause";
                pauseBtn.style.background = "#ff9800";
                updateLocalStatus("Running...", "#4CAF50");
            }
        } else {
            pauseBtn.disabled = true;
            pauseBtn.textContent = "⏸ Pause";
            pauseBtn.style.background = "#ff9800";
        }
    });
}

setInterval(updateStatus, 1000);
updateStatus();
