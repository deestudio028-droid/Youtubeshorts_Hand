# ReelHand

ReelHand is a local hand-gesture controller for YouTube Shorts. A Python webcam app tracks your hand with MediaPipe, sends gesture events over a localhost websocket, and a Chrome Extension controls Shorts scrolling and playback in the browser.

## Features

- Webcam hand detection with OpenCV and MediaPipe.
- Live preview window with hand landmarks and current gesture.
- Thumb + index pinch sends `NEXT`.
- Thumb + middle pinch sends `PREV`.
- Thumb + pinky pinch sends `PLAY`.
- One-second Python gesture cooldown, plus a small browser-side action guard.
- Chrome Manifest V3 extension for `youtube.com/shorts/*`.
- Websocket reconnect logic and popup connection status.
- Optional Windows beep feedback when a gesture fires.

## Project Structure

```text
ReelHand/
├── python/
│   ├── main.py
│   ├── requirements.txt
├── extension/
│   ├── manifest.json
│   ├── content.js
│   ├── background.js
│   ├── popup.html
│   ├── popup.js
│   ├── styles.css
├── README.md
```

## Requirements

- Python 3.10 or 3.11 recommended.
- Google Chrome.
- A working webcam.
- Windows, macOS, or Linux. The optional beep feedback only runs on Windows.

## Install Python Packages

From the project root:

```powershell
cd python
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

On macOS or Linux:

```bash
cd python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run the Gesture Server

From the `python` folder with the virtual environment active:

```powershell
python main.py
```

The app opens your webcam and starts a websocket server at:

```text
ws://127.0.0.1:8765
```

Press `Q` in the webcam preview window to stop ReelHand.

## Load the Chrome Extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the `extension` folder inside this project.

## Use ReelHand

1. Start the Python app with `python main.py`.
2. Load the extension in Chrome.
3. Open `https://www.youtube.com/shorts`.
4. Keep one hand visible in the webcam preview.
5. Use the gestures:

| Gesture | Action |
| --- | --- |
| Thumb + Index | Next Short |
| Thumb + Middle | Previous Short |
| Thumb + Pinky | Play / Pause |

## Gesture Tuning

If gestures are too sensitive or not sensitive enough, edit these values in `python/main.py`:

```python
PINCH_DISTANCE_THRESHOLD = 0.065
GESTURE_STABILITY_FRAMES = 3
COOLDOWN_SECONDS = 1.0
```

- Increase `PINCH_DISTANCE_THRESHOLD` if pinches are not detected.
- Decrease `PINCH_DISTANCE_THRESHOLD` if gestures trigger too easily.
- Increase `GESTURE_STABILITY_FRAMES` for stricter filtering.
- Change `CAMERA_INDEX` if you have multiple cameras.

## Troubleshooting

- If the popup says disconnected, make sure `python main.py` is running.
- If Chrome cannot connect, confirm the websocket log says `ws://127.0.0.1:8765`.
- If the webcam does not open, check OS camera permissions and close other camera apps.
- If Shorts does not move, click the YouTube tab once and retry the gesture.
- Open Chrome DevTools on the YouTube tab to see `[ReelHand]` console logs.

## Security Note

The Python server binds only to `127.0.0.1`, so it accepts websocket connections from your own machine only.
