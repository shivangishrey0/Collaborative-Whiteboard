const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Room = require("./models/Room");

dotenv.config();

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

const createRoomId = () => crypto.randomBytes(12).toString("hex");

const getRoomUserCount = (roomId) => io.sockets.adapter.rooms.get(roomId)?.size || 0;

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "whiteboard-backend" });
});

app.post("/api/rooms", async (req, res) => {
  try {
    let roomId = createRoomId();

    // Retry a few times to avoid a rare ID collision.
    for (let i = 0; i < 5; i += 1) {
      const exists = await Room.exists({ roomId });
      if (!exists) break;
      roomId = createRoomId();
    }

    const room = await Room.create({ roomId });
    return res.status(201).json({
      roomId: room.roomId,
      roomLink: `${FRONTEND_URL}/?room=${room.roomId}`,
    });
  } catch (error) {
    return res.status(500).json({ message: "Room create failed", error: error.message });
  }
});

app.get("/api/rooms/:roomId", async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId }).lean();
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    return res.json({
      roomId: room.roomId,
      createdAt: room.createdAt,
      lastActiveAt: room.lastActiveAt,
      hasSnapshot: Boolean(room.lastSnapshot),
      currentUsers: room.currentUsers || 0,
      peakUsers: room.peakUsers || 0,
    });
  } catch (error) {
    return res.status(500).json({ message: "Room fetch failed", error: error.message });
  }
});

io.on("connection", async (socket) => {
  try {
    const roomId = socket.handshake.auth?.roomId;
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

    socket.join(roomId);
    socket.data.roomId = roomId;

    console.log(`User Connected: ${socket.id} -> Room: ${roomId}`);

    socket.emit("board-state", { snapshot: room.lastSnapshot || null });
    const currentUsers = getRoomUserCount(roomId);
    io.to(roomId).emit("user-count", currentUsers);
    await Room.updateOne(
      { roomId },
      {
        $set: { currentUsers, lastActiveAt: new Date() },
        $max: { peakUsers: currentUsers },
      }
    );

    socket.on("start-draw", (data) => {
      socket.to(roomId).emit("start-draw", data);
    });

    socket.on("drawing", (data) => {
      socket.to(roomId).emit("drawing", data);
    });

    socket.on("stop-draw", () => {
      socket.to(roomId).emit("stop-draw");
    });

    socket.on("clear", async () => {
      io.to(roomId).emit("clear");
      await Room.updateOne({ roomId }, { $set: { lastSnapshot: "", lastActiveAt: new Date() } });
    });

    socket.on("draw-shape", (data) => {
      socket.to(roomId).emit("draw-shape", data);
    });

    socket.on("save-snapshot", async ({ snapshot }) => {
      if (!snapshot || typeof snapshot !== "string") return;
      await Room.updateOne(
        { roomId },
        { $set: { lastSnapshot: snapshot, lastActiveAt: new Date() } }
      );
    });

    socket.on("disconnect", () => {
      console.log(`User Disconnected: ${socket.id} -> Room: ${roomId}`);
      const remainingUsers = getRoomUserCount(roomId);
      io.to(roomId).emit("user-count", remainingUsers);
      Room.updateOne(
        { roomId },
        { $set: { currentUsers: remainingUsers, lastActiveAt: new Date() } }
      ).catch((updateError) => {
        console.error("Failed to update room user count:", updateError.message);
      });
    });
  } catch (error) {
    console.error("Socket connection error:", error.message);
    socket.emit("room-error", "Room connection failed");
    socket.disconnect(true);
  }
});

const startServer = async () => {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is missing in environment variables");
    }

    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected");

    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();