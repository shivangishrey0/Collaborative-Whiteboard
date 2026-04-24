import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import Board from "./components/Board";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

const TOOL_ITEMS = [
  { id: "pencil", icon: "✏", label: "Pen" },
  { id: "eraser", icon: "⌫", label: "Eraser" },
  { id: "rect", icon: "▭", label: "Shapes" },
  { id: "text", icon: "T", label: "Text" },
];

function App() {
  const boardRef = useRef(null);
  const toastTimeoutRef = useRef([]);
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState("Create or join a room to start");
  const [userCount, setUserCount] = useState(0);
  const [roomId, setRoomId] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [nameInput, setNameInput] = useState(() => localStorage.getItem("whiteboard_user_name") || "");
  const [joinedUserName, setJoinedUserName] = useState("");
  const [roomLink, setRoomLink] = useState("");
  const [roomExpiresAt, setRoomExpiresAt] = useState("");
  const [isRoomLoading, setIsRoomLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [showSignInNudge, setShowSignInNudge] = useState(true);

  const [color, setColor] = useState("#334155");
  const [brushSize, setBrushSize] = useState(5);
  const [bgType, setBgType] = useState("plain");
  const [tool, setTool] = useState("pencil");

  useEffect(() => {
    localStorage.setItem("whiteboard_user_name", nameInput);
  }, [nameInput]);

  useEffect(() => () => {
    toastTimeoutRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
  }, []);

  const addNotification = (message) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setNotifications((prev) => [...prev, { id, message }]);

    const timeoutId = setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id));
      toastTimeoutRef.current = toastTimeoutRef.current.filter((entryId) => entryId !== timeoutId);
    }, 2800);

    toastTimeoutRef.current.push(timeoutId);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      setRoomInput(roomFromUrl);
      setIsJoinModalOpen(true);
      setStatus("Paste your room and continue as guest or with a name");
    }
  }, []);

  const resolveSessionUserName = () => {
    const trimmed = nameInput.trim();
    return trimmed || "Guest";
  };

  useEffect(() => {
    if (!roomId || !joinedUserName) return undefined;

    const nextSocket = io(BACKEND_URL, {
      auth: { roomId, userName: joinedUserName },
    });
    setSocket(nextSocket);

    const onConnect = () => {
      setStatus(`Connected to ${roomId}`);
    };
    const onDisconnect = () => setStatus("Disconnected from server...");
    const onUserCount = (count) => setUserCount(count);
    const onRoomError = (message) => {
      setStatus(`Room error: ${message}`);
      setUserCount(0);
      setActiveUsers([]);
    };
    const onActiveUsers = (users) => {
      if (!Array.isArray(users)) return;
      setActiveUsers(users);
      setUserCount(users.length);
    };
    const onUserJoined = ({ userName: incomingUserName, socketId }) => {
      if (socketId !== nextSocket.id) {
        addNotification(`${incomingUserName || "Someone"} joined`);
      }
    };
    const onUserLeft = ({ userName: leftUserName }) => {
      addNotification(`${leftUserName || "Someone"} left`);
    };

    nextSocket.on("connect", onConnect);
    nextSocket.on("disconnect", onDisconnect);
    nextSocket.on("user-count", onUserCount);
    nextSocket.on("room-error", onRoomError);
    nextSocket.on("active-users", onActiveUsers);
    nextSocket.on("user-joined", onUserJoined);
    nextSocket.on("user-left", onUserLeft);

    return () => {
      nextSocket.off("connect", onConnect);
      nextSocket.off("disconnect", onDisconnect);
      nextSocket.off("user-count", onUserCount);
      nextSocket.off("room-error", onRoomError);
      nextSocket.off("active-users", onActiveUsers);
      nextSocket.off("user-joined", onUserJoined);
      nextSocket.off("user-left", onUserLeft);
      nextSocket.disconnect();
      setSocket(null);
      setActiveUsers([]);
    };
  }, [roomId, joinedUserName]);

  const createRoom = async () => {
    const sessionName = resolveSessionUserName();

    try {
      setIsRoomLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/rooms`, { method: "POST" });

      if (!response.ok) {
        throw new Error("Failed to create room");
      }

      const data = await response.json();
      setRoomId(data.roomId);
      setJoinedUserName(sessionName);
      setRoomInput(data.roomId);
      setRoomLink(data.roomLink);
      setRoomExpiresAt(data.expiresAt || "");

      const nextUrl = `${window.location.origin}/?room=${data.roomId}`;
      window.history.replaceState({}, "", nextUrl);
      setStatus("Board ready");
      setIsJoinModalOpen(false);
    } catch (error) {
      const message = error instanceof TypeError
        ? `Unable to reach backend at ${BACKEND_URL}. Ensure server and CORS are configured.`
        : error.message;
      setStatus(message);
    } finally {
      setIsRoomLoading(false);
    }
  };

  const joinRoom = async () => {
    const sessionName = resolveSessionUserName();

    if (!roomInput.trim()) {
      setStatus("Please enter a room ID");
      return;
    }

    try {
      setIsRoomLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/rooms/${roomInput.trim()}`);
      if (!response.ok) {
        throw new Error("Room not found. Check room link or ID.");
      }

      const data = await response.json();

      setRoomId(roomInput.trim());
      setJoinedUserName(sessionName);
      setRoomLink(`${window.location.origin}/?room=${roomInput.trim()}`);
      setRoomExpiresAt(data.expiresAt || "");
      const nextUrl = `${window.location.origin}/?room=${roomInput.trim()}`;
      window.history.replaceState({}, "", nextUrl);
      setStatus(`Joined ${roomInput.trim()}`);
      setIsJoinModalOpen(false);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsRoomLoading(false);
    }
  };

  const copyRoomLink = async () => {
    const linkToCopy = roomLink || `${window.location.origin}/?room=${roomId}`;
    try {
      await navigator.clipboard.writeText(linkToCopy);
      addNotification("Share link copied");
    } catch {
      setStatus("Unable to copy automatically. Copy from browser URL.");
    }
  };

  const formatExpiryLabel = (expiresAt) => {
    if (!expiresAt) return "";
    const expiryDate = new Date(expiresAt);
    if (Number.isNaN(expiryDate.getTime())) return "";
    return expiryDate.toLocaleString();
  };

  const participants = useMemo(() => {
    if (activeUsers.length > 0) return activeUsers;
    if (!joinedUserName) return [];
    return [{ socketId: "self", userName: joinedUserName, cursorColor: "#4f46e5" }];
  }, [activeUsers, joinedUserName]);

  const getInitials = (name) => {
    const safe = (name || "Guest").trim();
    if (!safe) return "G";
    const parts = safe.split(/\s+/).slice(0, 2);
    return parts.map((part) => part[0].toUpperCase()).join("");
  };

  return (
    <div className="app-shell">
      {!roomId && (
        <main className="landing-wrap">
          <section className="landing-card">
            <span className="eyebrow">Collaborative whiteboard</span>
            <h1>Sketch ideas together, instantly.</h1>
            <p>
              A clean, realtime canvas built for focused collaboration. Start as a guest and invite your team when ready.
            </p>
            <p className={`landing-status ${status.toLowerCase().includes("connected") ? "ok" : ""}`}>
              {status}
            </p>
            <div className="landing-actions">
              <button className="btn btn-primary" onClick={createRoom} disabled={isRoomLoading}>
                {isRoomLoading ? "Starting..." : "Start Drawing"}
              </button>
              <button className="btn btn-secondary" onClick={() => setIsJoinModalOpen(true)}>
                Join Room
              </button>
            </div>
            <label className="name-field" htmlFor="displayNameInput">
              Display name (optional)
              <input
                id="displayNameInput"
                type="text"
                value={nameInput}
                maxLength={24}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Continue as Guest if left blank"
              />
            </label>
          </section>
        </main>
      )}

      {roomId && (
        <section className="workspace-wrap">
          {socket && (
            <Board
              ref={boardRef}
              socket={socket}
              color={color}
              brushSize={brushSize}
              tool={tool}
              bgType={bgType}
              pendingImageData={""}
              onImagePlaced={() => {}}
              currentUserName={joinedUserName || "Guest"}
            />
          )}

          <header className="top-bar">
            <div className="top-bar-left">
              <span className="room-pill">Room: {roomId}</span>
              {roomExpiresAt && <span className="muted-pill">Expires {formatExpiryLabel(roomExpiresAt)}</span>}
              <span className="status-pill">{status}</span>
            </div>
            <div className="top-bar-right">
              <button className="icon-btn" onClick={() => boardRef.current?.undo?.()} title="Undo">↶</button>
              <button className="icon-btn" onClick={() => boardRef.current?.redo?.()} title="Redo">↷</button>
              <button className="icon-btn" onClick={() => socket?.emit("clear")} title="Clear board">⨯</button>
              <button className="btn btn-share" onClick={copyRoomLink}>Share</button>
              <div className="avatar-stack" title={`${userCount || participants.length} participants`}>
                {participants.slice(0, 4).map((user) => (
                  <span
                    key={user.socketId}
                    className="avatar"
                    style={{ borderColor: user.cursorColor || "#4f46e5" }}
                  >
                    {getInitials(user.userName)}
                  </span>
                ))}
              </div>
            </div>
          </header>

          <aside className="left-toolbar">
            {TOOL_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tool-btn ${tool === item.id ? "active" : ""}`}
                onClick={() => setTool(item.id)}
                title={item.label}
              >
                <span className="tool-icon">{item.icon}</span>
              </button>
            ))}
            <div className="toolbar-divider" />
            <button type="button" className={`tool-btn ${bgType === "plain" ? "active" : ""}`} onClick={() => setBgType("plain")} title="Plain sheet">
              <span className="tool-icon">□</span>
            </button>
            <button type="button" className={`tool-btn ${bgType === "ruled" ? "active" : ""}`} onClick={() => setBgType("ruled")} title="Ruled sheet">
              <span className="tool-icon">≡</span>
            </button>
            <button type="button" className={`tool-btn ${bgType === "grid" ? "active" : ""}`} onClick={() => setBgType("grid")} title="Grid sheet">
              <span className="tool-icon">▦</span>
            </button>
          </aside>

          <div className="bottom-toolbar">
            <label htmlFor="colorPicker">Color</label>
            <input
              id="colorPicker"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={tool === "eraser"}
              className="color-input"
            />
            <label htmlFor="brushSize">Stroke</label>
            <input
              id="brushSize"
              type="range"
              min="1"
              max="50"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
            <span className="stroke-value">{brushSize}px</span>
          </div>

          {showSignInNudge && (
            <button className="signin-nudge" onClick={() => setShowSignInNudge(false)}>
              Sign in to save your profile across devices
            </button>
          )}
        </section>
      )}

      {isJoinModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsJoinModalOpen(false)}>
          <div className="join-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Join Room</h2>
            <p>Paste a room ID and continue as a guest or with your display name.</p>
            <label htmlFor="roomInput">Room ID</label>
            <input
              id="roomInput"
              type="text"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="e.g. c2fbf2ad"
            />
            <label htmlFor="nameInput">Display name (optional)</label>
            <input
              id="nameInput"
              type="text"
              value={nameInput}
              maxLength={24}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Guest"
            />
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={joinRoom} disabled={isRoomLoading}>
                Continue as Guest
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setStatus("Sign-in is optional and can be added later.");
                  setIsJoinModalOpen(false);
                }}
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-wrap">
        {notifications.map((notification) => (
          <div key={notification.id} className="toast-item">
            {notification.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;