import { GoogleGenAI, Type, ApiError } from "@google/genai";
import { ParsedResume } from "../types.js";

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

/**
 * Parses raw resume text into structured JSON using Gemini
 */
export async function parseResumeText(text: string): Promise<ParsedResume> {
  const ai = getGeminiClient();
  const prompt = `You are an expert resume parser and technical recruiter. 
Analyze the following raw resume text and extract structured information.

Resume Text:
"""
${text}
"""`;

  const response = await withGeminiRetry(() => ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: {
      systemInstruction: "Extract the details with strict accuracy. If some values are not found, default them to empty lists or 0 years of experience. Respond ONLY with valid JSON.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          skills: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Core technical and soft skills."
          },
          titles: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Job titles previously held or targeted."
          },
          years_experience: {
            type: Type.INTEGER,
            description: "Total years of professional work experience."
          },
          education: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Degrees, certifications, and educational achievements."
          },
          tools: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Specific tools, platforms, or technologies mastered (e.g. Git, Docker, Figma)."
          }
        },
        required: ["skills", "titles", "years_experience", "education", "tools"]
      }
    }
  }));

  const rawText = response.text || "{}";
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
  const ai = getGeminiClient();
  const prompt = `You are a career development engine scoring how well a resume matches a job.
Analyze the parsed resume JSON against the job details, and calculate a realistic match rating out of 10.
Identify gaps and construct actionable resume modifications tailored to this exact job.

Parsed Resume:
${JSON.stringify(resume, null, 2)}

Job Title: ${jobTitle}
Job Description:
"""
${jobDescription}
"""`;

  const response = await withGeminiRetry(() => ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: {
      systemInstruction: `Evaluate strictly. Be realistic:
      - experience_match: Compare resume years_experience vs job requirements.
      - skills_match: Evaluate matching skills/tools vs required skills.
      - responsibilities_match: Compare targeted roles/titles vs job title/role functions.
      Provide detailed gap_analysis and custom resume_suggestions (such as 'Add specific experience with X tool' or 'Mention impact metrics using Y skill').
      Respond ONLY with valid JSON.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          match_score: {
            type: Type.INTEGER,
            description: "Overall weighted rating from 0 to 10. Use standard mathematical rounding or weighting."
          },
          score_breakdown: {
            type: Type.OBJECT,
            properties: {
              experience_match: { type: Type.INTEGER, description: "Rating 0-10 based on years of experience fit" },
              skills_match: { type: Type.INTEGER, description: "Rating 0-10 based on skill-to-requirement overlap" },
              responsibilities_match: { type: Type.INTEGER, description: "Rating 0-10 based on role and responsibilities alignment" }
            },
            required: ["experience_match", "skills_match", "responsibilities_match"]
          },
          gap_analysis: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Missing skills, tools, or experiences that are highlighted as important in the job."
          },
          resume_suggestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Highly actionable, concrete modifications or updates the user should make to their resume to fit this job."
          }
        },
        required: ["match_score", "score_breakdown", "gap_analysis", "resume_suggestions"]
      }
    }
  }));

  const rawText = response.text || "{}";
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
