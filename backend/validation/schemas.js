const { z } = require("zod");

// Matches crypto.randomBytes(12).toString("hex") — the only shape a real
// roomId can ever have, since the server is the one who generates it.
const ROOM_ID_PATTERN = /^[0-9a-f]{24}$/;

const TOOLS = ["pencil", "eraser", "rect", "circle", "line", "sticky", "image", "text"];
const MAX_TEXT_LENGTH = 5000;
const MAX_SNAPSHOT_LENGTH = 6_000_000; // generous ceiling; socket.io's own transport buffer already caps this in practice

const roomIdParamSchema = z.string().regex(ROOM_ID_PATTERN);

const socketAuthSchema = z.object({
  roomId: z.string().regex(ROOM_ID_PATTERN),
});

const coordinate = z.number().finite();

const drawEventSchema = z.object({
  x: coordinate,
  y: coordinate,
  color: z.string().min(1).max(30),
  size: z.number().finite().min(0.1).max(200),
  isEraser: z.boolean().optional(),
  tool: z.enum(TOOLS).optional(),
});

const drawShapeSchema = z.object({
  startX: coordinate,
  startY: coordinate,
  endX: coordinate.optional(),
  endY: coordinate.optional(),
  tool: z.enum(TOOLS),
  color: z.string().min(1).max(30),
  size: z.number().finite().min(0).max(5000),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
});

const stickyCreateSchema = z.object({
  id: z.string().min(1).max(100),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  xRatio: z.number().min(0).max(1).optional(),
  yRatio: z.number().min(0).max(1).optional(),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
});

const stickyUpdateSchema = z.object({
  id: z.string().min(1).max(100),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  xRatio: z.number().min(0).max(1).optional(),
  yRatio: z.number().min(0).max(1).optional(),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
});

const stickyDeleteSchema = z.object({
  id: z.string().min(1).max(100),
});

const saveSnapshotSchema = z.object({
  snapshot: z.string().min(1).max(MAX_SNAPSHOT_LENGTH),
});

const cursorMoveSchema = z.object({
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  xRatio: z.number().min(0).max(1).optional(),
  yRatio: z.number().min(0).max(1).optional(),
});

// Parses payload against schema; returns the parsed (and stripped-of-unknown-
// keys) data on success, or null on failure — callers just `return` early on null.
const validateOrNull = (schema, payload) => {
  const result = schema.safeParse(payload);
  return result.success ? result.data : null;
};

module.exports = {
  ROOM_ID_PATTERN,
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
};
