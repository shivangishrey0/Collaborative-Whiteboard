import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import Board from "./components/Board";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

function App() {
  const boardRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState("Create or join a room to start");
  const [userCount, setUserCount] = useState(0);
  const [roomId, setRoomId] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [roomLink, setRoomLink] = useState("");
  const [isRoomLoading, setIsRoomLoading] = useState(false);

  const [color, setColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(5);
  const [bgType, setBgType] = useState("plain");
  const [tool, setTool] = useState("pencil");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      setRoomId(roomFromUrl);
      setRoomInput(roomFromUrl);
    }
  }, []);

  useEffect(() => {
    if (!roomId) return undefined;

    const nextSocket = io(BACKEND_URL, {
      auth: { roomId },
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
    };

    nextSocket.on("connect", onConnect);
    nextSocket.on("disconnect", onDisconnect);
    nextSocket.on("user-count", onUserCount);
    nextSocket.on("room-error", onRoomError);

    return () => {
      nextSocket.off("connect", onConnect);
      nextSocket.off("disconnect", onDisconnect);
      nextSocket.off("user-count", onUserCount);
      nextSocket.off("room-error", onRoomError);
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [roomId]);

  const createRoom = async () => {
    try {
      setIsRoomLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/rooms`, { method: "POST" });

      if (!response.ok) {
        throw new Error("Failed to create room");
      }

      const data = await response.json();
      setRoomId(data.roomId);
      setRoomInput(data.roomId);
      setRoomLink(data.roomLink);

      const nextUrl = `${window.location.origin}/?room=${data.roomId}`;
      window.history.replaceState({}, "", nextUrl);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsRoomLoading(false);
    }
  };

  const joinRoom = async () => {
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

      setRoomId(roomInput.trim());
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

        {/* TOOLBAR */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", padding: "10px", backgroundColor: "#f0f0f0", borderRadius: "8px", width: "95%", margin: "0 auto", flexWrap: "wrap" }}>

          <div style={{ fontWeight: "bold", color: "#333", backgroundColor: "#e0e0e0", padding: "5px 10px", borderRadius: "5px" }}>
            👤 Room Users: {userCount}
          </div>

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
      </div>

      {socket ? (
        <Board ref={boardRef} socket={socket} color={color} brushSize={brushSize} tool={tool} bgType={bgType} />
      ) : (
        <div style={{ marginTop: "40px", color: "#555", fontWeight: "bold" }}>
          Create or join a room to start drawing.
        </div>
      )}
    </div>
  );
}

export default App;