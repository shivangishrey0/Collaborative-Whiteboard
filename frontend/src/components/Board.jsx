import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";

const Board = forwardRef(({ socket, color, brushSize, tool, bgType }, ref) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  
  const [startPos, setStartPos] = useState({ x: 0, y: 0 }); 
  const [snapshot, setSnapshot] = useState(null); 
  

  const [textInput, setTextInput] = useState({ visible: false, x: 0, y: 0, clientX: 0, clientY: 0, text: "" });
  
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);

  const isEraser = tool === "eraser";
  const currentColor = isEraser ? "#FFFFFF" : color;

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
    if (!dataUrl) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  };

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

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
  }, [currentColor, brushSize, isEraser]);

  // TEXT BOX MOVE (DRAG) EVENTS
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingText) return;
      setTextInput(prev => ({
        ...prev,
        clientX: e.clientX - dragOffset.x,
        clientY: e.clientY - dragOffset.y
      }));
    };

    const handleMouseUp = () => {
      setIsDraggingText(false);
    };

    if (isDraggingText) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    } else {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingText, dragOffset]);

  const handleTextDragStart = (e) => {
    setIsDraggingText(true);
    setDragOffset({
      x: e.clientX - textInput.clientX,
      y: e.clientY - textInput.clientY
    });
  };

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

    const handleDrawShape = ({ startX, startY, endX, endY, text, remoteTool, remoteColor, remoteSize }) => {
      const previousColor = ctx.strokeStyle;
      const previousSize = ctx.lineWidth;
      
      ctx.strokeStyle = remoteColor;
      ctx.lineWidth = remoteSize;
      ctx.globalCompositeOperation = "source-over";

      ctx.beginPath();
      
      if (remoteTool === "text") {
        ctx.font = `${remoteSize * 3}px Arial`;
        ctx.fillStyle = remoteColor;
        ctx.textBaseline = "top"; // Top align kiya hai taaki position perfect rahe
        ctx.fillText(text, startX, startY);
      } else if (remoteTool === "rect") {
        ctx.rect(startX, startY, endX - startX, endY - startY);
        ctx.stroke();
      } else if (remoteTool === "circle") {
        const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (remoteTool === "line") {
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
      
      ctx.closePath();
      ctx.strokeStyle = previousColor;
      ctx.lineWidth = previousSize;
    };

    const handleClear = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const handleBoardState = ({ snapshot }) => {
      if (snapshot) {
        restoreCanvas(snapshot);
      }
    };

    socket.on("start-draw", handleStartDraw);
    socket.on("drawing", handleDrawing);
    socket.on("stop-draw", handleStopDraw);
    socket.on("draw-shape", handleDrawShape);
    socket.on("clear", handleClear);
    socket.on("board-state", handleBoardState);

    return () => {
      socket.off("start-draw", handleStartDraw);
      socket.off("drawing", handleDrawing);
      socket.off("stop-draw", handleStopDraw);
      socket.off("draw-shape", handleDrawShape);
      socket.off("clear", handleClear);
      socket.off("board-state", handleBoardState);
    };
  }, [socket]);

  // TEXT SUBMIT FUNCTION
  const handleTextSubmit = (currentTextInput) => {
    if (!currentTextInput.visible) return;

    if (currentTextInput.text.trim() === "") {
      setTextInput({ visible: false, x: 0, y: 0, clientX: 0, clientY: 0, text: "" });
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();

    // Box ki nayi position ke hisaab se Canvas ki Asli X, Y calculate karna
    const finalCanvasX = currentTextInput.clientX - rect.left + 5; 
    const finalCanvasY = currentTextInput.clientY - rect.top + 20; // 20px isliye kyunki upar Drag Handle hai
    
    ctx.font = `${brushSize * 3}px Arial`;
    ctx.fillStyle = currentColor;
    ctx.textBaseline = "top"; 
    ctx.globalCompositeOperation = "source-over";
    ctx.fillText(currentTextInput.text, finalCanvasX, finalCanvasY);

    socket.emit("draw-shape", {
      startX: finalCanvasX, startY: finalCanvasY,
      text: currentTextInput.text,
      remoteTool: "text",
      remoteColor: currentColor, remoteSize: brushSize
    });

    const dataUrl = canvas.toDataURL();
    socket.emit("save-snapshot", { snapshot: dataUrl });
    const newHistory = history.slice(0, historyStep + 1);
    setHistory([...newHistory, dataUrl]);
    setHistoryStep(newHistory.length);

    setTextInput({ visible: false, x: 0, y: 0, clientX: 0, clientY: 0, text: "" });
  };

  const startDrawing = ({ nativeEvent }) => {
    const { offsetX, offsetY, clientX, clientY } = nativeEvent;
    
    if (tool === "text") {
      if (textInput.visible) {
        handleTextSubmit(textInput); 
      }
      // Naya Text Box
      setTextInput({ visible: true, x: offsetX, y: offsetY, clientX, clientY, text: "" });
      return;
    }

    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";

    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    setIsDrawing(true);
    setStartPos({ x: offsetX, y: offsetY });

    setSnapshot(ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height));

    if (tool === "pencil" || tool === "eraser") {
      socket.emit("start-draw", { x: offsetX, y: offsetY, remoteColor: currentColor, remoteSize: brushSize, remoteIsEraser: isEraser });
    }
  };

  const draw = ({ nativeEvent }) => {
    if (!isDrawing || tool === "text") return; 
    
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");

    if (tool === "pencil" || tool === "eraser") {
      ctx.lineTo(offsetX, offsetY);
      ctx.stroke();
      socket.emit("drawing", { x: offsetX, y: offsetY, remoteColor: currentColor, remoteSize: brushSize, remoteIsEraser: isEraser });
    } else {
      ctx.putImageData(snapshot, 0, 0);
      ctx.beginPath();
      
      if (tool === "rect") {
        ctx.rect(startPos.x, startPos.y, offsetX - startPos.x, offsetY - startPos.y);
      } else if (tool === "circle") {
        const radius = Math.sqrt(Math.pow(offsetX - startPos.x, 2) + Math.pow(offsetY - startPos.y, 2));
        ctx.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
      } else if (tool === "line") {
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(offsetX, offsetY);
      }
      ctx.stroke();
    }
  };

  const stopDrawing = ({ nativeEvent }) => {
    if (!isDrawing || tool === "text") return; 
    
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");
    ctx.closePath();
    setIsDrawing(false);

    if (tool !== "pencil" && tool !== "eraser") {
      socket.emit("draw-shape", {
        startX: startPos.x, startY: startPos.y, endX: offsetX, endY: offsetY,
        remoteTool: tool, remoteColor: currentColor, remoteSize: brushSize
      });
    } else {
      socket.emit("stop-draw");
    }

    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL();
    socket.emit("save-snapshot", { snapshot: dataUrl });
    const newHistory = history.slice(0, historyStep + 1);
    setHistory([...newHistory, dataUrl]);
    setHistoryStep(newHistory.length);
  };

  const bgStyles = { plain: "none", ruled: "linear-gradient(#e5e5e5 1px, transparent 1px)", grid: "linear-gradient(#e5e5e5 1px, transparent 1px), linear-gradient(90deg, #e5e5e5 1px, transparent 1px)" };
  const bgSizes = { plain: "auto", ruled: "100% 30px", grid: "30px 30px" };

  return (
    <>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        style={{
          border: "2px solid #ccc",
          cursor: tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair",
          marginTop: "10px",
          boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
          backgroundColor: "white",
          backgroundImage: bgStyles[bgType],
          backgroundSize: bgSizes[bgType]
        }}
      />

      {/* DRAGGABLE TEXT INPUT BOX */}
      {textInput.visible && (
        <div
          style={{
            position: "fixed",
            left: textInput.clientX,
            top: textInput.clientY,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            border: "1px solid #999",
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            borderRadius: "4px",
            boxShadow: "0 4px 10px rgba(0,0,0,0.2)"
          }}
        >
          {/* 🖐️ DRAG HANDLE (Isko pakad kar move karna hai) */}
          <div
            onMouseDown={handleTextDragStart}
            style={{
              width: "100%",
              height: "15px",
              backgroundColor: "#ccc",
              cursor: isDraggingText ? "grabbing" : "grab",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: "10px",
              fontWeight: "bold",
              userSelect: "none"
            }}
          >
            🖐️ Move
          </div>
          
          <input
            type="text"
            autoFocus
            value={textInput.text}
            onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleTextSubmit(textInput);
              }
            }}
            style={{
              margin: 0,
              padding: "5px",
              border: "none",
              outline: "none",
              background: "transparent",
              color: currentColor,
              font: `${brushSize * 3}px Arial`,
              minWidth: "150px" // Thoda bada dabba taaki likhne me aasaani ho
            }}
            placeholder="Type and press Enter..."
          />
        </div>
      )}
    </>
  );
});

Board.displayName = "Board";

export default Board;