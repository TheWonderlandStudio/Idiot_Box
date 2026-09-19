import React, { useState, useEffect, useCallback } from "react";
import { FolderOpen, CloudDownload, Pin, Plus, RefreshCw, Trash2, Clock, FolderUp, Search, Link2, Star, Loader2, ArrowLeft } from "lucide-react";
import VscodeIcon from "../shared/VscodeIcon.jsx";
import "./hub.css";

const ProjectHub = () => {
  const [recentProjects, setRecentProjects] = useState([]);
  const [pinnedProjects, setPinnedProjects] = useState([]);
  const [newProjectPath, setNewProjectPath] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectLocation, setNewProjectLocation] = useState("");
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingPath, setDeletingPath] = useState(null);
  const [projectPath, setProjectPath] = useState("");
  const [editingPath, setEditingPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);

  // Default location for new project (Documents etc.)
  useEffect(() => {
    if (!showNewProjectDialog || newProjectLocation) return;
    (async () => {
      let def = null;
      try {
        def = await window.electronAPI.getDefaultLocation?.();
      } catch {}
      if (def) {
        setNewProjectLocation(def);
        return;
      }
      // fallback: use parent of first recent/projectPath
      const srcRaw = projectPath || (typeof recentProjects[0] === "string" ? recentProjects[0] : recentProjects[0]?.path) || "";
      const src = typeof srcRaw === "string" ? srcRaw : srcRaw?.path || "";
      if (src) {
        const parent = src.replace(/[\\/][^\\/]+$/, "");
        if (parent) setNewProjectLocation(parent);
      }
    })();
  }, [showNewProjectDialog, newProjectLocation, projectPath, recentProjects]);

  const normalizeRecent = (list) => {
    if (!Array.isArray(list)) return [];
    return list.map((e) => {
      if (typeof e === "string") return { path: e, lastOpened: null };
      if (e && typeof e.path === "string") return { path: e.path, lastOpened: e.lastOpened || null };
      return null;
    }).filter(Boolean);
  };

  const formatLastOpened = (ts) => {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      const date = d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
      const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      return `${date} • ${time}`;
    } catch { return "—"; }
  };

  useEffect(() => {
    const loadRecent = async () => {
      try {
        const result = await window.electronAPI.projectLoadRecent();
        if (result && result.ok) {
          setRecentProjects(normalizeRecent(result.recent));
          setPinnedProjects(result.pinned || []);
        }
        try {
          const cur = await window.electronAPI.getProjectPath();
          if (cur) setProjectPath(cur);
        } catch {}
      } catch (err) {
        console.warn("Failed to load recent projects:", err);
      }
    };
    loadRecent();

    let unsubRecent;
    let unsubPin;
    try {
      unsubRecent = window.electronAPI.onProjectRecentUpdated(({ recent, pinned }) => {
        setRecentProjects(normalizeRecent(recent));
        setPinnedProjects(pinned);
      });
    } catch {}
    try {
      unsubPin = window.electronAPI.onProjectPinUpdated(() => {
        window.electronAPI.projectLoadRecent().then((r) => {
          if (r && r.ok) {
            setRecentProjects(normalizeRecent(r.recent));
            setPinnedProjects(r.pinned);
          }
        });
      });
    } catch {}

    return () => {
      try { unsubRecent?.(); } catch {}
      try { unsubPin?.(); } catch {}
    };
  }, []);

  // vscode-icons: blank folder -> default folder, else framework/language icon
  const getProjectIcon = useCallback((projectPath) => {
    const lower = (projectPath || "").toLowerCase();
    const base = projectPath.split(/[\\/]/).pop() || projectPath;
    // Framework / language detection -> map to a representative file for vscode-icons
    if (lower.includes("react") || lower.includes("next")) {
      return <VscodeIcon name="App.jsx" isDir={false} size={16} />;
    }
    if (lower.includes("vue")) {
      return <VscodeIcon name="App.vue" isDir={false} size={16} />;
    }
    if (lower.includes("angular")) {
      return <VscodeIcon name="angular.json" isDir={false} size={16} />;
    }
    if (lower.includes("python") || lower.includes("django") || lower.includes("flask")) {
      return <VscodeIcon name="main.py" isDir={false} size={16} />;
    }
    if (lower.includes("node") || lower.includes("express") || lower.includes("npm")) {
      return <VscodeIcon name="package.json" isDir={false} size={16} />;
    }
    if (lower.includes("typescript") || lower.includes(" ts")) {
      return <VscodeIcon name="app.ts" isDir={false} size={16} />;
    }
    if (lower.includes("java")) {
      return <VscodeIcon name="Main.java" isDir={false} size={16} />;
    }
    if (lower.includes("go")) {
      return <VscodeIcon name="main.go" isDir={false} size={16} />;
    }
    if (lower.includes("rust")) {
      return <VscodeIcon name="main.rs" isDir={false} size={16} />;
    }
    if (lower.includes("php")) {
      return <VscodeIcon name="index.php" isDir={false} size={16} />;
    }
    // blank / default -> folder icon via vscode-icons (https://github.com/vscode-icons/vscode-icons)
    return <VscodeIcon name={base} isDir={true} size={16} />;
  }, []);

  const addToRecent = useCallback((folderPath) => {
    window.electronAPI.projectAddRecent(folderPath);
  }, []);

  const removeFromRecent = useCallback((folderPath) => {
    window.electronAPI.projectRemoveRecent(folderPath);
  }, []);

  const togglePin = useCallback((folderPath) => {
    window.electronAPI.projectTogglePin(folderPath);
  }, []);

  const openProject = useCallback((folderPath) => {
    window.electronAPI.menuOpenProject(folderPath);
    setShowNewProjectDialog(false);
    setNewProjectPath("");
    setNewProjectName("");
    setNewProjectLocation("");
  }, []);

  const getFullProjectPath = useCallback(() => {
    const name = newProjectName.trim();
    const loc = newProjectLocation.trim();
    if (!name) return "";
    if (!loc) return name;
    // legacy: if location already looks like full path with name, avoid double
    if (loc.endsWith(name) || loc.endsWith(name + "/") || loc.endsWith(name + "\\")) return loc;
    const sep = loc.includes("\\") ? "\\" : "/";
    return loc.replace(/[\\/]+$/, "") + sep + name;
  }, [newProjectName, newProjectLocation]);

  const handleBrowseLocation = useCallback(async () => {
    try {
      const picked = await window.electronAPI.browseFolder();
      if (picked) setNewProjectLocation(picked);
    } catch (err) {
      console.warn("browse failed", err);
    }
  }, []);

  const createNewProject = useCallback(async () => {
    // prefer new panel fields, fallback to legacy single field
    const legacy = newProjectPath.trim();
    const full = getFullProjectPath();
    const target = full || legacy;
    if (!target) return;
    try {
      await window.electronAPI.menuNewProject(target);
      setNewProjectPath("");
      setNewProjectName("");
      setNewProjectLocation("");
      setShowNewProjectDialog(false);
    } catch (err) {
      console.error("Failed to create project:", err);
    }
  }, [newProjectPath, getFullProjectPath]);

  const handleDelete = useCallback(async (folderPath) => {
    const target = folderPath || deletingPath;
    if (!target) return;
    try {
      await window.electronAPI.projectRemoveRecent(target);
      setConfirmDelete(false);
      setDeletingPath(null);
    } catch (err) {
      console.error("Failed to delete recent project:", err);
      setConfirmDelete(false);
      setDeletingPath(null);
    }
  }, [deletingPath]);

  const handleEditPath = useCallback((newPath) => {
    setProjectPath(newPath);
    setEditingPath("");
    window.electronAPI.menuOpenProject(newPath);
  }, []);

  const handleSearch = useCallback(async (page = 1) => {
    const q = searchQuery.trim();
    if (!q) return;
    if (q.includes("github.com") || q.startsWith("http")) {
      handleClone(q);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30&page=${page}`
      );
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const data = await res.json();
      setSearchResults(data.items || []);
      setSearchPage(page);
      const total = data.total_count || 0;
      setSearchHasMore(page * 30 < Math.min(total, 1000));
    } catch (err) {
      console.warn("GitHub search failed", err);
      setSearchResults([]);
      setSearchHasMore(false);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  const handleClone = useCallback(async (url) => {
    const targetUrl = (url || cloneUrl || "").trim();
    if (!targetUrl) return;
    let destParent = newProjectLocation.trim() || projectPath || "";
    try {
      const picked = await window.electronAPI.browseFolder();
      if (picked) destParent = picked;
    } catch {}
    if (!destParent) {
      try { destParent = await window.electronAPI.getDefaultLocation?.(); } catch {}
    }
    if (!destParent) return;
    const repoName = targetUrl.split("/").pop()?.replace(/\.git$/, "").replace(/\/$/, "") || "repo";
    const cleanParent = destParent.replace(/[\\/]+$/, "");
    const sep = cleanParent.includes("\\") ? "\\" : "/";
    const destPath = cleanParent + sep + repoName;
    setCloning(true);
    try {
      const r = await window.electronAPI.gitClone(targetUrl, destPath);
      if (!r || r.ok === false) throw new Error(r?.error || "Clone failed");
      await window.electronAPI.menuNewProject(destPath);
      setShowCloneDialog(false);
      setSearchQuery("");
      setSearchResults([]);
      setCloneUrl("");
    } catch (err) {
      await window.electronAPI.showAlert(`Clone failed:\n${err.message || String(err)}`);
    } finally {
      setCloning(false);
    }
  }, [cloneUrl, newProjectLocation, projectPath]);

  return (
    <div className="phub">
      <div className="phub__header">
        <div className="phub__title">Idiot Box Hub</div>
        <div className="phub__actions">
          <button
            className="phub__btn phub__btn--secondary"
            onClick={async () => {
              await window.electronAPI.openFolder();
            }}
            title="Open Existing Folder"
          >
            <FolderUp size={16} /> Open
          </button>
          <button
            className="phub__btn phub__btn--secondary"
            onClick={() => setShowNewProjectDialog(true)}
            title="New Project"
          >
            <Plus size={16} /> New
          </button>
        </div>
      </div>

      {projectPath && (
        <div className="phub__path-bar">
          <span className="phub__path-label">Current Project:</span>
          <span className="phub__path-value" title={projectPath}>{projectPath}</span>
          <div className="phub__path-actions">
            <button
              className="phub__path-edit phub__btn--tiny"
              onClick={() => setEditingPath(projectPath)}
              title="Edit project path"
            >
              ⋯
            </button>
            <button
              className="phub__path-delete phub__btn--tiny phub__btn--danger"
              onClick={() => {
                setDeletingPath(projectPath);
                setConfirmDelete(true);
              }}
              title="Delete project"
            >
              🗑️
            </button>
          </div>
        </div>
      )}
      {editingPath && (
        <div className="phub__path-bar">
          <span className="phub__path-label">Edit Project Path:</span>
          <input
            className="phub__dialog-input"
            type="text"
            value={editingPath}
            onChange={(e) => setEditingPath(e.target.value.trim())}
            autoComplete="off"
          />
          <button
            className="phub__btn phub__btn--secondary phub__btn--tiny"
            onClick={() => {
              if (editingPath.trim()) {
                handleEditPath(editingPath.trim());
                setEditingPath("");
              }
            }}
          >
            Set
          </button>
          <button
            className="phub__btn phub__btn--secondary phub__btn--tiny"
            onClick={() => setEditingPath("")}
            title="Cancel"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="phub__sidebar">
        <button
          className="phub__sidebar-btn phub__btn--secondary"
          onClick={() => { setShowNewProjectDialog(true); setShowCloneDialog(false); }}
        >
          Create Project
        </button>
        <button
          className="phub__sidebar-btn phub__btn--secondary"
          onClick={() => { setShowCloneDialog(true); setShowNewProjectDialog(false); }}
        >
          <CloudDownload size={14} /> Clone Repo
        </button>
      </div>

      <div className="phub__center">
        {showNewProjectDialog ? (
          <div className="phub__panel phub__panel--create">
            <div className="phub__panel-header">
              <button
                className="phub__panel-back"
                onClick={() => {
                  setShowNewProjectDialog(false);
                  setNewProjectName("");
                  setNewProjectLocation("");
                  setNewProjectPath("");
                }}
                aria-label="Back"
              >
                <ArrowLeft size={16} />
              </button>
              <span className="phub__panel-title">Create Project</span>
            </div>
            <div className="phub__panel-body">
              <div className="phub__dialog-field">
                <label className="phub__dialog-label">Project Name</label>
                <input
                  className="phub__dialog-input"
                  type="text"
                  placeholder="e.g., MyAwesomeApp"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <div className="phub__dialog-field">
                <label className="phub__dialog-label">Save Location</label>
                <div className="phub__dialog-row">
                  <input
                    className="phub__dialog-input phub__dialog-input--flex"
                    type="text"
                    placeholder="Choose folder where project will be created"
                    value={newProjectLocation}
                    onChange={(e) => setNewProjectLocation(e.target.value)}
                    autoComplete="off"
                  />
                  <button className="phub__dialog-browse" onClick={handleBrowseLocation} title="Browse" type="button">
                    <FolderOpen size={14} />
                    Browse
                  </button>
                </div>
              </div>
              {(() => {
                const full = getFullProjectPath();
                const loc = newProjectLocation.trim();
                const preview = full || loc;
                if (!preview) return null;
                const isFull = !!full;
                return (
                  <div className="phub__dialog-field phub__dialog-field--preview">
                    <label className="phub__dialog-label">{isFull ? "Project will be created at" : "Default location"}</label>
                    <div className="phub__dialog-path-preview" title={preview}>
                      <FolderOpen size={12} className="phub__dialog-path-icon" />
                      <span>{preview}{!isFull && loc ? "/<project-name>" : ""}</span>
                    </div>
                    {!isFull && loc ? <span className="phub__dialog-hint">Enter project name to see full path</span> : null}
                  </div>
                );
              })()}
              <div style={{ display: "none" }}>
                <input value={newProjectPath} onChange={(e) => setNewProjectPath(e.target.value)} />
              </div>
            </div>
            <div className="phub__panel-footer">
              <button
                className="phub__dialog-cancel"
                onClick={() => {
                  setShowNewProjectDialog(false);
                  setNewProjectName("");
                  setNewProjectLocation("");
                  setNewProjectPath("");
                }}
              >
                Cancel
              </button>
              <button className="phub__dialog-create" onClick={createNewProject} disabled={!getFullProjectPath() && !newProjectPath.trim()}>
                Create
              </button>
            </div>
          </div>
        ) : showCloneDialog ? (
          <div className="phub__panel phub__panel--clone">
            <div className="phub__panel-header">
              <button
                className="phub__panel-back"
                onClick={() => {
                  setShowCloneDialog(false);
                  setSearchQuery("");
                  setSearchResults([]);
                  setCloneUrl("");
                }}
                aria-label="Back"
              >
                <ArrowLeft size={16} />
              </button>
              <span className="phub__panel-title">Clone Repository</span>
            </div>
            <div className="phub__panel-body">
              <div className="phub__dialog-field">
                <label className="phub__dialog-label">Search GitHub or paste URL</label>
                <div className="phub__dialog-row">
                  <div className="phub__dialog-inputWrap">
                    <Search size={14} className="phub__dialog-inputIcon" />
                    <input
                      className="phub__dialog-input phub__dialog-input--flex"
                      type="text"
                      placeholder="e.g., react or https://github.com/user/repo.git"
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setCloneUrl(e.target.value); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { const v = searchQuery.trim(); if (v.includes("github.com") || v.startsWith("http")) handleClone(v); else handleSearch(); } }}
                      tabIndex={0}
                    />
                  </div>
                  <button className="phub__dialog-browse" onClick={() => { const v = searchQuery.trim(); if (v.includes("github.com") || v.startsWith("http")) handleClone(v); else handleSearch(); }} disabled={searchLoading || cloning || !searchQuery.trim()} title="Search or Clone" tabIndex={0}>
                    {searchLoading || cloning ? <Loader2 size={14} className="phub__spin" /> : <Search size={14} />} Go
                  </button>
                </div>
              </div>
              <div className="phub__dialog-results phub__dialog-results--full">
                {searchLoading ? (
                  <div className="phub__panel-empty"><Loader2 size={16} className="phub__spin" /> Searching…</div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((repo) => (
                    <div key={repo.id} className="phub__dialog-result phub__dialog-result--card">
                      <div className="phub__dialog-result-main">
                        {repo.owner?.avatar_url && (
                          <img
                            src={repo.owner.avatar_url}
                            alt={repo.owner.login || ""}
                            className="phub__dialog-result-avatar"
                            width={24}
                            height={24}
                            loading="lazy"
                          />
                        )}
                        <span className="phub__dialog-result-name" title={repo.full_name}>{repo.full_name}</span>
                        <span className="phub__dialog-result-stars"><Star size={12} /> {repo.stargazers_count?.toLocaleString?.() ?? repo.stargazers_count}</span>
                      </div>
                      {repo.description && <div className="phub__dialog-result-desc" title={repo.description}>{repo.description}</div>}
                      <div className="phub__dialog-result-foot">
                        <span className="phub__dialog-result-url" title={repo.clone_url}>{repo.clone_url}</span>
                        <button className="phub__dialog-cloneBtn" onClick={() => handleClone(repo.clone_url)} disabled={cloning} title={repo.clone_url}>
                          {cloning ? <Loader2 size={12} className="phub__spin" /> : <CloudDownload size={12} />} Clone
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="phub__panel-empty" style={{ padding: "var(--space-16)" }}>No results — try searching or paste a URL above</div>
                )}
              </div>
              {(searchHasMore || searchPage > 1) && (
                <div className="phub__pagination">
                  <button className="phub__pagination-btn" disabled={searchPage <= 1 || searchLoading} onClick={() => handleSearch(searchPage - 1)}>Prev</button>
                  <span className="phub__pagination-info">Page {searchPage}{searchHasMore ? "" : " • end"}</span>
                  <button className="phub__pagination-btn phub__pagination-btn--primary" disabled={!searchHasMore || searchLoading} onClick={() => handleSearch(searchPage + 1)}>Next</button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="phub__panel">
            <div className="phub__panel-header">
              <span className="phub__panel-title">Recent</span>
              <span className="phub__panel-count">{recentProjects.length}</span>
              <button
                className="phub__panel-refresh phub__btn--tiny"
                onClick={() => window.electronAPI.projectRefreshRecent()}
                title="Refresh"
              >
                <Clock size={12} />
              </button>
            </div>
            {recentProjects.length === 0 && (
              <div className="phub__panel-empty">
                No recent projects. <button className="phub__empty-link" onClick={() => setShowNewProjectDialog(true)}>Create first project</button>
              </div>
            )}
            <div className="phub__panel-list">
              {recentProjects.map((entry) => {
                const path = entry.path;
                const name = path.split(/[\\/]/).pop() || path;
                return (
                  <div
                    key={path}
                    className="phub__panel-item"
                    onClick={() => openProject(path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setDeletingPath(path);
                      setConfirmDelete(true);
                    }}
                    title={path}
                  >
                    {getProjectIcon(path)}
                    <div className="phub__panel-main">
                      <span className="phub__panel-name">{name}</span>
                      <span className="phub__panel-path" title={path}>{path}</span>
                    </div>
                    <div className="phub__panel-time phub__panel-time--center" title={entry.lastOpened ? new Date(entry.lastOpened).toString() : ""}>
                      {formatLastOpened(entry.lastOpened)}
                    </div>
                    <div className="phub__panel-actions">
                      <button
                        className="phub__panel-action"
                        onClick={(e) => { e.stopPropagation(); window.electronAPI.revealInExplorer(path); }}
                        title="Open in Files"
                      >
                        <FolderOpen size={14} />
                      </button>
                      <button
                        className="phub__panel-action phub__panel-action--danger"
                        onClick={(e) => { e.stopPropagation(); setDeletingPath(path); setConfirmDelete(true); }}
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {confirmDelete && deletingPath && (
        <div className="phub__dialog-overlay">
          <div className="phub__dialog">
            <div className="phub__dialog-header">
              <h3 className="phub__dialog-title">Remove from Recent</h3>
              <button
                className="phub__dialog-close"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeletingPath(null);
                }}
                aria-label="Cancel"
              >
                Cancel
              </button>
            </div>
            <div className="phub__dialog-body">
              <p>Remove <strong>{deletingPath.split(/[\\/]/).pop() || deletingPath}</strong> from recent projects?</p>
            </div>
            <div className="phub__dialog-footer">
              <button
                className="phub__dialog-cancel"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeletingPath(null);
                }}
              >
                Cancel
              </button>
              <button
                className="phub__dialog-delete"
                onClick={() => handleDelete(deletingPath)}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectHub;
