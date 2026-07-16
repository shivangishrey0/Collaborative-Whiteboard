import { useEffect, useRef, useState } from "react";

// Helper: draw an image from data URL onto canvas (returns size)
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

// Owns local pointer/touch drawing interaction (pencil, shapes, image
// placement), the floating text/sticky input UI, and initial canvas setup.
// Remote playback lives in useSocketSync; undo/redo history lives in useHistory.
export const useCanvasDrawing = ({
  socket,
  tool,
  color,
  brushSize,
  pendingImageData,
  onImagePlaced,
  currentUserName,
  canvasRef,
  previewCanvasRef,
  pushSnapshot,
  initializeHistory,
  onCreateStickyNote,
}) => {
  const cursorEmitRef = useRef({ lastSentAt: 0 });
  // Tracks the local user's last draw position for self-contained line segments.
  const localDrawPosRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [floatingInput, setFloatingInput] = useState({ kind: "", visible: false, x: 0, y: 0, clientX: 0, clientY: 0, text: "" });
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const isEraser = tool === "eraser";
  const currentColor = isEraser ? "#FFFFFF" : color;

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 160;
    const ctx = canvas.getContext("2d");
    const preview = previewCanvasRef.current;
    if (preview) {
      preview.width = canvas.width;
      preview.height = canvas.height;
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setCanvasSize({ width: canvas.width, height: canvas.height });
    const initialData = canvas.toDataURL();
    initializeHistory(initialData);
    // canvasRef/previewCanvasRef are stable refs and initializeHistory has a
    // stable identity (useCallback) — this still runs exactly once on mount.
  }, [canvasRef, previewCanvasRef, initializeHistory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
  }, [currentColor, brushSize, isEraser, canvasRef]);

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

    // Recalculate canvas X/Y from the input box's dragged position
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
      onCreateStickyNote({
        canvasX: finalCanvasX,
        canvasY: finalCanvasY,
        text: currentFloatingInput.text,
      });
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

    // For non-pencil tools we preview on the overlay canvas instead of
    // snapshotting main canvas. Keep existing behavior for pencil/eraser.

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
      // Preview shapes on overlay canvas so remote updates aren't lost.
      const overlay = previewCanvasRef.current;
      if (!overlay) return;
      const octx = overlay.getContext("2d");
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.save();
      octx.strokeStyle = currentColor;
      octx.lineWidth = brushSize;
      octx.lineCap = "round";
      octx.lineJoin = "round";

      if (tool === "rect") {
        octx.beginPath();
        octx.rect(startPos.x, startPos.y, offsetX - startPos.x, offsetY - startPos.y);
        octx.stroke();
      } else if (tool === "circle") {
        const radius = Math.sqrt(Math.pow(offsetX - startPos.x, 2) + Math.pow(offsetY - startPos.y, 2));
        octx.beginPath();
        octx.arc(startPos.x, startPos.y, radius, 0, 2 * Math.PI);
        octx.stroke();
      } else if (tool === "line") {
        octx.beginPath();
        octx.moveTo(startPos.x, startPos.y);
        octx.lineTo(offsetX, offsetY);
        octx.stroke();
      }
      octx.restore();
    }
  };

  const stopDrawing = ({ nativeEvent }) => {
    if (!isDrawing || tool === "text") return;

    const { offsetX, offsetY } = nativeEvent;
    // No closePath() needed — we use self-contained segments, no persistent path.
    localDrawPosRef.current = null;
    setIsDrawing(false);

    if (tool !== "pencil" && tool !== "eraser") {
      // Commit the overlay preview into the main canvas so remote events
      // are preserved independently and we do not accidentally erase them.
      const overlay = previewCanvasRef.current;
      if (overlay) {
        const main = canvasRef.current;
        const mctx = main.getContext("2d");
        mctx.drawImage(overlay, 0, 0);
        // clear overlay
        const octx = overlay.getContext("2d");
        octx.clearRect(0, 0, overlay.width, overlay.height);
      }

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

  return {
    canvasSize,
    floatingInput,
    setFloatingInput,
    isDraggingText,
    currentColor,
    handleTextDragStart,
    handleFloatingSubmit,
    startDrawing,
    draw,
    stopDrawing,
    handleMouseLeave,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
};
