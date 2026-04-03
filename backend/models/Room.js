const mongoose = require("mongoose");

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
