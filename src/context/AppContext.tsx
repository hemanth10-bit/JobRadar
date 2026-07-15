import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Profile, Resume, JobMatch, ApplicationHistory, ParsedResume, COUNTRIES } from "../types.js";

interface AuthStatus {
  supabaseConfigured: boolean;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
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
  
  login: (email: string, name?: string, password?: string) => Promise<void>;
  signup: (email: string, name: string, password?: string) => Promise<void>;
  logout: () => void;
  uploadResume: (file: File) => Promise<ParsedResume>;
  confirmResume: (parsed: ParsedResume) => Promise<void>;
  triggerManualRefresh: (country: string) => Promise<void>;
  updateMatchStatus: (matchId: string, status: JobMatch['status']) => Promise<void>;
  updateCountry: (country: string) => Promise<void>;
  activateResumeVersion: (resumeId: string) => Promise<void>;
  updateResume: (resumeId: string, parsed: ParsedResume) => Promise<void>;
}

function emailToUUID(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash << 5) - hash + email.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash).toString(16).padEnd(32, 'a');
  return `${seed.substring(0, 8)}-${seed.substring(8, 12)}-4${seed.substring(12, 15)}-a${seed.substring(15, 18)}-${seed.substring(18, 30)}`;
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

  // Single reused Supabase client + current session access token, used to attach
  // Authorization: Bearer <token> to user-scoped API calls so the server can
  // verify caller identity instead of trusting a client-supplied userId.
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const accessTokenRef = useRef<string | null>(null);

  const getOrCreateSupabaseClient = useCallback(async (url: string, anonKey: string) => {
    if (!supabaseRef.current) {
      const { createClient } = await import("@supabase/supabase-js");
      supabaseRef.current = createClient(url, anonKey);
    }
    return supabaseRef.current;
  }, []);

  // Wraps fetch to attach the current Supabase session's bearer token, when one
  // exists. In demo mode (no Supabase session) this behaves like a plain fetch.
  const apiFetch = useCallback((url: string, options: RequestInit = {}) => {
    const token = accessTokenRef.current;
    if (!token) {
      return fetch(url, options);
    }
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  }, []);

  // 1. Fetch system & configuration status on mount
  useEffect(() => {
    fetch("/api/auth/status")
      .then(res => res.json())
      .then(async (data: AuthStatus) => {
        setStatus(data);
        setIsLoading(false);

        // If Supabase is configured, check for a live session!
        if (data.supabaseConfigured && data.supabaseUrl && data.supabaseAnonKey) {
          try {
            const supabase = await getOrCreateSupabaseClient(data.supabaseUrl, data.supabaseAnonKey);

            // Get session
            const { data: { session } } = await supabase.auth.getSession();
            accessTokenRef.current = session?.access_token || null;
            if (session?.user) {
              const googleUser = {
                id: session.user.id,
                email: session.user.email || "",
                name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split("@")[0] || "Google User"
              };

              // Upsert profile in DB
              try {
                await apiFetch("/api/profile", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    user_id: googleUser.id,
                    email: googleUser.email,
                    name: googleUser.name,
                    preferred_country: "us"
                  })
                });
              } catch (pErr) {
                console.error("Error upserting Google profile on load:", pErr);
              }

              localStorage.setItem("jobradar_user", JSON.stringify(googleUser));
              setUser(googleUser);
            } else {
              // Try local user fallback
              const savedUser = localStorage.getItem("jobradar_user");
              if (savedUser) {
                const parsed = JSON.parse(savedUser);
                if (parsed.id && parsed.id.startsWith("usr_")) {
                  parsed.id = emailToUUID(parsed.email);
                  localStorage.setItem("jobradar_user", JSON.stringify(parsed));
                }
                setUser(parsed);
              }
            }

            // Listen for auth state changes
            supabase.auth.onAuthStateChange(async (event, session) => {
              accessTokenRef.current = session?.access_token || null;
              if (session?.user) {
                const googleUser = {
                  id: session.user.id,
                  email: session.user.email || "",
                  name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split("@")[0] || "Google User"
                };

                try {
                  await apiFetch("/api/profile", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      user_id: googleUser.id,
                      email: googleUser.email,
                      name: googleUser.name,
                      preferred_country: "us"
                    })
                  });
                } catch (pErr) {
                  console.error("Error upserting Google profile on change:", pErr);
                }

                localStorage.setItem("jobradar_user", JSON.stringify(googleUser));
                setUser(googleUser);
              }
            });
          } catch (supaErr) {
            console.error("Failed to initialize dynamic client-side Supabase client:", supaErr);
            const savedUser = localStorage.getItem("jobradar_user");
            if (savedUser) {
              const parsed = JSON.parse(savedUser);
              if (parsed.id && parsed.id.startsWith("usr_")) {
                parsed.id = emailToUUID(parsed.email);
                localStorage.setItem("jobradar_user", JSON.stringify(parsed));
              }
              setUser(parsed);
            }
          }
        } else {
          // Standard mock fallback
          const savedUser = localStorage.getItem("jobradar_user");
          if (savedUser) {
            const parsed = JSON.parse(savedUser);
            if (parsed.id && parsed.id.startsWith("usr_")) {
              parsed.id = emailToUUID(parsed.email);
              localStorage.setItem("jobradar_user", JSON.stringify(parsed));
            }
            setUser(parsed);
          }
        }
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

        const savedUser = localStorage.getItem("jobradar_user");
        if (savedUser) {
          const parsed = JSON.parse(savedUser);
          if (parsed.id && parsed.id.startsWith("usr_")) {
            parsed.id = emailToUUID(parsed.email);
            localStorage.setItem("jobradar_user", JSON.stringify(parsed));
          }
          setUser(parsed);
        }
      });
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
        const profRes = await apiFetch(`/api/profile/${user.id}`);
        let profData = null;
        if (profRes.ok) {
          profData = await profRes.json();
        }

        if (!profData) {
          // Create initial profile
          const upsertRes = await apiFetch("/api/profile", {
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
        const resumesRes = await apiFetch(`/api/resumes/${user.id}`);
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
        const matchesRes = await apiFetch(`/api/matches/${user.id}`);
        if (matchesRes.ok) {
          const matchesData = await matchesRes.json();
          setMatches(matchesData);
        }

        // Fetch application history
        const histRes = await apiFetch(`/api/history/${user.id}`);
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
      const matchesRes = await apiFetch(`/api/matches/${user.id}`);
      if (matchesRes.ok) {
        const matchesData = await matchesRes.json();
        setMatches(matchesData);
      }
      const histRes = await apiFetch(`/api/history/${user.id}`);
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData);
      }
    } catch (err) {
      console.error("Error refreshing matches list:", err);
    }
  };

  // Sign-in
  const login = async (email: string, name?: string, password?: string) => {
    const defaultName = name || email.split("@")[0];
    let loggedUser = null;

    if (status?.supabaseConfigured && status.supabaseUrl && status.supabaseAnonKey) {
      try {
        const supabase = await getOrCreateSupabaseClient(status.supabaseUrl, status.supabaseAnonKey);

        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password: password || "default123!"
        });

        if (error) {
          throw error;
        }

        accessTokenRef.current = data.session?.access_token || null;

        if (data.user) {
          loggedUser = {
            id: data.user.id,
            email: data.user.email || email,
            name: data.user.user_metadata?.full_name || data.user.user_metadata?.name || defaultName
          };
        }
      } catch (err: any) {
        console.error("Live Supabase signInWithPassword error, checking if fallback needed:", err);
        throw err;
      }
    }

    if (!loggedUser) {
      loggedUser = {
        id: emailToUUID(email),
        email,
        name: defaultName
      };
    }

    // Save login details (profile) to the database immediately!
    const profileRes = await apiFetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: loggedUser.id,
        email: loggedUser.email,
        name: loggedUser.name,
        preferred_country: "us"
      })
    });
    if (!profileRes.ok) {
      const err = await profileRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save profile to database");
    }

    localStorage.setItem("jobradar_user", JSON.stringify(loggedUser));
    setUser(loggedUser);
  };

  // Sign-up
  const signup = async (email: string, name: string, password?: string) => {
    let loggedUser = null;

    if (status?.supabaseConfigured && status.supabaseUrl && status.supabaseAnonKey) {
      try {
        const supabase = await getOrCreateSupabaseClient(status.supabaseUrl, status.supabaseAnonKey);

        const { data, error } = await supabase.auth.signUp({
          email,
          password: password || "default123!",
          options: {
            data: {
              full_name: name
            }
          }
        });

        if (error) {
          throw error;
        }

        accessTokenRef.current = data.session?.access_token || null;

        // Supabase created the auth.users row, but if email confirmation is
        // required there's no session yet — the server can't authenticate any
        // follow-up requests (like creating the profile row) until the user
        // confirms their email and actually signs in. Stop here and tell them,
        // rather than silently proceeding with an unauthenticated user.
        if (data.user && !data.session) {
          throw new Error(
            "Account created! Check your email to confirm your address, then sign in."
          );
        }

        if (data.user) {
          loggedUser = {
            id: data.user.id,
            email: data.user.email || email,
            name: data.user.user_metadata?.full_name || name
          };
        }
      } catch (err: any) {
        console.error("Live Supabase signUp error:", err);
        throw err;
      }
    }

    if (!loggedUser) {
      loggedUser = {
        id: emailToUUID(email),
        email,
        name
      };
    }

    // Save login details (profile) to the database immediately!
    const profileRes = await apiFetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: loggedUser.id,
        email: loggedUser.email,
        name: loggedUser.name,
        preferred_country: "us"
      })
    });
    if (!profileRes.ok) {
      const err = await profileRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save profile to database");
    }

    localStorage.setItem("jobradar_user", JSON.stringify(loggedUser));
    setUser(loggedUser);
  };

  // Log-out
  const logout = async () => {
    localStorage.removeItem("jobradar_user");
    setUser(null);
    setResumes([]);
    setCurrentParsedReview(null);
    setMatches([]);
    setHistory([]);

    accessTokenRef.current = null;

    if (status?.supabaseConfigured && status.supabaseUrl && status.supabaseAnonKey) {
      try {
        const supabase = await getOrCreateSupabaseClient(status.supabaseUrl, status.supabaseAnonKey);
        await supabase.auth.signOut();
      } catch (err) {
        console.warn("Failed to sign out from Supabase Auth:", err);
      }
    }
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
      const res = await apiFetch("/api/resume/confirm", {
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
      const resumesRes = await apiFetch(`/api/resumes/${user.id}`);
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
      const res = await apiFetch("/api/pipeline/search-match", {
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
    await apiFetch("/api/profile", {
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
      const res = await apiFetch(`/api/matches/${matchId}`, {
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
      const res = await apiFetch("/api/resume/activate", {
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
      const res = await apiFetch("/api/resume/update", {
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
