import { useEffect, useRef, useState } from "react";
import { clampRatio } from "../utils/clampRatio";

const createStickyId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

// Owns sticky-note state and its own socket sync (create/update/delete/state),
// independent of the pixel-canvas drawing sync in useSocketSync.
export const useStickyNotes = ({ socket, canvasRef }) => {
  const stickySyncTimeoutsRef = useRef({});
  const [stickyNotes, setStickyNotes] = useState([]);

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

  useEffect(() => () => {
    Object.values(stickySyncTimeoutsRef.current).forEach((timeoutId) => clearTimeout(timeoutId));
  }, []);

  useEffect(() => {
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

    socket.on("sticky-note-create", handleStickyCreate);
    socket.on("sticky-note-update", handleStickyUpdate);
    socket.on("sticky-note-delete", handleStickyDelete);
    socket.on("sticky-notes-state", handleStickyState);

    return () => {
      socket.off("sticky-note-create", handleStickyCreate);
      socket.off("sticky-note-update", handleStickyUpdate);
      socket.off("sticky-note-delete", handleStickyDelete);
      socket.off("sticky-notes-state", handleStickyState);
    };
    // canvasRef is a stable ref — this still only re-runs when socket changes.
  }, [socket, canvasRef]);

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

  // Used by useCanvasDrawing's floating-input flow when the user creates a
  // sticky note by clicking the canvas — kept here so useStickyNotes stays
  // the single owner of id generation + local upsert + server emit.
  const createStickyNote = ({ canvasX, canvasY, text }) => {
    const canvas = canvasRef.current;
    const canvasWidth = canvas?.width || 1;
    const canvasHeight = canvas?.height || 1;
    const note = {
      id: createStickyId(),
      xRatio: clampRatio(Math.max(0, canvasX) / canvasWidth),
      yRatio: clampRatio(Math.max(0, canvasY) / canvasHeight),
      text,
    };

    upsertStickyNote(note);
    socket.emit("sticky-note-create", note);
  };

  return { stickyNotes, updateStickyText, deleteStickyNote, downloadStickyNote, createStickyNote };
};
