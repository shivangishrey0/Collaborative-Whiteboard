const {
  addUserToRoom,
  removeUserFromRoom,
  getUsersInRoom,
  getRoomUserCount,
} = require("./roomPresence");
const drawingBuffer = require("./drawingBuffer");
const {
  socketAuthSchema,
  drawEventSchema,
  drawShapeSchema,
  stickyCreateSchema,
  stickyUpdateSchema,
  stickyDeleteSchema,
  saveSnapshotSchema,
  cursorMoveSchema,
  validateOrNull,
} = require("../validation/schemas");

const MAX_DRAWING_ACTIONS = 250;

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

const syncStickyNotesToRoom = async (Room, roomId, updater) => {
  const room = await Room.findOne({ roomId }).select("stickyNotes");
  if (!room) return null;

  const nextStickyNotes = updater(Array.isArray(room.stickyNotes) ? room.stickyNotes : []);
  room.stickyNotes = nextStickyNotes;
  await room.save();
  return nextStickyNotes;
};

const registerSocketHandlers = ({ io, Room, isRoomExpired }) => {
  // Persists a batch of buffered drawing actions in a single atomic update
  // instead of one read-modify-write per mouse event (see drawingBuffer.js).
  const flushDrawingActionsForRoom = async (roomId, actions) => {
    await Room.updateOne(
      { roomId },
      {
        $push: {
          drawingActions: {
            $each: actions,
            $slice: -MAX_DRAWING_ACTIONS,
          },
        },
        $set: { lastActiveAt: new Date() },
      }
    );
  };

  io.on("connection", async (socket) => {
    try {
      const validatedAuth = validateOrNull(socketAuthSchema, socket.handshake.auth);
      const userName = sanitizeUserName(socket.handshake.auth?.userName);

      if (!validatedAuth) {
        socket.emit("room-error", "Room ID missing or invalid");
        socket.disconnect(true);
        return;
      }

      const { roomId } = validatedAuth;

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
        const validated = validateOrNull(drawEventSchema, payload);
        if (!validated) return;

        // Forward drawing packets only to room peers, never back to sender.
        socket.to(roomId).emit("start-draw", {
          ...validated,
          userName: socket.data.userName,
          socketId: socket.id,
        });

        drawingBuffer.addAction(roomId, {
          id: `${socket.id}-${Date.now()}-start`,
          type: "start-draw",
          userId: socket.id,
          userName: socket.data.userName,
          payload: validated,
        }, flushDrawingActionsForRoom);
      });

      socket.on("drawing", (payload) => {
        const validated = validateOrNull(drawEventSchema, payload);
        if (!validated) return;

        socket.to(roomId).emit("drawing", {
          ...validated,
          userName: socket.data.userName,
          socketId: socket.id,
        });

        drawingBuffer.addAction(roomId, {
          id: `${socket.id}-${Date.now()}-draw`,
          type: "drawing",
          userId: socket.id,
          userName: socket.data.userName,
          payload: validated,
        }, flushDrawingActionsForRoom);
      });

      socket.on("stop-draw", () => {
        socket.to(roomId).emit("stop-draw", {
          userName: socket.data.userName,
          socketId: socket.id,
        });

        drawingBuffer.addAction(roomId, {
          id: `${socket.id}-${Date.now()}-stop`,
          type: "stop-draw",
          userId: socket.id,
          userName: socket.data.userName,
          payload: {},
        }, flushDrawingActionsForRoom);
      });

      socket.on("clear", async () => {
        io.to(roomId).emit("clear");
        // Drop any buffered-but-unflushed actions so a stray flush can't
        // resurrect pre-clear drawing history after the reset below.
        drawingBuffer.removeRoom(roomId);
        await Room.updateOne({ roomId }, { $set: { lastSnapshot: "", stickyNotes: [], drawingActions: [], lastActiveAt: new Date() } });
        emitStickyNotesState(io, roomId, []);
      });

      socket.on("draw-shape", (payload) => {
        const validated = validateOrNull(drawShapeSchema, payload);
        if (!validated) return;

        socket.to(roomId).emit("draw-shape", {
          ...validated,
          userName: socket.data.userName,
          socketId: socket.id,
        });

        drawingBuffer.addAction(roomId, {
          id: `${socket.id}-${Date.now()}-${validated.tool || "shape"}`,
          type: "draw-shape",
          userId: socket.id,
          userName: socket.data.userName,
          payload: validated,
        }, flushDrawingActionsForRoom);
      });

      socket.on("sticky-note-create", (payload) => {
        const notePayload = validateOrNull(stickyCreateSchema, payload);
        if (!notePayload) return;

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
        const notePayload = validateOrNull(stickyUpdateSchema, payload);
        if (!notePayload) return;

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

      socket.on("sticky-note-delete", (payload) => {
        const validated = validateOrNull(stickyDeleteSchema, payload);
        if (!validated) return;
        const { id } = validated;

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

      socket.on("save-snapshot", async (payload) => {
        const validated = validateOrNull(saveSnapshotSchema, payload);
        if (!validated) return;

        await Room.updateOne(
          { roomId },
          { $set: { lastSnapshot: validated.snapshot, lastActiveAt: new Date() } }
        );
      });

      socket.on("cursor-move", (payload) => {
        const validated = validateOrNull(cursorMoveSchema, payload);
        if (!validated) return;

        const { x, y, xRatio, yRatio } = validated;
        const resolvedX = typeof x === "number" ? x : xRatio;
        const resolvedY = typeof y === "number" ? y : yRatio;

        if (typeof resolvedX !== "number" || typeof resolvedY !== "number") return;

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

          if (remainingUsers === 0) {
            // No one left to see further broadcasts — flush whatever's
            // buffered now instead of waiting for the next timer tick,
            // then drop the buffer so it doesn't sit in memory forever.
            await drawingBuffer.flushRoom(roomId, flushDrawingActionsForRoom);
            drawingBuffer.removeRoom(roomId);
          }
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
