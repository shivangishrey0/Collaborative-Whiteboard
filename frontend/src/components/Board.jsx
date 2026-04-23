import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";

const Board = forwardRef(({ socket, color, brushSize, tool, bgType, pendingImageData, onImagePlaced, currentUserName }, ref) => {
  const MAX_HISTORY_STATES = 250;
  const canvasRef = useRef(null);
  const cursorEmitRef = useRef({ lastSentAt: 0 });
  const stickySyncTimeoutsRef = useRef({});
  const remoteCursorBufferRef = useRef({});
  const cursorFrameRef = useRef(null);
  // Tracks the last known position of each remote user's drawing stroke,
  // so we can draw self-contained line segments without touching the local path.
  const remoteDrawStateRef = useRef({});
  // Tracks the local user's last draw position for self-contained line segments.
  const localDrawPosRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  
  const [startPos, setStartPos] = useState({ x: 0, y: 0 }); 
  const [snapshot, setSnapshot] = useState(null); 
  

  const [floatingInput, setFloatingInput] = useState({ kind: "", visible: false, x: 0, y: 0, clientX: 0, clientY: 0, text: "" });
  
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [stickyNotes, setStickyNotes] = useState([]);

  const stickyWidth = 220;

  const createStickyId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  const clampRatio = (value) => Math.max(0, Math.min(1, value));

  const upsertStickyNote = (note) => {
    setStickyNotes((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === note.id);
      if (existingIndex === -1) {
        return [...prev, note];
      }

      const next = [...prev];
      next[existingIndex] = { ...next[existingIndex], ...note };
      return next;
    });
  };

  const scheduleCursorFrame = () => {
    if (cursorFrameRef.current !== null) return;
    cursorFrameRef.current = window.requestAnimationFrame(() => {
      setRemoteCursors({ ...remoteCursorBufferRef.current });
      cursorFrameRef.current = null;
    });
  };

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
    },
    downloadBoard: () => {
      const canvas = canvasRef.current;
      const link = document.createElement("a");
      link.download = `whiteboard-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    }
  }));

  const pushSnapshot = () => {
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL("image/png");
    socket.emit("save-snapshot", { snapshot: dataUrl });
    const newHistory = history.slice(0, historyStep + 1);
    const nextHistory = [...newHistory, dataUrl].slice(-MAX_HISTORY_STATES);
    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
  };

  const wrapText = (ctx, text, maxWidth) => {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];

    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i += 1) {
      const testLine = `${currentLine} ${words[i]}`;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth) {
        lines.push(currentLine);
        currentLine = words[i];
      } else {
        currentLine = testLine;
      }
    }

    lines.push(currentLine);
    return lines;
  };

  const drawStickyNote = (ctx, x, y, text, noteWidth = 220, fontSize = 16) => {
    const padding = 14;
    const lineHeight = fontSize + 6;
    ctx.font = `${fontSize}px Arial`;
    const lines = wrapText(ctx, text, noteWidth - padding * 2);
    const noteHeight = Math.max(100, lines.length * lineHeight + padding * 2);

    ctx.fillStyle = "#fff59d";
    ctx.fillRect(x, y, noteWidth, noteHeight);
    ctx.strokeStyle = "#c9a400";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, noteWidth, noteHeight);

    ctx.fillStyle = "#222";
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.fillText(line, x + padding, y + padding + index * lineHeight);
    });

    return { noteWidth, noteHeight };
  };

  const drawImageOnCanvas = (ctx, dataUrl, x, y, width = 220) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = width / image.width;
      const height = image.height * scale;
      ctx.drawImage(image, x, y, width, height);
      resolve({ width, height });
    };
    image.src = dataUrl;
  });

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

  useEffect(() => () => {
    if (cursorFrameRef.current !== null) {
      window.cancelAnimationFrame(cursorFrameRef.current);
    }

    Object.values(stickySyncTimeoutsRef.current).forEach((timeoutId) => clearTimeout(timeoutId));
  }, []);

  // TEXT BOX MOVE (DRAG) EVENTS
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingText) return;
      setFloatingInput((prev) => ({
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
      x: e.clientX - floatingInput.clientX,
      y: e.clientY - floatingInput.clientY
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const handleStartDraw = ({ x, y, socketId }) => {
      // Record the remote user's start position — do NOT touch the shared ctx path.
      const senderId = socketId || "unknown";
      remoteDrawStateRef.current[senderId] = { x, y };
    };

    const handleDrawing = ({ x, y, color: incomingColor, size: incomingSize, isEraser: incomingIsEraser, remoteColor, remoteSize, remoteIsEraser, socketId }) => {
      const senderId = socketId || "unknown";
      const lastPos = remoteDrawStateRef.current[senderId];

      const strokeColor = incomingColor || remoteColor;
      const strokeSize = incomingSize || remoteSize;
      const strokeEraser = typeof incomingIsEraser === "boolean" ? incomingIsEraser : remoteIsEraser;

      // Draw a self-contained line segment using save/restore so we never
      // interfere with the local user's active path or context settings.
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = strokeEraser ? "destination-out" : "source-over";

      ctx.beginPath();
      if (lastPos) {
        ctx.moveTo(lastPos.x, lastPos.y);
      } else {
        ctx.moveTo(x, y);
      }
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();

      // Update this remote user's last position for the next segment.
      remoteDrawStateRef.current[senderId] = { x, y };
    };

    const handleStopDraw = ({ socketId }) => {
      // Clean up the remote user's tracking — do NOT touch the shared ctx path.
      const senderId = socketId || "unknown";
      delete remoteDrawStateRef.current[senderId];
    };

    const handleDrawShape = ({ startX, startY, endX, endY, text, tool: incomingTool, color: incomingColor, size: incomingSize, remoteTool, remoteColor, remoteSize }) => {
      const shapeTool = incomingTool || remoteTool;
      const shapeColor = incomingColor || remoteColor;
      const shapeSize = incomingSize || remoteSize;
      
      // Use save/restore so remote shapes never corrupt the local user's context.
      ctx.save();
      ctx.strokeStyle = shapeColor;
      ctx.lineWidth = shapeSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "source-over";

      ctx.beginPath();
      
      if (shapeTool === "text") {
        ctx.font = `${shapeSize * 3}px Arial`;
        ctx.fillStyle = shapeColor;
        ctx.textBaseline = "top"; // Top align kiya hai taaki position perfect rahe
        ctx.fillText(text, startX, startY);
      } else if (shapeTool === "sticky") {
        drawStickyNote(ctx, startX, startY, text, 220, shapeSize * 2 || 16);
      } else if (shapeTool === "image") {
        const imageWidth = shapeSize || 220;
        const imageUrl = text;
        const image = new Image();
        image.onload = () => {
          const scale = imageWidth / image.width;
          const imageHeight = image.height * scale;
          ctx.drawImage(image, startX, startY, imageWidth, imageHeight);
        };
        image.src = imageUrl;
      } else if (shapeTool === "rect") {
        ctx.rect(startX, startY, endX - startX, endY - startY);
        ctx.stroke();
      } else if (shapeTool === "circle") {
        const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (shapeTool === "line") {
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
      
      ctx.restore();
    };

    const handleClear = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const handleBoardState = ({ snapshot }) => {
      if (snapshot) {
        restoreCanvas(snapshot);
      }
    };

    const handleStickyCreate = (note) => {
      if (!note?.id) return;

      const canvas = canvasRef.current;
      const fallbackXRatio = typeof note.x === "number" && canvas?.width ? clampRatio(note.x / canvas.width) : 0;
      const fallbackYRatio = typeof note.y === "number" && canvas?.height ? clampRatio(note.y / canvas.height) : 0;

      upsertStickyNote({
        id: note.id,
        xRatio: typeof note.xRatio === "number" ? clampRatio(note.xRatio) : fallbackXRatio,
        yRatio: typeof note.yRatio === "number" ? clampRatio(note.yRatio) : fallbackYRatio,
        text: note.text || "",
      });
    };

    const handleStickyUpdate = (note) => {
      if (!note?.id) return;
      const patch = { id: note.id };
      const canvas = canvasRef.current;
      if (typeof note.xRatio === "number") patch.xRatio = clampRatio(note.xRatio);
      if (typeof note.yRatio === "number") patch.yRatio = clampRatio(note.yRatio);
      if (typeof note.x === "number" && canvas?.width) patch.xRatio = clampRatio(note.x / canvas.width);
      if (typeof note.y === "number" && canvas?.height) patch.yRatio = clampRatio(note.y / canvas.height);
      if (typeof note.text === "string") patch.text = note.text;

      upsertStickyNote({
        ...patch,
      });
    };

    const handleStickyState = (notes) => {
      if (!Array.isArray(notes)) return;
      const canvas = canvasRef.current;
      setStickyNotes(
        notes
          .filter((note) => note?.id)
          .map((note) => ({
            id: note.id,
            xRatio: typeof note.xRatio === "number"
              ? clampRatio(note.xRatio)
              : (typeof note.x === "number" && canvas?.width ? clampRatio(note.x / canvas.width) : 0),
            yRatio: typeof note.yRatio === "number"
              ? clampRatio(note.yRatio)
              : (typeof note.y === "number" && canvas?.height ? clampRatio(note.y / canvas.height) : 0),
            text: note.text || "",
          }))
      );
    };

    const handleStickyDelete = ({ id }) => {
      if (!id) return;
      setStickyNotes((prev) => prev.filter((note) => note.id !== id));
    };

    const handleCursorMove = ({ userId, socketId, username, userName, cursorColor, x, y, xRatio, yRatio }) => {
      const cursorUserId = userId || socketId;
      const cursorX = typeof x === "number" ? x : xRatio;
      const cursorY = typeof y === "number" ? y : yRatio;

      if (!cursorUserId || typeof cursorX !== "number" || typeof cursorY !== "number") return;

      remoteCursorBufferRef.current[cursorUserId] = {
        x: cursorX,
        y: cursorY,
        username: username || userName || "Guest",
        cursorColor: cursorColor || "#1f78ff",
      };
      scheduleCursorFrame();
    };

    const handleCursorLeave = ({ userId, socketId }) => {
      const cursorUserId = userId || socketId;
      if (!cursorUserId) return;
      if (!remoteCursorBufferRef.current[cursorUserId]) return;
      delete remoteCursorBufferRef.current[cursorUserId];
      scheduleCursorFrame();
    };

    const handleUserLeft = ({ userId, socketId }) => {
      handleCursorLeave({ userId: userId || socketId });
    };

    const handleActiveUsers = (users) => {
      if (!Array.isArray(users)) return;

      const validSocketIds = new Set(users.map((user) => user.socketId));
      Object.keys(remoteCursorBufferRef.current).forEach((socketId) => {
        if (!validSocketIds.has(socketId)) {
          delete remoteCursorBufferRef.current[socketId];
        }
      });

      users.forEach((user) => {
        const activeUserId = user?.userId || user?.socketId;
        if (!activeUserId || activeUserId === socket.id) return;
        if (!remoteCursorBufferRef.current[activeUserId]) {
          remoteCursorBufferRef.current[activeUserId] = {
            x: 0,
            y: 0,
            username: user.username || user.userName || "Guest",
            cursorColor: user.cursorColor || "#1f78ff",
          };
        }
      });

      scheduleCursorFrame();
    };

    socket.on("start-draw", handleStartDraw);
    socket.on("drawing", handleDrawing);
    socket.on("stop-draw", handleStopDraw);
    socket.on("draw-shape", handleDrawShape);
    socket.on("clear", handleClear);
    socket.on("board-state", handleBoardState);
    socket.on("cursor-move", handleCursorMove);
    socket.on("cursor-leave", handleCursorLeave);
    socket.on("user-left", handleUserLeft);
    socket.on("active-users", handleActiveUsers);
    socket.on("sticky-note-create", handleStickyCreate);
    socket.on("sticky-note-update", handleStickyUpdate);
    socket.on("sticky-note-delete", handleStickyDelete);
    socket.on("sticky-notes-state", handleStickyState);

    return () => {
      socket.off("start-draw", handleStartDraw);
      socket.off("drawing", handleDrawing);
      socket.off("stop-draw", handleStopDraw);
      socket.off("draw-shape", handleDrawShape);
      socket.off("clear", handleClear);
      socket.off("board-state", handleBoardState);
      socket.off("cursor-move", handleCursorMove);
      socket.off("cursor-leave", handleCursorLeave);
      socket.off("user-left", handleUserLeft);
      socket.off("active-users", handleActiveUsers);
      socket.off("sticky-note-create", handleStickyCreate);
      socket.off("sticky-note-update", handleStickyUpdate);
      socket.off("sticky-note-delete", handleStickyDelete);
      socket.off("sticky-notes-state", handleStickyState);
    };
  }, [socket]);

  const scheduleStickySync = (id, payload) => {
    if (stickySyncTimeoutsRef.current[id]) {
      clearTimeout(stickySyncTimeoutsRef.current[id]);
    }

    stickySyncTimeoutsRef.current[id] = setTimeout(() => {
      socket.emit("sticky-note-update", payload);
      delete stickySyncTimeoutsRef.current[id];
    }, 120);
  };

  const updateStickyText = (id, text) => {
    setStickyNotes((prev) => prev.map((note) => (note.id === id ? { ...note, text } : note)));
    scheduleStickySync(id, { id, text });
  };

  const deleteStickyNote = (id) => {
    setStickyNotes((prev) => prev.filter((note) => note.id !== id));
    socket.emit("sticky-note-delete", { id });
  };

  const downloadStickyNote = (note) => {
    const blob = new Blob([note.text || ""], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `sticky-note-${note.id}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const emitCursorMove = (offsetX, offsetY) => {
    const canvas = canvasRef.current;
    if (!canvas || !socket) return;

    const now = Date.now();
    if (now - cursorEmitRef.current.lastSentAt < 30) return;
    cursorEmitRef.current.lastSentAt = now;

    const x = Math.max(0, Math.min(1, offsetX / canvas.width));
    const y = Math.max(0, Math.min(1, offsetY / canvas.height));
    socket.emit("cursor-move", {
      x,
      y,
      userId: socket.id,
      username: currentUserName,
    });
  };

  // TEXT SUBMIT FUNCTION
  const handleFloatingSubmit = (currentFloatingInput) => {
    if (!currentFloatingInput.visible) return;

    if (currentFloatingInput.text.trim() === "") {
      setFloatingInput({ kind: "", visible: false, x: 0, y: 0, clientX: 0, clientY: 0, text: "" });
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();

    // Box ki nayi position ke hisaab se Canvas ki Asli X, Y calculate karna
    const finalCanvasX = currentFloatingInput.clientX - rect.left + 5; 
    const finalCanvasY = currentFloatingInput.clientY - rect.top + 20;

    ctx.textBaseline = "top"; 
    ctx.globalCompositeOperation = "source-over";

    if (currentFloatingInput.kind === "text") {
      ctx.font = `${brushSize * 3}px Arial`;
      ctx.fillStyle = currentColor;
      ctx.fillText(currentFloatingInput.text, finalCanvasX, finalCanvasY);
      socket.emit("draw-shape", {
        startX: finalCanvasX,
        startY: finalCanvasY,
        text: currentFloatingInput.text,
        tool: "text",
        color: currentColor,
        size: brushSize,
        userName: currentUserName,
      });
    } else if (currentFloatingInput.kind === "sticky") {
      const canvasWidth = canvasRef.current?.width || 1;
      const canvasHeight = canvasRef.current?.height || 1;
      const note = {
        id: createStickyId(),
        xRatio: clampRatio(Math.max(0, finalCanvasX) / canvasWidth),
        yRatio: clampRatio(Math.max(0, finalCanvasY) / canvasHeight),
        text: currentFloatingInput.text,
      };

      upsertStickyNote(note);
      socket.emit("sticky-note-create", note);
    }

    if (currentFloatingInput.kind !== "sticky") {
      pushSnapshot();
    }

    setFloatingInput({ kind: "", visible: false, x: 0, y: 0, clientX: 0, clientY: 0, text: "" });
  };

  // Convert a TouchEvent into the same shape the drawing functions expect.
  const getTouchOffset = (touch) => {
    const canvas = canvasRef.current;
    if (!canvas) return { offsetX: 0, offsetY: 0, clientX: touch.clientX, clientY: touch.clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      offsetX: touch.clientX - rect.left,
      offsetY: touch.clientY - rect.top,
      clientX: touch.clientX,
      clientY: touch.clientY,
    };
  };

  const handleTouchStart = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    startDrawing({ nativeEvent: getTouchOffset(touch) });
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    draw({ nativeEvent: getTouchOffset(touch) });
  };

  const handleTouchEnd = (e) => {
    e.preventDefault();
    // Use changedTouches for the final position since touches is empty on touchend.
    const touch = e.changedTouches[0];
    if (!touch) return;
    stopDrawing({ nativeEvent: getTouchOffset(touch) });
  };

  const startDrawing = ({ nativeEvent }) => {
    const { offsetX, offsetY, clientX, clientY } = nativeEvent;
    
    if (tool === "text" || tool === "sticky") {
      if (floatingInput.visible) {
        handleFloatingSubmit(floatingInput); 
      }
      setFloatingInput({ kind: tool, visible: true, x: offsetX, y: offsetY, clientX, clientY, text: "" });
      return;
    }

    if (tool === "image") {
      if (!pendingImageData) return;

      const ctx = canvasRef.current.getContext("2d");
      drawImageOnCanvas(ctx, pendingImageData, Math.max(0, offsetX - 110), Math.max(0, offsetY - 110)).then(({ width }) => {
        socket.emit("draw-shape", {
          startX: Math.max(0, offsetX - 110),
          startY: Math.max(0, offsetY - 110),
          text: pendingImageData,
          tool: "image",
          color: "#ffffff",
          size: width,
          userName: currentUserName,
        });

        pushSnapshot();
        if (onImagePlaced) onImagePlaced();
      });
      return;
    }

    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";

    // Store position in ref instead of starting a persistent path.
    // This prevents remote drawing events from corrupting our path.
    localDrawPosRef.current = { x: offsetX, y: offsetY };
    setIsDrawing(true);
    setStartPos({ x: offsetX, y: offsetY });

    setSnapshot(ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height));

    if (tool === "pencil" || tool === "eraser") {
      socket.emit("start-draw", {
        x: offsetX,
        y: offsetY,
        color: currentColor,
        size: brushSize,
        isEraser,
        tool,
        userName: currentUserName,
      });
    }
  };

  const draw = ({ nativeEvent }) => {
    emitCursorMove(nativeEvent.offsetX, nativeEvent.offsetY);

    if (!isDrawing || tool === "text") return; 
    
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext("2d");

    if (tool === "pencil" || tool === "eraser") {
      // Draw a self-contained line segment so remote events can never corrupt our path.
      const lastPos = localDrawPosRef.current;
      ctx.beginPath();
      ctx.moveTo(lastPos ? lastPos.x : offsetX, lastPos ? lastPos.y : offsetY);
      ctx.lineTo(offsetX, offsetY);
      ctx.stroke();
      localDrawPosRef.current = { x: offsetX, y: offsetY };
      socket.emit("drawing", {
        x: offsetX,
        y: offsetY,
        color: currentColor,
        size: brushSize,
        isEraser,
        tool,
        userName: currentUserName,
      });
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
    // No closePath() needed — we use self-contained segments, no persistent path.
    localDrawPosRef.current = null;
    setIsDrawing(false);

    if (tool !== "pencil" && tool !== "eraser") {
      socket.emit("draw-shape", {
        startX: startPos.x, startY: startPos.y, endX: offsetX, endY: offsetY,
        tool,
        color: currentColor,
        size: brushSize,
        userName: currentUserName,
      });
    } else {
      socket.emit("stop-draw");
    }

    pushSnapshot();
  };

  const handleMouseLeave = (event) => {
    stopDrawing(event);
    socket.emit("cursor-leave");
  };

  const bgStyles = { plain: "none", ruled: "linear-gradient(#e5e5e5 1px, transparent 1px)", grid: "linear-gradient(#e5e5e5 1px, transparent 1px), linear-gradient(90deg, #e5e5e5 1px, transparent 1px)" };
  const bgSizes = { plain: "auto", ruled: "100% 30px", grid: "30px 30px" };

  return (
    <>
      <div style={{ position: "relative", marginTop: "10px" }}>
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            border: "2px solid #ccc",
            cursor: tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair",
            boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
            backgroundColor: "white",
            backgroundImage: bgStyles[bgType],
            backgroundSize: bgSizes[bgType],
            touchAction: "none",
            maxWidth: "100vw",
          }}
        />

        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {Object.entries(remoteCursors).map(([userId, cursor]) => {
            const canvas = canvasRef.current;
            if (!canvas || !cursor) return null;
            const left = cursor.x * canvas.width;
            const top = cursor.y * canvas.height;

            return (
              <div
                key={userId}
                style={{
                  position: "absolute",
                  left,
                  top,
                  transform: "translate(-1px, -1px)",
                }}
              >
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: cursor.cursorColor,
                    border: "1px solid #fff",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
                  }}
                />
                <div
                  style={{
                    marginTop: "4px",
                    backgroundColor: cursor.cursorColor,
                    color: "#fff",
                    fontSize: "11px",
                    fontWeight: "bold",
                    padding: "2px 6px",
                    borderRadius: "999px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cursor.username}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {stickyNotes.map((note) => (
            <div
              key={note.id}
              style={{
                position: "absolute",
                left: `${(note.xRatio || 0) * 100}%`,
                top: `${(note.yRatio || 0) * 100}%`,
                width: `${stickyWidth}px`,
                transform: "translate(0, 0)",
                pointerEvents: "auto",
                backgroundColor: "#fff59d",
                border: "1px solid #c9a400",
                borderRadius: "6px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f2dc63", padding: "4px 6px", borderBottom: "1px solid #c9a400" }}>
                <span style={{ fontSize: "11px", fontWeight: "bold", color: "#5d4d00" }}>Sticky Note</span>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <button
                    type="button"
                    onClick={() => downloadStickyNote(note)}
                    title="Download note"
                    style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: "12px", color: "#5d4d00", padding: 0 }}
                  >
                    ⬇
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteStickyNote(note.id)}
                    title="Delete note"
                    style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: "12px", color: "#5d4d00", padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <textarea
                value={note.text}
                onChange={(e) => updateStickyText(note.id, e.target.value)}
                placeholder="Write your note..."
                style={{
                  width: "100%",
                  minHeight: "100px",
                  resize: "vertical",
                  border: "none",
                  outline: "none",
                  backgroundColor: "transparent",
                  padding: "8px",
                  fontSize: "14px",
                  color: "#222",
                  fontFamily: "Arial, sans-serif",
                  boxSizing: "border-box",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* DRAGGABLE TEXT / STICKY NOTE INPUT BOX */}
      {floatingInput.visible && (
        <div
          style={{
            position: "fixed",
            left: floatingInput.clientX,
            top: floatingInput.clientY,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            border: "1px solid #999",
            backgroundColor: floatingInput.kind === "sticky" ? "#fff59d" : "rgba(255, 255, 255, 0.9)",
            borderRadius: "4px",
            boxShadow: "0 4px 10px rgba(0,0,0,0.2)"
          }}
        >
          {/* 🖐️ DRAG HANDLE (Isko pakad kar move karna hai) */}
          <div
            onMouseDown={handleTextDragStart}
            style={{
              width: "100%",
              minHeight: "20px",
              backgroundColor: floatingInput.kind === "sticky" ? "#e6c84f" : "#ccc",
              cursor: isDraggingText ? "grabbing" : "grab",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "10px",
              fontWeight: "bold",
              userSelect: "none",
              padding: "0 6px",
            }}
          >
            <span>🖐️ Move</span>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setFloatingInput({ kind: "", visible: false, x: 0, y: 0, clientX: 0, clientY: 0, text: "" })}
              title="Close"
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: "12px", fontWeight: "bold", color: "#333", padding: 0, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>
          
          <input
            type="text"
            autoFocus
            value={floatingInput.text}
            onChange={(e) => setFloatingInput({ ...floatingInput, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleFloatingSubmit(floatingInput);
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
              minWidth: floatingInput.kind === "sticky" ? "220px" : "150px"
            }}
            placeholder={floatingInput.kind === "sticky" ? "Write sticky note and press Enter..." : "Type and press Enter..."}
          />
        </div>
      )}
    </>
  );
});

Board.displayName = "Board";

export default Board;