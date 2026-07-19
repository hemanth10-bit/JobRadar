import React, { useRef, useState, useEffect } from "react";
import { AppProvider, useApp } from "./context/AppContext.js";
import { AuthPage } from "./components/AuthPage.js";
import { ParsedReviewModal } from "./components/ParsedReviewModal.js";
import { RatingCard } from "./components/RatingCard.js";
import { RecentlyApplied } from "./components/RecentlyApplied.js";
import { COUNTRIES } from "./types.js";
import { 
  Sparkles, Upload, FileText, Globe, RefreshCw, LogOut, Briefcase, 
  Settings, CheckCircle2, ChevronRight, Sliders, AlertCircle, ShieldAlert, Edit 
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

function MainDashboard() {
  const { 
    user, logout, status, profile, activeResume, resumes, matches, isPipelineRunning, 
    uploadResume, triggerManualRefresh, updateCountry, currentParsedReview, setCurrentParsedReview, 
    activateResumeVersion, setEditingResumeId
  } = useApp();

  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'matches' | 'applied'>('matches');
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync selected resume state when activeResume changes
  useEffect(() => {
    if (activeResume) {
      setSelectedResumeId(activeResume.id);
    }
  }, [activeResume]);

  const currentSelectedResume = resumes.find(r => r.id === selectedResumeId) || activeResume;

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setUploadError(null);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      await processUploadedFile(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await processUploadedFile(file);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const processUploadedFile = async (file: File) => {
    // Validate file type
    const validTypes = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
    if (!validTypes.includes(file.type) && !file.name.endsWith(".docx") && !file.name.endsWith(".pdf")) {
      setUploadError("Invalid file format. Please upload a PDF or DOCX file.");
      return;
    }

    setIsUploading(true);
    try {
      await uploadResume(file);
    } catch (err: any) {
      setUploadError(err.message || "Failed to parse file. Try again.");
    } finally {
      setIsUploading(false);
    }
  };

  // Filter out dismissed matches and only show matches corresponding to the selected resume version
  const activeMatches = matches.filter(m => 
    m.status !== "dismissed" && 
    m.status !== "applied" &&
    (!currentSelectedResume || m.resume_version === currentSelectedResume.version)
  );

  return (
    <div id="dashboard-root" className="min-h-screen bg-zinc-950 text-zinc-200 font-sans flex flex-col justify-between relative overflow-hidden">
      {/* Background radial highlight */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-zinc-900/30 rounded-full blur-3xl opacity-40 pointer-events-none" />

      {/* Header section */}
      <header className="z-10 bg-zinc-950/60 backdrop-blur-md border-b border-white/5 sticky top-0 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded-md flex items-center justify-center">
              <div className="w-4 h-4 bg-zinc-950 rounded-sm"></div>
            </div>
            <div>
              <span className="font-sans font-semibold tracking-tight text-lg text-white block leading-none">JobRadar</span>
              <span className="text-[10px] text-zinc-500 font-medium">Daily Job-Matching Engine</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Connection badge */}
            <div className="hidden md:flex items-center gap-1.5 bg-zinc-900 border border-white/10 text-zinc-400 text-xs px-3 py-1.5 rounded-lg">
              {status?.demoMode ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-zinc-500" />
                  <span>Local Session Mode</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Database Connected</span>
                </>
              )}
            </div>

            {/* Profile greeting */}
            <div className="text-right hidden sm:block">
              <span className="text-xs text-zinc-500 block font-medium">Signed in as</span>
              <span className="text-xs text-white font-semibold font-mono">{user?.email}</span>
            </div>

            <button
              id="logout-btn"
              onClick={logout}
              className="bg-zinc-900 border border-white/10 hover:border-white/20 text-zinc-400 hover:text-white p-2.5 rounded-xl transition-all cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="z-10 flex-grow max-w-7xl mx-auto w-full px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* ==========================================
              LEFT COLUMN: SETTINGS, RESUME UPLOAD & REFRESH 
             ========================================== */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* 1. Resume Block */}
            <div id="resume-block" className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 font-display">My Resume Profile</h2>
                {currentSelectedResume && (
                  <span className="bg-zinc-950 border border-white/5 text-zinc-400 text-[10px] font-mono px-2.5 py-1 rounded-lg">
                    V{currentSelectedResume.version}
                  </span>
                )}
              </div>

              {currentSelectedResume ? (
                /* Resume Loaded State */
                <div className="space-y-4">
                  <div className="flex items-start gap-3 bg-zinc-950/50 p-4 rounded-xl border border-white/5">
                    <div className="p-2 bg-white/5 rounded-lg border border-white/5 flex-shrink-0">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider block">Selected Resume File</span>
                      <span className="text-sm text-white font-semibold block truncate">{currentSelectedResume.raw_file_url}</span>
                      <span className="text-[10px] text-zinc-500 font-mono block mt-1">Uploaded {new Date(currentSelectedResume.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Resume Version Dropdown */}
                  {resumes.length > 1 && (
                    <div className="space-y-1.5 bg-zinc-950/20 border border-white/5 p-3 rounded-xl">
                      <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider flex items-center justify-between">
                        <span>Resume Version History</span>
                        {currentSelectedResume.id === activeResume?.id && (
                          <span className="text-[9px] text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <select
                          id="resume-version-dropdown"
                          value={selectedResumeId || ""}
                          onChange={(e) => setSelectedResumeId(e.target.value)}
                          className="w-full bg-zinc-950 border border-white/10 hover:border-white/20 focus:border-white/30 rounded-xl py-2 px-3 text-xs text-zinc-200 outline-none transition-colors appearance-none cursor-pointer"
                        >
                          {resumes.map((r) => (
                            <option key={r.id} value={r.id}>
                              Version {r.version} — {new Date(r.created_at).toLocaleDateString()} {r.is_active ? "(Active)" : ""}
                            </option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-zinc-500">
                          <Sliders className="w-3 h-3" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Summary extraction preview tags */}
                  <div className="space-y-2.5 pt-1">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Target roles</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {currentSelectedResume.parsed_json.titles?.slice(0, 3).map((title, i) => (
                          <span key={i} className="text-[10px] font-semibold bg-zinc-950 text-zinc-300 border border-white/5 px-2.5 py-1 rounded-full">{title}</span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">skills extracted</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {currentSelectedResume.parsed_json.skills?.slice(0, 5).map((skill, i) => (
                          <span key={i} className="text-[10px] font-mono bg-zinc-950 text-zinc-400 px-2 py-0.5 rounded border border-white/5">{skill}</span>
                        ))}
                        {(currentSelectedResume.parsed_json.skills?.length || 0) > 5 && (
                          <span className="text-[10px] text-zinc-500 font-bold">+{currentSelectedResume.parsed_json.skills.length - 5} more</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Edit profile & Replace upload action trigger */}
                  <div className="pt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setEditingResumeId(currentSelectedResume.id);
                        setCurrentParsedReview(currentSelectedResume.parsed_json);
                      }}
                      className="border border-white/10 hover:border-white/20 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>Edit Roles & Skills</span>
                    </button>
                    <button
                      onClick={triggerFileInput}
                      className="border border-white/10 hover:border-white/20 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload New Version</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Empty Resume State - Prominent drag & drop zone */
                <div 
                  id="dropzone"
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`border border-dashed rounded-2xl p-6 text-center space-y-4 transition-all ${
                    dragActive 
                      ? "border-white bg-zinc-850" 
                      : "border-white/10 bg-zinc-950/40 hover:bg-zinc-950/80"
                  }`}
                >
                  <div className="w-12 h-12 bg-zinc-950 border border-white/5 rounded-2xl flex items-center justify-center mx-auto">
                    {isUploading ? (
                      <div className="w-5 h-5 border-2 border-zinc-400 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Upload className="w-5 h-5 text-zinc-400" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-white">Drag and drop your resume</h3>
                    <p className="text-[10px] text-zinc-500 font-mono">Supports PDF or DOCX format</p>
                  </div>
                  <button
                    onClick={triggerFileInput}
                    disabled={isUploading}
                    className="bg-white hover:bg-zinc-200 text-zinc-950 px-4 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Choose File</span>
                  </button>
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.doc,.txt"
                onChange={handleFileChange}
              />

              {uploadError && (
                <div className="p-3.5 bg-red-950/30 border border-red-900/30 rounded-xl flex items-start gap-2 text-red-400 text-xs leading-relaxed">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>

            {/* 2. Country Selector */}
            <div id="country-block" className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Target Location</h2>
                <Globe className="w-4 h-4 text-zinc-500" />
              </div>
              
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Search Country</label>
                <div className="relative">
                  <select
                    id="country-selector"
                    disabled={!currentSelectedResume || isPipelineRunning}
                    value={profile?.preferred_country || "in"}
                    onChange={(e) => updateCountry(e.target.value)}
                    className="w-full bg-zinc-950 border border-white/10 focus:border-white/30 rounded-xl py-3 px-4 text-sm text-zinc-200 outline-none transition-colors appearance-none cursor-pointer disabled:opacity-50"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-zinc-500 leading-normal font-mono">
                Search jobs from this location using the button below once you're ready.
              </p>
            </div>

            {/* 3. Action button: Search or Activate */}
            {currentSelectedResume && (
              currentSelectedResume.id !== activeResume?.id ? (
                <button
                  id="activate-resume-btn"
                  onClick={() => activateResumeVersion(currentSelectedResume.id)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-4 px-4 rounded-2xl text-xs font-bold tracking-tight cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Set Version {currentSelectedResume.version} as Active</span>
                </button>
              ) : (
                <button
                  id="manual-refresh-btn"
                  onClick={() => triggerManualRefresh(profile?.preferred_country || "in")}
                  disabled={isPipelineRunning}
                  className="w-full bg-white text-zinc-950 py-4 px-4 rounded-2xl text-xs font-bold tracking-tight cursor-pointer hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${isPipelineRunning ? 'animate-spin' : ''}`} />
                  <span>{isPipelineRunning ? "Running matching pipelines..." : "Search For New Jobs"}</span>
                </button>
              )
            )}
          </div>

          {/* ==========================================
              RIGHT COLUMN: RATING CARDS & APPLIED QUEUE
             ========================================== */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Primary Tab Navigation */}
            <div className="flex border-b border-white/5 gap-6">
              <button
                id="tab-btn-matches"
                onClick={() => setActiveTab('matches')}
                className={`pb-4 text-sm font-semibold tracking-tight relative transition-colors cursor-pointer ${
                  activeTab === 'matches' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>Job Matches</span>
                {activeTab === 'matches' && (
                  <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                )}
              </button>

              <button
                id="tab-btn-applied"
                onClick={() => setActiveTab('applied')}
                className={`pb-4 text-sm font-semibold tracking-tight relative transition-colors cursor-pointer ${
                  activeTab === 'applied' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>Recently Applied</span>
                {activeTab === 'applied' && (
                  <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                )}
              </button>
            </div>

            {/* Content Switcher */}
            {activeTab === 'matches' ? (
              <div className="space-y-4">
                {!currentSelectedResume ? (
                  /* Blocked onboarding until resume loaded */
                  <div id="dashboard-blocked-state" className="bg-zinc-900/30 border border-white/5 border-dashed rounded-2xl p-12 text-center space-y-4">
                    <div className="w-14 h-14 bg-zinc-950 border border-white/5 rounded-full flex items-center justify-center mx-auto">
                      <Briefcase className="w-6 h-6 text-zinc-600 animate-pulse" />
                    </div>
                    <div className="max-w-md mx-auto space-y-1.5">
                      <h3 className="text-base font-semibold text-white tracking-tight">Upload your resume to unlock matches</h3>
                      <p className="text-xs text-zinc-500 leading-normal font-mono">
                        Everything else on the dashboard is simply empty/inactive until a resume exists. 
                        Once uploaded, our daily engine will analyze local markets and score jobs automatically!
                      </p>
                    </div>
                  </div>
                ) : isPipelineRunning && activeMatches.length === 0 ? (
                  /* Initial pipeline run state */
                  <div className="bg-zinc-900/20 border border-white/5 rounded-2xl p-12 text-center space-y-4 animate-pulse">
                    <div className="w-10 h-10 border-4 border-zinc-700 border-t-white rounded-full animate-spin mx-auto" />
                    <div>
                      <h4 className="text-white font-semibold">Running Job Matching Pipeline</h4>
                      <p className="text-xs text-zinc-500 mt-1">Downloading, embedding, and scoring jobs. This may take 10-15 seconds...</p>
                    </div>
                  </div>
                ) : activeMatches.length === 0 ? (
                  /* No matches found state */
                  <div className="bg-zinc-900/40 border border-white/5 rounded-2xl p-12 text-center space-y-3">
                    <div className="w-12 h-12 bg-zinc-950 border border-white/5 rounded-full flex items-center justify-center mx-auto">
                      <Sliders className="w-5 h-5 text-zinc-600" />
                    </div>
                    <div>
                      <h4 className="text-white font-semibold">No matched jobs found yet</h4>
                      <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
                        We scanned but found no recent jobs for your profile in {(COUNTRIES.find(c => c.code === profile?.preferred_country) || {name: "selected country"}).name}. 
                        Click "Search for new jobs" or select a different country to run a fresh scan.
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Render shortlist */
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
                      <span className="font-bold uppercase tracking-wider">Shortlisted Matches ({activeMatches.length})</span>
                      <span>Scored using Gemini 1.5 & 2.0</span>
                    </div>

                    <div className="space-y-4">
                      {activeMatches.map((match) => (
                        <RatingCard key={match.id} match={match} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Recently Applied tab component */
              <RecentlyApplied />
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="z-10 border-t border-white/5 bg-zinc-950 py-6 px-6 text-center text-xs text-zinc-600 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>© 2026 JobRadar. Powered by Google Gemini and Supabase.</div>
          <div className="flex gap-4">
            <a href="#" className="hover:text-zinc-400">Help & Support</a>
            <a href="#" className="hover:text-zinc-400">Documentation</a>
          </div>
        </div>
      </footer>

      {/* Parse review modal */}
      {currentParsedReview && <ParsedReviewModal />}
    </div>
  );
}

export default function App() {
  const { user, isLoading } = useApp();

  if (isLoading) {
    return (
      <div id="full-page-loading" className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-4 border-zinc-800 border-t-white rounded-full animate-spin" />
        <span className="text-xs tracking-widest text-zinc-500 uppercase font-semibold font-mono">Initializing JobRadar...</span>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {user ? (
        <MainDashboard key="dashboard" />
      ) : (
        <AuthPage key="auth" />
      )}
    </AnimatePresence>
  );
}
