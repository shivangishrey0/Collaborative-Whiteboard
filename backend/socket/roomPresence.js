const activeRooms = new Map();

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
  }
};

const getUsersInRoom = (roomId) => {
  const roomUsers = activeRooms.get(roomId);
  if (!roomUsers) return [];
  return [...roomUsers.values()];
};

const getRoomUserCount = (roomId) => getUsersInRoom(roomId).length;

module.exports = {
  addUserToRoom,
  removeUserFromRoom,
  getUsersInRoom,
  getRoomUserCount,
};
