import mongoose from "mongoose";

const schema = new mongoose.Schema({
  block:             { type: String, required: true },
  streetName:        { type: String, required: true },
  town:              String,
  flatType:          { type: String, required: true },
  storeyRange:       String,
  sqm:               Number,
  resalePrice:       Number,
  pricePerSqm:       Number,
  month:             String,
  leaseCommenceYear: Number,
  remainingLease:    Number,
  location: {
    type:        { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },  // [lng, lat]
  },
});

schema.index({ location: "2dsphere" });
schema.index({ flatType: 1, month: -1 });
schema.index(
  { block: 1, streetName: 1, flatType: 1, storeyRange: 1, month: 1 },
  { unique: true }
);

export const HdbTx =
  mongoose.models.HdbTx ?? mongoose.model("HdbTx", schema);
