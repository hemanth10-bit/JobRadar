import React, { useState } from "react";
import { useApp } from "../context/AppContext.js";
import { Briefcase, Calendar, ChevronRight, CheckCircle2, MessageSquare, Award } from "lucide-react";
import { motion } from "motion/react";

export const RecentlyApplied: React.FC = () => {
  const { history } = useApp();
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  if (history.length === 0) {
    return (
      <div id="recently-applied-empty" className="bg-zinc-900/50 border border-white/5 rounded-2xl p-10 text-center text-zinc-400 space-y-3">
        <div className="w-12 h-12 bg-zinc-950 border border-white/5 rounded-full flex items-center justify-center mx-auto">
          <Briefcase className="w-5 h-5 text-zinc-600" />
        </div>
        <div>
          <h4 className="text-white font-semibold">No applications recorded yet</h4>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            When you mark a matched job as "Applied" on your dashboard, 
            it will immediately appear in this tracking pipeline.
          </p>
        </div>
      </div>
    );
  }

  // Format date helper
  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return "Recently";
    }
  };

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case 'offer': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'interview': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'rejected': return 'text-red-400 bg-red-500/10 border-red-500/20';
      default: return 'text-zinc-300 bg-zinc-950 border-white/5';
    }
  };

  return (
    <div id="recently-applied-container" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Application Pipeline ({history.length})</h3>
        <span className="text-xs text-zinc-500">Most recent first</span>
      </div>

      <div className="space-y-3">
        {history.map((app) => {
          const job = app.job;
          if (!job) return null;
          const isExpanded = selectedItem === app.id;

          return (
            <motion.div
              layout
              key={app.id}
              className="bg-zinc-900/50 border border-white/5 hover:border-white/10 rounded-2xl overflow-hidden transition-all duration-200"
            >
              {/* Summary Bar */}
              <div 
                onClick={() => setSelectedItem(isExpanded ? null : app.id)}
                className="p-5 flex items-center justify-between gap-4 cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 bg-zinc-950 rounded-xl flex items-center justify-center border border-white/5 flex-shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-white leading-snug">{job.title}</h4>
                    <p className="text-xs text-zinc-400 mt-0.5">{job.company} — {job.location}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 flex-shrink-0">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Applied On</span>
                    <span className="text-xs font-mono text-zinc-300">{formatDate(app.applied_at)}</span>
                  </div>
                  <span className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-full border ${getOutcomeColor(app.outcome)}`}>
                    {app.outcome}
                  </span>
                  <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                </div>
              </div>

              {/* Collapsible Details */}
              {isExpanded && (
                <div className="px-5 pb-5 pt-1 border-t border-white/5 bg-zinc-950/20 text-sm space-y-4">
                  {app.notes && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-zinc-400 text-xs font-bold uppercase tracking-wider">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Application Notes</span>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-950/50 p-3 rounded-xl border border-white/5">
                        {app.notes}
                      </p>
                    </div>
                  )}

                  {/* Interview Dates or metadata */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-zinc-400">
                    <div className="bg-zinc-950/50 p-3.5 rounded-xl border border-white/5 flex items-center justify-between">
                      <span className="font-semibold text-zinc-500">Source:</span>
                      <span className="font-mono text-zinc-300 uppercase">{job.source_id}</span>
                    </div>

                    <div className="bg-zinc-950/50 p-3.5 rounded-xl border border-white/5 flex items-center justify-between">
                      <span className="font-semibold text-zinc-500">Original Post:</span>
                      <a 
                        href={job.apply_url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-white hover:underline flex items-center gap-1 font-semibold"
                      >
                        <span>View Listing</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
