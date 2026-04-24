import mongoose from "mongoose";

declare global {
  var _mongoConn: Promise<typeof mongoose> | undefined;
}

export async function connectDb(): Promise<typeof mongoose | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  if (!global._mongoConn) {
    global._mongoConn = mongoose.connect(uri, { bufferCommands: false });
  }
  return global._mongoConn;
}

export function isMongoConfigured(): boolean {
  return !!process.env.MONGODB_URI;
}
