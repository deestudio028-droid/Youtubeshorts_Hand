const statusDot = document.getElementById("popup-status-dot");
const statusText = document.getElementById("popup-status-text");
const lastGesture = document.getElementById("popup-last-gesture");

function renderStatus(state) {
  const connected = Boolean(state.connected);
  statusDot.classList.toggle("connected", connected);
  statusText.textContent = connected ? "Connected" : state.lastMessage || "Disconnected";
  lastGesture.textContent = state.lastGesture || "NONE";
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "REELHAND_GET_STATUS" }, (state) => {
    if (chrome.runtime.lastError) {
      renderStatus({
        connected: false,
        lastMessage: "Extension background unavailable",
        lastGesture: "NONE"
      });
      return;
    }

    renderStatus(state || {});
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  chrome.storage.local.get(
    {
      connected: false,
      lastGesture: "NONE",
      lastMessage: "Waiting for YouTube Shorts"
    },
    renderStatus
  );
});

refreshStatus();
setInterval(refreshStatus, 1000);
