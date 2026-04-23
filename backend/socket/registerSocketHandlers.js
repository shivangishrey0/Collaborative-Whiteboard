const {
  addUserToRoom,
  removeUserFromRoom,
  getUsersInRoom,
  getRoomUserCount,
} = require("./roomPresence");

const createCursorColor = () => `hsl(${Math.floor(Math.random() * 360)}, 75%, 45%)`;

const sanitizeUserName = (value) => {
  if (typeof value !== "string") return "Guest";
  const trimmed = value.trim().slice(0, 24);
  return trimmed || "Guest";
};

const emitActiveUsers = (io, roomId) => {
  io.to(roomId).emit("active-users", getUsersInRoom(roomId));
};

const updateRoomUserStats = async (Room, roomId) => {
  const currentUsers = getRoomUserCount(roomId);
  await Room.updateOne(
    { roomId },
    {
      $set: { currentUsers, lastActiveAt: new Date() },
      $max: { peakUsers: currentUsers },
    }
  );

  return currentUsers;
};

const emitStickyNotesState = (io, roomId, stickyNotes = []) => {
  io.to(roomId).emit("sticky-notes-state", stickyNotes);
};

const emitDrawingActionsState = (io, roomId, drawingActions = []) => {
  io.to(roomId).emit("drawing-actions-state", drawingActions);
};

const syncStickyNotesToRoom = async (Room, roomId, updater) => {
  const room = await Room.findOne({ roomId }).select("stickyNotes");
  if (!room) return null;

  const nextStickyNotes = updater(Array.isArray(room.stickyNotes) ? room.stickyNotes : []);
  room.stickyNotes = nextStickyNotes;
  await room.save();
  return nextStickyNotes;
};

const syncDrawingActionsToRoom = async (Room, roomId, action) => {
  const room = await Room.findOne({ roomId }).select("drawingActions");
  if (!room) return null;

  const existingActions = Array.isArray(room.drawingActions) ? room.drawingActions : [];
  const nextActions = [...existingActions, action].slice(-250);
  room.drawingActions = nextActions;
  await room.save();
  return nextActions;
};

const registerSocketHandlers = ({ io, Room, isRoomExpired }) => {
  io.on("connection", async (socket) => {
    try {
      const roomId = socket.handshake.auth?.roomId;
      const userName = sanitizeUserName(socket.handshake.auth?.userName);

      if (!roomId) {
        socket.emit("room-error", "Room ID missing");
        socket.disconnect(true);
        return;
      }

      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit("room-error", "Room not found");
        socket.disconnect(true);
        return;
      }

      if (isRoomExpired(room)) {
        await Room.deleteOne({ roomId });
        socket.emit("room-error", "Room expired");
        socket.disconnect(true);
        return;
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.userName = userName;
      socket.data.cursorColor = createCursorColor();

      const userPayload = {
        userId: socket.id,
        socketId: socket.id,
        userName,
        username: userName,
        cursorColor: socket.data.cursorColor,
      };

      // Register presence and immediately fan out the full active list.
      addUserToRoom(roomId, userPayload);
      emitActiveUsers(io, roomId);

      socket.to(roomId).emit("user-joined", {
        userId: socket.id,
        socketId: socket.id,
        userName,
        username: userName,
      });

      socket.emit("board-state", { snapshot: room.lastSnapshot || null });
      socket.emit("sticky-notes-state", Array.isArray(room.stickyNotes) ? room.stickyNotes : []);
      socket.emit("drawing-actions-state", Array.isArray(room.drawingActions) ? room.drawingActions : []);

      const currentUsers = await updateRoomUserStats(Room, roomId);
      io.to(roomId).emit("user-count", currentUsers);

      socket.on("start-draw", (payload) => {
        // Forward drawing packets only to room peers, never back to sender.
        socket.to(roomId).emit("start-draw", {
          ...payload,
          userName: socket.data.userName,
          socketId: socket.id,
        });

        syncDrawingActionsToRoom(Room, roomId, {
          id: `${socket.id}-${Date.now()}-start`,
          type: "start-draw",
          userId: socket.id,
          userName: socket.data.userName,
          payload: { ...payload },
        })
          .then((nextActions) => emitDrawingActionsState(io, roomId, nextActions || []))
          .catch((error) => console.error("Failed to persist start-draw action:", error.message));
      });

      socket.on("drawing", (payload) => {
        socket.to(roomId).emit("drawing", {
          ...payload,
          userName: socket.data.userName,
          socketId: socket.id,
        });

        syncDrawingActionsToRoom(Room, roomId, {
          id: `${socket.id}-${Date.now()}-draw`,
          type: "drawing",
          userId: socket.id,
          userName: socket.data.userName,
          payload: { ...payload },
        })
          .then((nextActions) => emitDrawingActionsState(io, roomId, nextActions || []))
          .catch((error) => console.error("Failed to persist drawing action:", error.message));
      });

      socket.on("stop-draw", () => {
        socket.to(roomId).emit("stop-draw", {
          userName: socket.data.userName,
          socketId: socket.id,
        });

        syncDrawingActionsToRoom(Room, roomId, {
          id: `${socket.id}-${Date.now()}-stop`,
          type: "stop-draw",
          userId: socket.id,
          userName: socket.data.userName,
          payload: {},
        })
          .then((nextActions) => emitDrawingActionsState(io, roomId, nextActions || []))
          .catch((error) => console.error("Failed to persist stop-draw action:", error.message));
      });

      socket.on("clear", async () => {
        io.to(roomId).emit("clear");
        await Room.updateOne({ roomId }, { $set: { lastSnapshot: "", stickyNotes: [], drawingActions: [], lastActiveAt: new Date() } });
        emitStickyNotesState(io, roomId, []);
        emitDrawingActionsState(io, roomId, []);
      });

      socket.on("draw-shape", (payload) => {
        socket.to(roomId).emit("draw-shape", {
          ...payload,
          userName: socket.data.userName,
          socketId: socket.id,
        });

        syncDrawingActionsToRoom(Room, roomId, {
          id: `${socket.id}-${Date.now()}-${payload?.tool || "shape"}`,
          type: "draw-shape",
          userId: socket.id,
          userName: socket.data.userName,
          payload: { ...payload },
        })
          .then((nextActions) => emitDrawingActionsState(io, roomId, nextActions || []))
          .catch((error) => console.error("Failed to persist draw-shape action:", error.message));
      });

      socket.on("sticky-note-create", (payload) => {
        if (!payload || typeof payload !== "object") return;
        const notePayload = {
          id: payload.id,
          x: payload.x,
          y: payload.y,
          xRatio: payload.xRatio,
          yRatio: payload.yRatio,
          text: payload.text,
        };

        if (!notePayload.id) return;

        syncStickyNotesToRoom(Room, roomId, (stickyNotes) => {
          const withoutDuplicate = stickyNotes.filter((item) => item.id !== notePayload.id);
          return [
            ...withoutDuplicate,
            {
              ...notePayload,
              createdBy: socket.id,
              updatedBy: socket.id,
              updatedAt: new Date(),
            },
          ];
        })
          .then(() => {
            socket.to(roomId).emit("sticky-note-create", {
              ...notePayload,
              userName: socket.data.userName,
              socketId: socket.id,
            });
          })
          .catch((error) => {
            console.error("Failed to persist sticky note create:", error.message);
          });
      });

      socket.on("sticky-note-update", (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (!payload.id) return;

        const notePayload = { id: payload.id };
        if (typeof payload.x === "number") notePayload.x = payload.x;
        if (typeof payload.y === "number") notePayload.y = payload.y;
        if (typeof payload.xRatio === "number") notePayload.xRatio = payload.xRatio;
        if (typeof payload.yRatio === "number") notePayload.yRatio = payload.yRatio;
        if (typeof payload.text === "string") notePayload.text = payload.text;

        syncStickyNotesToRoom(Room, roomId, (stickyNotes) =>
          stickyNotes.map((item) =>
            item.id === notePayload.id
              ? {
                  ...item,
                  ...notePayload,
                  updatedBy: socket.id,
                  updatedAt: new Date(),
                }
              : item
          )
        )
          .then(() => {
            socket.to(roomId).emit("sticky-note-update", {
              ...notePayload,
              userName: socket.data.userName,
              socketId: socket.id,
            });
          })
          .catch((error) => {
            console.error("Failed to persist sticky note update:", error.message);
          });
      });

      socket.on("sticky-note-delete", ({ id }) => {
        if (!id) return;
        syncStickyNotesToRoom(Room, roomId, (stickyNotes) => stickyNotes.filter((item) => item.id !== id))
          .then(() => {
            socket.to(roomId).emit("sticky-note-delete", {
              id,
              userName: socket.data.userName,
              socketId: socket.id,
            });
          })
          .catch((error) => {
            console.error("Failed to persist sticky note delete:", error.message);
          });
      });

      socket.on("save-snapshot", async ({ snapshot }) => {
        if (!snapshot || typeof snapshot !== "string") return;
        await Room.updateOne(
          { roomId },
          { $set: { lastSnapshot: snapshot, lastActiveAt: new Date() } }
        );
      });

      socket.on("cursor-move", ({ x, y, xRatio, yRatio }) => {
        const resolvedX = typeof x === "number" ? x : xRatio;
        const resolvedY = typeof y === "number" ? y : yRatio;

        if (typeof resolvedX !== "number" || typeof resolvedY !== "number") return;
        if (resolvedX < 0 || resolvedX > 1 || resolvedY < 0 || resolvedY > 1) return;

        socket.to(roomId).emit("cursor-move", {
          userId: socket.id,
          socketId: socket.id,
          username: socket.data.userName || "Guest",
          userName: socket.data.userName || "Guest",
          cursorColor: socket.data.cursorColor || "#1f78ff",
          x: resolvedX,
          y: resolvedY,
          xRatio: resolvedX,
          yRatio: resolvedY,
        });
      });

      socket.on("cursor-leave", () => {
        socket.to(roomId).emit("cursor-leave", { userId: socket.id, socketId: socket.id });
      });

      socket.on("disconnect", async () => {
        // Keep presence + room stats consistent on disconnect.
        removeUserFromRoom(roomId, socket.id);

        socket.to(roomId).emit("user-left", {
          userId: socket.id,
          socketId: socket.id,
          username: socket.data.userName || "Guest",
          userName: socket.data.userName || "Guest",
        });

        socket.to(roomId).emit("cursor-leave", { userId: socket.id, socketId: socket.id });
        emitActiveUsers(io, roomId);

        try {
          const remainingUsers = await updateRoomUserStats(Room, roomId);
          io.to(roomId).emit("user-count", remainingUsers);
        } catch (updateError) {
          console.error("Failed to update room user count:", updateError.message);
        }
      });
    } catch (error) {
      console.error("Socket connection error:", error.message);
      socket.emit("room-error", "Room connection failed");
      socket.disconnect(true);
    }
  });
};

module.exports = { registerSocketHandlers };
