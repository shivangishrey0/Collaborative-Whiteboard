import { useRef, forwardRef, useImperativeHandle } from "react";
import { useHistory } from "../hooks/useHistory";
import { useSocketSync } from "../hooks/useSocketSync";
import { useStickyNotes } from "../hooks/useStickyNotes";
import { useCanvasDrawing } from "../hooks/useCanvasDrawing";

const Board = forwardRef(({ socket, color, brushSize, tool, bgType, pendingImageData, onImagePlaced, currentUserName }, ref) => {
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);

  const stickyNotesApi = useStickyNotes({ socket, canvasRef });
  const historyApi = useHistory({ canvasRef, socket });
  const socketSync = useSocketSync({ socket, canvasRef, restoreCanvas: historyApi.restoreCanvas });
  const canvasDrawing = useCanvasDrawing({
    socket,
    tool,
    color,
    brushSize,
    pendingImageData,
    onImagePlaced,
    currentUserName,
    canvasRef,
    previewCanvasRef,
    pushSnapshot: historyApi.pushSnapshot,
    initializeHistory: historyApi.initializeHistory,
    onCreateStickyNote: stickyNotesApi.createStickyNote,
  });

  const {
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
  } = canvasDrawing;

  const { remoteCursors } = socketSync;
  const { stickyNotes, updateStickyText, deleteStickyNote, downloadStickyNote } = stickyNotesApi;

  const stickyWidth = 220;

  useImperativeHandle(ref, () => ({
    undo: historyApi.undo,
    redo: historyApi.redo,
    downloadBoard: () => {
      const canvas = canvasRef.current;
      const link = document.createElement("a");
      link.download = `whiteboard-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    }
  }));

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

        {/* Overlay canvas for previews (shapes/rect/line/circle) */}
        <canvas
          ref={previewCanvasRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            pointerEvents: "none",
            width: "100%",
            height: "100%",
          }}
        />

        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {Object.entries(remoteCursors).map(([userId, cursor]) => {
            if (!canvasSize.width || !canvasSize.height || !cursor) return null;
            const left = cursor.x * canvasSize.width;
            const top = cursor.y * canvasSize.height;

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
          {/* Drag handle */}
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
