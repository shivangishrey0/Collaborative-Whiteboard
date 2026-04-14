const {
  addUserToRoom,
  removeUserFromRoom,
  getUsersInRoom,
  getRoomUserCount,
  upsertStickyNote,
  deleteStickyNote,
  getStickyNotes,
  clearStickyNotes,
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
      socket.emit("sticky-notes-state", getStickyNotes(roomId));

      const currentUsers = await updateRoomUserStats(Room, roomId);
      io.to(roomId).emit("user-count", currentUsers);

      socket.on("start-draw", (payload) => {
        // Forward drawing packets only to room peers, never back to sender.
        socket.to(roomId).emit("start-draw", {
          ...payload,
          userName: socket.data.userName,
          socketId: socket.id,
        });
      });

      socket.on("drawing", (payload) => {
        socket.to(roomId).emit("drawing", {
          ...payload,
          userName: socket.data.userName,
          socketId: socket.id,
        });
      });

      socket.on("stop-draw", () => {
        socket.to(roomId).emit("stop-draw", {
          userName: socket.data.userName,
          socketId: socket.id,
        });
      });

      socket.on("clear", async () => {
        io.to(roomId).emit("clear");
        clearStickyNotes(roomId);
        io.to(roomId).emit("sticky-notes-state", []);
        await Room.updateOne({ roomId }, { $set: { lastSnapshot: "", lastActiveAt: new Date() } });
      });

      socket.on("draw-shape", (payload) => {
        socket.to(roomId).emit("draw-shape", {
          ...payload,
          userName: socket.data.userName,
          socketId: socket.id,
        });
      });

      socket.on("sticky-note-create", (payload) => {
        if (!payload || typeof payload !== "object") return;
        const notePayload = {
          id: payload.id,
          x: payload.x,
          y: payload.y,
          text: payload.text,
        };

        if (!notePayload.id) return;

        upsertStickyNote(roomId, notePayload);

        io.to(roomId).emit("sticky-note-create", {
          ...notePayload,
          userName: socket.data.userName,
          socketId: socket.id,
        });
      });

      socket.on("sticky-note-update", (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (!payload.id) return;

        const notePayload = {
          id: payload.id,
          x: payload.x,
          y: payload.y,
          text: payload.text,
        };

        upsertStickyNote(roomId, notePayload);

        io.to(roomId).emit("sticky-note-update", {
          ...notePayload,
          userName: socket.data.userName,
          socketId: socket.id,
        });
      });

      socket.on("sticky-note-delete", ({ id }) => {
        if (!id) return;
        deleteStickyNote(roomId, id);

        io.to(roomId).emit("sticky-note-delete", {
          id,
          userName: socket.data.userName,
          socketId: socket.id,
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
