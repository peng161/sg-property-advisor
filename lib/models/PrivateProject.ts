import mongoose from "mongoose";

const schema = new mongoose.Schema({
  project:       { type: String, required: true, unique: true },
  street:        String,
  district:      String,
  marketSegment: { type: String, enum: ["OCR", "RCR", "CCR"] },
  tenure:        String,
  minPrice:      Number,
  maxPrice:      Number,
  medianPsm:     Number,
  txCount:       Number,
  latestDate:    String,
  minSqm:        Number,
  maxSqm:        Number,
  trend3Y:       Number,
  location: {
    type:        { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },  // [lng, lat]
  },
}, { timestamps: true });

schema.index({ location: "2dsphere" });

export const PrivateProject =
  mongoose.models.PrivateProject ??
  mongoose.model("PrivateProject", schema);
