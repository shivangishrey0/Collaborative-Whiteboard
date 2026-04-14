const activeRooms = new Map();
const stickyNotesByRoom = new Map();

const addUserToRoom = (roomId, user) => {
  // Keep an in-memory presence map per room for fast active user broadcasts.
  if (!activeRooms.has(roomId)) {
    activeRooms.set(roomId, new Map());
  }

  activeRooms.get(roomId).set(user.socketId, user);
};

const removeUserFromRoom = (roomId, socketId) => {
  const roomUsers = activeRooms.get(roomId);
  if (!roomUsers) return;

  roomUsers.delete(socketId);
  if (roomUsers.size === 0) {
    activeRooms.delete(roomId);
    stickyNotesByRoom.delete(roomId);
  }
};

const getUsersInRoom = (roomId) => {
  const roomUsers = activeRooms.get(roomId);
  if (!roomUsers) return [];
  return [...roomUsers.values()];
};

const getRoomUserCount = (roomId) => getUsersInRoom(roomId).length;

const upsertStickyNote = (roomId, note) => {
  if (!note?.id) return;

  if (!stickyNotesByRoom.has(roomId)) {
    stickyNotesByRoom.set(roomId, new Map());
  }

  const roomNotes = stickyNotesByRoom.get(roomId);
  const existing = roomNotes.get(note.id) || {};
  roomNotes.set(note.id, { ...existing, ...note });
};

const deleteStickyNote = (roomId, noteId) => {
  const roomNotes = stickyNotesByRoom.get(roomId);
  if (!roomNotes) return;

  roomNotes.delete(noteId);
};

const getStickyNotes = (roomId) => {
  const roomNotes = stickyNotesByRoom.get(roomId);
  if (!roomNotes) return [];
  return [...roomNotes.values()];
};

const clearStickyNotes = (roomId) => {
  stickyNotesByRoom.delete(roomId);
};

module.exports = {
  addUserToRoom,
  removeUserFromRoom,
  getUsersInRoom,
  getRoomUserCount,
  upsertStickyNote,
  deleteStickyNote,
  getStickyNotes,
  clearStickyNotes,
};
