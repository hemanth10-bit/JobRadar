import React, { createContext, useContext, useState, useEffect } from "react";
import { Profile, Resume, JobMatch, ApplicationHistory, ParsedResume, COUNTRIES } from "../types.js";

interface AuthStatus {
  supabaseConfigured: boolean;
  geminiConfigured: boolean;
  demoMode: boolean;
  message: string;
}

interface AppContextType {
  user: { id: string; email: string; name: string } | null;
  authMode: 'signin' | 'signup';
  setAuthMode: (mode: 'signin' | 'signup') => void;
  status: AuthStatus | null;
  profile: Profile | null;
  activeResume: Resume | null;
  resumes: Resume[];
  matches: JobMatch[];
  history: ApplicationHistory[];
  isLoading: boolean;
  isPipelineRunning: boolean;
  currentParsedReview: ParsedResume | null;
  setCurrentParsedReview: (resume: ParsedResume | null) => void;
  editingResumeId: string | null;
  setEditingResumeId: (id: string | null) => void;
  
  login: (email: string, name?: string) => Promise<void>;
  signup: (email: string, name: string) => Promise<void>;
  logout: () => void;
  uploadResume: (file: File) => Promise<ParsedResume>;
  confirmResume: (parsed: ParsedResume) => Promise<void>;
  triggerManualRefresh: (country: string) => Promise<void>;
  updateMatchStatus: (matchId: string, status: JobMatch['status']) => Promise<void>;
  updateCountry: (country: string) => Promise<void>;
  activateResumeVersion: (resumeId: string) => Promise<void>;
  updateResume: (resumeId: string, parsed: ParsedResume) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeResume, setActiveResume] = useState<Resume | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [matches, setMatches] = useState<JobMatch[]>([]);
  const [history, setHistory] = useState<ApplicationHistory[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPipelineRunning, setIsPipelineRunning] = useState<boolean>(false);
  const [currentParsedReview, setCurrentParsedReview] = useState<ParsedResume | null>(null);
  const [editingResumeId, setEditingResumeId] = useState<string | null>(null);

  // 1. Fetch system & configuration status on mount
  useEffect(() => {
    fetch("/api/auth/status")
      .then(res => res.json())
      .then((data: AuthStatus) => {
        setStatus(data);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch auth status", err);
        setStatus({
          supabaseConfigured: false,
          geminiConfigured: false,
          demoMode: true,
          message: "API service is initializing."
        });
        setIsLoading(false);
      });

    // Load any existing session from localStorage
    const savedUser = localStorage.getItem("jobradar_user");
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
  }, []);

  // 2. Fetch user-scoped profile, resume, matches, history when logged in
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setActiveResume(null);
      setMatches([]);
      setHistory([]);
      return;
    }

    const loadUserData = async () => {
      try {
        // Fetch or create profile
        const profRes = await fetch(`/api/profile/${user.id}`);
        let profData = null;
        if (profRes.ok) {
          profData = await profRes.json();
        }
        
        if (!profData) {
          // Create initial profile
          const upsertRes = await fetch("/api/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: user.id,
              email: user.email,
              name: user.name,
              preferred_country: "us"
            })
          });
          if (upsertRes.ok) {
            profData = await upsertRes.json();
          }
        }
        setProfile(profData);

        // Fetch resumes
        const resumesRes = await fetch(`/api/resumes/${user.id}`);
        if (resumesRes.ok) {
          const resumesData = await resumesRes.json();
          setResumes(resumesData);
          const active = resumesData.find((r: Resume) => r.is_active);
          if (active) {
            setActiveResume(active);
          } else if (resumesData.length > 0) {
            setActiveResume(resumesData[0]);
          }
        }

        // Fetch matches
        const matchesRes = await fetch(`/api/matches/${user.id}`);
        if (matchesRes.ok) {
          const matchesData = await matchesRes.json();
          setMatches(matchesData);
        }

        // Fetch application history
        const histRes = await fetch(`/api/history/${user.id}`);
        if (histRes.ok) {
          const histData = await histRes.json();
          setHistory(histData);
        }
      } catch (err) {
        console.error("Error loading user details:", err);
      }
    };

    loadUserData();
  }, [user]);

  // Handle local state synchronization for matches
  const reloadMatchesAndHistory = async () => {
    if (!user) return;
    try {
      const matchesRes = await fetch(`/api/matches/${user.id}`);
      if (matchesRes.ok) {
        const matchesData = await matchesRes.json();
        setMatches(matchesData);
      }
      const histRes = await fetch(`/api/history/${user.id}`);
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData);
      }
    } catch (err) {
      console.error("Error refreshing matches list:", err);
    }
  };

  // Sign-in
  const login = async (email: string, name?: string) => {
    const defaultName = name || email.split("@")[0];
    const loggedUser = {
      id: "usr_" + email.replace(/[^a-zA-Z0-9]/g, ""),
      email,
      name: defaultName
    };
    localStorage.setItem("jobradar_user", JSON.stringify(loggedUser));
    setUser(loggedUser);
  };

  // Sign-up
  const signup = async (email: string, name: string) => {
    await login(email, name);
  };

  // Log-out
  const logout = () => {
    localStorage.removeItem("jobradar_user");
    setUser(null);
    setResumes([]);
    setCurrentParsedReview(null);
  };

  // Upload Resume file for parsing
  const uploadResume = async (file: File): Promise<ParsedResume> => {
    const formData = new FormData();
    formData.append("resume", file);

    const res = await fetch("/api/resume/parse", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to parse resume");
    }

    const data = await res.json();
    setCurrentParsedReview(data.parsed);
    return data.parsed;
  };

  // Confirm and save resume, triggers background job search + matching
  const confirmResume = async (parsed: ParsedResume) => {
    if (!user) return;
    setIsPipelineRunning(true);
    try {
      const res = await fetch("/api/resume/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          parsedResume: parsed,
          rawFileUrl: "uploaded_resume.pdf"
        })
      });

      if (!res.ok) {
        throw new Error("Failed to save and analyze resume");
      }

      const data = await res.json();
      setActiveResume(data.resume);
      setCurrentParsedReview(null);
      
      // Fetch resumes
      const resumesRes = await fetch(`/api/resumes/${user.id}`);
      if (resumesRes.ok) {
        const resumesData = await resumesRes.json();
        setResumes(resumesData);
      }
      
      // Reload job matching records
      await reloadMatchesAndHistory();
    } finally {
      setIsPipelineRunning(false);
    }
  };

  // Manually search and score jobs on demand
  const triggerManualRefresh = async (country: string) => {
    if (!user) return;
    setIsPipelineRunning(true);
    try {
      const res = await fetch("/api/pipeline/search-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          country,
          bypassCronCheck: true // client trigger
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Search and rating failed");
      }

      const data = await res.json();
      setMatches(data.matches);
      
      // Update local profile representation
      if (profile) {
        setProfile({ ...profile, preferred_country: country });
      }
    } finally {
      setIsPipelineRunning(false);
    }
  };

  // Update preferred country in profile
  const updateCountry = async (country: string) => {
    if (!user || !profile) return;
    const updatedProfile = { ...profile, preferred_country: country };
    setProfile(updatedProfile);
    
    // Save to server
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedProfile)
    });

    // Auto-trigger refresh for the new country
    await triggerManualRefresh(country);
  };

  // Mark job applied / saved / viewed etc.
  const updateMatchStatus = async (matchId: string, status: JobMatch['status']) => {
    if (!user) return;
    try {
      const res = await fetch(`/api/matches/${matchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          status
        })
      });

      if (res.ok) {
        await reloadMatchesAndHistory();
      }
    } catch (err) {
      console.error("Failed to update status", err);
    }
  };

  const activateResumeVersion = async (resumeId: string) => {
    if (!user) return;
    try {
      const res = await fetch("/api/resume/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, resumeId })
      });
      if (res.ok) {
        const data = await res.json();
        // Update local resumes list
        setResumes(prev => prev.map(r => ({ ...r, is_active: r.id === resumeId })));
        setActiveResume(data.resume);
        // Reload job matching records scored for this version
        await reloadMatchesAndHistory();
      }
    } catch (err) {
      console.error("Failed to activate resume version:", err);
    }
  };

  const updateResume = async (resumeId: string, parsed: ParsedResume) => {
    if (!user) return;
    setIsPipelineRunning(true);
    try {
      const res = await fetch("/api/resume/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          resumeId,
          parsedResume: parsed
        })
      });

      if (!res.ok) {
        throw new Error("Failed to update resume and re-analyze");
      }

      const data = await res.json();
      
      // Update local resumes list and active resume
      setResumes(prev => prev.map(r => r.id === resumeId ? data.resume : r));
      if (activeResume && activeResume.id === resumeId) {
        setActiveResume(data.resume);
      }
      
      // Reload job matching records scored for this version
      await reloadMatchesAndHistory();
    } catch (err) {
      console.error("Failed to update resume:", err);
    } finally {
      setIsPipelineRunning(false);
    }
  };

  return (
    <AppContext.Provider value={{
      user,
      authMode,
      setAuthMode,
      status,
      profile,
      activeResume,
      resumes,
      matches,
      history,
      isLoading,
      isPipelineRunning,
      currentParsedReview,
      setCurrentParsedReview,
      editingResumeId,
      setEditingResumeId,
      login,
      signup,
      logout,
      uploadResume,
      confirmResume,
      triggerManualRefresh,
      updateMatchStatus,
      updateCountry,
      activateResumeVersion,
      updateResume
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
};
