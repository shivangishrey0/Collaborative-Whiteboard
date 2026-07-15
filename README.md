# Collaborative Whiteboard

A real-time collaborative whiteboard: create a room, share the link, and draw together. Supports freehand drawing, shapes (rectangle, circle, line), text, sticky notes, image insertion, live remote cursors, undo/redo, and per-room presence — all synced instantly across every connected client.

**Live demo:**
- Frontend: https://collaborative-whiteboard-sigma-ten.vercel.app/
- Backend API: https://collaborative-whiteboard-1-dphb.onrender.com

> The backend is hosted on Render's free tier, so the first request after a period of inactivity can take 30-60s to wake up.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, HTML5 Canvas (no drawing library) |
| Real-time transport | Socket.io |
| Backend | Node.js, Express 5 |
| Database | MongoDB (Mongoose) |
| Deployment | Vercel (frontend), Render (backend) |

## Architecture

```mermaid
flowchart LR
    subgraph Client["Browser"]
        UI["App.jsx — room UI, toolbar"]
        Canvas["Board.jsx — HTML5 canvas rendering"]
        SocketClient["socket.io-client"]
    end

    subgraph Server["Node.js / Express"]
        REST["REST API — /api/rooms"]
        SocketServer["Socket.io server"]
        Presence["In-memory room presence"]
        Buffer["Drawing action buffer\n(batches writes, see below)"]
    end

    DB[("MongoDB — Room documents")]

    UI --> Canvas
    Canvas <--> SocketClient
    SocketClient <-->|WebSocket| SocketServer
    UI -->|HTTP| REST
    REST --> DB
    SocketServer --> Presence
    SocketServer --> Buffer
    Buffer -->|batched writes, every 800ms or 20 actions| DB
    SocketServer -->|snapshot + sticky notes on join| DB
```

### How a room works

1. **Create/join** — `POST /api/rooms` generates a random room ID and creates a `Room` document with a 24h TTL index (MongoDB expires it automatically). `GET /api/rooms/:roomId` is used to validate a room exists before joining.
2. **Connect** — the client opens a Socket.io connection authenticated with `{ roomId, userName }`. The server validates the room, joins the socket to a Socket.io room, and registers the user in an in-memory presence map (`roomPresence.js`) for fast active-user broadcasts.
3. **Draw** — on every stroke, the client (a) draws locally, (b) emits the event (`drawing`, `start-draw`, `stop-draw`, `draw-shape`) so the server can broadcast it to every other peer in the room **immediately**, and (c) the server also buffers the action in memory (`drawingBuffer.js`) and flushes it to MongoDB in a single batched write every 800ms or every 20 actions — whichever comes first — instead of one database write per mouse event. This keeps live sync instant while keeping database write volume bounded regardless of how fast someone draws.
4. **Catch up late joiners** — a full canvas snapshot (PNG data URL) is saved to MongoDB after each stroke and sent to anyone who joins afterward, along with the current sticky notes. This is the primary mechanism for restoring board state — the buffered drawing-action log is a secondary, replayable history of individual events.
5. **Presence & cursors** — active users, join/leave notifications, and live cursor positions are broadcast via dedicated socket events, throttled client-side to avoid flooding the socket.

## Project structure

```
backend/
  index.js                        # Express app, REST routes, Mongo connection, server bootstrap
  models/Room.js                  # Mongoose schema: room, drawing actions, sticky notes, TTL
  socket/registerSocketHandlers.js# All socket.io event handlers
  socket/roomPresence.js          # In-memory active-user tracking per room
  socket/drawingBuffer.js         # In-memory per-room drawing action buffer (batches DB writes)

frontend/
  src/App.jsx                     # Room creation/join UI, toolbar, socket lifecycle
  src/components/Board.jsx        # Canvas rendering, drawing/shape/sticky-note logic
```

## Setup & run locally

**Prerequisites:** Node.js 18+, npm, and a MongoDB instance (a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster works fine).

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env and fill in MONGO_URI (and PORT/FRONTEND_URL if not using the defaults)
npm run dev
```

Backend env vars (`backend/.env`):

| Variable | Description | Example |
|---|---|---|
| `PORT` | Port the Express/Socket.io server listens on | `5000` |
| `FRONTEND_URL` | Allowed CORS origin for the deployed frontend | `http://localhost:5173` |
| `MONGO_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster/whiteboardDB` |

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
# edit .env if your backend isn't running on the default port
npm run dev
```

Frontend env vars (`frontend/.env`):

| Variable | Description | Example |
|---|---|---|
| `VITE_BACKEND_URL` | URL of the backend API/socket server | `http://localhost:5000` |

### 3. Try it out

Open the frontend URL (default `http://localhost:5173`), create a room, then open a **second browser tab** with the same room link and draw — both tabs should update instantly. This two-tab test is also the quickest way to manually verify real-time sync after making changes to drawing or socket logic.

## Known limitations / honest trade-offs

This project is under active improvement — some intentional trade-offs and current gaps worth knowing about:

- **No authentication.** Rooms are protected only by their randomly-generated, hard-to-guess ID — there's no password or account system. Fine for a casual whiteboard link, not for sensitive content.
- **Last-write-wins conflict resolution.** Concurrent edits to the same sticky note or overlapping strokes aren't reconciled with operational transforms or CRDTs — the most recent write simply overwrites. Acceptable for a lightweight drawing tool, worth knowing about as a trade-off rather than an oversight.
- **Single-node presence.** Active-user tracking lives in an in-memory `Map` on the server process, so it doesn't yet support horizontal scaling across multiple server instances (a Redis-backed adapter is on the roadmap).
- **Automated test coverage, containerization, and CI are being actively added** — not yet complete.

## License

No license file yet — all rights reserved by default.
