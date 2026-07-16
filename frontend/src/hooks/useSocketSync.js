import { useEffect, useRef, useState } from "react";
import { wrapText } from "../utils/wrapText";

// Helper: draw a sticky note onto a CanvasRenderingContext2D (used when
// replaying a remote "draw-shape" sticky event onto the canvas).
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

// Plays back remote drawing events onto the canvas (pencil strokes, shapes,
// clears, snapshot catch-up) and tracks remote cursor positions. Does not
// own local drawing (see useCanvasDrawing) or sticky notes (see useStickyNotes).
export const useSocketSync = ({ socket, canvasRef, restoreCanvas }) => {
  // Tracks the last known position of each remote user's drawing stroke,
  // so we can draw self-contained line segments without touching the local path.
  const remoteDrawStateRef = useRef({});
  const remoteCursorBufferRef = useRef({});
  const cursorFrameRef = useRef(null);
  const [remoteCursors, setRemoteCursors] = useState({});

  const scheduleCursorFrame = () => {
    if (cursorFrameRef.current !== null) return;
    cursorFrameRef.current = window.requestAnimationFrame(() => {
      setRemoteCursors({ ...remoteCursorBufferRef.current });
      cursorFrameRef.current = null;
    });
  };

  useEffect(() => () => {
    if (cursorFrameRef.current !== null) {
      window.cancelAnimationFrame(cursorFrameRef.current);
    }
  }, []);

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
        ctx.textBaseline = "top"; // Top-align so text position stays accurate
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
    };
    // canvasRef is a stable ref and restoreCanvas has a stable identity
    // (useCallback in useHistory) — this still only re-runs when socket changes.
  }, [socket, canvasRef, restoreCanvas]);

  return { remoteCursors };
};
