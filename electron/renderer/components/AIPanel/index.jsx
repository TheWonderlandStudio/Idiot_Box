// AI Panel — OpenCode AI Assistant with full app control
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Send, Mic, X, Copy, RotateCw, FileText, Image, Terminal, GitBranch, Globe, Search, Settings, FolderOpen, Maximize2, Minimize2, Plus, Trash2, Sparkles, MessageSquare, Code, Layout, Wifi, RefreshCw } from "lucide-react";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#cccccc", overflow: "hidden", fontFamily: "'Segoe UI',system-ui,sans-serif", minHeight: "100%", minWidth: "100%" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0, gap: 8 },
  title: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#e0e0e0" },
  iconBtn: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", cursor: "pointer", padding: "5px 8px", borderRadius: 4, fontSize: 12, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  messages: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  msgRow: { display: "flex", gap: 10, maxWidth: "85%" },
  msgRowUser: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  msgRowBot: { alignSelf: "flex-start" },
  avatar: { width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12 },
  avatarUser: { background: "#007acc", color: "#fff" },
  avatarBot: { background: "#4ec9b0", color: "#000" },
  bubble: { padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  bubbleUser: { background: "#007acc", color: "#fff", borderBottomRightRadius: 4 },
  bubbleBot: { background: "#2d2d2d", color: "#e0e0e0", border: "1px solid #3a3a3a", borderBottomLeftRadius: 4 },
  actionBtn: { fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #3a3a3a", background: "transparent", color: "#888", cursor: "pointer", marginLeft: 8 },
  inputWrap: { display: "flex", gap: 8, padding: "10px", background: "#252526", borderTop: "1px solid #2d2d2d", flexShrink: 0 },
  input: { flex: 1, background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#e0e0e0", borderRadius: 6, padding: "10px 14px", fontSize: 13, outline: "none", resize: "none", minHeight: 44, maxHeight: 160, fontFamily: "inherit", lineHeight: 1.5 },
  sendBtn: { background: "#4ec9b0", color: "#000", border: "none", borderRadius: 6, padding: "0 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", minWidth: 44 },
  sendBtnDisabled: { opacity: 0.4, cursor: "not-allowed" },
  quickActions: { display: "flex", flexWrap: "wrap", gap: 6, padding: "0 10px 10px" },
  quickBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#252526", border: "1px solid #3a3a3a", borderRadius: 4, fontSize: 11, color: "#ccc", cursor: "pointer", transition: "all 0.15s" },
  loading: { display: "flex", alignItems: "center", gap: 8, color: "#888", fontSize: 12, padding: "4px 0" },
  spinner: { width: 14, height: 14, border: "2px solid #4ec9b0", borderTopColor: "transparent", borderRadius: "50%", animationName: "spin", animationDuration: "0.8s", animationTimingFunction: "linear", animationIterationCount: "infinite" },
  codeBlock: { background: "#111", border: "1px solid #2d2d2d", borderRadius: 6, padding: 10, marginTop: 8, fontFamily: "Consolas, monospace", fontSize: 11, overflow: "auto", maxHeight: 300 },
  codeHeader: { display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10, color: "#888" },
  toolCall: { background: "#1a2a2a", border: "1px solid #2a5a5a", borderRadius: 6, padding: "8px 10px", marginTop: 8, fontSize: 11, color: "#4ec9b0", fontFamily: "Consolas, monospace" },
  toolResult: { background: "#1a1a2a", border: "1px solid #2a2a5a", borderRadius: 6, padding: "8px 10px", marginTop: 8, fontSize: 11, color: "#569cd6", fontFamily: "Consolas, monospace", maxHeight: 200, overflow: "auto" },
};

const QUICK_ACTIONS = [
  { id: "openFile", label: "Open File", icon: FileText, desc: "Open any file in editor" },
  { id: "searchFiles", label: "Find File", icon: Search, desc: "Search files by name" },
  { id: "searchText", label: "Search Text", icon: MessageSquare, desc: "Search text in project" },
  { id: "openTerminal", label: "Terminal", icon: Terminal, desc: "Open new terminal" },
  { id: "openGit", label: "Git", icon: GitBranch, desc: "Open Git panel" },
  { id: "openBrowser", label: "Browser", icon: Globe, desc: "Open browser panel" },
  { id: "openPorts", label: "Ports", icon: Wifi, desc: "Open Ports panel" },
  { id: "openCanvas", label: "Canvas", icon: Layout, desc: "Visual project map" },
  { id: "openProject", label: "Open Project", icon: FolderOpen, desc: "Open a project folder" },
  { id: "settings", label: "Settings", icon: Settings, desc: "Open settings" },
];

const SYSTEM_PROMPT = `You are OpenCode AI, an AI assistant integrated into the Idiot Box IDE. You have full control over the application through function calls.

Available tools:
- openFile: Open a file in the code editor (path: string)
- openMedia: Open image/video in media viewer (path: string)
- openBrowser: Open a URL in the internal browser (url: string, title?: string)
- openTerminal: Open a new terminal panel (cwd?: string)
- runTerminalCommand: Run a command in the active terminal (command: string, cwd?: string)
- openGit: Open the Git panel
- openPorts: Open the Ports panel
- openCanvas: Open the Canvas (visual project map)
- searchFiles: Search files by name (query: string, limit?: number)
- searchText: Search text content in project (query: string, limit?: number)
- gitStatus: Get git status of current project
- gitDiff: Get diff for a file (filePath: string)
- gitCommit: Commit staged changes (message: string)
- gitStage: Stage a file (filePath: string)
- gitStageAll: Stage all changes
- gitUnstage: Unstage a file (filePath: string)
- gitDiscard: Discard changes in a file (filePath: string)
- openProject: Open a project folder (path: string)
- getProjectPath: Get current project path
- listFiles: List files in a directory (dirPath: string)
- readFile: Read file content (filePath: string)
- writeFile: Write file content (filePath: string, content: string)
- createFile: Create a new file (parentPath: string, name: string)
- createFolder: Create a new folder (parentPath: string, name: string)
- deleteFile: Delete a file/folder (path: string)
- openSettings: Open settings window
- resetLayout: Reset window layout to default
- toggleFullscreen: Toggle fullscreen mode

When the user asks you to do something, use the appropriate tool. Explain what you're doing before calling tools.`;

function AIPanel({ nodeId }) {
  console.log("[AIPanel] Mounted, nodeId:", nodeId, "projectPath:", window.__currentProjectPath);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hello! I'm OpenCode AI. I can help you with coding tasks, file operations, git, terminal, and more. What would you like to do?", toolCalls: null, toolResults: null },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [projectPath, setProjectPath] = useState(() => window.__currentProjectPath || null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => {
    const onOpened = (e) => setProjectPath(e.detail?.path || window.__currentProjectPath || null);
    const onClosed = () => setProjectPath(null);
    window.addEventListener("project:opened", onOpened);
    window.addEventListener("project:closed", onClosed);
    return () => { window.removeEventListener("project:opened", onOpened); window.removeEventListener("project:closed", onClosed); };
  }, []);

  const addMessage = (role, content, toolCalls, toolResults) => {
    setMessages(prev => [...prev, { role, content, toolCalls, toolResults, id: Date.now() + Math.random() }]);
  };

  const executeTool = async (name, args) => {
    try {
      switch (name) {
        case "openFile": {
          const path = args.path;
          window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path } }));
          return { success: true, message: `Opened ${path} in editor` };
        }
        case "openMedia": {
          const path = args.path;
          window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path } }));
          return { success: true, message: `Opened ${path} in media viewer` };
        }
        case "openBrowser": {
          const { url, title } = args;
          window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url, config: { type: "browser", title: title || "Browser", url } } }));
          return { success: true, message: `Opened ${url} in browser` };
        }
        case "openTerminal": {
          window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { location: "BOTTOM", cwd: args.cwd || projectPath } }));
          return { success: true, message: "Opened new terminal" };
        }
        case "runTerminalCommand": {
          window.dispatchEvent(new CustomEvent("terminal:command", { detail: { cmd: "send", data: args.command + "\n", cwd: args.cwd || projectPath } }));
          return { success: true, message: `Sent command: ${args.command}` };
        }
        case "openGit": {
          window.dispatchEvent(new CustomEvent("add-git-panel"));
          return { success: true, message: "Opened Git panel" };
        }
        case "openPorts": {
          window.dispatchEvent(new CustomEvent("add-ports-panel"));
          return { success: true, message: "Opened Ports panel" };
        }
        case "openCanvas": {
          window.dispatchEvent(new CustomEvent("add-canvas-panel"));
          return { success: true, message: "Opened Canvas panel" };
        }
        case "searchFiles": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.findFiles(projectPath, args.query, args.limit || 50);
          return { success: true, data: res };
        }
        case "searchText": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.searchText(projectPath, args.query, args.limit || 100);
          return { success: true, data: res };
        }
        case "gitStatus": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.gitStatus(projectPath);
          return { success: true, data: res };
        }
        case "gitDiff": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.gitDiff(projectPath, args.filePath);
          return { success: true, data: res };
        }
        case "gitCommit": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.gitCommit(projectPath, args.message);
          return { success: res.ok, message: res.ok ? "Committed successfully" : res.error };
        }
        case "gitStage": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.gitStage(projectPath, args.filePath);
          return { success: res.ok, message: res.ok ? "Staged" : res.error };
        }
        case "gitStageAll": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.gitStageAll(projectPath);
          return { success: res.ok, message: res.ok ? "All changes staged" : res.error };
        }
        case "gitUnstage": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.gitUnstage(projectPath, args.filePath);
          return { success: res.ok, message: res.ok ? "Unstaged" : res.error };
        }
        case "gitDiscard": {
          if (!projectPath) return { success: false, message: "No project open" };
          const res = await window.electronAPI.gitDiscard(projectPath, args.filePath);
          return { success: res.ok, message: res.ok ? "Changes discarded" : res.error };
        }
        case "openProject": {
          await window.electronAPI.openFolder();
          return { success: true, message: "Opening project dialog..." };
        }
        case "getProjectPath": {
          return { success: true, data: projectPath };
        }
        case "listFiles": {
          if (!args.dirPath && !projectPath) return { success: false, message: "No directory specified" };
          const res = await window.electronAPI.readDirAll(args.dirPath || projectPath);
          return { success: true, data: res };
        }
        case "readFile": {
          const res = await window.electronAPI.readTextFile(args.filePath);
          return { success: true, data: res };
        }
        case "writeFile": {
          const res = await window.electronAPI.writeFileText(args.filePath, args.content);
          return { success: res.success, message: res.success ? "File written" : res.error };
        }
        case "createFile": {
          const res = await window.electronAPI.newFile(args.parentPath, args.name);
          return { success: res.success, message: res.success ? "File created" : res.error };
        }
        case "createFolder": {
          const res = await window.electronAPI.newFolder(args.parentPath, args.name);
          return { success: res.success, message: res.success ? "Folder created" : res.error };
        }
        case "deleteFile": {
          const res = await window.electronAPI.deleteItem(args.path);
          return { success: res.success, message: res.success ? "Deleted" : res.error };
        }
        case "openSettings": {
          window.electronAPI.openSettingsWindow?.();
          return { success: true, message: "Opened settings" };
        }
        case "resetLayout": {
          window.dispatchEvent(new CustomEvent("menu:action", { detail: { cmd: "resetLayout" } }));
          return { success: true, message: "Layout reset to default" };
        }
        case "toggleFullscreen": {
          window.dispatchEvent(new CustomEvent("app:fullscreen"));
          return { success: true, message: "Toggled fullscreen" };
        }
        default:
          return { success: false, message: `Unknown tool: ${name}` };
      }
    } catch (e) {
      return { success: false, message: e?.message || String(e) };
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userInput = input.trim();
    setInput("");
    setLoading(true);

    addMessage("user", userInput);

    abortControllerRef.current = new AbortController();

    try {
      // Simple intent detection for quick actions without LLM
      const lower = userInput.toLowerCase();
      let toolCalls = [];
      let toolResults = [];

      // Quick local actions
      if (lower.includes("open git") || lower === "git") {
        toolCalls.push({ name: "openGit", args: {} });
      } else if (lower.includes("open ports") || lower === "ports") {
        toolCalls.push({ name: "openPorts", args: {} });
      } else if (lower.includes("open canvas") || lower === "canvas") {
        toolCalls.push({ name: "openCanvas", args: {} });
      } else if (lower.includes("open terminal") || lower === "terminal") {
        toolCalls.push({ name: "openTerminal", args: {} });
      } else if (lower.includes("open browser") || lower.startsWith("http")) {
        const url = lower.startsWith("http") ? userInput : "https://www.google.com";
        toolCalls.push({ name: "openBrowser", args: { url } });
      } else if (lower.includes("reset layout")) {
        toolCalls.push({ name: "resetLayout", args: {} });
      } else if (lower.includes("fullscreen")) {
        toolCalls.push({ name: "toggleFullscreen", args: {} });
      } else if (lower.includes("open settings") || lower === "settings") {
        toolCalls.push({ name: "openSettings", args: {} });
      } else if (lower.includes("open project")) {
        toolCalls.push({ name: "openProject", args: {} });
      } else if (lower.startsWith("open ") && (lower.includes(".png") || lower.includes(".jpg") || lower.includes(".jpeg") || lower.includes(".gif") || lower.includes(".webp") || lower.includes(".mp4") || lower.includes(".webm"))) {
        const path = userInput.slice(5).trim();
        toolCalls.push({ name: "openMedia", args: { path } });
      } else if (lower.startsWith("open ") && (lower.includes(".") || lower.includes("/") || lower.includes("\\"))) {
        const path = userInput.slice(5).trim();
        toolCalls.push({ name: "openFile", args: { path } });
      } else if (lower.startsWith("search ") || lower.startsWith("find ")) {
        const query = userInput.slice(userInput.indexOf(" ") + 1).trim();
        if (query) {
          toolCalls.push({ name: "searchFiles", args: { query } });
        }
      } else if (lower.startsWith("grep ") || lower.startsWith("search text ")) {
        const query = userInput.slice(userInput.indexOf(" ") + 1).trim();
        if (query) {
          toolCalls.push({ name: "searchText", args: { query } });
        }
      } else if (lower.includes("git status")) {
        toolCalls.push({ name: "gitStatus", args: {} });
      } else if (lower.startsWith("git diff ")) {
        const filePath = userInput.slice(9).trim();
        toolCalls.push({ name: "gitDiff", args: { filePath } });
      } else if (lower.startsWith("git commit ")) {
        const message = userInput.slice(11).trim();
        toolCalls.push({ name: "gitCommit", args: { message } });
      } else if (lower.startsWith("git stage ") || lower.startsWith("git add ")) {
        const filePath = userInput.split(" ").slice(2).join(" ").trim();
        if (filePath === "all" || filePath === ".") {
          toolCalls.push({ name: "gitStageAll", args: {} });
        } else {
          toolCalls.push({ name: "gitStage", args: { filePath } });
        }
      } else if (lower.startsWith("git unstage ")) {
        const filePath = userInput.slice(12).trim();
        toolCalls.push({ name: "gitUnstage", args: { filePath } });
      } else if (lower.startsWith("git discard ")) {
        const filePath = userInput.slice(12).trim();
        toolCalls.push({ name: "gitDiscard", args: { filePath } });
      } else if (lower.startsWith("list ") || lower.startsWith("ls ")) {
        const dirPath = userInput.slice(userInput.indexOf(" ") + 1).trim() || projectPath;
        toolCalls.push({ name: "listFiles", args: { dirPath } });
      } else if (lower.startsWith("read ")) {
        const filePath = userInput.slice(5).trim();
        toolCalls.push({ name: "readFile", args: { filePath } });
      } else if (lower.startsWith("write ")) {
        const parts = userInput.slice(6).trim().split(" ");
        const filePath = parts[0];
        const content = parts.slice(1).join(" ");
        toolCalls.push({ name: "writeFile", args: { filePath, content } });
      }

      // Execute all tool calls
      for (const call of toolCalls) {
        const result = await executeTool(call.name, call.args);
        toolResults.push({ name: call.name, args: call.args, result });
      }

      // Generate response
      let response = "";
      if (toolCalls.length > 0) {
        response = "Done! ";
        for (const tr of toolResults) {
          if (tr.result.success) {
            response += tr.result.message + " ";
          } else {
            response += `Error: ${tr.result.message} `;
          }
        }
        if (toolResults.some(tr => tr.name === "searchFiles" && tr.result.data?.length)) {
          const files = toolResults.find(tr => tr.name === "searchFiles").result.data;
          response += "\n\nFound " + files.length + " files:\n" + files.slice(0, 10).map(f => `- ${f.rel || f.name}`).join("\n");
          if (files.length > 10) response += "\n... and " + (files.length - 10) + " more";
        }
        if (toolResults.some(tr => tr.name === "searchText" && tr.result.data?.length)) {
          const results = toolResults.find(tr => tr.name === "searchText").result.data;
          response += "\n\nFound " + results.length + " matches:\n" + results.slice(0, 5).map(r => `${r.rel}:${r.line} - ${r.preview}`).join("\n");
        }
        if (toolResults.some(tr => tr.name === "gitStatus" && tr.result.data?.length)) {
          const status = toolResults.find(tr => tr.name === "gitStatus").result.data;
          response += "\n\nGit Status (" + status.length + " files):\n" + status.slice(0, 15).map(f => `${f.status} ${f.rel}`).join("\n");
        }
        if (toolResults.some(tr => tr.name === "gitDiff" && tr.result.data)) {
          const diff = toolResults.find(tr => tr.name === "gitDiff").result.data;
          response += "\n\n```diff\n" + diff.slice(0, 2000) + (diff.length > 2000 ? "\n... (truncated)" : "") + "\n```";
        }
        if (toolResults.some(tr => tr.name === "listFiles" && tr.result.data?.length)) {
          const files = toolResults.find(tr => tr.name === "listFiles").result.data;
          response += "\n\nFiles:\n" + files.map(f => `${f.isDir ? "📁" : "📄"} ${f.name}`).join("\n");
        }
        if (toolResults.some(tr => tr.name === "readFile" && tr.result.data)) {
          const content = toolResults.find(tr => tr.name === "readFile").result.data;
          response += "\n\n```\n" + content.slice(0, 3000) + (content.length > 3000 ? "\n... (truncated)" : "") + "\n```";
        }
      } else {
        // Fallback: simple chat response
        response = "I can help you with that! Try commands like:\n- `open <file>` - Open file in editor\n- `open <image/video>` - Open in media viewer\n- `search <query>` - Find files\n- `grep <query>` - Search text in project\n- `git status` - Show git status\n- `git diff <file>` - Show diff\n- `git commit <msg>` - Commit\n- `git stage <file>` / `git stage all` - Stage changes\n- `open terminal` - New terminal\n- `open browser <url>` - Open browser\n- `open git` / `open ports` / `open canvas` - Open panels\n- `list [dir]` - List directory\n- `read <file>` - Read file\n- `write <file> <content>` - Write file\n- `reset layout` - Reset layout\n- `fullscreen` - Toggle fullscreen";
      }

      addMessage("assistant", response, toolCalls.length > 0 ? toolCalls : null, toolResults.length > 0 ? toolResults : null);
    } catch (e) {
      addMessage("assistant", "Error: " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (action) => {
    switch (action.id) {
      case "openFile":
      case "searchFiles":
      case "searchText":
        inputRef.current?.focus();
        break;
      case "openTerminal":
        window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { location: "BOTTOM" } }));
        break;
      case "openGit":
        window.dispatchEvent(new CustomEvent("add-git-panel"));
        break;
      case "openBrowser":
        window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: "https://www.google.com", config: { type: "browser", title: "Browser", url: "https://www.google.com" } } }));
        break;
      case "openPorts":
        window.dispatchEvent(new CustomEvent("add-ports-panel"));
        break;
      case "openCanvas":
        window.dispatchEvent(new CustomEvent("add-canvas-panel"));
        break;
      case "openProject":
        window.electronAPI.openFolder();
        break;
      case "settings":
        window.electronAPI.openSettingsWindow?.();
        break;
    }
  };

  const clearChat = () => {
    setMessages([{ role: "assistant", content: "Chat cleared. How can I help you?", toolCalls: null, toolResults: null }]);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>
          <Sparkles style={{ width: 16, height: 16, color: "#4ec9b0" }} />
          <span>OpenCode AI</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {nodeId && (
            <button onClick={() => window.dispatchEvent(new CustomEvent("close-flex-tab", { detail: { nodeId } }))} title="Close panel" style={s.iconBtn}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div style={s.quickActions}>
        {QUICK_ACTIONS.map(a => (
          <button key={a.id} onClick={() => handleQuickAction(a)} title={a.desc} style={s.quickBtn}
            onMouseEnter={e => { e.currentTarget.style.background = "#2a2d2e"; e.currentTarget.style.borderColor = "#007acc"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#252526"; e.currentTarget.style.borderColor = "#2d2d2d"; }}>
            <a.icon size={14} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      <div style={s.messages} role="log" aria-live="polite">
        {messages.map((msg, i) => (
          <div key={msg.id} style={[s.msgRow, msg.role === "user" ? s.msgRowUser : s.msgRowBot]}>
            <div style={[s.avatar, msg.role === "user" ? s.avatarUser : s.avatarBot]}>
              {msg.role === "user" ? <MessageSquare size={14} /> : <Sparkles size={14} />}
            </div>
            <div style={[s.bubble, msg.role === "user" ? s.bubbleUser : s.bubbleBot]}>
              <div>{msg.content}</div>
              {msg.toolCalls && msg.toolCalls.map((tc, idx) => (
                <div key={idx} style={s.toolCall}>
                  ▸ {tc.name}({JSON.stringify(tc.args).slice(0, 100)})
                </div>
              ))}
              {msg.toolResults && msg.toolResults.map((tr, idx) => (
                <div key={idx} style={s.toolResult}>
                  ▾ {tr.name}: {tr.result.success ? "✓" : "✗"} {tr.result.message || (tr.result.data ? "Done" : "")}
                  {tr.result.data && typeof tr.result.data === "object" && !Array.isArray(tr.result.data) && tr.result.data.content && (
                    <div style={{ marginTop: 4, fontSize: 10, color: "#888", whiteSpace: "pre-wrap", maxHeight: 100, overflow: "auto" }}>
                      {String(tr.result.data.content).slice(0, 500)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {loading && (
          <div key="loading" style={[s.msgRow, s.msgRowBot]}>
            <div style={s.avatarBot}><Sparkles size={14} /></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#2d2d2d", border: "1px solid #3a3a3a", borderRadius: 12, borderBottomLeftRadius: 4 }}>
              <div style={s.spinner} />
              <span>Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={s.inputWrap}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={projectPath ? "Ask me anything... (Enter to send, Shift+Enter for new line)" : "Open a project first, then ask me anything..."}
          disabled={loading || !projectPath}
          style={s.input}
          rows={1}
        />
        <button onClick={handleSend} disabled={loading || !input.trim() || !projectPath} style={[s.sendBtn, (loading || !input.trim() || !projectPath) && s.sendBtnDisabled]}>
          <Send size={16} />
</button>
</div>
      </div>
    );
  }

export default AIPanel;