(() => {
  const SOCKET_URL = "ws://127.0.0.1:8765";
  const RECONNECT_BASE_DELAY_MS = 1000;
  const RECONNECT_MAX_DELAY_MS = 8000;
  const ACTION_COOLDOWN_MS = 850;

  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let lastActionAt = 0;
  let lastGesture = "NONE";
  let overlayRoot = null;
  let statusDot = null;
  let statusText = null;
  let gestureText = null;
  let pageWatcher = null;

  function isShortsPage() {
    return location.hostname.includes("youtube.com") && location.pathname.startsWith("/shorts");
  }

  function sendStatus(connected, message) {
    try {
      chrome.runtime.sendMessage({
        type: "REELHAND_STATUS",
        connected,
        lastGesture,
        lastMessage: message
      });
    } catch (error) {
      console.debug("[ReelHand] status message skipped", error);
    }
  }

  function ensureOverlay() {
    if (overlayRoot || !document.body) {
      return;
    }

    overlayRoot = document.createElement("div");
    overlayRoot.id = "reelhand-overlay";
    overlayRoot.innerHTML = `
      <div class="reelhand-brand">
        <span class="reelhand-mark"></span>
        <div>
          <div class="reelhand-title">ReelHand</div>
          <div class="reelhand-subtitle">Control Shorts with gestures.</div>
        </div>
      </div>
      <div class="reelhand-row">
        <span id="reelhand-status-dot" class="reelhand-dot"></span>
        <span id="reelhand-status-text">Connecting</span>
      </div>
      <div class="reelhand-gesture">Gesture: <strong id="reelhand-gesture-text">NONE</strong></div>
    `;

    document.body.appendChild(overlayRoot);
    statusDot = document.getElementById("reelhand-status-dot");
    statusText = document.getElementById("reelhand-status-text");
    gestureText = document.getElementById("reelhand-gesture-text");
  }

  function removeOverlay() {
    overlayRoot?.remove();
    overlayRoot = null;
    statusDot = null;
    statusText = null;
    gestureText = null;
  }

  function setOverlayStatus(connected, text) {
    ensureOverlay();
    if (statusDot) {
      statusDot.classList.toggle("connected", connected);
    }
    if (statusText) {
      statusText.textContent = text;
    }
    if (gestureText) {
      gestureText.textContent = lastGesture;
    }
  }

  function dispatchKeyboard(key, code) {
    const eventOptions = {
      key,
      code,
      bubbles: true,
      cancelable: true,
      composed: true
    };

    document.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
    document.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
  }

  function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) {
      return null;
    }

    const viewportMiddle = window.innerHeight / 2;
    return videos
      .map((video) => {
        const rect = video.getBoundingClientRect();
        const distanceFromCenter = Math.abs(rect.top + rect.height / 2 - viewportMiddle);
        return { video, rect, distanceFromCenter };
      })
      .filter((item) => item.rect.width > 0 && item.rect.height > 0)
      .sort((a, b) => a.distanceFromCenter - b.distanceFromCenter)[0]?.video || videos[0];
  }

  function scrollShort(direction) {
    dispatchKeyboard(direction > 0 ? "ArrowDown" : "ArrowUp", direction > 0 ? "ArrowDown" : "ArrowUp");

    const scrollAmount = Math.max(window.innerHeight * 0.92, 600);
    window.scrollBy({
      top: direction * scrollAmount,
      behavior: "smooth"
    });
  }

  function togglePlayPause() {
    const video = getActiveVideo();
    if (video) {
      if (video.paused) {
        video.play().catch(() => {
          dispatchKeyboard(" ", "Space");
        });
      } else {
        video.pause();
      }
      return;
    }

    dispatchKeyboard(" ", "Space");
  }

  function handleGesture(gesture) {
    if (!isShortsPage()) {
      return;
    }

    const now = Date.now();
    if (now - lastActionAt < ACTION_COOLDOWN_MS) {
      console.debug("[ReelHand] ignored gesture during content cooldown", gesture);
      return;
    }

    lastActionAt = now;
    lastGesture = gesture;
    setOverlayStatus(true, "Connected");
    sendStatus(true, `Last gesture: ${gesture}`);
    console.info("[ReelHand] gesture received", gesture);

    if (gesture === "NEXT") {
      scrollShort(1);
    } else if (gesture === "PREV") {
      scrollShort(-1);
    } else if (gesture === "PLAY") {
      togglePlayPause();
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_DELAY_MS
    );
    reconnectAttempts += 1;

    reconnectTimer = setTimeout(() => {
      if (isShortsPage()) {
        connectSocket();
      }
    }, delay);
  }

  function connectSocket() {
    if (!isShortsPage()) {
      closeSocket();
      removeOverlay();
      sendStatus(false, "Open a YouTube Shorts page");
      return;
    }

    ensureOverlay();

    if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) {
      return;
    }

    setOverlayStatus(false, "Connecting");
    sendStatus(false, "Connecting to local gesture server");

    socket = new WebSocket(SOCKET_URL);

    socket.addEventListener("open", () => {
      reconnectAttempts = 0;
      setOverlayStatus(true, "Connected");
      sendStatus(true, "Connected to local gesture server");
      console.info("[ReelHand] websocket connected");
    });

    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "GESTURE" && typeof data.gesture === "string") {
          handleGesture(data.gesture);
        }
      } catch (error) {
        console.warn("[ReelHand] invalid websocket message", event.data, error);
      }
    });

    socket.addEventListener("close", () => {
      setOverlayStatus(false, "Disconnected");
      sendStatus(false, "Gesture server disconnected");
      console.warn("[ReelHand] websocket disconnected");
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      setOverlayStatus(false, "Connection error");
      sendStatus(false, "Could not reach ws://127.0.0.1:8765");
    });
  }

  function closeSocket() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      socket.close();
      socket = null;
    }
  }

  function handleRouteChange() {
    if (isShortsPage()) {
      connectSocket();
    } else {
      closeSocket();
      removeOverlay();
      sendStatus(false, "Open a YouTube Shorts page");
    }
  }

  function patchHistoryMethod(methodName) {
    const original = history[methodName];
    history[methodName] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event("reelhand-route-change"));
      return result;
    };
  }

  function start() {
    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("reelhand-route-change", handleRouteChange);

    pageWatcher = setInterval(handleRouteChange, 2500);
    handleRouteChange();
  }

  window.addEventListener("beforeunload", () => {
    closeSocket();
    if (pageWatcher) {
      clearInterval(pageWatcher);
    }
  });

  start();
})();
