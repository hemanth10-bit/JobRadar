import { GoogleGenAI, ApiError } from "@google/genai";
import Groq, { APIError as GroqAPIError } from "groq-sdk";
import { ParsedResume } from "../types.js";

// ==========================================
// GEMINI — used only for embeddings (src/lib/embeddings.ts). Groq has no
// embedding models, so this stays on Gemini regardless of the chat/JSON
// generation provider below.
// ==========================================
let aiInstance: GoogleGenAI | null = null;

// Gemini occasionally returns transient errors (503 "model overloaded",
// 429 rate limits) under normal load. Retry those with backoff instead of
// failing the whole request on a blip; anything else (bad request, auth,
// etc.) fails immediately since retrying won't help.
const RETRYABLE_STATUS_CODES = new Set([429, 503]);

// A 429 whose quotaId contains "PerDay" is a daily quota exhaustion (common
// on the free tier — as low as 20 requests/day for some models), not a
// transient burst limit. It cannot recover within a request's lifetime, so
// retrying just wastes time and risks hitting the function's own timeout —
// fail fast instead.
function isDailyQuotaExhausted(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429 && /PerDay/i.test(err.message);
}

export async function withGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRetryable = err instanceof ApiError && RETRYABLE_STATUS_CODES.has(err.status) && !isDailyQuotaExhausted(err);
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 500 * 2 ** attempt + Math.random() * 250;
      console.warn(`Gemini call failed with a transient error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delayMs)}ms:`, (err as Error).message);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required but not configured. Set GEMINI_API_KEY in your secrets/environment.");
    }
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

// ==========================================
// GROQ — resume parsing and job-match scoring. Free tier gives
// llama-3.1-8b-instant 14,400 requests/day (vs. Gemini's free-tier cap of as
// low as 20/day for generateContent), which is what these two calls need.
// ==========================================
// Parsing runs on every resume save/edit (higher volume, more mechanical
// task) — stays on the fast/high-quota 8b model.
const GROQ_MODEL = "llama-3.1-8b-instant";
// Scoring is capped at 8 fresh calls/run (see server.ts SCORING_CAP_PER_RUN)
// and needs better judgment on nuanced fit, so it gets the larger model.
// Free tier: 1,000 req/day, 100K tokens/day — comfortable at this cap/scale,
// but tokens/day is worth watching if usage grows (prompts carry the full
// job description + resume JSON).
const GROQ_SCORING_MODEL = "llama-3.3-70b-versatile";
let groqInstance: Groq | null = null;

function getGroqClient(): Groq {
  if (!groqInstance) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is required but not configured. Set GROQ_API_KEY in your secrets/environment.");
    }
    groqInstance = new Groq({ apiKey });
  }
  return groqInstance;
}

const GROQ_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

export async function withGroqRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRetryable = err instanceof GroqAPIError && !!err.status && GROQ_RETRYABLE_STATUS_CODES.has(err.status);
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 500 * 2 ** attempt + Math.random() * 250;
      console.warn(`Groq call failed with a transient error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delayMs)}ms:`, (err as Error).message);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Parses raw resume text into structured JSON using Groq (llama-3.1-8b-instant).
 * Groq's free tier only guarantees valid JSON *syntax* here (not exact schema
 * match, unlike Gemini's responseSchema), so the shape is spelled out
 * explicitly in the prompt and any malformed response is caught by the
 * caller — same graceful-degradation path as any other per-job failure.
 */
export async function parseResumeText(text: string): Promise<ParsedResume> {
  const groq = getGroqClient();

  const response = await withGroqRetry(() => groq.chat.completions.create({
    model: GROQ_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert resume parser and technical recruiter. Extract details with strict accuracy, using only what the resume text actually states — never invent or infer a skill, tool, or title that isn't written or clearly implied by described work. If a value isn't found, default to an empty list or 0 years of experience.

For years_experience: sum actual date ranges across roles (accounting for overlaps — don't double-count concurrent roles), not a guess from seniority-sounding titles.

Respond ONLY with a single JSON object matching exactly this shape, no other text:
{
  "skills": string[] (core technical and soft skills, each one specific and resume-grounded — not generic filler like "hardworking" unless the resume itself uses that framing),
  "titles": string[] (job titles previously held or targeted),
  "years_experience": integer (total years of professional work experience),
  "education": string[] (degrees, certifications, educational achievements),
  "tools": string[] (specific tools/platforms/technologies, e.g. Git, Docker, Figma)
}`
      },
      {
        role: "user",
        content: `Resume Text:\n"""\n${text}\n"""`
      }
    ]
  }));

  const rawText = response.choices[0]?.message?.content || "{}";
  return JSON.parse(cleanJsonResponse(rawText));
}

/**
 * Extracts job requirements, seniority, and skills from raw job description
 */
export interface JobRequirements {
  required_skills: string[];
  experience_years_needed: number;
  seniority: string;
  must_haves: string[];
}

/**
 * Calculates match score, breakdown, gap analysis, and tailored recommendations
 */
export interface MatchScoreResult {
  match_score: number; // 0 to 10
  score_breakdown: {
    experience_match: number;       // 0 to 10
    skills_match: number;           // 0 to 10
    responsibilities_match: number; // 0 to 10
  };
  gap_analysis: string[];
  resume_suggestions: string[];
}

export async function scoreJobMatch(
  resume: ParsedResume,
  jobTitle: string,
  jobDescription: string
): Promise<MatchScoreResult> {
  const groq = getGroqClient();

  const response = await withGroqRetry(() => groq.chat.completions.create({
    model: GROQ_SCORING_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a strict, evidence-based technical recruiter scoring how well a candidate's resume matches a specific job. Be realistic — most resumes are partial matches, not perfect ones. Do not inflate scores to be encouraging.

First, identify the job's actual required skills, tools, experience level, and responsibilities directly from the job description text (ignore fluff like generic company boilerplate). Then compare each dimension of the resume against exactly those requirements, citing specifics rather than general impressions.

Score each dimension 0-10 using this rubric:
- 0-2: little to no overlap with what the job asks for.
- 3-5: some relevant overlap, but clear, significant gaps remain.
- 6-8: solid overlap on most stated requirements, with only minor gaps.
- 9-10: matches nearly all stated requirements with direct, specific evidence.

Dimensions:
- experience_match: resume's years_experience and role history against the job's stated seniority/experience needs.
- skills_match: overlap between resume skills/tools and the specific skills/tools the job description names — partial credit for closely related/transferable skills, not for vaguely-adjacent ones.
- responsibilities_match: how closely the resume's past titles and described work align with this job's actual day-to-day responsibilities, not just title similarity.
match_score is a holistic overall rating (not a mechanical average) — weight skills_match and responsibilities_match slightly more heavily than experience_match, since a strong skills fit with slightly less tenure usually matters more than the reverse.

For gap_analysis: list only gaps that are actually significant to this specific job — each item must name the exact skill/tool/requirement from the job description that's missing or weak in the resume. Never write vague filler like "could improve technical skills."

For resume_suggestions: each suggestion must be concrete and actionable, referencing a specific requirement from this job description and how the resume should address it (e.g. "Add a bullet quantifying your experience with [specific tool from the job] since the role explicitly requires it" — not "highlight relevant skills"). If the resume is already a strong match, suggestions can focus on quantifying impact/metrics rather than inventing new gaps.

Respond ONLY with a single JSON object matching exactly this shape, no other text:
{
  "match_score": integer 0-10 (overall weighted rating),
  "score_breakdown": {
    "experience_match": integer 0-10,
    "skills_match": integer 0-10,
    "responsibilities_match": integer 0-10
  },
  "gap_analysis": string[] (specific, job-grounded gaps only — empty array if genuinely none),
  "resume_suggestions": string[] (concrete, job-grounded, actionable resume edits)
}`
      },
      {
        role: "user",
        content: `Parsed Resume:\n${JSON.stringify(resume, null, 2)}\n\nJob Title: ${jobTitle}\nJob Description:\n"""\n${jobDescription}\n"""`
      }
    ]
  }));

  const rawText = response.choices[0]?.message?.content || "{}";
  return JSON.parse(cleanJsonResponse(rawText));
}

/**
 * Defensive utility to strip out markdown code blocks if the model wrapped the JSON
 */
function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}
