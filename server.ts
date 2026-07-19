import express from "express";
import path from "path";
import multer from "multer";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

import { parseResumeText, extractJobRequirements, scoreJobMatch } from "./src/lib/ai.js";
import { generateEmbedding } from "./src/lib/embeddings.js";
import { DbService, isSupabaseConfigured, localDB, getSupabaseClient } from "./src/lib/db.js";
import { JobSourcesManager } from "./src/lib/job_sources.js";
import { resolveUserId, asyncHandler } from "./src/lib/auth.js";
import { parseResumeDeterministic, parseJobRequirementsDeterministic } from "./src/lib/deterministic_parser.js";

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

// Resume parser route (unpdf + Gemini extraction)
app.post("/api/resume/parse", upload.single("resume"), async (req: any, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    let rawText = "";

    const isPdf = req.file.mimetype === "application/pdf" ||
                  (req.file.originalname && req.file.originalname.toLowerCase().endsWith(".pdf"));

    if (isPdf) {
      // Loaded lazily (not at module top-level) so a failure to load this
      // dependency only fails this one request instead of crashing the whole
      // serverless function on cold start. unpdf ships a serverless-safe
      // PDF.js build with no native/canvas dependency for plain text extraction.
      let getDocumentProxy: typeof import("unpdf").getDocumentProxy;
      let extractText: typeof import("unpdf").extractText;
      try {
        ({ getDocumentProxy, extractText } = await import("unpdf"));
      } catch (loadErr: any) {
        console.error("Failed to load unpdf module:", loadErr);
        return res.status(503).json({ error: "PDF parsing is temporarily unavailable. Try uploading a .txt/.docx version, or contact support." });
      }

      const pdfDoc = await getDocumentProxy(new Uint8Array(req.file.buffer));
      const { text } = await extractText(pdfDoc, { mergePages: true });
      rawText = text || "";
    } else {
      rawText = req.file.buffer.toString("utf-8");
    }

    if (!rawText.trim()) {
      return res.status(400).json({ error: "Failed to extract text from resume. Ensure the file is not empty or protected." });
    }

    // Try free deterministic parsing (regex + skill dictionary) first — it's
    // instant, has no external dependency, and covers the common case well.
    // Only fall back to the LLM when its result looks low-confidence (sparse
    // matches, unusual formatting), which keeps Gemini calls — and exposure
    // to its rate limits/outages — to a fraction of uploads.
    const deterministic = parseResumeDeterministic(rawText);
    const parsedJson = deterministic.confident
      ? deterministic.data
      : await parseResumeText(rawText);

    res.json({ success: true, text: rawText.substring(0, 500), parsed: parsedJson });
  } catch (err: any) {
    console.error("Resume parsing failure:", err);
    res.status(500).json({ error: err.message || "Internal server error during resume parsing" });
  }
});

// Confirm resume route (save only — job search is a separate, explicit action
// via /api/pipeline/search-match, which lazily generates the embedding itself
// if one isn't cached yet)
app.post("/api/resume/confirm", asyncHandler(async (req, res) => {
  const { parsedResume, rawFileUrl } = req.body;
  if (!parsedResume) {
    return res.status(400).json({ error: "Missing parsedResume data" });
  }
  const userId = await resolveUserId(req, req.body.userId);

  try {
    const activeResume = await DbService.getActiveResume(userId);
    const nextVersion = activeResume ? activeResume.version + 1 : 1;

    const savedResume = await DbService.insertResume({
      user_id: userId,
      raw_file_url: rawFileUrl || "uploaded_file.pdf",
      parsed_json: parsedResume,
      version: nextVersion,
      is_active: true
    });

    res.json({ success: true, resume: savedResume });
  } catch (err: any) {
    console.error("Confirm resume error:", err);
    res.status(500).json({ error: err.message || "Failed to confirm and save resume" });
  }
}));

// Get all resumes for a user
app.get("/api/resumes/:userId", asyncHandler(async (req, res) => {
  const userId = await resolveUserId(req, req.params.userId);
  try {
    const resumes = await DbService.getResumes(userId);
    res.json(resumes);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to retrieve resumes" });
  }
}));

// Activate a specific resume
app.post("/api/resume/activate", asyncHandler(async (req, res) => {
  const { resumeId } = req.body;
  if (!resumeId) {
    return res.status(400).json({ error: "Missing resumeId" });
  }
  const userId = await resolveUserId(req, req.body.userId);
  try {
    const activeResume = await DbService.activateResume(userId, resumeId);
    res.json({ success: true, resume: activeResume });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to activate resume" });
  }
}));

// Update an existing resume's parsed details
// Save-only — skills changed, so the cached embedding is cleared and will be
// regenerated fresh the next time the user explicitly searches (see
// /api/pipeline/search-match's lazy embedding generation).
app.post("/api/resume/update", asyncHandler(async (req, res) => {
  const { resumeId, parsedResume } = req.body;
  if (!resumeId || !parsedResume) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  await resolveUserId(req, req.body.userId);

  try {
    const updatedResume = await DbService.updateResumeFields(resumeId, {
      parsed_json: parsedResume,
      embedding: null as any
    });

    res.json({ success: true, resume: updatedResume });
  } catch (err: any) {
    console.error("Update resume error:", err);
    res.status(500).json({ error: err.message || "Failed to update resume" });
  }
}));

// Trigger matching pipeline manually
app.post("/api/pipeline/search-match", asyncHandler(async (req, res) => {
  const { country } = req.body;

  // Two valid callers: (a) a trusted service/cron holding CRON_SECRET, which may
  // act on behalf of any userId, or (b) an authenticated end user triggering their
  // own refresh, whose identity must be verified against the claimed userId.
  const authHeader = req.headers.authorization;
  const presentedCronToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;
  const isTrustedCronCall = !!presentedCronToken && presentedCronToken === (process.env.CRON_SECRET || "default_cron_secret");

  const userId = isTrustedCronCall
    ? req.body.userId
    : await resolveUserId(req, req.body.userId);

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  try {
    const activeResume = await DbService.getActiveResume(userId);
    if (!activeResume) {
      return res.status(400).json({ error: "No active resume found for user. Please upload a resume first." });
    }

    await DbService.upsertProfile({
      user_id: userId,
      email: req.body.email || "user@example.com",
      preferred_country: country || "in"
    });

    let resumeEmbedding = (activeResume as any).embedding;
    if (!resumeEmbedding || resumeEmbedding.length === 0) {
      const textToEmbed = `${activeResume.parsed_json.titles.join(", ")} ${activeResume.parsed_json.skills.join(", ")} ${activeResume.parsed_json.tools.join(", ")}`;
      resumeEmbedding = await generateEmbedding(textToEmbed);
      await DbService.updateJobFields(activeResume.id, { embedding: resumeEmbedding });
    }

    const targetCountry = country || "in";
    await runJobMatchingPipelineForUser(userId, activeResume.parsed_json, resumeEmbedding, targetCountry, activeResume.version);

    const matches = await DbService.getJobMatches(userId);
    res.json({ success: true, matches });
  } catch (err: any) {
    console.error("Pipeline run failed:", err);
    res.status(500).json({ error: err.message || "Pipeline run failed" });
  }
}));

// Profile endpoints
app.get("/api/profile/:userId", asyncHandler(async (req, res) => {
  const userId = await resolveUserId(req, req.params.userId);
  try {
    const profile = await DbService.getProfile(userId);
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

app.post("/api/profile", asyncHandler(async (req, res) => {
  const userId = await resolveUserId(req, req.body.user_id);
  try {
    const profile = await DbService.upsertProfile({ ...req.body, user_id: userId });
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

// Matches endpoints
app.get("/api/matches/:userId", asyncHandler(async (req, res) => {
  const userId = await resolveUserId(req, req.params.userId);
  try {
    const matches = await DbService.getJobMatches(userId);
    res.json(matches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

app.patch("/api/matches/:matchId", asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: "Missing status" });
  }
  const userId = await resolveUserId(req, req.body.userId);

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
}));

// Application History endpoints
app.get("/api/history/:userId", asyncHandler(async (req, res) => {
  const userId = await resolveUserId(req, req.params.userId);
  try {
    const history = await DbService.getApplicationHistory(userId);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

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
            profile.preferred_country || "in",
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
          const deterministicReqs = parseJobRequirementsDeterministic(job.description);
          const reqs = deterministicReqs.confident
            ? deterministicReqs.data
            : await extractJobRequirements(job.description);
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
