import { IngestedJobInput } from "../types.js";

export interface JobSourceAdapter {
  name: string;
  enabled: boolean;
  fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]>;
}

// ==========================================
// SAMPLE FALLBACK JOBS FOR GRACEFUL DEVELOPMENT
// ==========================================
const SAMPLE_JOBS_BY_COUNTRY: Record<string, Omit<IngestedJobInput, 'posted_date'>[]> = {
  us: [
    {
      source_id: "sample",
      external_job_id: "sample-us-1",
      title: "React Frontend Engineer",
      company: "Innovate Tech",
      location: "San Francisco, CA",
      country: "us",
      description: "We are looking for a React Frontend Engineer with 3+ years of experience. Must be proficient in TypeScript, React 18, Tailwind CSS, and state management. Experience with Vite, Next.js, and animations (Motion) is a big plus. Responsibilities include building responsive UI components, integrating RESTful APIs, and maintaining code quality.",
      apply_url: "https://example.com/apply/sample-us-1"
    },
    {
      source_id: "sample",
      external_job_id: "sample-us-2",
      title: "Full-Stack Node.js Developer",
      company: "CloudCore Systems",
      location: "Austin, TX (Remote)",
      country: "us",
      description: "Seeking a Full-Stack Node.js Developer. Required skills: Node.js, Express, PostgreSQL, Prisma or Drizzle ORM, and React. Responsibilities: designing secure REST APIs, designing database schemas, integrating authentication (OAuth/JWT), and optimizing system performance. Experience with AWS or Google Cloud is desired. 4+ years of experience expected.",
      apply_url: "https://example.com/apply/sample-us-2"
    },
    {
      source_id: "sample",
      external_job_id: "sample-us-3",
      title: "Senior AI Engineer (Gemini / LLMs)",
      company: "Cognitive Labs",
      location: "New York, NY",
      country: "us",
      description: "Join our core team to build AI-powered agents. We require deep experience with LLM orchestration, prompt engineering, vector embeddings, and semantic search (pgvector). Proficiency in Python, Node.js, and the Google GenAI SDK (@google/genai) is essential. Responsibilities include deploying RAG systems, tuning prompts, and creating robust LLM processing chains.",
      apply_url: "https://example.com/apply/sample-us-3"
    }
  ],
  in: [
    {
      source_id: "sample",
      external_job_id: "sample-in-1",
      title: "Software Development Engineer - React",
      company: "TechMahal Solutions",
      location: "Bengaluru, Karnataka (Hybrid)",
      country: "in",
      description: "Looking for an SDE with strong expertise in React, TypeScript, and CSS frameworks like Tailwind. You will own client-side applications, collaborate with designers on Figma components, and implement real-time data visualizers (Recharts/D3). Requirements: 2-4 years experience, excellent problem solving, and basic Node.js familiarity.",
      apply_url: "https://example.com/apply/sample-in-1"
    },
    {
      source_id: "sample",
      external_job_id: "sample-in-2",
      title: "Backend Engineer (Node.js & Express)",
      company: "Aura Fintech",
      location: "Mumbai, Maharashtra",
      country: "in",
      description: "Aura Fintech is hiring a Backend SDE. You will design scalable web microservices in Node.js, secure APIs, and run migrations on Postgres databases. Skills: Node, Express, SQL, Redis, Firebase. Experience with OAuth flows, payment gateways, and containerization (Docker) is highly valued.",
      apply_url: "https://example.com/apply/sample-in-2"
    }
  ],
  gb: [
    {
      source_id: "sample",
      external_job_id: "sample-gb-1",
      title: "Senior Frontend Engineer (Vite / React / Tailwind)",
      company: "Vanguard Retail Ltd",
      location: "London, England",
      country: "gb",
      description: "We are seeking a senior front-end practitioner to build out our high-speed e-commerce interface. Requirements: 6+ years in frontend, 3+ years writing TypeScript and React. Must be an expert in Tailwind CSS and build tooling (Vite/Rollup). Responsibilities include code auditing, profiling browser rendering performance, and driving robust component designs.",
      apply_url: "https://example.com/apply/sample-gb-1"
    }
  ],
  all: [
    {
      source_id: "sample",
      external_job_id: "sample-remote-1",
      title: "Remote Frontend Developer (Global)",
      company: "Nomad Interactive",
      location: "Fully Remote",
      country: "all",
      description: "Nomad Interactive is a remote-first studio. We are searching for a React developer with experience in Tailwind CSS, responsive web layouts, and interactive charts (using recharts or d3). You must be capable of working autonomously. Experience with REST API consumption and web security basics is required.",
      apply_url: "https://example.com/apply/sample-remote-1"
    }
  ]
};

// Generic helper to get custom date in UTC string
function getSampleDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString();
}

// ==========================================
// 1. ADZUNA ADAPTER (Requires app_id and app_key)
// ==========================================
export class AdzunaAdapter implements JobSourceAdapter {
  name = "adzuna";
  enabled = true;

  async fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;

    if (!appId || !appKey) {
      console.warn("Adzuna API credentials missing. Returning country fallback jobs.");
      return getFallbackJobs(country, query);
    }

    const c = country.toLowerCase() === 'all' ? 'us' : country.toLowerCase();
    const url = `https://api.adzuna.com/v1/api/jobs/${c}/search/${page}?app_id=${appId}&app_key=${appKey}&what=${encodeURIComponent(query)}&content-type=application/json`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Adzuna API error: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.results) return [];

      return data.results.map((job: any) => ({
        external_job_id: job.id.toString(),
        source_id: this.name,
        title: job.title || "Job Title",
        company: job.company?.display_name || "Confidential Company",
        location: job.location?.display_name || "N/A",
        country: c,
        description: job.description || "",
        apply_url: job.redirect_url || "",
        posted_date: job.created || new Date().toISOString()
      }));
    } catch (err) {
      console.warn("Failed to fetch from Adzuna, returning fallbacks.", err);
      return getFallbackJobs(country, query);
    }
  }
}

// ==========================================
// 2. JSEARCH ADAPTER (RapidAPI, Google for Jobs results)
// ==========================================
export class JSearchAdapter implements JobSourceAdapter {
  name = "jsearch";
  enabled = true;

  async fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]> {
    const rapidKey = process.env.RAPIDAPI_KEY;

    if (!rapidKey) {
      console.warn("RapidAPI Key missing. Returning country fallback jobs for JSearch.");
      return getFallbackJobs(country, query);
    }

    // Append country keyword to query to scope it naturally
    const cKeyword = country.toUpperCase() !== 'ALL' ? ` in ${country.toUpperCase()}` : "";
    const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query + cKeyword)}&page=${page}&num_pages=1`;

    try {
      const response = await fetch(url, {
        headers: {
          "x-rapidapi-key": rapidKey,
          "x-rapidapi-host": "jsearch.p.rapidapi.com"
        }
      });
      if (!response.ok) {
        throw new Error(`JSearch API error: ${response.statusText}`);
      }
      const resData = await response.json();
      if (!resData.data) return [];

      return resData.data.map((job: any) => ({
        external_job_id: job.job_id,
        source_id: this.name,
        title: job.job_title || "Job Title",
        company: job.employer_name || "Confidential",
        location: [job.job_city, job.job_state].filter(Boolean).join(", ") || job.job_country || "N/A",
        country: country.toLowerCase() === 'all' ? (job.job_country || "us").toLowerCase() : country.toLowerCase(),
        description: job.job_description || "",
        apply_url: job.job_apply_link || "",
        posted_date: job.job_posted_at_datetime_utc || new Date().toISOString()
      }));
    } catch (err) {
      console.warn("Failed to fetch from JSearch, returning fallbacks.", err);
      return getFallbackJobs(country, query);
    }
  }
}

// ==========================================
// 3. REMOTIVE ADAPTER (Free remote jobs, no key)
// ==========================================
export class RemotiveAdapter implements JobSourceAdapter {
  name = "remotive";
  enabled = true;

  async fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]> {
    // Remotive is remote first and doesn't support fine country codes. Let's fetch and filter loosely.
    const url = `https://remotive.com/api/remote-jobs?limit=30`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Remotive API error: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.jobs) return [];

      let jobs = data.jobs;

      // Filter by query loosely if provided
      if (query) {
        const q = query.toLowerCase();
        jobs = jobs.filter((j: any) => 
          j.title.toLowerCase().includes(q) || 
          j.description.toLowerCase().includes(q)
        );
      }

      return jobs.map((job: any) => ({
        external_job_id: job.id.toString(),
        source_id: this.name,
        title: job.title,
        company: job.company_name || "Confidential",
        location: job.candidate_required_location || "Remote",
        country: "all", // remote
        description: stripHtml(job.description || ""),
        apply_url: job.url,
        posted_date: job.publication_date || new Date().toISOString()
      }));
    } catch (err) {
      console.warn("Failed to fetch from Remotive, returning fallbacks.", err);
      return getFallbackJobs(country, query);
    }
  }
}

// Helper function to strip HTML tags from Remotive description
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

// Helper to construct mock fallbacks dynamically
function getFallbackJobs(country: string, query: string): IngestedJobInput[] {
  const code = country.toLowerCase();
  const rawList = SAMPLE_JOBS_BY_COUNTRY[code] || SAMPLE_JOBS_BY_COUNTRY['us'] || SAMPLE_JOBS_BY_COUNTRY['all'];
  
  return rawList.map((job, idx) => ({
    ...job,
    posted_date: getSampleDateString(idx * 2)
  }));
}

// ==========================================
// CENTRAL ADAPTER MANAGER
// ==========================================
export class JobSourcesManager {
  private adapters: JobSourceAdapter[] = [];

  constructor() {
    this.adapters = [
      new AdzunaAdapter(),
      new JSearchAdapter(),
      new RemotiveAdapter()
    ];
  }

  async fetchAll(query: string, country: string): Promise<IngestedJobInput[]> {
    const promises = this.adapters
      .filter(a => a.enabled)
      .map(a => a.fetchJobs(query, country, 1));

    const results = await Promise.allSettled(promises);
    const combined: IngestedJobInput[] = [];

    results.forEach(res => {
      if (res.status === "fulfilled") {
        combined.push(...res.value);
      }
    });

    // Remove duplicates by external_job_id
    const seen = new Set<string>();
    return combined.filter(job => {
      const key = `${job.source_id}:${job.external_job_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
