import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import Board from "./components/Board";

const socket = io("http://localhost:5000");

function App() {
  const boardRef = useRef(null);
  const [status, setStatus] = useState("Connecting...");
  const [userCount, setUserCount] = useState(1);

  // Tools aur Sheet ke states
  const [color, setColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(5);
  const [isEraser, setIsEraser] = useState(false);
  const [bgType, setBgType] = useState("plain"); // Naya: Sheet Background State

  useEffect(() => {
    if (socket.connected) {
      setStatus(`Connected successfully! Your ID: ${socket.id}`);
    }

    const onConnect = () => setStatus(`Connected successfully! Your ID: ${socket.id}`);
    const onDisconnect = () => setStatus("Disconnected from server...");
    const onUserCount = (count) => setUserCount(count);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("user-count", onUserCount);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("user-count", onUserCount);
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: "10px", width: "100%" }}>
        <h1 style={{ margin: "10px 0" }}>Real-Time Collaborative Whiteboard</h1>
        <p style={{ color: status.includes("Connected") ? "green" : "red", margin: "0 0 10px 0", fontSize: "14px" }}>
          {status}
        </p>

        {/* TOOLBAR */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", padding: "10px", backgroundColor: "#f0f0f0", borderRadius: "8px", width: "95%", margin: "0 auto", flexWrap: "wrap" }}>

          <div style={{ fontWeight: "bold", color: "#333", backgroundColor: "#e0e0e0", padding: "5px 10px", borderRadius: "5px" }}>
            👤 Users: {userCount}
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

          <div style={{ display: "flex", alignItems: "center", gap: "5px", opacity: isEraser ? 0.5 : 1 }}>
            <label htmlFor="colorPicker">Color:</label>
            <input
              type="color"
              id="colorPicker"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={isEraser}
              style={{ cursor: isEraser ? "not-allowed" : "pointer" }}
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
            onClick={() => setIsEraser(!isEraser)}
            style={{
              padding: "5px 10px",
              backgroundColor: isEraser ? "#4d4d4d" : "#ffffff",
              color: isEraser ? "white" : "black",
              border: "1px solid #ccc",
              borderRadius: "5px",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            {isEraser ? "🖍️ Brush" : "🧽 Eraser"}
          </button>

          <button
            onClick={() => boardRef.current.undo()}
            style={{ padding: "5px 10px", backgroundColor: "#ffcc00", border: "1px solid #ccc", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}
          >
            ↩️ Undo
          </button>

          <button
            onClick={() => boardRef.current.redo()}
            style={{ padding: "5px 10px", backgroundColor: "#ffcc00", border: "1px solid #ccc", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}
          >
            ↪️ Redo
          </button>

          <button
            onClick={() => socket.emit("clear")}
            style={{ padding: "5px 10px", backgroundColor: "#ff4d4d", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}
          >
            🗑️ Clear
          </button>

        </div>
      </div>

      <Board ref={boardRef} socket={socket} color={color} brushSize={brushSize} isEraser={isEraser} bgType={bgType} />
    </div>
  );
}

export default App;