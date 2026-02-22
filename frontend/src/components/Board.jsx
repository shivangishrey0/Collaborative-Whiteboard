import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";

const Board = forwardRef(({ socket, color, brushSize, isEraser, bgType }, ref) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);

  // Undo/Redo Functions
  useImperativeHandle(ref, () => ({
    undo: () => {
      if (historyStep > 0) {
        setHistoryStep(historyStep - 1);
        restoreCanvas(history[historyStep - 1]);
      } else if (historyStep === 0) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHistoryStep(-1);
      }
    },
    redo: () => {
      if (historyStep < history.length - 1) {
        setHistoryStep(historyStep + 1);
        restoreCanvas(history[historyStep + 1]);
      }
    }
  }));

  const restoreCanvas = (dataUrl) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  };

  // 1. Initial Setup
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 160;
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const initialData = canvas.toDataURL();
    setHistory([initialData]);
    setHistoryStep(0);
  }, []);

  // 2. Brush Settings Update
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    // Asli Eraser Logic (Destination-out se pixel transparent hote hain)
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
  }, [color, brushSize, isEraser]);

  // 3. Socket Listeners (Dusre users ki drawing)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const handleStartDraw = ({ x, y }) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const handleDrawing = ({ x, y, remoteColor, remoteSize, remoteIsEraser }) => {
      const previousColor = ctx.strokeStyle;
      const previousSize = ctx.lineWidth;
      const previousOperation = ctx.globalCompositeOperation;

      ctx.strokeStyle = remoteColor;
      ctx.lineWidth = remoteSize;
      ctx.globalCompositeOperation = remoteIsEraser ? "destination-out" : "source-over";

      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.strokeStyle = previousColor;
      ctx.lineWidth = previousSize;
      ctx.globalCompositeOperation = previousOperation;
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
    socket.on("clear", handleClear);

    return () => {
      socket.off("start-draw", handleStartDraw);
      socket.off("drawing", handleDrawing);
      socket.off("stop-draw", handleStopDraw);
      socket.off("clear", handleClear);
    };
  }, [socket]);

  // 4. Apni Drawing Logic & Data Bhejna
  const startDrawing = ({ nativeEvent }) => {
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");

    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";

    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    setIsDrawing(true);

    socket.emit("start-draw", { x: offsetX, y: offsetY, remoteColor: color, remoteSize: brushSize, remoteIsEraser: isEraser });
  };

  const draw = ({ nativeEvent }) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");

    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();

    socket.emit("drawing", { x: offsetX, y: offsetY, remoteColor: color, remoteSize: brushSize, remoteIsEraser: isEraser });
  };

  const stopDrawing = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.closePath();
    setIsDrawing(false);

    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL();

    const newHistory = history.slice(0, historyStep + 1);
    setHistory([...newHistory, dataUrl]);
    setHistoryStep(newHistory.length);

    socket.emit("stop-draw");
  };

  // Background CSS Styling Logic
  const bgStyles = {
    plain: "none",
    ruled: "linear-gradient(#e5e5e5 1px, transparent 1px)",
    grid: "linear-gradient(#e5e5e5 1px, transparent 1px), linear-gradient(90deg, #e5e5e5 1px, transparent 1px)"
  };

  const bgSizes = {
    plain: "auto",
    ruled: "100% 30px",
    grid: "30px 30px"
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
      style={{
        border: "2px solid #ccc",
        cursor: isEraser ? "cell" : "crosshair",
        marginTop: "10px",
        boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
        backgroundColor: "white",
        backgroundImage: bgStyles[bgType],  // Yahan sheet ka pattern apply hoga
        backgroundSize: bgSizes[bgType]     // Yahan sheet ki spacing apply hogi
      }}
    />
  );
});

Board.displayName = "Board";

export default Board;