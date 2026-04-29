import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import Board from "./components/Board";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
console.log("BACKEND URL:", BACKEND_URL);
function App() {
  const boardRef = useRef(null);
  const imageInputRef = useRef(null);
  const toastTimeoutRef = useRef([]);
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState("Create or join a room to start");
  const [userCount, setUserCount] = useState(0);
  const [roomId, setRoomId] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [nameInput, setNameInput] = useState(() => localStorage.getItem("whiteboard_user_name") || "");
  const [joinedUserName, setJoinedUserName] = useState("");
  const [allowGuest, setAllowGuest] = useState(false);
  const [roomLink, setRoomLink] = useState("");
  const [roomExpiresAt, setRoomExpiresAt] = useState("");
  const [isRoomLoading, setIsRoomLoading] = useState(false);
  const [pendingImageName, setPendingImageName] = useState("");
  const [pendingImageData, setPendingImageData] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);

  const [color, setColor] = useState("#000000");
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
    }, 3500);

    toastTimeoutRef.current.push(timeoutId);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      setRoomInput(roomFromUrl);
      setStatus("Enter your name and click Join Room (or allow guest join)");
    }
  }, []);

  const resolveSessionUserName = () => {
    const trimmed = nameInput.trim();
    if (trimmed) return trimmed;
    if (allowGuest) return "Guest";

    setStatus("Enter your name first, or enable guest join.");
    return null;
  };

  useEffect(() => {
    if (!roomId || !joinedUserName) return undefined;

    const nextSocket = io(BACKEND_URL, {
      auth: { roomId, userName: joinedUserName },
    });
    setSocket(nextSocket);

    const onConnect = () => {
      setStatus(`Connected to room ${roomId}`);
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
    const onUserJoined = ({ userName: joinedUserName, socketId }) => {
      if (socketId !== nextSocket.id) {
        addNotification(`${joinedUserName || "Someone"} joined the room`);
      }
    };
    const onUserLeft = ({ userName: leftUserName }) => {
      addNotification(`${leftUserName || "Someone"} left the room`);
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
    if (!sessionName) return;

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
    } catch (error) {
      const message = error instanceof TypeError
        ? `Unable to reach backend at ${BACKEND_URL}. Make sure backend server is running and CORS origin is configured.`
        : error.message;
      setStatus(message);
    } finally {
      setIsRoomLoading(false);
    }
  };

  const joinRoom = async () => {
    const sessionName = resolveSessionUserName();
    if (!sessionName) return;

    if (!roomInput.trim()) {
      setStatus("Please enter a room ID");
      return;
    }

    try {
      setIsRoomLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/rooms/${roomInput.trim()}`);
      if (!response.ok) {
        throw new Error("Room not found. Check room link/ID.");
      }

      const data = await response.json();

      setRoomId(roomInput.trim());
  setJoinedUserName(sessionName);
      setRoomExpiresAt(data.expiresAt || "");
      const nextUrl = `${window.location.origin}/?room=${roomInput.trim()}`;
      window.history.replaceState({}, "", nextUrl);
      setStatus(`Joining room ${roomInput.trim()}...`);
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
      setStatus("Room link copied to clipboard");
    } catch {
      setStatus("Unable to copy automatically. Copy from browser URL.");
    }
  };

  const handleImagePick = () => {
    if (imageInputRef.current) {
      imageInputRef.current.click();
    }
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPendingImageData(String(reader.result || ""));
      setPendingImageName(file.name);
      setTool("image");
      setStatus("Click on the board to place the image");
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

  const formatExpiryLabel = (expiresAt) => {
    if (!expiresAt) return "";

    const expiryDate = new Date(expiresAt);
    if (Number.isNaN(expiryDate.getTime())) return "";

    return expiryDate.toLocaleString();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: "10px", width: "100%" }}>
        <h1 style={{ margin: "10px 0" }}>Real-Time Collaborative Whiteboard</h1>
        <p style={{ color: status.includes("Connected") ? "green" : "red", margin: "0 0 10px 0", fontSize: "14px" }}>
          {status}
        </p>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", padding: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
          <button
            onClick={createRoom}
            disabled={isRoomLoading}
            style={{ padding: "8px 12px", backgroundColor: "#146c43", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
          >
            ➕ Create Room
          </button>

          <input
            type="text"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            placeholder="Enter Room ID"
            style={{ padding: "8px", borderRadius: "6px", border: "1px solid #ccc", minWidth: "240px" }}
          />

          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Your name"
            maxLength={24}
            style={{ padding: "8px", borderRadius: "6px", border: "1px solid #ccc", minWidth: "170px" }}
          />

          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#444" }}>
            <input
              type="checkbox"
              checked={allowGuest}
              onChange={(e) => setAllowGuest(e.target.checked)}
            />
            Allow guest join
          </label>

          <button
            onClick={handleImagePick}
            style={{ padding: "8px 12px", backgroundColor: "#fd7e14", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
          >
            🖼️ Insert Image
          </button>

          <button
            onClick={downloadBoard}
            disabled={!socket}
            style={{ padding: "8px 12px", backgroundColor: "#198754", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
          >
            ⬇️ Download Board
          </button>

          <button
            onClick={downloadBoard}
            disabled={!socket}
            title="Quick download"
            style={{ padding: "8px 10px", backgroundColor: "#157347", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", minWidth: "40px" }}
          >
            ⬇
          </button>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            style={{ display: "none" }}
          />

          <button
            onClick={joinRoom}
            disabled={isRoomLoading}
            style={{ padding: "8px 12px", backgroundColor: "#0d6efd", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
          >
            🔐 Join Room
          </button>

          {roomId && (
            <button
              onClick={copyRoomLink}
              style={{ padding: "8px 12px", backgroundColor: "#6f42c1", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
            >
              🔗 Copy Room Link
            </button>
          )}
        </div>

        {pendingImageName && (
          <div style={{ marginBottom: "10px", color: "#555", fontSize: "14px" }}>
            Selected image: {pendingImageName}
            <button
              onClick={clearPendingImage}
              style={{ marginLeft: "10px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", cursor: "pointer" }}
            >
              Clear image
            </button>
          </div>
        )}

        {/* TOOLBAR */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", padding: "10px", backgroundColor: "#f0f0f0", borderRadius: "8px", width: "95%", margin: "0 auto", flexWrap: "wrap" }}>

          <div style={{ fontWeight: "bold", color: "#333", backgroundColor: "#e0e0e0", padding: "5px 10px", borderRadius: "5px" }}>
            👤 Room Users: {userCount}
          </div>

          {roomExpiresAt && (
            <div style={{ fontWeight: "bold", color: "#333", backgroundColor: "#e6f4ea", padding: "5px 10px", borderRadius: "5px" }}>
              ⏳ Expires: {formatExpiryLabel(roomExpiresAt)}
            </div>
          )}

          {/* Sheet Background Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <label htmlFor="bgType">Sheet:</label>
            <select
              id="bgType"
              value={bgType}
              onChange={(e) => setBgType(e.target.value)}
              style={{ padding: "5px", borderRadius: "5px", cursor: "pointer" }}
            >
              <option value="plain">⬜ Plain</option>
              <option value="ruled">📝 Ruled</option>
              <option value="grid">▦ Grid</option>
            </select>
          </div>

          {/* NAYA TOOL SELECTOR */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <label htmlFor="tool">Tool:</label>
             <select 
            id="tool" 
            value={tool} 
            onChange={(e) => setTool(e.target.value)}
            style={{ padding: "5px", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}
          >
            <option value="pencil">✏️ Pencil</option>
            <option value="eraser">🧽 Eraser</option>
            <option value="rect">🟩 Rectangle</option>
            <option value="circle">⭕ Circle</option>
            <option value="line">📏 Straight Line</option>
            <option value="sticky">🗒️ Sticky Note</option>
            <option value="image">🖼️ Image</option>
            <option value="text">🔠 Text</option> {/* Naya option */}
        </select>
          </div>
         

          {/* Color Picker (Agar Eraser select hai toh disable ho jayega) */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px", opacity: tool === "eraser" ? 0.5 : 1 }}>
            <label htmlFor="colorPicker">Color:</label>
            <input
              type="color"
              id="colorPicker"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={tool === "eraser"}
              style={{ cursor: tool === "eraser" ? "not-allowed" : "pointer" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <label htmlFor="brushSize">Size:</label>
            <input
              type="range"
              id="brushSize"
              min="1"
              max="50"
              value={brushSize}
              onChange={(e) => setBrushSize(e.target.value)}
              style={{ cursor: "pointer", width: "80px" }}
            />
          </div>

          <button
            onClick={() => boardRef.current.undo()}
            disabled={!socket}
            style={{ padding: "5px 10px", backgroundColor: "#ffcc00", border: "1px solid #ccc", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}
          >
            ↩️ Undo
          </button>

          <button
            onClick={() => boardRef.current.redo()}
            disabled={!socket}
            style={{ padding: "5px 10px", backgroundColor: "#ffcc00", border: "1px solid #ccc", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}
          >
            ↪️ Redo
          </button>

          <button
            onClick={() => socket?.emit("clear")}
            disabled={!socket}
            style={{ padding: "5px 10px", backgroundColor: "#ff4d4d", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}
          >
            🗑️ Clear
          </button>

        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "95%", margin: "10px auto 0 auto", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", color: "#555", fontWeight: "bold" }}>Active:</span>
          {joinedUserName && (
            <span style={{ fontSize: "12px", color: "#666" }}>You: {joinedUserName}</span>
          )}
          {activeUsers.length === 0 ? (
            <span style={{ fontSize: "13px", color: "#666" }}>No users connected</span>
          ) : (
            activeUsers.map((user) => (
              <span
                key={user.socketId}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  borderRadius: "999px",
                  border: "1px solid #ddd",
                  backgroundColor: "#fff",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: "#333",
                }}
              >
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: user.cursorColor || "#999" }} />
                {user.userName || "Guest"}
              </span>
            ))
          )}
        </div>
      </div>

      {socket ? (
        <Board
          ref={boardRef}
          socket={socket}
          color={color}
          brushSize={brushSize}
          tool={tool}
          bgType={bgType}
          pendingImageData={pendingImageData}
          onImagePlaced={clearPendingImage}
          currentUserName={joinedUserName || "Guest"}
        />
      ) : (
        <div style={{ marginTop: "40px", color: "#555", fontWeight: "bold" }}>
          Create or join a room to start drawing.
        </div>
      )}

      <div style={{ position: "fixed", top: "16px", right: "16px", zIndex: 1500, display: "flex", flexDirection: "column", gap: "8px", pointerEvents: "none" }}>
        {notifications.map((notification) => (
          <div
            key={notification.id}
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              backgroundColor: "rgba(26, 26, 26, 0.9)",
              color: "#fff",
              fontSize: "13px",
              minWidth: "210px",
              boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
            }}
          >
            {notification.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;