import { useCallback, useState } from "react";

const MAX_HISTORY_STATES = 250;

// Manages the undo/redo snapshot stack for the whiteboard canvas.
// Snapshots are full-canvas PNG data URLs, capped at MAX_HISTORY_STATES.
export const useHistory = ({ canvasRef, socket }) => {
  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);

  // Stable identity (useCallback) since useCanvasDrawing/useSocketSync call
  // this from inside their own effects — an unstable reference here would
  // make those effects re-run on every render instead of once/on-socket-change.
  const restoreCanvas = useCallback((dataUrl) => {
    if (!dataUrl) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  }, [canvasRef]);

  // Seeds the history stack with the canvas's initial blank state.
  // Stable identity for the same reason as restoreCanvas above.
  const initializeHistory = useCallback((dataUrl) => {
    setHistory([dataUrl]);
    setHistoryStep(0);
  }, []);

  const pushSnapshot = () => {
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL("image/png");
    socket.emit("save-snapshot", { snapshot: dataUrl });
    const newHistory = history.slice(0, historyStep + 1);
    const nextHistory = [...newHistory, dataUrl].slice(-MAX_HISTORY_STATES);
    setHistory(nextHistory);
    setHistoryStep(nextHistory.length - 1);
  };

  const undo = () => {
    if (historyStep > 0) {
      setHistoryStep(historyStep - 1);
      restoreCanvas(history[historyStep - 1]);
    } else if (historyStep === 0) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHistoryStep(-1);
    }
  };

  const redo = () => {
    if (historyStep < history.length - 1) {
      setHistoryStep(historyStep + 1);
      restoreCanvas(history[historyStep + 1]);
    }
  };

  return { pushSnapshot, undo, redo, restoreCanvas, initializeHistory };
};
