import { useEffect, useRef, useState } from "react";

// Yahan humne socket prop receive kiya
const Board = ({ socket }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 100;
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 5;

    // --- SOCKET LISTENERS (Dusro ki drawing receive karna) ---
    const handleStartDraw = ({ x, y }) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const handleDrawing = ({ x, y }) => {
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const handleStopDraw = () => {
      ctx.closePath();
    };

    socket.on("start-draw", handleStartDraw);
    socket.on("drawing", handleDrawing);
    socket.on("stop-draw", handleStopDraw);

    // Cleanup taaki event multiple times na chale
    return () => {
      socket.off("start-draw", handleStartDraw);
      socket.off("drawing", handleDrawing);
      socket.off("stop-draw", handleStopDraw);
    };
  }, [socket]);

  // --- LOCAL DRAWING & SENDING DATA ---
  const startDrawing = ({ nativeEvent }) => {
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    setIsDrawing(true);

    // Server ko batao ki drawing shuru ho gayi hai
    socket.emit("start-draw", { x: offsetX, y: offsetY });
  };

  const draw = ({ nativeEvent }) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();

    // Server ko drawing ke coordinates bhejo
    socket.emit("drawing", { x: offsetX, y: offsetY });
  };

  const stopDrawing = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.closePath();
    setIsDrawing(false);

    // Server ko batao ki drawing ruk gayi hai
    socket.emit("stop-draw");
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
      style={{ border: "2px solid #ccc", cursor: "crosshair" }}
    />
  );
};

export default Board;