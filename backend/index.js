const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Room = require("./models/Room");
const { registerSocketHandlers } = require("./socket/registerSocketHandlers");

dotenv.config();

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

const isLocalDevOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
const isOriginAllowed = (origin) => !origin || origin === FRONTEND_URL || isLocalDevOrigin(origin);

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS origin not allowed"));
  },
  methods: ["GET", "POST"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: corsOptions,
});

const createRoomId = () => crypto.randomBytes(12).toString("hex");

const isRoomExpired = (room) => Boolean(room?.expiresAt && new Date(room.expiresAt).getTime() <= Date.now());

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
      expiresAt: room.expiresAt,
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

    if (isRoomExpired(room)) {
      await Room.deleteOne({ roomId: req.params.roomId });
      return res.status(410).json({ message: "Room expired" });
    }

    return res.json({
      roomId: room.roomId,
      createdAt: room.createdAt,
      lastActiveAt: room.lastActiveAt,
      hasSnapshot: Boolean(room.lastSnapshot),
      currentUsers: room.currentUsers || 0,
      peakUsers: room.peakUsers || 0,
      expiresAt: room.expiresAt,
    });
  } catch (error) {
    return res.status(500).json({ message: "Room fetch failed", error: error.message });
  }
});

registerSocketHandlers({ io, Room, isRoomExpired });

const startServer = async () => {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is missing in environment variables");
    }

    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected");

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Stop the existing backend process or change PORT in .env.`);
        process.exit(1);
      }

      console.error("Server error:", error.message);
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();