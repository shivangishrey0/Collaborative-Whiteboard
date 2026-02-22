import { useEffect, useRef, useState } from "react";

// Yahan humne color aur brushSize naye props add kiye hain
const Board = ({ socket, color, brushSize }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // 1. Initial Setup (Sirf ek baar chalega)
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 150; // Thodi aur jagah chhodi toolbar ke liye
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
  }, []);

  // 2. Jab bhi Color ya Brush Size change ho, canvas ko update karo
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
  }, [color, brushSize]);

  // 3. Socket Listeners (Dusre users ki drawing receive karna)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const handleStartDraw = ({ x, y, remoteColor, remoteSize }) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const handleDrawing = ({ x, y, remoteColor, remoteSize }) => {
      // Apna current color aur size save karo
      const previousColor = ctx.strokeStyle;
      const previousSize = ctx.lineWidth;

      // Dusre user ka color aur size apply karo
      ctx.strokeStyle = remoteColor;
      ctx.lineWidth = remoteSize;

      ctx.lineTo(x, y);
      ctx.stroke();

      // Apna color aur size wapas set karo
      ctx.strokeStyle = previousColor;
      ctx.lineWidth = previousSize;
    };

    const handleStopDraw = () => {
      ctx.closePath();
    };
    const handleClear = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    socket.on("start-draw", handleStartDraw);
    socket.on("drawing", handleDrawing);
    socket.on("stop-draw", handleStopDraw);
    socket.on("clear",handleClear);

    return () => {
      socket.off("start-draw", handleStartDraw);
      socket.off("drawing", handleDrawing);
      socket.off("stop-draw", handleStopDraw);
      socket.off("clear",handleClear);
    };
  }, [socket]);

  // 4. Apni Drawing Logic & Data Bhejna
  const startDrawing = ({ nativeEvent }) => {
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");
    
    // Ensure karo ki apna color/size set hai
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;

    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    setIsDrawing(true);

    // Socket ko color aur size bhi bhejo
    socket.emit("start-draw", { x: offsetX, y: offsetY, remoteColor: color, remoteSize: brushSize });
  };

  const draw = ({ nativeEvent }) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");
    
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();

    socket.emit("drawing", { x: offsetX, y: offsetY, remoteColor: color, remoteSize: brushSize });
  };

  const stopDrawing = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.closePath();
    setIsDrawing(false);

    socket.emit("stop-draw");
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
      style={{ border: "2px solid #ccc", cursor: "crosshair", backgroundColor: "white", marginTop: "10px" }}
    />
  );
};

export default Board;