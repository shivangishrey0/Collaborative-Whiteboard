import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Board from "./components/Board";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

const TOOL_OPTIONS = [
  { value: "pencil", label: "Pencil", icon: "✏️" },
  { value: "eraser", label: "Eraser", icon: "🧽" },
  { value: "rect", label: "Rectangle", icon: "▭" },
  { value: "circle", label: "Circle", icon: "◯" },
  { value: "line", label: "Line", icon: "／" },
  { value: "sticky", label: "Sticky", icon: "🗒️" },
  { value: "image", label: "Image", icon: "🖼️" },
  { value: "text", label: "Text", icon: "Aa" },
];

const getFallbackDisplayName = (value) => value.trim() || "Guest";

const getInitials = (name) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "G";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

function App() {
  const boardRef = useRef(null);
  const imageInputRef = useRef(null);
  const toastTimeoutRef = useRef([]);

  const [screen, setScreen] = useState("landing");
  const [sessionMode, setSessionMode] = useState("local");
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState("Start drawing instantly or join a room by ID.");
  const [userCount, setUserCount] = useState(0);
  const [roomId, setRoomId] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [nameInput, setNameInput] = useState(() => localStorage.getItem("whiteboard_user_name") || "");
  const [joinedUserName, setJoinedUserName] = useState("");
  const [roomLink, setRoomLink] = useState("");
  const [roomExpiresAt, setRoomExpiresAt] = useState("");
  const [isRoomLoading, setIsRoomLoading] = useState(false);
  const [pendingImageName, setPendingImageName] = useState("");
  const [pendingImageData, setPendingImageData] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);

  const [color, setColor] = useState("#0f172a");
  const [brushSize, setBrushSize] = useState(5);
  const [bgType, setBgType] = useState("plain");
  const [tool, setTool] = useState("pencil");

  const displayName = getFallbackDisplayName(nameInput);
  const isRoomSession = sessionMode === "room";

  useEffect(() => {
    localStorage.setItem("whiteboard_user_name", nameInput);
  }, [nameInput]);

  useEffect(() => () => {
    toastTimeoutRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");

    if (roomFromUrl) {
      setRoomInput(roomFromUrl);
      setScreen("join");
      setStatus("Room link detected. Enter the room ID to join.");
    }
  }, []);

  const addNotification = (message) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setNotifications((prev) => [...prev, { id, message }]);

    const timeoutId = setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id));
      toastTimeoutRef.current = toastTimeoutRef.current.filter((entryId) => entryId !== timeoutId);
    }, 3500);

    toastTimeoutRef.current.push(timeoutId);
  };

  useEffect(() => {
    if (!isRoomSession || !roomId || !joinedUserName) return undefined;

    const nextSocket = io(BACKEND_URL, {
      auth: { roomId, userName: joinedUserName },
    });
    setSocket(nextSocket);

    const onConnect = () => {
      setStatus(`Connected to room ${roomId}`);
    };
    const onDisconnect = () => setStatus("Disconnected from the room.");
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
    const onUserJoined = ({ userName: userNameJoined, socketId }) => {
      if (socketId !== nextSocket.id) {
        addNotification(`${userNameJoined || "Someone"} joined the room`);
      }
    };
    const onUserLeft = ({ userName: userNameLeft }) => {
      addNotification(`${userNameLeft || "Someone"} left the room`);
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
  }, [isRoomSession, roomId, joinedUserName]);

  const resetSession = () => {
    setScreen("landing");
    setSessionMode("local");
    setRoomId("");
    setRoomLink("");
    setRoomExpiresAt("");
    setUserCount(0);
    setActiveUsers([]);
    setJoinedUserName("");
    setStatus("Start drawing instantly or join a room by ID.");
    window.history.replaceState({}, "", window.location.pathname);
  };

  const startDrawing = () => {
    setScreen("board");
    setSessionMode("local");
    setRoomId("");
    setRoomLink("");
    setRoomExpiresAt("");
    setUserCount(1);
    setActiveUsers([]);
    setJoinedUserName(displayName);
    setStatus("Private canvas ready. Nothing is shared until you join a room.");
    window.history.replaceState({}, "", window.location.pathname);
  };

  const openJoinRoom = () => {
    setScreen("join");
    setStatus("Enter an existing room ID to join a shared board.");
  };

  const handleJoinRoom = async (event) => {
    event.preventDefault();

    const targetRoomId = roomInput.trim();
    if (!targetRoomId) {
      setStatus("Please enter a room ID.");
      return;
    }

    try {
      setIsRoomLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/rooms/${targetRoomId}`);
      if (!response.ok) {
        throw new Error("Room not found. Check the room ID.");
      }

      const data = await response.json();
      setSessionMode("room");
      setRoomId(targetRoomId);
      setJoinedUserName(displayName);
      setRoomExpiresAt(data.expiresAt || "");
      setRoomLink(data.roomLink || `${window.location.origin}/?room=${targetRoomId}`);
      setScreen("board");
      setStatus(`Joining room ${targetRoomId}...`);
      window.history.replaceState({}, "", `${window.location.origin}/?room=${targetRoomId}`);
    } catch (error) {
      const message = error instanceof TypeError
        ? `Unable to reach the backend at ${BACKEND_URL}. Make sure the server is running.`
        : error.message;
      setStatus(message);
    } finally {
      setIsRoomLoading(false);
    }
  };

  const copyRoomLink = async () => {
    const linkToCopy = roomLink || `${window.location.origin}/?room=${roomId}`;
    try {
      await navigator.clipboard.writeText(linkToCopy);
      setStatus("Room link copied to clipboard.");
    } catch {
      setStatus("Unable to copy automatically. Copy the link from the address bar.");
    }
  };

  const handleImagePick = () => {
    imageInputRef.current?.click();
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPendingImageData(String(reader.result || ""));
      setPendingImageName(file.name);
      setTool("image");
      setStatus("Click on the board to place the image.");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const clearPendingImage = () => {
    setPendingImageData("");
    setPendingImageName("");
  };

  const downloadBoard = () => {
    boardRef.current?.downloadBoard?.();
  };

  const clearBoard = () => {
    boardRef.current?.clearBoard?.();
  };

  const formatExpiryLabel = (expiresAt) => {
    if (!expiresAt) return "";

    const expiryDate = new Date(expiresAt);
    if (Number.isNaN(expiryDate.getTime())) return "";

    return expiryDate.toLocaleString();
  };

  const participantUsers = isRoomSession
    ? (activeUsers.length > 0
      ? activeUsers
      : [{ socketId: "room-self", userName: joinedUserName || displayName, cursorColor: "#4f46e5" }])
    : [{ socketId: "local-user", userName: joinedUserName || displayName, cursorColor: "#4f46e5" }];

  return (
    <div className="app-shell">
      <div className="app-orb app-orb-a" />
      <div className="app-orb app-orb-b" />

      <div className="app-content">
        {screen === "landing" && (
          <section className="landing-layout">
            <div className="surface-card landing-card">
              <div className="eyebrow">Collaborative whiteboard</div>
              <h1>Draw instantly, or join a room by ID.</h1>
              <p className="lede">
                Guest-first by default. Start a private canvas with one click, or enter an existing room when you need collaboration.
              </p>

              <div className="landing-actions">
                <button type="button" className="action-button primary" onClick={startDrawing}>
                  Start Drawing
                </button>
                <button type="button" className="action-button secondary" onClick={openJoinRoom}>
                  Join Room
                </button>
              </div>

              <div className="feature-row">
                <span className="feature-pill">No forced login</span>
                <span className="feature-pill">Soft shadows</span>
                <span className="feature-pill">Indigo + green palette</span>
              </div>

              <p className="subtle-note">Optional sign-in can come later. For now, the app stays guest-first and lightweight.</p>
            </div>

            <div className="surface-card landing-sidecard">
              <div className="sidecard-header">
                <span>What you can do</span>
                <span className="status-dot" />
              </div>
              <ul className="feature-list">
                <li>Start a private drawing space without creating a room.</li>
                <li>Join a shared board by entering the room ID only.</li>
                <li>Use the same drawing tools with smooth hover and active states.</li>
              </ul>
            </div>
          </section>
        )}

        {screen === "join" && (
          <section className="join-layout">
            <form className="surface-card join-card" onSubmit={handleJoinRoom}>
              <div className="eyebrow">Join an existing room</div>
              <h2>Enter the room ID and start collaborating.</h2>
              <p className="lede compact">
                No account required. If you want, add a display name for the room, but it is optional.
              </p>

              <div className="form-grid">
                <label className="field">
                  <span>Room ID</span>
                  <input
                    type="text"
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value)}
                    placeholder="Enter room ID"
                    autoComplete="off"
                  />
                </label>

                <label className="field">
                  <span>Display name</span>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Optional display name"
                    maxLength={24}
                  />
                </label>
              </div>

              <div className="landing-actions">
                <button type="submit" className="action-button primary" disabled={isRoomLoading}>
                  {isRoomLoading ? "Checking Room..." : "Join Room"}
                </button>
                <button type="button" className="action-button secondary" onClick={() => setScreen("landing")}>
                  Back
                </button>
              </div>

              <div className="subtle-note">
                Sign-in stays optional for now. Room access is based on the ID you enter.
              </div>
            </form>

            <div className="surface-card join-sidecard">
              <div className="sidecard-header">
                <span>Guest-first</span>
                <span className="status-dot accent" />
              </div>
              <p className="compact-copy">
                Use a room ID from an invite link, or share the current board URL once you are inside a room.
              </p>
              <div className="feature-row stacked">
                <span className="feature-pill">Smooth transitions</span>
                <span className="feature-pill">Rounded controls</span>
                <span className="feature-pill">Minimal SaaS layout</span>
              </div>
            </div>
          </section>
        )}

        {screen === "board" && (
          <section className="workspace">
            <header className="surface-card workspace-header">
              <div className="brand-block">
                <div className="brand-mark">W</div>
                <div>
                  <div className="brand-title">Whiteboard</div>
                  <div className="brand-subtitle">{isRoomSession ? `Room ${roomId || "..."}` : "Private canvas"}</div>
                </div>
              </div>

              <div className="status-block">
                <span className={`mode-chip ${isRoomSession ? "room" : "local"}`}>
                  {isRoomSession ? "Shared room" : "Private"}
                </span>
                <span className="status-text">{status}</span>
              </div>

              <div className="participant-stack" aria-label="Participants">
                <span className="participant-count">{isRoomSession ? `${userCount || participantUsers.length} active` : "1 active"}</span>
                <div className="avatar-row">
                  {participantUsers.slice(0, 4).map((user) => (
                    <span
                      key={user.socketId || user.userName}
                      className="participant-avatar"
                      title={user.userName || "Guest"}
                      style={{ backgroundColor: user.cursorColor || "#4f46e5" }}
                    >
                      {getInitials(user.userName || "Guest")}
                    </span>
                  ))}
                  {isRoomSession && activeUsers.length > 4 && (
                    <span className="participant-avatar extra">+{activeUsers.length - 4}</span>
                  )}
                </div>
              </div>
            </header>

            {pendingImageName && (
              <div className="surface-card image-banner">
                <span>Selected image: {pendingImageName}</span>
                <button type="button" className="mini-button" onClick={clearPendingImage}>
                  Clear image
                </button>
              </div>
            )}

            <div className="surface-card control-panel">
              <div className="control-group muted-chip">
                <span>Users</span>
                <strong>{isRoomSession ? userCount || 0 : 1}</strong>
              </div>

              {roomExpiresAt && isRoomSession && (
                <div className="control-group muted-chip success">
                  <span>Expires</span>
                  <strong>{formatExpiryLabel(roomExpiresAt)}</strong>
                </div>
              )}

              <label className="control-group">
                <span>Sheet</span>
                <select value={bgType} onChange={(e) => setBgType(e.target.value)}>
                  <option value="plain">Plain</option>
                  <option value="ruled">Ruled</option>
                  <option value="grid">Grid</option>
                </select>
              </label>

              <label className="control-group">
                <span>Color</span>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={tool === "eraser"} />
              </label>

              <label className="control-group slider-control">
                <span>Size</span>
                <input type="range" min="1" max="50" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
              </label>

              <button type="button" className="action-button soft" onClick={handleImagePick}>
                Insert Image
              </button>
              <button type="button" className="action-button soft" onClick={downloadBoard}>
                Download
              </button>
              <button type="button" className="action-button soft" onClick={() => boardRef.current?.undo?.()}>
                Undo
              </button>
              <button type="button" className="action-button soft" onClick={() => boardRef.current?.redo?.()}>
                Redo
              </button>
              <button type="button" className="action-button destructive" onClick={clearBoard}>
                Clear
              </button>

              {isRoomSession && (
                <button type="button" className="action-button secondary" onClick={copyRoomLink}>
                  Copy room link
                </button>
              )}

              <button type="button" className="action-button ghost" onClick={resetSession}>
                Leave
              </button>
            </div>

            <div className="surface-card tool-panel">
              <div className="tool-header">
                <span className="tool-label">Tools</span>
                <span className="tool-hint">Hover and active states stay highlighted.</span>
              </div>

              <div className="tool-grid">
                {TOOL_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`tool-button ${tool === option.value ? "active" : ""}`}
                    onClick={() => setTool(option.value)}
                  >
                    <span className="tool-icon">{option.icon}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <Board
              ref={boardRef}
              socket={isRoomSession ? socket : null}
              color={color}
              brushSize={brushSize}
              tool={tool}
              bgType={bgType}
              pendingImageData={pendingImageData}
              onImagePlaced={clearPendingImage}
              currentUserName={joinedUserName || displayName}
            />
          </section>
        )}
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        style={{ display: "none" }}
      />

      <div className="toast-stack">
        {notifications.map((notification) => (
          <div key={notification.id} className="toast-card">
            {notification.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;