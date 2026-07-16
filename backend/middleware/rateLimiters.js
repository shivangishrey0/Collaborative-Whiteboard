const rateLimit = require("express-rate-limit");

// Configurable via env so tests can trigger a 429 without waiting out a real
// window; production gets a generous default that won't bother real users.
const roomCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ROOM_CREATE_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many rooms created from this IP. Please try again later." },
});

// Looser — this is called on every page load for the auto-rejoin check
// (item 3), not just on explicit user action, so it needs headroom.
const roomLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.ROOM_LOOKUP_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many room lookups from this IP. Please try again later." },
});

module.exports = { roomCreateLimiter, roomLookupLimiter };
