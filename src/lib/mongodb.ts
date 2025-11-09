import mongoose from "mongoose";

const uri = process.env.MONGO_URI || "";

if (!uri) {
  throw new Error("Please add your Mongo URI to .env.local");
}

let isConnected = false;

export const connectDB = async () => {
  if (isConnected) return;

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 20000, // 20s
      ssl: true,
      tlsAllowInvalidCertificates: false,
    });
    isConnected = !!conn.connections[0].readyState;
    console.log("✅ MongoDB Connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw new Error("MongoDB connection failed");
  }
};
