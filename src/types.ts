export interface IngestedJobInput {
  external_job_id: string;
  source_id: string;
  title: string;
  company: string;
  location: string;
  country: string;
  description: string;
  apply_url: string;
  posted_date: string;
}

export interface Profile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  target_roles: string[];
  preferred_country: string;
  min_match_score: number;
  created_at: string;
}

export interface ParsedResume {
  skills: string[];
  titles: string[];
  years_experience: number;
  education: string[];
  tools: string[];
}

export interface Resume {
  id: string;
  user_id: string;
  raw_file_url: string;
  parsed_json: ParsedResume;
  version: number;
  is_active: boolean;
  created_at: string;
}

export interface Job {
  id: string;
  source_id: string;
  external_job_id: string;
  title: string;
  company: string;
  location: string;
  country: string;
  description: string;
  requirements_json: {
    required_skills: string[];
    experience_years_needed: number;
    seniority: string;
    must_haves: string[];
  };
  apply_url: string;
  posted_date: string;
  scraped_at: string;
}

export interface MatchScoreBreakdown {
  experience_match: number; // 0-10
  skills_match: number;     // 0-10
  responsibilities_match: number; // 0-10
}

export interface JobMatch {
  id: string;
  user_id: string;
  job_id: string;
  resume_version: number;
  similarity_score: number;
  llm_score: number;
  score_breakdown: MatchScoreBreakdown;
  gap_analysis: string[];
  resume_suggestions: string[];
  status: 'new' | 'viewed' | 'saved' | 'applied' | 'dismissed';
  created_at: string;
  applied_at?: string;
  // Included fields from joining jobs table
  job?: Job;
}

export interface ApplicationHistory {
  id: string;
  user_id: string;
  job_id: string;
  applied_at: string;
  notes?: string;
  follow_up_date?: string;
  outcome: 'pending' | 'interview' | 'rejected' | 'offer';
  // Joined job fields
  job?: Job;
}

export interface CountryOption {
  code: string;
  name: string;
}

export const COUNTRIES: CountryOption[] = [
  { code: 'us', name: 'United States' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'in', name: 'India' },
  { code: 'ca', name: 'Canada' },
  { code: 'au', name: 'Australia' },
  { code: 'de', name: 'Germany' },
  { code: 'sg', name: 'Singapore' },
  { code: 'ae', name: 'United Arab Emirates' }
];
