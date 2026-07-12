import React, { useState } from "react";
import { JobMatch } from "../types.js";
import { useApp } from "../context/AppContext.js";
import { ExternalLink, CheckCircle, ChevronDown, ChevronUp, AlertCircle, Building2, MapPin, Award } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface RatingCardProps {
  match: JobMatch;
}

export const RatingCard: React.FC<RatingCardProps> = ({ match }) => {
  const { updateMatchStatus } = useApp();
  const [isExpanded, setIsExpanded] = useState(false);
  const job = match.job;

  if (!job) return null;

  const score = match.llm_score || 0;
  
  // Color configuration depending on match rating
  const getScoreColorClass = (scoreVal: number) => {
    if (scoreVal >= 8) return "text-emerald-400 border-emerald-500/30 bg-emerald-950/20";
    if (scoreVal >= 5) return "text-amber-400 border-amber-500/30 bg-amber-950/20";
    return "text-neutral-400 border-neutral-800 bg-neutral-900/40";
  };

  const getScoreCircleStroke = (scoreVal: number) => {
    if (scoreVal >= 8) return "stroke-emerald-400";
    if (scoreVal >= 5) return "stroke-amber-400";
    return "stroke-neutral-500";
  };

  const scorePercent = score * 10;
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (scorePercent / 100) * circumference;

  return (
    <div 
      id={`rating-card-${match.id}`}
      className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 transition-all duration-300 hover:border-white/10 relative flex flex-col md:flex-row gap-6 items-start"
    >
      {/* 1. Score Circle Block (Prominent score) */}
      <div className="flex-shrink-0 flex items-center justify-center md:flex-col gap-3">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg className="w-16 h-16 transform -rotate-90">
            {/* Background circle */}
            <circle 
              cx="32" 
              cy="32" 
              r={radius} 
              className="stroke-zinc-800 fill-none" 
              strokeWidth="4" 
            />
            {/* Foreground animated progress */}
            <circle 
              cx="32" 
              cy="32" 
              r={radius} 
              className={`fill-none transition-all duration-1000 ease-out ${getScoreCircleStroke(score)}`}
              strokeWidth="4" 
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold font-mono tracking-tight text-white">{score}</span>
            <span className="text-[9px] text-zinc-500 uppercase font-semibold">Match</span>
          </div>
        </div>

        <div className="text-xs text-zinc-400 md:text-center">
          <span className="font-semibold block md:inline">Similarity: </span>
          <span className="font-mono text-zinc-300">{(match.similarity_score * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* 2. Main Job Details and suggestions */}
      <div className="flex-grow space-y-4">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-lg font-semibold text-white tracking-tight leading-snug hover:text-zinc-200 transition-colors">
              {job.title}
            </h3>
            
            {/* Status indicators */}
            {match.status === "applied" && (
              <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full">
                Applied
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-sm text-zinc-400 mt-1.5">
            <span className="flex items-center gap-1.5 font-medium text-zinc-300">
              <Building2 className="w-4 h-4 text-zinc-500" />
              {job.company}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-zinc-500" />
              {job.location}
            </span>
          </div>
        </div>

        {/* 3. Transparent score weighting subscores breakdown */}
        {match.score_breakdown && (
          <div className="grid grid-cols-3 gap-2 bg-zinc-950/40 p-3.5 rounded-xl border border-white/5">
            <div className="text-center">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-semibold">Experience</span>
              <span className="text-sm font-bold font-mono text-zinc-200">
                {match.score_breakdown.experience_match || 0}/10
              </span>
            </div>
            <div className="text-center border-x border-white/5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-semibold">Skills Fit</span>
              <span className="text-sm font-bold font-mono text-zinc-200">
                {match.score_breakdown.skills_match || 0}/10
              </span>
            </div>
            <div className="text-center">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-semibold">Role Fit</span>
              <span className="text-sm font-bold font-mono text-zinc-200">
                {match.score_breakdown.responsibilities_match || 0}/10
              </span>
            </div>
          </div>
        )}

        {/* Collapsible Resume Suggestions & Gap Analysis Section */}
        <div className="space-y-2">
          <button
            id={`toggle-suggestions-${match.id}`}
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors py-1 focus:outline-none font-semibold"
          >
            {isExpanded ? (
              <>
                <span>Hide suggestions & analysis</span>
                <ChevronUp className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>View resume gap analysis & suggestions</span>
                <ChevronDown className="w-4 h-4" />
              </>
            )}
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden space-y-3 pt-1 text-sm text-zinc-350 leading-relaxed"
              >
                {/* Gap Analysis */}
                {match.gap_analysis && match.gap_analysis.length > 0 && (
                  <div className="bg-zinc-950/20 border border-white/5 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-zinc-400 mb-2">
                      <AlertCircle className="w-4 h-4 text-zinc-500" />
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Identified Gaps</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-xs text-zinc-300 pl-1">
                      {match.gap_analysis.map((gap, i) => (
                        <li key={i}>{gap}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggestions */}
                {match.resume_suggestions && match.resume_suggestions.length > 0 && (
                  <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 text-emerald-400 mb-2">
                      <Award className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Tailored Resume Upgrades</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1.5 text-xs text-zinc-300 pl-1">
                      {match.resume_suggestions.map((sug, i) => (
                        <li key={i} className="leading-relaxed">{sug}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 4. Primary and Secondary Action Buttons */}
        <div className="flex flex-wrap gap-2 pt-2">
          {/* Apply button (opens link in new tab) */}
          <a
            id={`apply-btn-${match.id}`}
            href={job.apply_url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-grow sm:flex-grow-0 bg-white hover:bg-zinc-200 text-zinc-950 px-5 py-2.5 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-2"
          >
            <span>APPLY NOW</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          {/* Mark as Applied action */}
          {match.status !== "applied" && (
            <button
              id={`mark-applied-btn-${match.id}`}
              onClick={() => updateMatchStatus(match.id, "applied")}
              className="flex-grow sm:flex-grow-0 border border-white/5 bg-zinc-800 hover:bg-zinc-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>SAVE JOB</span>
            </button>
          )}

          {/* Dismiss button */}
          {match.status !== "applied" && (
            <button
              id={`dismiss-match-btn-${match.id}`}
              onClick={() => updateMatchStatus(match.id, "dismissed")}
              className="text-zinc-500 hover:text-red-400 text-xs px-3 py-2 rounded-lg transition-colors ml-auto focus:outline-none"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
