const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
// Frontend Vite ka default port 5173 hota hai, usko allow kar rahe hain
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", 
    methods: ["GET", "POST"],
  },
});

// Jab bhi koi user connect hoga, ye chalega
// backend/index.js

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  io.emit("user-count", io.engine.clientsCount);

  // 1. Jab koi user drawing shuru kare
  socket.on("start-draw", (data) => {
    socket.broadcast.emit("start-draw", data); // Dusro ko bhejo
  });

  // 2. Jab user mouse move karke draw kar raha ho
  socket.on("drawing", (data) => {
    socket.broadcast.emit("drawing", data); // Dusro ko bhejo
  });

  // 3. Jab user drawing band kare
  socket.on("stop-draw", () => {
    socket.broadcast.emit("stop-draw"); // Dusro ko bhejo
  });

 socket.on("clear", () => {
    // io.emit sabko message bhejta hai (jisne bheja usko bhi!)
    io.emit("clear"); 
  });

  socket.on("disconnect", () => {
    console.log(`User Disconnected: ${socket.id}`);
    io.emit("user-count", io.engine.clientsCount);
  });
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});