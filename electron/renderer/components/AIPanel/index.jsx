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
    { role: "assistant", content: "Hello! I'm OpenCode AI. I can help you with coding tasks, file operations, git, terminal, and more. I'm connecting to the OpenCode server...", toolCalls: null, toolResults: null },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [projectPath, setProjectPath] = useState(() => window.__currentProjectPath || null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [installingCLI, setInstallingCLI] = useState(false);
  const [serverPassword, setServerPassword] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
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

  // Initialize OpenCode SDK via IPC
  useEffect(() => {
    const initSDK = async () => {
      try {
        setConnectionStatus("connecting");
        const result = await window.electronAPI.opencodeInit({
          hostname: "127.0.0.1",
          port: 4096,
        });
        
        if (result.success) {
          setConnectionStatus("connected");
          console.log("[AIPanel] OpenCode SDK connected:", result.url);
          // Update initial message to show successful connection
          setMessages(prev => [{
            role: "assistant",
            content: "Hello! I'm OpenCode AI. I can help you with coding tasks, file operations, git, terminal, and more. I'm connected and ready to help!",
            toolCalls: null,
            toolResults: null,
            id: Date.now() + Math.random()
          }]);
        } else {
          setConnectionStatus("error");
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `Failed to connect to OpenCode AI server: ${result.error}. Make sure the OpenCode server is running on 127.0.0.1:4096.`,
            toolCalls: null,
            toolResults: null,
            id: Date.now() + Math.random()
          }]);
        }
      } catch (error) {
        console.error("[AIPanel] Failed to connect to OpenCode SDK:", error);
        setConnectionStatus("error");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Failed to connect to OpenCode AI server. Make sure the OpenCode server is running on 127.0.0.1:4096.",
          toolCalls: null,
          toolResults: null,
          id: Date.now() + Math.random()
        }]);
      }
    };

    initSDK();
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
      if (connectionStatus !== "connected") {
        addMessage("assistant", "OpenCode AI is not connected. Please make sure the OpenCode server is running on 127.0.0.1:4096.");
        setLoading(false);
        return;
      }

      // Prepare conversation history for the SDK
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Add current user message
      conversationHistory.push({ role: "user", content: userInput });

      // Define tools for the AI
      const tools = [
        {
          name: "openFile",
          description: "Open a file in the code editor",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path to open" }
            },
            required: ["path"]
          }
        },
        {
          name: "openMedia",
          description: "Open image/video in media viewer",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Media file path" }
            },
            required: ["path"]
          }
        },
        {
          name: "openBrowser",
          description: "Open a URL in the internal browser",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to open" },
              title: { type: "string", description: "Tab title (optional)" }
            },
            required: ["url"]
          }
        },
        {
          name: "openTerminal",
          description: "Open a new terminal panel",
          parameters: {
            type: "object",
            properties: {
              cwd: { type: "string", description: "Working directory (optional)" }
            }
          }
        },
        {
          name: "runTerminalCommand",
          description: "Run a command in the active terminal",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Command to run" },
              cwd: { type: "string", description: "Working directory (optional)" }
            },
            required: ["command"]
          }
        },
        {
          name: "openGit",
          description: "Open the Git panel",
          parameters: { type: "object" }
        },
        {
          name: "openPorts",
          description: "Open the Ports panel",
          parameters: { type: "object" }
        },
        {
          name: "openCanvas",
          description: "Open the Canvas (visual project map)",
          parameters: { type: "object" }
        },
        {
          name: "searchFiles",
          description: "Search files by name in the project",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              limit: { type: "number", description: "Max results (default 50)" }
            },
            required: ["query"]
          }
        },
        {
          name: "searchText",
          description: "Search text content in project files",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Text to search for" },
              limit: { type: "number", description: "Max results (default 100)" }
            },
            required: ["query"]
          }
        },
        {
          name: "gitStatus",
          description: "Get git status of current project",
          parameters: { type: "object" }
        },
        {
          name: "gitDiff",
          description: "Get diff for a specific file",
          parameters: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "File path to diff" }
            },
            required: ["filePath"]
          }
        },
        {
          name: "gitCommit",
          description: "Commit staged changes",
          parameters: {
            type: "object",
            properties: {
              message: { type: "string", description: "Commit message" }
            },
            required: ["message"]
          }
        },
        {
          name: "gitStage",
          description: "Stage a specific file",
          parameters: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "File path to stage" }
            },
            required: ["filePath"]
          }
        },
        {
          name: "gitStageAll",
          description: "Stage all changes",
          parameters: { type: "object" }
        },
        {
          name: "gitUnstage",
          description: "Unstage a file",
          parameters: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "File path to unstage" }
            },
            required: ["filePath"]
          }
        },
        {
          name: "gitDiscard",
          description: "Discard changes in a file",
          parameters: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "File path" }
            },
            required: ["filePath"]
          }
        },
        {
          name: "openProject",
          description: "Open a project folder",
          parameters: { type: "object" }
        },
        {
          name: "getProjectPath",
          description: "Get current project path",
          parameters: { type: "object" }
        },
        {
          name: "listFiles",
          description: "List files in a directory",
          parameters: {
            type: "object",
            properties: {
              dirPath: { type: "string", description: "Directory path (optional, defaults to project root)" }
            }
          }
        },
        {
          name: "readFile",
          description: "Read file content",
          parameters: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "File path to read" }
            },
            required: ["filePath"]
          }
        },
        {
          name: "writeFile",
          description: "Write content to a file",
          parameters: {
            type: "object",
            properties: {
              filePath: { type: "string", description: "File path to write" },
              content: { type: "string", description: "Content to write" }
            },
            required: ["filePath", "content"]
          }
        },
        {
          name: "createFile",
          description: "Create a new file",
          parameters: {
            type: "object",
            properties: {
              parentPath: { type: "string", description: "Parent directory path" },
              name: { type: "string", description: "File name" }
            },
            required: ["parentPath", "name"]
          }
        },
        {
          name: "createFolder",
          description: "Create a new folder",
          parameters: {
            type: "object",
            properties: {
              parentPath: { type: "string", description: "Parent directory path" },
              name: { type: "string", description: "Folder name" }
            },
            required: ["parentPath", "name"]
          }
        },
        {
          name: "deleteFile",
          description: "Delete a file or folder",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to delete" }
            },
            required: ["path"]
          }
        },
        {
          name: "openSettings",
          description: "Open settings window",
          parameters: { type: "object" }
        },
        {
          name: "resetLayout",
          description: "Reset window layout to default",
          parameters: { type: "object" }
        },
        {
          name: "toggleFullscreen",
          description: "Toggle fullscreen mode",
          parameters: { type: "object" }
        }
      ];

      // Call OpenCode SDK via IPC for AI response
      const result = await window.electronAPI.opencodeChat({
        messages: conversationHistory,
        tools
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      const response = result.response;

      // Handle tool calls from AI response
      let toolCalls = [];
      let toolResults = [];

      if (response.toolCalls && response.toolCalls.length > 0) {
        toolCalls = response.toolCalls;
        
        // Execute all tool calls
        for (const call of toolCalls) {
          const result = await executeTool(call.name, call.arguments);
          toolResults.push({ name: call.name, args: call.arguments, result });
        }

        // If there were tool calls, we might need to get a follow-up response
        if (toolResults.length > 0) {
          const followUpMessages = [
            ...conversationHistory,
            { role: "assistant", content: response.content, toolCalls: toolCalls },
            { role: "tool", content: JSON.stringify(toolResults) }
          ];

          const followUpResult = await window.electronAPI.opencodeChat({
            messages: followUpMessages,
            tools: []
          });

          if (followUpResult.success) {
            addMessage("assistant", followUpResult.response.content, toolCalls, toolResults);
          } else {
            addMessage("assistant", response.content, toolCalls, toolResults);
          }
        } else {
          addMessage("assistant", response.content, toolCalls, toolResults);
        }
      } else {
        // Just a text response, no tool calls
        addMessage("assistant", response.content, null, null);
      }

    } catch (e) {
      console.error("[AIPanel] Error in handleSend:", e);
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

  const handleStartServer = async () => {
    try {
      setConnectionStatus("starting");
      const result = await window.electronAPI.opencodeStartServer({
        hostname: "127.0.0.1",
        port: 4096,
        projectPath: projectPath || undefined,
        password: serverPassword || undefined,
      });
      
      if (result.success) {
        setConnectionStatus("connected");
        const projectMsg = projectPath ? ` for project: ${projectPath}` : "";
        setMessages(prev => [{
          role: "assistant",
          content: `OpenCode AI server started and connected${projectMsg}! I'm ready to help you with coding tasks, file operations, git, terminal, and more.`,
          toolCalls: null,
          toolResults: null,
          id: Date.now() + Math.random()
        }]);
      } else {
        setConnectionStatus("error");
        const errorMsg = result.error || "";
        // Check if error indicates missing password
        if (errorMsg.includes("OPENCODE_SERVER_PASSWORD") || errorMsg.includes("unsecured")) {
          setShowPasswordInput(true);
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `Failed to start OpenCode server: The server requires a password for security.\n\nPlease enter a password in the input field above and click the + button again.`,
            toolCalls: null,
            toolResults: null,
            id: Date.now() + Math.random()
          }]);
        }
        // Check if error indicates missing CLI
        else if (errorMsg.includes("CLI") || errorMsg.includes("ServeError") || errorMsg.includes("Unexpected error")) {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `Failed to start OpenCode server: ${result.error}\n\nThe OpenCode CLI is not installed. Click the "Install CLI" button above to install it automatically.`,
            toolCalls: null,
            toolResults: null,
            id: Date.now() + Math.random()
          }]);
        } else {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `Failed to start OpenCode server: ${result.error}`,
            toolCalls: null,
            toolResults: null,
            id: Date.now() + Math.random()
          }]);
        }
      }
    } catch (error) {
      setConnectionStatus("error");
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Error starting server: ${error?.message || String(error)}`,
        toolCalls: null,
        toolResults: null,
        id: Date.now() + Math.random()
      }]);
    }
  };

  const handleInstallCLI = async () => {
    try {
      setInstallingCLI(true);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Installing OpenCode CLI globally... This may take a minute or two.",
        toolCalls: null,
        toolResults: null,
        id: Date.now() + Math.random()
      }]);

      const result = await window.electronAPI.opencodeInstallCLI();
      
      if (result.success) {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "OpenCode CLI installed successfully! You can now start the server by clicking the + button.",
          toolCalls: null,
          toolResults: null,
          id: Date.now() + Math.random()
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `Failed to install CLI: ${result.error}\n\nPlease run manually: npm install -g @opencode-ai/cli`,
          toolCalls: null,
          toolResults: null,
          id: Date.now() + Math.random()
        }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Error installing CLI: ${error?.message || String(error)}`,
        toolCalls: null,
        toolResults: null,
        id: Date.now() + Math.random()
      }]);
    } finally {
      setInstallingCLI(false);
    }
  };

  const handleRefreshConnection = async () => {
    try {
      setConnectionStatus("connecting");
      const result = await window.electronAPI.opencodeInit({
        hostname: "127.0.0.1",
        port: 4096,
      });
      
      if (result.success) {
        setConnectionStatus("connected");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Reconnected to OpenCode AI server!",
          toolCalls: null,
          toolResults: null,
          id: Date.now() + Math.random()
        }]);
      } else {
        setConnectionStatus("error");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `Failed to reconnect: ${result.error}`,
          toolCalls: null,
          toolResults: null,
          id: Date.now() + Math.random()
        }]);
      }
    } catch (error) {
      setConnectionStatus("error");
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Error reconnecting: ${error?.message || String(error)}`,
        toolCalls: null,
        toolResults: null,
        id: Date.now() + Math.random()
      }]);
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>
          <Sparkles style={{ width: 16, height: 16, color: "#4ec9b0" }} />
          <span>OpenCode AI</span>
          {connectionStatus === "connecting" && (
            <span style={{ fontSize: 10, color: "#888", marginLeft: 8 }}>Connecting...</span>
          )}
          {connectionStatus === "connected" && (
            <span style={{ fontSize: 10, color: "#4ec9b0", marginLeft: 8 }}>● Connected</span>
          )}
          {connectionStatus === "error" && (
            <span style={{ fontSize: 10, color: "#f44747", marginLeft: 8 }}>● Disconnected</span>
          )}
          {connectionStatus === "disconnected" && (
            <span style={{ fontSize: 10, color: "#888", marginLeft: 8 }}>● Disconnected</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {showPasswordInput && (
            <input
              type="password"
              placeholder="Server password"
              value={serverPassword}
              onChange={(e) => setServerPassword(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleStartServer()}
              style={{
                background: "#1e1e1e",
                border: "1px solid #3a3a3a",
                color: "#e0e0e0",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 11,
                outline: "none",
                width: 120,
              }}
            />
          )}
          {connectionStatus !== "connected" && (
            <button onClick={handleStartServer} disabled={installingCLI} title="Start OpenCode Server" style={s.iconBtn}>
              <Plus size={14} />
            </button>
          )}
          {connectionStatus === "error" && (
            <button onClick={handleInstallCLI} disabled={installingCLI} title="Install OpenCode CLI" style={{ ...s.iconBtn, background: installingCLI ? "#2a2d2e" : "#2d2d2d", opacity: installingCLI ? 0.6 : 1 }}>
              {installingCLI ? <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Settings size={14} />}
            </button>
          )}
          <button onClick={handleRefreshConnection} title="Refresh Connection" style={s.iconBtn}>
            <RefreshCw size={14} />
          </button>
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
          <div key={msg.id} style={msg.role === "user" ? { ...s.msgRow, ...s.msgRowUser } : { ...s.msgRow, ...s.msgRowBot }}>
            <div style={msg.role === "user" ? { ...s.avatar, ...s.avatarUser } : { ...s.avatar, ...s.avatarBot }}>
              {msg.role === "user" ? <MessageSquare size={14} /> : <Sparkles size={14} />}
            </div>
            <div style={msg.role === "user" ? { ...s.bubble, ...s.bubbleUser } : { ...s.bubble, ...s.bubbleBot }}>
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
          <div key="loading" style={{ ...s.msgRow, ...s.msgRowBot }}>
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
        <button onClick={handleSend} disabled={loading || !input.trim() || !projectPath} style={{ ...s.sendBtn, ...(loading || !input.trim() || !projectPath) && s.sendBtnDisabled }}>
          <Send size={16} />
</button>
</div>
      </div>
    );
  }

export default AIPanel;