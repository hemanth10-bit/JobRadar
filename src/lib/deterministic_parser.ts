import { ParsedResume } from "../types.js";
import { JobRequirements } from "./ai.js";

// ==========================================
// SKILL / TOOL / TITLE DICTIONARIES
// ==========================================
// Curated for tech roles (matches this app's job sources). Deliberately
// biased toward recall over precision — false positives here just mean an
// extra tag, false negatives push a resume/job into the Gemini fallback.
const SKILLS = [
  "javascript", "typescript", "python", "java", "c++", "c#", "go", "golang", "rust",
  "ruby", "php", "kotlin", "swift", "scala", "sql", "html", "css", "sass", "less",
  "problem solving", "communication", "leadership", "teamwork", "agile", "scrum",
  "project management", "product management", "data analysis", "machine learning",
  "deep learning", "nlp", "computer vision", "algorithms", "data structures",
  "system design", "microservices", "rest api", "graphql", "unit testing",
  "test driven development", "ci/cd", "devops", "cloud computing", "security"
];

const TOOLS = [
  "react", "react native", "vue", "angular", "svelte", "next.js", "nuxt", "vite",
  "webpack", "tailwind", "tailwind css", "bootstrap", "material ui", "redux",
  "node.js", "node", "express", "nestjs", "django", "flask", "fastapi", "spring",
  "spring boot", ".net", "laravel", "rails",
  "postgres", "postgresql", "mysql", "mongodb", "redis", "sqlite", "dynamodb",
  "elasticsearch", "supabase", "firebase", "prisma", "drizzle",
  "aws", "gcp", "azure", "vercel", "netlify", "heroku",
  "docker", "kubernetes", "terraform", "ansible", "jenkins", "github actions",
  "gitlab ci", "circleci",
  "git", "github", "gitlab", "bitbucket", "jira", "confluence", "figma", "sketch",
  "postman", "swagger",
  "pandas", "numpy", "pytorch", "tensorflow", "scikit-learn", "keras", "spark",
  "hadoop", "airflow", "kafka", "rabbitmq", "grafana", "prometheus", "datadog",
  "jest", "mocha", "cypress", "playwright", "selenium", "junit", "pytest",
  "genai", "gemini", "openai", "langchain", "vector database", "pgvector", "pinecone"
];

const TITLES = [
  "software engineer", "software developer", "senior software engineer",
  "staff software engineer", "principal engineer", "frontend engineer",
  "frontend developer", "backend engineer", "backend developer",
  "full stack engineer", "full stack developer", "full-stack developer",
  "mobile engineer", "mobile developer", "ios developer", "android developer",
  "devops engineer", "site reliability engineer", "platform engineer",
  "data engineer", "data scientist", "data analyst", "machine learning engineer",
  "ai engineer", "ml engineer", "qa engineer", "test engineer", "sdet",
  "engineering manager", "technical lead", "tech lead", "product manager",
  "product owner", "project manager", "ui designer", "ux designer",
  "ui/ux designer", "product designer", "cloud engineer", "security engineer",
  "solutions architect", "systems architect"
];

const EDUCATION_PATTERNS = [
  /\b(bachelor(?:'s)?(?:\s+of\s+\w+)?)\b/gi,
  /\b(master(?:'s)?(?:\s+of\s+\w+)?)\b/gi,
  /\b(ph\.?d\.?|doctorate)\b/gi,
  /\b(b\.?s\.?c?\.?|m\.?s\.?c?\.?|m\.?b\.?a\.?|b\.?tech\.?|m\.?tech\.?|b\.?e\.?|b\.?a\.?)\b/gi,
  /\b(associate(?:'s)?\s+degree)\b/gi
];

function findMatches(text: string, dictionary: string[]): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const term of dictionary) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word-boundary match; `\b` doesn't work well around `.`/`+`/`#` (e.g. "c++",
    // "node.js"), so fall back to a loose boundary check for those terms.
    const hasSpecialChars = /[.+#]/.test(term);
    const pattern = hasSpecialChars
      ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i")
      : new RegExp(`\\b${escaped}\\b`, "i");
    if (pattern.test(lower)) {
      found.add(term);
    }
  }
  return Array.from(found);
}

// ==========================================
// EMPLOYMENT DATE RANGE → YEARS OF EXPERIENCE
// ==========================================
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

// Matches things like "Jan 2020 - Present", "06/2019 - 08/2022", "2018 – 2021"
const DATE_RANGE_REGEX = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(\d{4})\s*(?:-|–|to)\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(\d{4}|present|current)\b/gi;

function parseDateToken(monthToken: string | undefined, year: number): Date {
  const month = monthToken ? (MONTHS[monthToken.toLowerCase().slice(0, 3)] ?? 0) : 0;
  return new Date(year, month, 1);
}

function estimateYearsExperience(text: string): number {
  const now = new Date();
  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;

  for (const match of text.matchAll(DATE_RANGE_REGEX)) {
    const [, startMonth, startYearStr, endMonth, endYearStr] = match;
    const startYear = parseInt(startYearStr, 10);
    if (startYear < 1970 || startYear > now.getFullYear()) continue;

    const start = parseDateToken(startMonth, startYear);
    const end = /present|current/i.test(endYearStr)
      ? now
      : parseDateToken(endMonth, parseInt(endYearStr, 10));

    if (!earliestStart || start < earliestStart) earliestStart = start;
    if (!latestEnd || end > latestEnd) latestEnd = end;
  }

  if (!earliestStart || !latestEnd) return 0;
  const years = (latestEnd.getTime() - earliestStart.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, Math.round(years));
}

function extractEducation(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of EDUCATION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[0].trim());
    }
  }
  return Array.from(found);
}

// ==========================================
// RESUME PARSING (deterministic)
// ==========================================
export interface DeterministicParseResult<T> {
  data: T;
  confident: boolean;
}

export function parseResumeDeterministic(text: string): DeterministicParseResult<ParsedResume> {
  const skills = findMatches(text, SKILLS);
  const tools = findMatches(text, TOOLS);
  const titles = findMatches(text, TITLES);
  const education = extractEducation(text);
  const years_experience = estimateYearsExperience(text);

  const data: ParsedResume = { skills, titles, years_experience, education, tools };

  // Low confidence -> caller should fall back to the LLM parser instead of
  // trusting this result. Thresholds are deliberately conservative: a
  // resume with almost nothing recognized is more likely a dictionary miss
  // (unusual formatting, non-tech role, etc.) than an actually-empty resume.
  const confident = (skills.length + tools.length) >= 3 && titles.length >= 1 && years_experience > 0;

  return { data, confident };
}

// ==========================================
// JOB REQUIREMENTS PARSING (deterministic)
// ==========================================
const EXPERIENCE_YEARS_REGEX = /\b(\d{1,2})\+?\s*(?:-\s*\d{1,2}\s*)?\+?\s*years?\b/i;

const SENIORITY_RULES: [RegExp, string][] = [
  [/\b(principal|staff|distinguished)\b/i, "Lead"],
  [/\b(senior|sr\.?)\b/i, "Senior"],
  [/\b(lead)\b/i, "Lead"],
  [/\b(mid[- ]level|intermediate)\b/i, "Mid"],
  [/\b(junior|jr\.?|entry[- ]level|associate)\b/i, "Junior"]
];

const REQUIREMENTS_SECTION_REGEX = /(requirements|qualifications|must[- ]haves?|what you'?ll need|you have)[:\s]*\n([\s\S]{0,1500}?)(?:\n\s*\n|$)/i;

function extractMustHaves(text: string): string[] {
  const sectionMatch = text.match(REQUIREMENTS_SECTION_REGEX);
  const scope = sectionMatch ? sectionMatch[2] : text;

  const bulletRegex = /(?:^|\n)\s*(?:[-•*]|\d+[.)])\s*(.+)/g;
  const items: string[] = [];
  for (const match of scope.matchAll(bulletRegex)) {
    const item = match[1].trim();
    if (item.length > 3 && item.length < 200) {
      items.push(item);
    }
  }
  return items.slice(0, 10);
}

export function parseJobRequirementsDeterministic(text: string): DeterministicParseResult<JobRequirements> {
  const required_skills = findMatches(text, [...SKILLS, ...TOOLS]);

  const yearsMatch = text.match(EXPERIENCE_YEARS_REGEX);
  const experience_years_needed = yearsMatch ? parseInt(yearsMatch[1], 10) : 0;

  let seniority = "Mid";
  for (const [pattern, label] of SENIORITY_RULES) {
    if (pattern.test(text)) {
      seniority = label;
      break;
    }
  }

  const must_haves = extractMustHaves(text);

  const data: JobRequirements = { required_skills, experience_years_needed, seniority, must_haves };

  const confident = required_skills.length >= 3 && must_haves.length >= 1;

  return { data, confident };
}
