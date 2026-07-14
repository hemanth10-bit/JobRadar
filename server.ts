import express from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse/lib/pdf-parse.js");
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

import { parseResumeText, extractJobRequirements, scoreJobMatch } from "./src/lib/ai.js";
import { generateEmbedding } from "./src/lib/embeddings.ts";
import { DbService, isSupabaseConfigured, localDB, getSupabaseClient } from "./src/lib/db.js";
import { JobSourcesManager } from "./src/lib/job_sources.ts";

const app = express();
const PORT = 3000;

// Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Multer storage in memory for resume parsing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper: Gate endpoints with Bearer Token matching CRON_SECRET if required
function checkCronSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || "default_cron_secret";

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  const token = authHeader.split(" ")[1];
  if (token !== cronSecret) {
    return res.status(403).json({ error: "Invalid authorization token" });
  }
  next();
}

// ==========================================
// API ROUTES
// ==========================================

// Auth Configuration Status check (tells frontend if live Supabase is connected)
// NOTE: never send SUPABASE_SERVICE_ROLE_KEY to the client — anon key only.
app.get("/api/auth/status", (req, res) => {
  const isConfigured = isSupabaseConfigured();
  res.json({
    supabaseConfigured: isConfigured,
    supabaseUrl: process.env.NEXT_PUBLIC_SUP
