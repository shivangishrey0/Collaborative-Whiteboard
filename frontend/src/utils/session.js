const ACTIVE_SESSION_KEY = "whiteboard_active_session";

// Remembers which room + name this browser last joined, so a refresh can
// auto-rejoin instead of dropping back to the landing screen.
export const getStoredActiveSession = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.roomId || !parsed?.userName) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveActiveSession = (roomId, userName) => {
  localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ roomId, userName }));
};

export const clearActiveSession = () => {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
};

export const fetchRoomInfo = async (backendUrl, roomId) => {
  const response = await fetch(`${backendUrl}/api/rooms/${roomId}`);
  if (!response.ok) {
    throw new Error("Room not found. Check room link/ID.");
  }
  return response.json();
};
