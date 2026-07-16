import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Must be set before requiring the app — index.js reads these at module load
// time (CORS origin, room link construction, rate limit thresholds).
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
process.env.PORT = process.env.PORT || "5000";
process.env.ROOM_CREATE_RATE_LIMIT_MAX = "3";

const { app } = require("../index");
const Room = require("../models/Room");

let mongoServer;

// Real, valid-format roomIds (matches the /^[0-9a-f]{24}$/ shape the server
// actually generates) — a malformed ID now gets rejected before even
// reaching the DB, so fixtures need to look like the real thing.
const EXISTING_ROOM_ID = "a".repeat(24);
const MISSING_ROOM_ID = "b".repeat(24);
const EXPIRED_ROOM_ID = "c".repeat(24);

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

  // Runs last in this describe block deliberately — it exhausts the
  // (test-only, low) rate limit budget, so it shouldn't run before the test above.
  it("returns 429 once the room-creation rate limit is exceeded", async () => {
    let sawRateLimited = false;

    for (let i = 0; i < 10 && !sawRateLimited; i += 1) {
      const response = await request(app).post("/api/rooms");
      if (response.status === 429) {
        sawRateLimited = true;
      } else {
        expect(response.status).toBe(201);
      }
    }

    expect(sawRateLimited).toBe(true);
  });
});

describe("GET /api/rooms/:roomId", () => {
  it("returns room info for an existing room", async () => {
    await Room.create({ roomId: EXISTING_ROOM_ID });

    const response = await request(app).get(`/api/rooms/${EXISTING_ROOM_ID}`);

    expect(response.status).toBe(200);
    expect(response.body.roomId).toBe(EXISTING_ROOM_ID);
    expect(response.body.currentUsers).toBe(0);
    expect(response.body.hasSnapshot).toBe(false);
  });

  it("returns 404 for a valid-format room ID that doesn't exist", async () => {
    const response = await request(app).get(`/api/rooms/${MISSING_ROOM_ID}`);
    expect(response.status).toBe(404);
  });

  it("returns 410 and deletes the room once it has expired", async () => {
    await Room.create({ roomId: EXPIRED_ROOM_ID, expiresAt: new Date(Date.now() - 1000) });

    const response = await request(app).get(`/api/rooms/${EXPIRED_ROOM_ID}`);
    expect(response.status).toBe(410);

    const stored = await Room.findOne({ roomId: EXPIRED_ROOM_ID });
    expect(stored).toBeNull();
  });

  it("returns 400 for a malformed room ID instead of hitting the database", async () => {
    const response = await request(app).get("/api/rooms/not-a-valid-room-id");
    expect(response.status).toBe(400);
  });
});
