const FLUSH_INTERVAL_MS = 800;
const FLUSH_COUNT_THRESHOLD = 20;

// roomId -> { actions: [], timer: NodeJS.Timeout | null }
const buffers = new Map();

const flushRoom = async (roomId, flushFn) => {
  const buffer = buffers.get(roomId);
  if (!buffer) return;

  if (buffer.timer) {
    clearTimeout(buffer.timer);
    buffer.timer = null;
  }

  if (buffer.actions.length === 0) return;

  const actionsToFlush = buffer.actions;
  buffer.actions = [];

  try {
    await flushFn(roomId, actionsToFlush);
  } catch (error) {
    console.error(`Failed to flush drawing actions for room ${roomId}:`, error.message);
  }
};

const scheduleFlush = (roomId, flushFn) => {
  const buffer = buffers.get(roomId);
  if (!buffer || buffer.timer) return;

  buffer.timer = setTimeout(() => {
    flushRoom(roomId, flushFn);
  }, FLUSH_INTERVAL_MS);
};

// Buffers a drawing action in memory and flushes to persistence once the
// room hits FLUSH_COUNT_THRESHOLD actions or FLUSH_INTERVAL_MS elapses,
// whichever comes first. Keeps socket broadcast (real-time sync) fully
// decoupled from persistence — callers should emit to peers before calling this.
const addAction = (roomId, action, flushFn) => {
  let buffer = buffers.get(roomId);
  if (!buffer) {
    buffer = { actions: [], timer: null };
    buffers.set(roomId, buffer);
  }

  buffer.actions.push(action);

  if (buffer.actions.length >= FLUSH_COUNT_THRESHOLD) {
    flushRoom(roomId, flushFn);
  } else {
    scheduleFlush(roomId, flushFn);
  }
};

// Cancels any pending timer and drops the in-memory buffer for a room.
// Call after flushing (e.g. on last-user-disconnect) or when the room's
// drawing history is being reset (e.g. on "clear") to avoid a stale
// flush re-adding actions after the fact.
const removeRoom = (roomId) => {
  const buffer = buffers.get(roomId);
  if (buffer?.timer) {
    clearTimeout(buffer.timer);
  }
  buffers.delete(roomId);
};

module.exports = { addAction, flushRoom, removeRoom };
