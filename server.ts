import express from "express";
import path from "path";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse/lib/pdf-parse.js");
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

import { parseResumeText, extractJobRequirements, scoreJobMatch } from "./src/lib/ai.js";
import { generateEmbedding } from "./src/lib/embeddings.js";
import { DbService, isSupabaseConfigured, localDB, getSupabaseClient } from "./src/lib/db.js";
import { JobSourcesManager } from "./src/lib/job_sources.js";

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
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    demoMode: !isConfigured || !process.env.GEMINI_API_KEY,
    message: isConfigured
      ? "Supabase connected. Live database and auth active."
      : "Running in Sandbox Demo Mode with persistent mock storage."
  });
});

// Resume parser route (pdf-parse + Gemini extraction)
app.post("/api/resume/parse", upload.single("resume"), async (req: any, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    let rawText = "";

    const isPdf = req.file.mimetype === "application/pdf" ||
                  (req.file.originalname && req.file.originalname.toLowerCase().endsWith(".pdf"));

    if (isPdf) {
      const parsedData = await pdf(req.file.buffer);
      rawText = parsedData.text || "";
    } else {
      rawText = req.file.buffer.toString("utf-8");
    }

    if (!rawText.trim()) {
      return res.status(400).json({ error: "Failed to extract text from resume. Ensure the file is not empty or protected." });
    }

    const parsedJson = await parseResumeText(rawText);
    res.json({ success: true, text: rawText.substring(0, 500), parsed: parsedJson });
  } catch (err: any) {
    console.error("Resume parsing failure:", err);
    res.status(500).json({ error: err.message || "Internal server error during resume parsing" });
  }
});

// Confirm resume route (generate embedding + trigger pipeline)
app.post("/api/resume/confirm", async (req, res) => {
  const { userId, parsedResume, rawFileUrl } = req.body;
  if (!userId || !parsedResume) {
    return res.status(400).json({ error: "Missing userId or parsedResume data" });
  }

  try {
    let embedding: number[] | undefined;
    try {
      const textToEmbed = `${parsedResume.titles.join(", ")} ${parsedResume.skills.join(", ")} ${parsedResume.tools.join(", ")}`;
      embedding = await generateEmbedding(textToEmbed);
    } catch (embErr) {
      console.warn("Failed to generate resume embedding, continuing with mock.", embErr);
    }

    const activeResume = await DbService.getActiveResume(userId);
    const nextVersion = activeResume ? activeResume.version + 1 : 1;

    const savedResume = await DbService.insertResume({
      user_id: userId,
      raw_file_url: rawFileUrl || "uploaded_file.pdf",
      parsed_json: parsedResume,
      version: nextVersion,
      is_active: true,
      embedding
    });

    const profile = await DbService.getProfile(userId);
    const country = profile?.preferred_country || "us";

    await runJobMatchingPipelineForUser(userId, parsedResume, embedding || [], country, nextVersion);

    res.json({ success: true, resume: savedResume });
  } catch (err: any) {
    console.error("Confirm resume error:", err);
    res.status(500).json({ error: err.message || "Failed to confirm and save resume" });
  }
});

// Get all resumes for a user
app.get("/api/resumes/:userId", async (req, res) => {
  try {
    const resumes = await DbService.getResumes(req.params.userId);
    res.json(resumes);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to retrieve resumes" });
  }
});

// Activate a specific resume
app.post("/api/resume/activate", async (req, res) => {
  const { userId, resumeId } = req.body;
  if (!userId || !resumeId) {
    return res.status(400).json({ error: "Missing userId or resumeId" });
  }
  try {
    const activeResume = await DbService.activateResume(userId, resumeId);
    res.json({ success: true, resume: activeResume });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to activate resume" });
  }
});

// Update an existing resume's parsed details
app.post("/api/resume/update", async (req, res) => {
  const { userId, resumeId, parsedResume } = req.body;
  if (!userId || !resumeId || !parsedResume) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    let embedding: number[] | undefined;
    try {
      const textToEmbed = `${parsedResume.titles.join(", ")} ${parsedResume.skills.join(", ")} ${parsedResume.tools.join(", ")}`;
      embedding = await generateEmbedding(textToEmbed);
    } catch (embErr) {
      console.warn("Failed to generate resume embedding, continuing with mock.", embErr);
    }

    const updatePayload: any = {
      parsed_json: parsedResume
    };
    if (embedding) {
      updatePayload.embedding = embedding;
    }

    const updatedResume = await DbService.updateResumeFields(resumeId, updatePayload);

    const profile = await DbService.getProfile(userId);
    const country = profile?.preferred_country || "us";

    await runJobMatchingPipelineForUser(userId, parsedResume, embedding || [], country, updatedResume.version);

    res.json({ success: true, resume: updatedResume });
  } catch (err: any) {
    console.error("Update resume error:", err);
    res.status(500).json({ error: err.message || "Failed to update resume" });
  }
});

// Trigger matching pipeline manually
app.post("/api/pipeline/search-match", async (req, res) => {
  const { userId, country, bypassCronCheck } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  if (!bypassCronCheck) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(" ")[1];
      if (token !== (process.env.CRON_SECRET || "default_cron_secret")) {
        return res.status(403).json({ error: "Unauthorized manual pipeline trigger" });
      }
    }
  }

  try {
    const activeResume = await DbService.getActiveResume(userId);
    if (!activeResume) {
      return res.status(400).json({ error: "No active resume found for user. Please upload a resume first." });
    }

    await DbService.upsertProfile({
      user_id: userId,
      email: req.body.email || "user@example.com",
      preferred_country: country || "us"
    });

    let resumeEmbedding = (activeResume as any).embedding;
    if (!resumeEmbedding || resumeEmbedding.length === 0) {
      const textToEmbed = `${activeResume.parsed_json.titles.join(", ")} ${activeResume.parsed_json.skills.join(", ")} ${activeResume.parsed_json.tools.join(", ")}`;
      resumeEmbedding = await generateEmbedding(textToEmbed);
      await DbService.updateJobFields(activeResume.id, { embedding: resumeEmbedding });
    }

    const targetCountry = country || "us";
    await runJobMatchingPipelineForUser(userId, activeResume.parsed_json, resumeEmbedding, targetCountry, activeResume.version);

    const matches = await DbService.getJobMatches(userId);
    res.json({ success: true, matches });
  } catch (err: any) {
    console.error("Pipeline run failed:", err);
    res.status(500).json({ error: err.message || "Pipeline run failed" });
  }
});

// Profile endpoints
app.get("/api/profile/:userId", async (req, res) => {
  try {
    const profile = await DbService.getProfile(req.params.userId);
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/profile", async (req, res) => {
  try {
    const profile = await DbService.upsertProfile(req.body);
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Matches endpoints
app.get("/api/matches/:userId", async (req, res) => {
  try {
    const matches = await DbService.getJobMatches(req.params.userId);
    res.json(matches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/matches/:matchId", async (req, res) => {
  const { userId, status } = req.body;
  if (!userId || !status) {
    return res.status(400).json({ error: "Missing userId or status" });
  }

  try {
    await DbService.updateJobMatchStatus(userId, req.params.matchId, status);

    if (status === "applied") {
      const matches = await DbService.getJobMatches(userId);
      const matchedRecord = matches.find(m => m.id === req.params.matchId);
      if (matchedRecord) {
        await DbService.insertApplicationHistory({
          user_id: userId,
          job_id: matchedRecord.job_id,
          applied_at: new Date().toISOString(),
          outcome: "pending",
          notes: "Applied via JobRadar dashboard matching card."
        });
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Application History endpoints
app.get("/api/history/:userId", async (req, res) => {
  try {
    const history = await DbService.getApplicationHistory(req.params.userId);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cron Daily Pipeline
app.post("/api/cron/daily", checkCronSecret, async (req, res) => {
  console.log("Daily Cron trigger started...");
  try {
    let profilesList = [];

    if (isSupabaseConfigured()) {
      const supabase = getSupabaseClient();
      const { data } = await supabase.from("profiles").select("*");
      profilesList = data || [];
    } else {
      profilesList = localDB.profiles;
    }

    console.log(`Processing daily refresh for ${profilesList.length} user profiles...`);

    for (const profile of profilesList) {
      try {
        const activeResume = await DbService.getActiveResume(profile.user_id);
        if (activeResume) {
          let resumeEmbedding = (activeResume as any).embedding;
          if (!resumeEmbedding || resumeEmbedding.length === 0) {
            const textToEmbed = `${activeResume.parsed_json.titles.join(", ")} ${activeResume.parsed_json.skills.join(", ")} ${activeResume.parsed_json.tools.join(", ")}`;
            resumeEmbedding = await generateEmbedding(textToEmbed);
          }

          await runJobMatchingPipelineForUser(
            profile.user_id,
            activeResume.parsed_json,
            resumeEmbedding,
            profile.preferred_country || "us",
            activeResume.version
          );
        }
      } catch (userErr) {
        console.error(`Failed daily cron match for user ${profile.user_id}:`, userErr);
      }
    }

    res.json({ success: true, processed_count: profilesList.length });
  } catch (err: any) {
    console.error("Cron daily route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// CENTRAL JOB MATCHING PIPELINE WORKFLOW
// ==========================================
async function runJobMatchingPipelineForUser(
  userId: string,
  parsedResume: any,
  resumeEmbedding: number[],
  country: string,
  resumeVersion: number
) {
  console.log(`Running pipeline for user: ${userId} (${country})`);

  const manager = new JobSourcesManager();
  const searchQueries = parsedResume.titles.length > 0 ? parsedResume.titles.slice(0, 2) : ["Software Engineer"];

  const fetchedJobsList = [];
  for (const q of searchQueries) {
    try {
      const jobs = await manager.fetchAll(q, country);
      fetchedJobsList.push(...jobs);
    } catch (fetchErr) {
      console.warn(`Failed to fetch jobs for query '${q}':`, fetchErr);
    }
  }

  const seenIds = new Set<string>();
  const uniqueJobs = fetchedJobsList.filter(j => {
    const key = `${j.source_id}:${j.external_job_id}`;
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  });

  if (uniqueJobs.length === 0) {
    console.log("No new jobs found for user criteria.");
    return;
  }

  const savedJobs = await DbService.upsertJobs(uniqueJobs);
  console.log(`Ingested ${savedJobs.length} unique jobs into the database.`);

  for (const job of savedJobs) {
    try {
      let needsUpdate = false;
      const updatePayload: any = {};

      const jobWithEmbedding = job as any;
      if (!jobWithEmbedding.embedding || jobWithEmbedding.embedding.length === 0) {
        const textToEmbed = `${job.title} at ${job.company}. ${job.location}. ${job.description}`;
        try {
          const emb = await generateEmbedding(textToEmbed);
          updatePayload.embedding = emb;
          needsUpdate = true;
        } catch (embErr) {
          console.error(`Embedding generation failed for job ${job.id}:`, embErr);
        }
      }

      if (!job.requirements_json || Object.keys(job.requirements_json).length === 0 || !job.requirements_json.required_skills) {
        try {
          const reqs = await extractJobRequirements(job.description);
          updatePayload.requirements_json = reqs;
          needsUpdate = true;
        } catch (reqErr) {
          console.error(`Job requirements extraction failed for job ${job.id}:`, reqErr);
        }
      }

      if (needsUpdate) {
        await DbService.updateJobFields(job.id, updatePayload);
        Object.assign(job, updatePayload);
      }
    } catch (itemErr) {
      console.error(`Error caching metadata/embedding for job ${job.id}:`, itemErr);
    }
  }

  const shortlistedJobs = await DbService.queryTopJobsForEmbedding(resumeEmbedding, country, 15);
  console.log(`Stage 1 shortlist filtered down to ${shortlistedJobs.length} jobs.`);

  for (const matchJob of shortlistedJobs) {
    try {
      let matches = [];
      if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        const { data } = await supabase
          .from("job_matches")
          .select("*")
          .eq("user_id", userId)
          .eq("job_id", matchJob.id)
          .eq("resume_version", resumeVersion);
        matches = data || [];
      } else {
        matches = localDB.jobMatches.filter(m =>
          m.user_id === userId &&
          m.job_id === matchJob.id &&
          m.resume_version === resumeVersion
        );
      }

      if (matches.length > 0 && matches[0].llm_score !== null) {
        console.log(`Match score already cached for job ${matchJob.id}. Skipping re-scoring.`);
        continue;
      }

      console.log(`Invoking Stage 2 LLM scoring for job: ${matchJob.title} at ${matchJob.company}`);
      const scoreResult = await scoreJobMatch(parsedResume, matchJob.title, matchJob.description);

      await DbService.upsertJobMatch({
        user_id: userId,
        job_id: matchJob.id,
        resume_version: resumeVersion,
        similarity_score: matchJob.similarity || 0.5,
        llm_score: scoreResult.match_score,
        score_breakdown: scoreResult.score_breakdown,
        gap_analysis: scoreResult.gap_analysis,
        resume_suggestions: scoreResult.resume_suggestions,
        status: "new"
      });
    } catch (scoreErr) {
      console.error(`Failed to score match for job ${matchJob.id}:`, scoreErr);
    }
  }
}

// ==========================================
// VITE DEV SERVER / PRODUCTION ENTRY SETUP
// (only runs standalone locally — Vercel imports `app` via api/index.ts instead)
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

// Only boot a persistent listener when NOT running on Vercel.
// On Vercel, api/index.ts imports `app` directly and Vercel handles invocation.
if (!process.env.VERCEL) {
  startServer();
}

export { app };
