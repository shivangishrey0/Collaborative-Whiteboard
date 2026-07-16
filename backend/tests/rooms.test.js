import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Must be set before requiring the app — index.js reads these at module load
// time (CORS origin, room link construction).
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
process.env.PORT = process.env.PORT || "5000";

const { app } = require("../index");
const Room = require("../models/Room");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Room.deleteMany({});
});

describe("GET /health", () => {
  it("reports ok", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "whiteboard-backend" });
  });
});

describe("POST /api/rooms", () => {
  it("creates a room with a hex roomId, a room link, and a future expiry", async () => {
    const response = await request(app).post("/api/rooms");

    expect(response.status).toBe(201);
    expect(response.body.roomId).toMatch(/^[0-9a-f]{24}$/);
    expect(response.body.roomLink).toBe(`${process.env.FRONTEND_URL}/?room=${response.body.roomId}`);
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const stored = await Room.findOne({ roomId: response.body.roomId });
    expect(stored).not.toBeNull();
  });
});

describe("GET /api/rooms/:roomId", () => {
  it("returns room info for an existing room", async () => {
    await Room.create({ roomId: "existing-room" });

    const response = await request(app).get("/api/rooms/existing-room");

    expect(response.status).toBe(200);
    expect(response.body.roomId).toBe("existing-room");
    expect(response.body.currentUsers).toBe(0);
    expect(response.body.hasSnapshot).toBe(false);
  });

  it("returns 404 for a room that doesn't exist", async () => {
    const response = await request(app).get("/api/rooms/does-not-exist");
    expect(response.status).toBe(404);
  });

  it("returns 410 and deletes the room once it has expired", async () => {
    await Room.create({ roomId: "expired-room", expiresAt: new Date(Date.now() - 1000) });

    const response = await request(app).get("/api/rooms/expired-room");
    expect(response.status).toBe(410);

    const stored = await Room.findOne({ roomId: "expired-room" });
    expect(stored).toBeNull();
  });
});
