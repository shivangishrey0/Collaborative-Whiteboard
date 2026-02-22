import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import Board from "./components/Board";

const socket = io("http://localhost:5000");

function App() {
  const [status, setStatus] = useState("Connecting...");
  // Naye states: Color aur Brush Size ke liye
  const [color, setColor] = useState("#000000"); // Default black
  const [brushSize, setBrushSize] = useState(5); // Default size 5

  useEffect(() => {
    if (socket.connected) {
      setStatus(`Connected successfully! Your ID: ${socket.id}`);
    }

    const onConnect = () => setStatus(`Connected successfully! Your ID: ${socket.id}`);
    const onDisconnect = () => setStatus("Disconnected from server...");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: "10px", width: "100%" }}>
        <h1 style={{ margin: "10px 0" }}>Real-Time Collaborative Whiteboard</h1>
        <p style={{ color: status.includes("Connected") ? "green" : "red", margin: "0 0 10px 0", fontSize: "14px" }}>
          {status}
        </p>
        
        {/* --- NAYA TOOLBAR YAHAN HAI --- */}
        <div style={{ display: "flex", justifyContent: "center", gap: "20px", padding: "10px", backgroundColor: "#f0f0f0", borderRadius: "8px", width: "80%", margin: "0 auto" }}>
          
          {/* Color Picker */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <label htmlFor="colorPicker">Color:</label>
            <input 
              type="color" 
              id="colorPicker" 
              value={color} 
              onChange={(e) => setColor(e.target.value)} 
              style={{ cursor: "pointer" }}
            />
          </div>

          {/* Brush Size Slider */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <label htmlFor="brushSize">Brush Size ({brushSize}):</label>
            <input 
              type="range" 
              id="brushSize" 
              min="1" 
              max="30" 
              value={brushSize} 
              onChange={(e) => setBrushSize(e.target.value)} 
              style={{ cursor: "pointer" }}
            />
          </div>

          {/* Clear Board Button (Functionality aage add karenge) */}
          <button 
            onClick={() => socket.emit("clear")} // Yahan se server ko 'clear' message bheja
            style={{ padding: "5px 15px", backgroundColor: "#ff4d4d", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}
          >
            Clear Board
          </button>
        </div>
      </div>
      
      {/* Naye props (color aur brushSize) ko Board me bhej rahe hain */}
      <Board socket={socket} color={color} brushSize={brushSize} /> 
    </div>
  );
}

export default App;