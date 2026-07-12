import React, { useState } from "react";
import { useApp } from "../context/AppContext.js";
import { ParsedResume } from "../types.js";
import { X, Sparkles, Plus, Trash2, CheckCircle } from "lucide-react";
import { motion } from "motion/react";

export const ParsedReviewModal: React.FC = () => {
  const { 
    currentParsedReview, 
    confirmResume, 
    setCurrentParsedReview, 
    isPipelineRunning,
    editingResumeId,
    setEditingResumeId,
    updateResume 
  } = useApp();
  
  // Local state initialized with the parsed results
  const [skills, setSkills] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [yearsExperience, setYearsExperience] = useState<number>(0);
  const [education, setEducation] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);

  // Temporary input states
  const [newSkill, setNewSkill] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newEd, setNewEd] = useState("");
  const [newTool, setNewTool] = useState("");

  // Sync state whenever currentParsedReview changes
  React.useEffect(() => {
    if (currentParsedReview) {
      setSkills(currentParsedReview.skills || []);
      setTitles(currentParsedReview.titles || []);
      setYearsExperience(currentParsedReview.years_experience || 0);
      setEducation(currentParsedReview.education || []);
      setTools(currentParsedReview.tools || []);
    }
  }, [currentParsedReview]);
  
  if (!currentParsedReview) return null;

  const handleAddSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill("");
    }
  };

  const handleAddTitle = () => {
    if (newTitle.trim() && !titles.includes(newTitle.trim())) {
      setTitles([...titles, newTitle.trim()]);
      setNewTitle("");
    }
  };

  const handleAddEd = () => {
    if (newEd.trim() && !education.includes(newEd.trim())) {
      setEducation([...education, newEd.trim()]);
      setNewEd("");
    }
  };

  const handleAddTool = () => {
    if (newTool.trim() && !tools.includes(newTool.trim())) {
      setTools([...tools, newTool.trim()]);
      setNewTool("");
    }
  };

  const handleConfirm = async () => {
    const updatedResume: ParsedResume = {
      skills,
      titles,
      years_experience: yearsExperience,
      education,
      tools
    };
    if (editingResumeId) {
      await updateResume(editingResumeId, updatedResume);
      setEditingResumeId(null);
    } else {
      await confirmResume(updatedResume);
    }
    setCurrentParsedReview(null);
  };

  const handleClose = () => {
    setCurrentParsedReview(null);
    setEditingResumeId(null);
  };

  return (
    <div id="parsed-review-overlay" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        id="parsed-review-card"
        className="w-full max-w-2xl bg-zinc-900 border border-white/5 rounded-2xl flex flex-col max-h-[90vh] text-zinc-200 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg md:text-xl font-semibold tracking-tight text-white">
              {editingResumeId ? "Edit Resume Profile Data" : "Review Parsed Resume Data"}
            </h2>
          </div>
          <button 
            onClick={handleClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-grow p-6 overflow-y-auto space-y-6">
          <p className="text-sm text-zinc-400 leading-relaxed">
            {editingResumeId 
              ? "Modify the professional dimensions of your active resume. Saving changes will automatically re-analyze the job market."
              : "We used AI to extract core professional dimensions from your resume. Please review the categories below and make corrections as needed before scanning the job market."
            }
          </p>

          {/* Job Titles */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Target / Previous Job Titles</label>
            <div className="flex gap-2">
              <input
                id="add-title-input"
                type="text"
                placeholder="e.g. Senior Frontend Engineer"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTitle())}
                className="flex-grow bg-zinc-950 border border-white/10 focus:border-white/30 rounded-xl px-4 py-2.5 text-sm text-white outline-none placeholder-zinc-650"
              />
              <button 
                onClick={handleAddTitle}
                className="bg-white text-zinc-950 hover:bg-zinc-200 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1.5">
              {titles.map((title, idx) => (
                <span key={idx} className="flex items-center gap-1.5 bg-zinc-950 border border-white/5 text-zinc-300 px-3 py-1.5 rounded-full text-xs">
                  <span>{title}</span>
                  <button onClick={() => setTitles(titles.filter(t => t !== title))} className="text-zinc-500 hover:text-red-400 p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Years of Experience */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Years of Experience</label>
              <span className="text-sm text-white font-mono bg-zinc-950 border border-white/5 px-3 py-1 rounded-lg">{yearsExperience} Years</span>
            </div>
            <input
              id="years-experience-slider"
              type="range"
              min="0"
              max="25"
              step="1"
              value={yearsExperience}
              onChange={(e) => setYearsExperience(parseInt(e.target.value))}
              className="w-full accent-white h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Skills */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Key Professional Skills</label>
            <div className="flex gap-2">
              <input
                id="add-skill-input"
                type="text"
                placeholder="e.g. React, Node.js, System Design"
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSkill())}
                className="flex-grow bg-zinc-950 border border-white/10 focus:border-white/30 rounded-xl px-4 py-2.5 text-sm text-white outline-none placeholder-zinc-650"
              />
              <button 
                onClick={handleAddSkill}
                className="bg-white text-zinc-950 hover:bg-zinc-200 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {skills.map((skill, idx) => (
                <span key={idx} className="flex items-center gap-1.5 bg-zinc-950 border border-white/5 text-zinc-300 px-3 py-1 rounded-full text-xs">
                  <span>{skill}</span>
                  <button onClick={() => setSkills(skills.filter(s => s !== skill))} className="text-zinc-500 hover:text-red-400 p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Tools */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Developer Tools / platforms</label>
            <div className="flex gap-2">
              <input
                id="add-tool-input"
                type="text"
                placeholder="e.g. AWS, Docker, Figma, Git"
                value={newTool}
                onChange={(e) => setNewTool(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTool())}
                className="flex-grow bg-zinc-950 border border-white/10 focus:border-white/30 rounded-xl px-4 py-2.5 text-sm text-white outline-none placeholder-zinc-650"
              />
              <button 
                onClick={handleAddTool}
                className="bg-white text-zinc-950 hover:bg-zinc-200 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {tools.map((tool, idx) => (
                <span key={idx} className="flex items-center gap-1.5 bg-zinc-950 border border-white/5 text-zinc-300 px-3 py-1 rounded-full text-xs">
                  <span>{tool}</span>
                  <button onClick={() => setTools(tools.filter(t => t !== tool))} className="text-zinc-500 hover:text-red-400 p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Education */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Degrees & Certifications</label>
            <div className="flex gap-2">
              <input
                id="add-ed-input"
                type="text"
                placeholder="e.g. B.S. in Computer Science"
                value={newEd}
                onChange={(e) => setNewEd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddEd())}
                className="flex-grow bg-zinc-950 border border-white/10 focus:border-white/30 rounded-xl px-4 py-2.5 text-sm text-white outline-none placeholder-zinc-650"
              />
              <button 
                onClick={handleAddEd}
                className="bg-white text-zinc-950 hover:bg-zinc-200 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {education.map((ed, idx) => (
                <span key={idx} className="flex items-center gap-1.5 bg-zinc-950 border border-white/5 text-zinc-300 px-3 py-1 rounded-full text-xs">
                  <span>{ed}</span>
                  <button onClick={() => setEducation(education.filter(e => e !== ed))} className="text-zinc-500 hover:text-red-400 p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between bg-zinc-950/40">
          <button
            onClick={handleClose}
            className="text-sm font-semibold text-zinc-400 hover:text-white px-4 py-2 rounded-lg"
          >
            Cancel
          </button>
          
          <button
            id="confirm-parsed-resume-btn"
            onClick={handleConfirm}
            disabled={isPipelineRunning || skills.length === 0 || titles.length === 0}
            className="bg-white text-zinc-950 hover:bg-zinc-200 py-2.5 px-6 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPipelineRunning ? (
              <>
                <div className="w-4 h-4 border-2 border-zinc-400 border-t-zinc-950 rounded-full animate-spin" />
                <span>{editingResumeId ? "Saving & Scoring..." : "Running Match Pipeline..."}</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>{editingResumeId ? "Save & Re-score Jobs" : "Confirm & Search Jobs"}</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
