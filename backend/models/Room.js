const mongoose = require("mongoose");

const stickyNoteSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      index: true,
    },
    x: {
      type: Number,
      required: true,
    },
    y: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      default: "",
    },
    createdBy: {
      type: String,
      default: "system",
    },
    updatedBy: {
      type: String,
      default: "system",
    },
  },
  { _id: false, timestamps: true }
);

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    createdBy: {
      type: String,
      default: "system",
    },
    lastSnapshot: {
      type: String,
      default: "",
    },
    drawingActions: {
      type: [
        new mongoose.Schema(
          {
            id: { type: String, required: true },
            type: { type: String, required: true },
            userId: { type: String, default: "" },
            userName: { type: String, default: "" },
            payload: { type: mongoose.Schema.Types.Mixed, default: {} },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    stickyNotes: {
      type: [stickyNoteSchema],
      default: [],
    },
    currentUsers: {
      type: Number,
      default: 0,
      min: 0,
    },
    peakUsers: {
      type: Number,
      default: 0,
      min: 0,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Room", roomSchema);
