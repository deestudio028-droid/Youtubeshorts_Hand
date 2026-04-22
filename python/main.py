import asyncio
import json
import math
import platform
import signal
import threading
import time
from dataclasses import dataclass
from typing import Optional, Set

import cv2
import mediapipe as mp
import websockets


HOST = "127.0.0.1"
PORT = 8765
COOLDOWN_SECONDS = 1.0
PINCH_DISTANCE_THRESHOLD = 0.065
GESTURE_STABILITY_FRAMES = 3
CAMERA_INDEX = 0


mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_styles = mp.solutions.drawing_styles

connected_clients: Set[websockets.WebSocketServerProtocol] = set()
server_loop: Optional[asyncio.AbstractEventLoop] = None
shutdown_event = threading.Event()


@dataclass
class GestureState:
    last_sent_at: float = 0.0
    candidate: str = "NONE"
    candidate_frames: int = 0
    display_gesture: str = "NONE"


def normalized_distance(a, b) -> float:
    """Distance between two MediaPipe landmarks in normalized image coordinates."""
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)


def detect_pinch_gesture(landmarks) -> str:
    thumb_tip = landmarks[4]
    index_tip = landmarks[8]
    middle_tip = landmarks[12]
    pinky_tip = landmarks[20]

    distances = {
        "NEXT": normalized_distance(thumb_tip, index_tip),
        "PREV": normalized_distance(thumb_tip, middle_tip),
        "PLAY": normalized_distance(thumb_tip, pinky_tip),
    }

    gesture, distance = min(distances.items(), key=lambda item: item[1])
    if distance <= PINCH_DISTANCE_THRESHOLD:
        return gesture
    return "NONE"


async def websocket_handler(websocket):
    connected_clients.add(websocket)
    print(f"[websocket] client connected: {websocket.remote_address}")
    try:
        await websocket.send(
            json.dumps(
                {
                    "type": "STATUS",
                    "status": "CONNECTED",
                    "message": "ReelHand gesture server connected",
                }
            )
        )
        async for _ in websocket:
            pass
    except websockets.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[websocket] client disconnected: {websocket.remote_address}")


async def broadcast_gesture(gesture: str) -> None:
    if not connected_clients:
        return

    payload = json.dumps(
        {
            "type": "GESTURE",
            "gesture": gesture,
            "timestamp": time.time(),
        }
    )
    disconnected = []
    for websocket in list(connected_clients):
        try:
            await websocket.send(payload)
        except websockets.ConnectionClosed:
            disconnected.append(websocket)

    for websocket in disconnected:
        connected_clients.discard(websocket)


def send_gesture_to_clients(gesture: str) -> None:
    if server_loop is None or server_loop.is_closed():
        return
    asyncio.run_coroutine_threadsafe(broadcast_gesture(gesture), server_loop)


async def start_websocket_server() -> None:
    global server_loop
    server_loop = asyncio.get_running_loop()

    async with websockets.serve(websocket_handler, HOST, PORT):
        print(f"[websocket] ReelHand server running at ws://{HOST}:{PORT}")
        while not shutdown_event.is_set():
            await asyncio.sleep(0.1)


def run_websocket_server() -> None:
    asyncio.run(start_websocket_server())


def play_feedback_sound() -> None:
    if platform.system() == "Windows":
        try:
            import winsound

            winsound.Beep(880, 70)
        except RuntimeError:
            pass


def update_stable_gesture(raw_gesture: str, state: GestureState) -> str:
    if raw_gesture == state.candidate:
        state.candidate_frames += 1
    else:
        state.candidate = raw_gesture
        state.candidate_frames = 1

    if state.candidate_frames >= GESTURE_STABILITY_FRAMES:
        return state.candidate
    return "NONE"


def draw_status_overlay(frame, state: GestureState, client_count: int) -> None:
    cv2.rectangle(frame, (0, 0), (520, 112), (0, 0, 0), -1)
    cv2.putText(
        frame,
        "ReelHand",
        (18, 34),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (0, 0, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"Gesture: {state.display_gesture}",
        (18, 70),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"Clients: {client_count} | Press Q to quit",
        (18, 100),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        (180, 180, 180),
        1,
        cv2.LINE_AA,
    )


def run_camera_loop() -> None:
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        raise RuntimeError(
            "Could not open webcam. Check camera permissions and CAMERA_INDEX in main.py."
        )

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 540)

    state = GestureState()

    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        model_complexity=1,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.7,
    ) as hands:
        print("[camera] webcam started")
        print("[camera] gestures: thumb+index NEXT, thumb+middle PREV, thumb+pinky PLAY")

        while not shutdown_event.is_set():
            ok, frame = cap.read()
            if not ok:
                print("[camera] frame read failed")
                time.sleep(0.05)
                continue

            frame = cv2.flip(frame, 1)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb_frame.flags.writeable = False
            results = hands.process(rgb_frame)
            rgb_frame.flags.writeable = True

            raw_gesture = "NONE"
            if results.multi_hand_landmarks:
                hand_landmarks = results.multi_hand_landmarks[0]
                mp_drawing.draw_landmarks(
                    frame,
                    hand_landmarks,
                    mp_hands.HAND_CONNECTIONS,
                    mp_styles.get_default_hand_landmarks_style(),
                    mp_styles.get_default_hand_connections_style(),
                )
                raw_gesture = detect_pinch_gesture(hand_landmarks.landmark)

            stable_gesture = update_stable_gesture(raw_gesture, state)
            now = time.monotonic()

            if (
                stable_gesture != "NONE"
                and now - state.last_sent_at >= COOLDOWN_SECONDS
            ):
                state.last_sent_at = now
                state.display_gesture = stable_gesture
                print(f"[gesture] {stable_gesture}")
                send_gesture_to_clients(stable_gesture)
                play_feedback_sound()
            elif raw_gesture == "NONE" and now - state.last_sent_at > 0.25:
                state.display_gesture = "NONE"

            draw_status_overlay(frame, state, len(connected_clients))
            cv2.imshow("ReelHand - Webcam Gesture Preview", frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                shutdown_event.set()
                break

    cap.release()
    cv2.destroyAllWindows()


def handle_exit_signal(_signum, _frame) -> None:
    shutdown_event.set()


def main() -> None:
    signal.signal(signal.SIGINT, handle_exit_signal)
    signal.signal(signal.SIGTERM, handle_exit_signal)

    websocket_thread = threading.Thread(target=run_websocket_server, daemon=True)
    websocket_thread.start()

    try:
        run_camera_loop()
    finally:
        shutdown_event.set()
        websocket_thread.join(timeout=2)
        print("[app] ReelHand stopped")


if __name__ == "__main__":
    main()
