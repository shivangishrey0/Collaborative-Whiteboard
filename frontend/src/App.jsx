import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import Board from "./components/Board"; // Naya component import kiya

const socket = io("http://localhost:5000");

function App() {
  const [status, setStatus] = useState("Connecting...");

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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <h1 style={{ margin: "10px 0" }}>Real-Time Collaborative Whiteboard</h1>
        <p style={{ color: status.includes("Connected") ? "green" : "red", margin: 0 }}>
          {status}
        </p>
      </div>
      
      {/* Yahan humara drawing board aayega */}
      // App.jsx me sirf ye ek line change karni hai
    <Board socket={socket} />
    </div>
  );
}

export default App;