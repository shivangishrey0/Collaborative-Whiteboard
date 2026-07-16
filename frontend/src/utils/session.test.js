import { describe, it, expect, beforeEach } from "vitest";
import { getStoredActiveSession, saveActiveSession, clearActiveSession } from "./session";

describe("active session persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(getStoredActiveSession()).toBeNull();
  });

  it("round-trips a saved session", () => {
    saveActiveSession("room-123", "Alice");
    expect(getStoredActiveSession()).toEqual({ roomId: "room-123", userName: "Alice" });
  });

  it("clears a stored session", () => {
    saveActiveSession("room-123", "Alice");
    clearActiveSession();
    expect(getStoredActiveSession()).toBeNull();
  });

  it("returns null instead of throwing on malformed stored JSON", () => {
    localStorage.setItem("whiteboard_active_session", "{not valid json");
    expect(getStoredActiveSession()).toBeNull();
  });

  it("returns null when the stored value is missing required fields", () => {
    localStorage.setItem("whiteboard_active_session", JSON.stringify({ roomId: "room-123" }));
    expect(getStoredActiveSession()).toBeNull();
  });
});
