const DEFAULT_STATE = {
  connected: false,
  lastGesture: "NONE",
  lastMessage: "Waiting for YouTube Shorts",
  updatedAt: Date.now()
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(DEFAULT_STATE);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REELHAND_STATUS") {
    chrome.storage.local.set({
      connected: Boolean(message.connected),
      lastGesture: message.lastGesture || "NONE",
      lastMessage: message.lastMessage || "",
      updatedAt: Date.now()
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "REELHAND_GET_STATUS") {
    chrome.storage.local.get(DEFAULT_STATE, (state) => {
      sendResponse(state);
    });
    return true;
  }

  return false;
});
