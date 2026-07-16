import { describe, it, expect } from "vitest";

const {
  roomIdParamSchema,
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

const VALID_ROOM_ID = "a".repeat(24);

describe("roomIdParamSchema", () => {
  it("accepts a 24-character lowercase hex string", () => {
    expect(roomIdParamSchema.safeParse(VALID_ROOM_ID).success).toBe(true);
  });

  it.each([
    ["too short", "abc123"],
    ["uppercase", "A".repeat(24)],
    ["wrong characters", "z".repeat(24)],
    ["not a string", 12345],
  ])("rejects %s", (_label, value) => {
    expect(roomIdParamSchema.safeParse(value).success).toBe(false);
  });
});

describe("socketAuthSchema", () => {
  it("accepts a valid roomId", () => {
    expect(validateOrNull(socketAuthSchema, { roomId: VALID_ROOM_ID })).toEqual({ roomId: VALID_ROOM_ID });
  });

  it("rejects a missing or malformed roomId", () => {
    expect(validateOrNull(socketAuthSchema, {})).toBeNull();
    expect(validateOrNull(socketAuthSchema, { roomId: "not-hex" })).toBeNull();
    expect(validateOrNull(socketAuthSchema, null)).toBeNull();
  });
});

describe("drawEventSchema", () => {
  const validPayload = { x: 10, y: 20, color: "#000000", size: 5, isEraser: false, tool: "pencil" };

  it("accepts a well-formed drawing event", () => {
    expect(validateOrNull(drawEventSchema, validPayload)).toEqual(validPayload);
  });

  it("rejects an unknown tool", () => {
    expect(validateOrNull(drawEventSchema, { ...validPayload, tool: "flamethrower" })).toBeNull();
  });

  it("rejects non-finite coordinates", () => {
    expect(validateOrNull(drawEventSchema, { ...validPayload, x: Infinity })).toBeNull();
  });

  it("rejects a missing required field", () => {
    const { color, ...withoutColor } = validPayload;
    expect(validateOrNull(drawEventSchema, withoutColor)).toBeNull();
  });
});

describe("drawShapeSchema", () => {
  it("accepts a shape without endX/endY (e.g. placed text)", () => {
    const payload = { startX: 0, startY: 0, tool: "text", color: "#000", size: 15, text: "hello" };
    expect(validateOrNull(drawShapeSchema, payload)).toEqual(payload);
  });

  it("rejects text longer than the max length", () => {
    const payload = { startX: 0, startY: 0, tool: "text", color: "#000", size: 15, text: "x".repeat(5001) };
    expect(validateOrNull(drawShapeSchema, payload)).toBeNull();
  });
});

describe("stickyCreateSchema / stickyUpdateSchema / stickyDeleteSchema", () => {
  it("accepts a sticky note create with ratio coordinates", () => {
    const payload = { id: "note-1", xRatio: 0.5, yRatio: 0.25, text: "hi" };
    expect(validateOrNull(stickyCreateSchema, payload)).toEqual(payload);
  });

  it("rejects a ratio outside [0, 1]", () => {
    expect(validateOrNull(stickyCreateSchema, { id: "note-1", xRatio: 1.5 })).toBeNull();
  });

  it("accepts a partial update with just id + text", () => {
    expect(validateOrNull(stickyUpdateSchema, { id: "note-1", text: "updated" })).toEqual({ id: "note-1", text: "updated" });
  });

  it("rejects delete without an id", () => {
    expect(validateOrNull(stickyDeleteSchema, {})).toBeNull();
  });
});

describe("saveSnapshotSchema", () => {
  it("accepts a non-empty snapshot string", () => {
    expect(validateOrNull(saveSnapshotSchema, { snapshot: "data:image/png;base64,abc" })).toEqual({
      snapshot: "data:image/png;base64,abc",
    });
  });

  it("rejects an empty snapshot", () => {
    expect(validateOrNull(saveSnapshotSchema, { snapshot: "" })).toBeNull();
  });
});

describe("cursorMoveSchema", () => {
  it("accepts ratio coordinates within [0, 1]", () => {
    expect(validateOrNull(cursorMoveSchema, { xRatio: 0.5, yRatio: 0.5 })).toEqual({ xRatio: 0.5, yRatio: 0.5 });
  });

  it("rejects an out-of-range coordinate", () => {
    expect(validateOrNull(cursorMoveSchema, { xRatio: 1.2, yRatio: 0.5 })).toBeNull();
  });
});
