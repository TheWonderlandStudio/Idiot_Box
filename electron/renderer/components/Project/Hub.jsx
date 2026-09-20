import React, { useState, useEffect, useCallback, useRef } from "react";
import { FolderOpen, CloudDownload, Pin, Plus, RefreshCw, Trash2, Clock, FolderUp, Search, Link2, Star, Loader2, ArrowLeft, Layers, Bot, Send, Smartphone, Globe, Server, Code2, Box, Zap, Palette, Atom, Boxes, Terminal as TerminalIcon, Cpu, Leaf, Bird } from "lucide-react";
import VscodeIcon from "../shared/VscodeIcon.jsx";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./hub.css";

// ─── Frameworks / Templates — Replit-style starter gallery ────────────────
// Real icons via devicons + simpleicons CDN (no local assets needed)
const FRAMEWORKS = [
  // Frontend
  { id: "react", name: "React", desc: "Vite + React starter", category: "Frontend", icon: Atom, color: "#61dafb", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg", languages: ["JavaScript", "TypeScript"], variants: ["Tailwind"] },
  { id: "nextjs", name: "Next.js", desc: "React SSR framework", category: "Frontend", icon: Globe, color: "#000", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nextjs/nextjs-original.svg", languages: ["JavaScript", "TypeScript"] },
  { id: "vue", name: "Vue", desc: "Vite + Vue 3", category: "Frontend", icon: Palette, color: "#42b883", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vuejs/vuejs-original.svg", languages: ["JavaScript", "TypeScript"] },
  { id: "svelte", name: "Svelte", desc: "Svelte + Vite", category: "Frontend", icon: Zap, color: "#ff3e00", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/svelte/svelte-original.svg", languages: ["JavaScript", "TypeScript"] },
  { id: "angular", name: "Angular", desc: "Angular CLI starter", category: "Frontend", icon: Boxes, color: "#dd0031", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/angularjs/angularjs-original.svg", languages: ["TypeScript"] },
  { id: "astro", name: "Astro", desc: "Static site builder", category: "Frontend", icon: Globe, color: "#ff5a03", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/astro/astro-original.svg", languages: ["JavaScript", "TypeScript"] },
  { id: "html", name: "HTML/CSS/JS", desc: "Blank static template", category: "Frontend", icon: Code2, color: "#e34c26", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/html5/html5-original.svg" },
  { id: "nuxt", name: "Nuxt", desc: "Vue SSR framework", category: "Frontend", icon: Layers, color: "#00dc82", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nuxtjs/nuxtjs-original.svg", languages: ["JavaScript", "TypeScript"] },
  // Backend JS
  { id: "express", name: "Express", desc: "Node.js web framework", category: "Backend", icon: Server, color: "#68a063", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/express/express-original.svg", languages: ["JavaScript", "TypeScript"] },
  { id: "nestjs", name: "NestJS", desc: "TypeScript backend", category: "Backend", icon: Server, color: "#ea2845", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nestjs/nestjs-original.svg", languages: ["TypeScript"] },
  { id: "fastify", name: "Fastify", desc: "Fast Node.js server", category: "Backend", icon: Zap, color: "#202020", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/fastify/fastify-original.svg", languages: ["JavaScript", "TypeScript"] },
  { id: "hono", name: "Hono", desc: "Ultrafast web framework", category: "Backend", icon: Box, color: "#ff6a00", iconUrl: "https://cdn.simpleicons.org/hono/FF6A00", languages: ["JavaScript", "TypeScript"] },
  // Python
  { id: "flask", name: "Flask", desc: "Python micro web framework", category: "Python", icon: Leaf, color: "#3b9c7d", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/flask/flask-original.svg" },
  { id: "django", name: "Django", desc: "Python full-stack", category: "Python", icon: Server, color: "#092e20", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/django/django-plain.svg" },
  { id: "fastapi", name: "FastAPI", desc: "Python API framework", category: "Python", icon: Zap, color: "#009688", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/fastapi/fastapi-original.svg" },
  { id: "streamlit", name: "Streamlit", desc: "Python data apps", category: "Python", icon: Palette, color: "#ff4b4b", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/streamlit/streamlit-original.svg" },
  { id: "gradio", name: "Gradio", desc: "Python AI UI", category: "Python", icon: Cpu, color: "#f97316", iconUrl: "https://cdn.simpleicons.org/gradio/F97316" },
  // Go / Rust / Others
  { id: "go", name: "Go", desc: "Go starter", category: "Others", icon: Code2, color: "#00ADD8", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/go/go-original.svg" },
  { id: "rust", name: "Rust", desc: "Cargo starter", category: "Others", icon: Box, color: "#dea584", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/rust/rust-original.svg" },
  { id: "java", name: "Java", desc: "Spring Boot starter", category: "Others", icon: Code2, color: "#007396", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/java/java-original.svg" },
  { id: "php", name: "PHP", desc: "Laravel starter", category: "Others", icon: Code2, color: "#777bb4", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/php/php-original.svg" },
  // Mobile / Desktop
  { id: "expo", name: "Expo", desc: "React Native + Expo", category: "Mobile", icon: Smartphone, color: "#4630eb", iconUrl: "https://cdn.simpleicons.org/expo/4630EB", languages: ["JavaScript", "TypeScript"] },
  { id: "flutter", name: "Flutter", desc: "Dart + Flutter", category: "Mobile", icon: Smartphone, color: "#02569b", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/flutter/flutter-original.svg" },
  { id: "electron", name: "Electron", desc: "Desktop app starter", category: "Mobile", icon: Box, color: "#47848f", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/electron/electron-original.svg", languages: ["JavaScript", "TypeScript"] },
  { id: "tauri", name: "Tauri", desc: "Rust desktop app", category: "Mobile", icon: Box, color: "#24c8db", iconUrl: "https://cdn.simpleicons.org/tauri/24C8DB", languages: ["JavaScript", "TypeScript"] },
  // Bots
  { id: "discord-node", name: "Discord Bot (Node)", desc: "discord.js starter", category: "Bots", icon: Bot, color: "#5865f2", iconUrl: "https://cdn.simpleicons.org/discord/5865F2", languages: ["JavaScript", "TypeScript"] },
  { id: "discord-py", name: "Discord Bot (Python)", desc: "discord.py starter", category: "Bots", icon: Bot, color: "#3572A5", iconUrl: "https://cdn.simpleicons.org/discord/3572A5" },
  { id: "telegram-node", name: "Telegram Bot (Node)", desc: "Telegraf starter", category: "Bots", icon: Send, color: "#26a5e4", iconUrl: "https://cdn.simpleicons.org/telegram/26A5E4", languages: ["JavaScript", "TypeScript"] },
  { id: "telegram-py", name: "Telegram Bot (Python)", desc: "python-telegram-bot", category: "Bots", icon: Send, color: "#3572A5", iconUrl: "https://cdn.simpleicons.org/telegram/3572A5" },
  { id: "slack", name: "Slack Bot", desc: "Bolt framework", category: "Bots", icon: Send, color: "#e01e5a", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/slack/slack-original.svg", languages: ["JavaScript", "TypeScript"] },
  { id: "whatsapp", name: "WhatsApp Bot", desc: "whatsapp-web.js", category: "Bots", icon: Smartphone, color: "#25d366", iconUrl: "https://cdn.simpleicons.org/whatsapp/25D366", languages: ["JavaScript"] },
  { id: "twitter", name: "Twitter Bot", desc: "Twitter API starter", category: "Bots", icon: Send, color: "#1da1f2", iconUrl: "https://cdn.simpleicons.org/x/1DA1F2", languages: ["JavaScript", "TypeScript"] },
  { id: "chrome-ext", name: "Chrome Extension", desc: "Manifest v3 starter", category: "Tools", icon: Boxes, color: "#4285f4", iconUrl: "https://cdn.simpleicons.org/googlechrome/4285F4", languages: ["JavaScript", "TypeScript"] },
  { id: "cli", name: "CLI Tool", desc: "Node CLI starter", category: "Tools", icon: TerminalIcon, color: "#333", iconUrl: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/bash/bash-original.svg", languages: ["JavaScript", "TypeScript"] },
];

// fallback for MessageSquare (if not imported, use Send)
function MessageSquareIconFallback(props) {
  return <Send {...props} />;
}
const FRAMEWORK_CATEGORIES = ["All", "Frontend", "Backend", "Python", "Bots", "Mobile", "Others", "Tools"];

// Minimal starter file maps per framework — proper files for each, supports JS/TS variants
const getFrameworkFiles = (id, projectName, lang = "TypeScript") => {
  const name = projectName || id;
  const pn = name.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  const isTS = lang === "TypeScript";
  // helper for package.json
  const pkg = (extra) => JSON.stringify({ name: pn, private: true, version: "0.1.0", ...extra }, null, 2);
  switch (id) {
    case "react": {
      if (isTS) {
        return {
          "package.json": pkg({ type: "module", scripts: { dev: "vite", build: "vite build", preview: "vite preview" }, dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" }, devDependencies: { vite: "^5.3.1", "@vitejs/plugin-react": "^4.3.1", typescript: "^5.5.2", "@types/react": "^18.3.3", "@types/react-dom": "^18.3.0" } }),
          "vite.config.ts": `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n`,
          "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2020", jsx: "react-jsx", module: "ESNext", moduleResolution: "bundler", strict: true, esModuleInterop: true } }, null, 2),
          "index.html": `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${name}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
          "src/main.tsx": `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App.tsx'\nReactDOM.createRoot(document.getElementById('root')!).render(<App />)\n`,
          "src/App.tsx": `export default function App(){ return <div style={{padding:24,fontFamily:'system-ui'}}><h1>${name} — React + TS</h1><p>Edit src/App.tsx</p></div> }\n`,
          "src/vite-env.d.ts": `/// <reference types="vite/client" />\n`,
          "README.md": `# ${name} — React + TypeScript (Vite)\n\n\`npm install\` → \`npm run dev\`\n`,
        };
      }
      return {
        "package.json": pkg({ type: "module", scripts: { dev: "vite", build: "vite build", preview: "vite preview" }, dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" }, devDependencies: { vite: "^5.3.1", "@vitejs/plugin-react": "^4.3.1" } }),
        "vite.config.js": `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n`,
        "index.html": `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${name}</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
        "src/main.jsx": `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App.jsx'\nReactDOM.createRoot(document.getElementById('root')).render(<App />)\n`,
        "src/App.jsx": `export default function App(){ return <div style={{padding:24,fontFamily:'system-ui'}}><h1>${name} — React</h1><p>Edit src/App.jsx</p></div> }\n`,
        "README.md": `# ${name} — React (Vite)\n\n\`npm install\` → \`npm run dev\`\n`,
      };
    }
    case "nextjs": {
      if (isTS) {
        return {
          "package.json": pkg({ scripts: { dev: "next dev", build: "next build", start: "next start" }, dependencies: { next: "^14.2.5", react: "^18.3.1", "react-dom": "^18.3.1" }, devDependencies: { typescript: "^5.5.2", "@types/node": "^20.14.2", "@types/react": "^18.3.3" } }),
          "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom","dom.iterable","esnext"], jsx: "preserve", module: "esnext", moduleResolution: "bundler", strict: true } }, null, 2),
          "app/page.tsx": `export default function Page(){ return <div style={{padding:24}}><h1>${name} — Next.js + TS</h1></div> }\n`,
          "app/layout.tsx": `export default function RootLayout({children}:{children:React.ReactNode}){ return <html><body>{children}</body></html> }\n`,
          "next.config.mjs": `/** @type {import('next').NextConfig} */\nconst nextConfig={}; export default nextConfig;\n`,
          "README.md": `# ${name} — Next.js + TS\n`,
        };
      }
      return {
        "package.json": pkg({ scripts: { dev: "next dev", build: "next build", start: "next start" }, dependencies: { next: "^14.2.5", react: "^18.3.1", "react-dom": "^18.3.1" } }),
        "app/page.jsx": `export default function Page(){ return <div style={{padding:24}}><h1>${name} — Next.js</h1><p>Edit app/page.jsx</p></div> }\n`,
        "app/layout.jsx": `export default function RootLayout({children}){ return <html><body>{children}</body></html> }\n`,
        "next.config.mjs": `const nextConfig={}; export default nextConfig;\n`,
        "README.md": `# ${name} — Next.js\n\n\`npm install\` → \`npm run dev\`\n`,
      };
    }
    case "vue": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ scripts: { dev: "vite", build: "vite build" }, dependencies: { vue: "^3.4.27" }, devDependencies: { vite: "^5.3.1", "@vitejs/plugin-vue": "^5.0.5", ...(isTS ? { typescript: "^5.5.2" } : {}) } }),
        "vite.config.js": `import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\nexport default defineConfig({ plugins: [vue()] })\n`,
        "index.html": `<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.${ext}"></script></body></html>`,
        [`src/main.${ext}`]: `import { createApp } from 'vue'\nimport App from './App.vue'\ncreateApp(App).mount('#app')\n`,
        "src/App.vue": `<template><div style="padding:24px"><h1>${name} — Vue${isTS ? " + TS" : ""}</h1></div></template>\n`,
        "README.md": `# ${name} — Vue${isTS ? " + TS" : ""}\n`,
      };
    }
    case "svelte": {
      return {
        "package.json": pkg({ scripts: { dev: "vite dev", build: "vite build" }, dependencies: {}, devDependencies: { vite: "^5.3.1", "@sveltejs/vite-plugin-svelte": "^3.1.1", svelte: "^4.2.15", ...(isTS ? { typescript: "^5.5.2" } : {}) } }),
        "vite.config.js": `import { defineConfig } from 'vite'\nimport { svelte } from '@sveltejs/vite-plugin-svelte'\nexport default defineConfig({ plugins: [svelte()] })\n`,
        "index.html": `<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>`,
        "src/App.svelte": `<h1>${name} — Svelte${isTS ? " + TS" : ""}</h1>\n<p>Edit src/App.svelte</p>\n`,
        "src/main.js": `import App from './App.svelte'\nconst app=new App({target:document.getElementById('app')});export default app;\n`,
        "README.md": `# ${name} — Svelte\n`,
      };
    }
    case "angular":
      return {
        "package.json": pkg({ scripts: { start: "ng serve", build: "ng build" }, dependencies: { "@angular/core": "^17.3.0" }, devDependencies: { "@angular/cli": "^17.3.0", typescript: "^5.4.5" } }),
        "angular.json": JSON.stringify({ version: 1, projects: { [pn]: { projectType: "application", root: "", sourceRoot: "src" } } }, null, 2),
        "src/main.ts": `import { bootstrapApplication } from '@angular/platform-browser';\nimport { AppComponent } from './app/app.component';\nbootstrapApplication(AppComponent);\n`,
        "src/app/app.component.ts": `import { Component } from '@angular/core';\n@Component({selector:'app-root',template:'<h1>${name} — Angular</h1>'}) export class AppComponent{}\n`,
        "README.md": `# ${name} — Angular\n\n\`npm install\` → \`npm start\`\n`,
      };
    case "astro": {
      return {
        "package.json": pkg({ scripts: { dev: "astro dev", build: "astro build" }, dependencies: { astro: "^4.10.1" }, devDependencies: { typescript: "^5.5.2" } }),
        "astro.config.mjs": `import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`,
        "src/pages/index.astro": `---\n---\n<html><body><h1>${name} — Astro${isTS ? " + TS" : ""}</h1></body></html>\n`,
        "README.md": `# ${name} — Astro\n`,
      };
    }
    case "html":
      return {
        "index.html": `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${name}</title><link rel="stylesheet" href="style.css"/></head><body><h1>${name} — HTML/CSS/JS</h1><script src="script.js"></script></body></html>`,
        "style.css": `body{font-family:system-ui;padding:24px}h1{color:#333}\n`,
        "script.js": `console.log('${name} ready');\n`,
        "README.md": `# ${name} — HTML\n`,
      };
    case "nuxt": {
      return {
        "package.json": pkg({ scripts: { dev: "nuxt dev", build: "nuxt build" }, dependencies: { nuxt: "^3.11.2" } }),
        "nuxt.config.ts": `export default defineNuxtConfig({})\n`,
        "app.vue": `<template><div><h1>${name} — Nuxt${isTS ? " + TS" : ""}</h1></div></template>\n`,
        "README.md": `# ${name} — Nuxt\n`,
      };
    }
    case "express": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ scripts: { dev: isTS ? "tsx index.ts" : "node index.js", start: isTS ? "tsx index.ts" : "node index.js" }, dependencies: { express: "^4.19.2", ...(isTS ? { typescript: "^5.5.2", tsx: "^4.15.6", "@types/express": "^4.17.21", "@types/node": "^20.14.2" } : {}) } }),
        [`index.${ext}`]: isTS ? `import express from 'express';\nconst app=express();\napp.get('/',(_,res)=>res.send('<h1>${name} — Express + TS</h1>'));\napp.listen(3000,()=>console.log('http://localhost:3000'));\n` : `const express=require('express');const app=express();\napp.get('/',(req,res)=>res.send('<h1>${name} — Express</h1>'));\napp.listen(3000,()=>console.log('http://localhost:3000'));\n`,
        "README.md": `# ${name} — Express${isTS ? " + TS" : ""}\n`,
      };
    }
    case "nestjs":
      return {
        "package.json": pkg({ scripts: { start: "nest start", "start:dev": "nest start --watch" }, dependencies: { "@nestjs/core": "^10.3.2", "@nestjs/common": "^10.3.2" }, devDependencies: { typescript: "^5.5.2" } }),
        "src/main.ts": `import { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\nasync function bootstrap(){ const app=await NestFactory.create(AppModule); await app.listen(3000); }\nbootstrap();\n`,
        "src/app.module.ts": `import { Module } from '@nestjs/common';\n@Module({}) export class AppModule {}\n`,
        "README.md": `# ${name} — NestJS\n`,
      };
    case "fastify": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ scripts: { dev: isTS ? "tsx server.ts" : "node server.js" }, dependencies: { fastify: "^4.26.2", ...(isTS ? { typescript: "^5.5.2", tsx: "^4.15.6" } : {}) } }),
        [`server.${ext}`]: isTS ? `import Fastify from 'fastify';\nconst app=Fastify();\napp.get('/',async()=>'<h1>${name} — Fastify + TS</h1>');\napp.listen({port:3000});\n` : `const fastify=require('fastify')();\nfastify.get('/',async()=>'<h1>${name} — Fastify</h1>');\nfastify.listen({port:3000});\n`,
        "README.md": `# ${name} — Fastify\n`,
      };
    }
    case "hono": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ scripts: { dev: isTS ? "tsx src/index.ts" : "node src/index.js" }, dependencies: { hono: "^4.4.0", ...(isTS ? { typescript: "^5.5.2" } : {}) } }),
        [`src/index.${ext}`]: isTS ? `import { Hono } from 'hono';\nconst app=new Hono();\napp.get('/',(c)=>c.html('<h1>${name} — Hono + TS</h1>'));\nexport default app;\n` : `const { Hono } = require('hono');\nconst app=new Hono();\napp.get('/',(c)=>c.html('<h1>${name} — Hono</h1>'));\nmodule.exports=app;\n`,
        "README.md": `# ${name} — Hono\n`,
      };
    }
    case "flask":
      return {
        "requirements.txt": "flask\n",
        "app.py": `from flask import Flask\napp=Flask(__name__)\n@app.route('/')\ndef home(): return '<h1>${name} — Flask</h1>'\nif __name__=='__main__': app.run(debug=True, port=5000)\n`,
        "README.md": `# ${name} — Flask\n\n\`pip install -r requirements.txt\` → \`python app.py\`\n`,
      };
    case "django":
      return {
        "requirements.txt": "django\n",
        "manage.py": `#!/usr/bin/env python\nimport os,sys\nif __name__=='__main__': os.environ.setdefault('DJANGO_SETTINGS_MODULE','${pn}.settings');from django.core.management import execute_from_command_line;execute_from_command_line(sys.argv)\n`,
        "README.md": `# ${name} — Django\n\n\`django-admin startproject ${pn} .\`\n`,
      };
    case "fastapi":
      return {
        "requirements.txt": "fastapi\nuvicorn[standard]\n",
        "main.py": `from fastapi import FastAPI\napp=FastAPI()\n@app.get('/')\ndef root(): return {"message":"${name} — FastAPI"}\n# uvicorn main:app --reload\n`,
        "README.md": `# ${name} — FastAPI\n\n\`uvicorn main:app --reload\`\n`,
      };
    case "streamlit":
      return {
        "requirements.txt": "streamlit\n",
        "app.py": `import streamlit as st\nst.title('${name} — Streamlit')\nst.write('Edit app.py')\n`,
        "README.md": `# ${name} — Streamlit\n\n\`streamlit run app.py\`\n`,
      };
    case "gradio":
      return {
        "requirements.txt": "gradio\n",
        "app.py": `import gradio as gr\ndef greet(name): return f"Hello {name} from ${name}!"\niface=gr.Interface(fn=greet, inputs="text", outputs="text", title="${name} — Gradio")\niface.launch()\n`,
        "README.md": `# ${name} — Gradio\n\n\`python app.py\`\n`,
      };
    case "go":
      return {
        "go.mod": `module ${pn}\n\ngo 1.22\n`,
        "main.go": `package main\nimport "fmt"\nfunc main(){ fmt.Println("${name} — Go") }\n`,
        "README.md": `# ${name} — Go\n\n\`go run main.go\`\n`,
      };
    case "rust":
      return {
        "Cargo.toml": `[package]\nname="${pn}"\nversion="0.1.0"\nedition="2021"\n\n[dependencies]\n`,
        "src/main.rs": `fn main(){ println!("${name} — Rust"); }\n`,
        "README.md": `# ${name} — Rust\n\n\`cargo run\`\n`,
      };
    case "java":
      return {
        "pom.xml": `<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>${pn}</artifactId><version>0.1.0</version></project>\n`,
        "src/main/java/com/example/Main.java": `package com.example;\npublic class Main{ public static void main(String[] args){ System.out.println("${name} — Java"); } }\n`,
        "README.md": `# ${name} — Java\n`,
      };
    case "php":
      return {
        "composer.json": JSON.stringify({ name: pn + "/" + pn, require: { php: ">=8.1", "laravel/framework": "^10.0" } }, null, 2),
        "index.php": `<?php echo "<h1>${name} — PHP</h1>"; ?>\n`,
        "README.md": `# ${name} — PHP\n`,
      };
    case "expo": {
      const ext = isTS ? "tsx" : "js";
      return {
        "package.json": pkg({ scripts: { start: "expo start", android: "expo start --android", ios: "expo start --ios" }, dependencies: { expo: "~51.0.14", react: "18.2.0", "react-native": "0.74.2", ...(isTS ? { typescript: "^5.3.3", "@types/react": "^18.2.79" } : {}) } }),
        "app.json": JSON.stringify({ expo: { name, slug: pn, version: "1.0.0" } }, null, 2),
        "babel.config.js": `module.exports=function(api){api.cache(true);return{presets:['babel-preset-expo']}}\n`,
        [`App.${ext}`]: isTS ? `import { Text, View } from 'react-native';\nexport default function App(){ return <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><Text>${name} — Expo + TS</Text></View> }\n` : `import { Text, View } from 'react-native';\nexport default function App(){ return <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><Text>${name} — Expo</Text></View> }\n`,
        "README.md": `# ${name} — Expo${isTS ? " + TS" : ""}\n\n\`npm install\` → \`npx expo start\`\n`,
      };
    }
    case "flutter":
      return {
        "pubspec.yaml": `name: ${pn}\ndescription: ${name} — Flutter\npublish_to: 'none'\nversion: 1.0.0\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n`,
        "lib/main.dart": `import 'package:flutter/material.dart';\nvoid main()=>runApp(MaterialApp(home:Scaffold(body:Center(child:Text('${name} — Flutter')))));\n`,
        "README.md": `# ${name} — Flutter\n\n\`flutter run\`\n`,
      };
    case "electron": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ main: `main.${ext}`, scripts: { start: "electron ." }, dependencies: { electron: "^30.0.1" }, devDependencies: { ...(isTS ? { typescript: "^5.5.2" } : {}) } }),
        [`main.${ext}`]: isTS ? `import { app, BrowserWindow } from 'electron';\nconst createWindow=()=>{const win=new BrowserWindow({width:800,height:600});win.loadFile('index.html')};app.whenReady().then(createWindow);\n` : `const { app, BrowserWindow } = require('electron');\nconst createWindow=()=>{const win=new BrowserWindow({width:800,height:600});win.loadFile('index.html')};app.whenReady().then(createWindow);\n`,
        "index.html": `<h1>${name} — Electron${isTS ? " + TS" : ""}</h1>\n`,
        "README.md": `# ${name} — Electron\n`,
      };
    }
    case "tauri": {
      return {
        "package.json": pkg({ scripts: { tauri: "tauri" }, dependencies: {} }),
        "src-tauri/Cargo.toml": `[package]\nname="${pn}"\nversion="0.1.0"\n`,
        "src/main.js": `console.log('${name} — Tauri${isTS ? " + TS" : ""}');\n`,
        "README.md": `# ${name} — Tauri\n`,
      };
    }
    case "discord-node": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ scripts: { start: isTS ? "tsx index.ts" : "node index.js" }, dependencies: { "discord.js": "^14.15.3", ...(isTS ? { typescript: "^5.5.2", tsx: "^4.15.6" } : {}) } }),
        [ext === "ts" ? "index.ts" : "index.js"]: isTS ? `import { Client, GatewayIntentBits } from 'discord.js';\nconst client=new Client({intents:[GatewayIntentBits.Guilds]});\nclient.once('ready',()=>console.log('Logged in as '+client.user!.tag));\nclient.login(process.env.DISCORD_TOKEN);\n` : `const { Client, GatewayIntentBits } = require('discord.js');\nconst client=new Client({intents:[GatewayIntentBits.Guilds]});\nclient.once('ready',()=>console.log('Logged in as '+client.user.tag));\nclient.login(process.env.DISCORD_TOKEN);\n`,
        ".env.example": "DISCORD_TOKEN=your_token_here\n",
        "README.md": `# ${name} — Discord Bot (Node)${isTS ? " + TS" : ""}\n`,
      };
    }
    case "discord-py":
      return {
        "requirements.txt": "discord.py\n",
        "bot.py": `import discord\nintents=discord.Intents.default()\nintents.message_content=True\nclient=discord.Client(intents=intents)\n@client.event\nasync def on_ready(): print(f'Logged in as {client.user}')\nclient.run('TOKEN')\n`,
        "README.md": `# ${name} — Discord Bot (Python)\n`,
      };
    case "telegram-node": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ scripts: { start: isTS ? "tsx index.ts" : "node index.js" }, dependencies: { telegraf: "^4.16.3", ...(isTS ? { typescript: "^5.5.2" } : {}) } }),
        [ext === "ts" ? "index.ts" : "index.js"]: isTS ? `import { Telegraf } from 'telegraf';\nconst bot=new Telegraf(process.env.BOT_TOKEN!);\nbot.start((ctx)=>ctx.reply('Hello from ${name}!'));\nbot.launch();\n` : `const { Telegraf } = require('telegraf');\nconst bot=new Telegraf(process.env.BOT_TOKEN);\nbot.start((ctx)=>ctx.reply('Hello from ${name}!'));\nbot.launch();\n`,
        ".env.example": "BOT_TOKEN=your_token_here\n",
        "README.md": `# ${name} — Telegram Bot${isTS ? " + TS" : ""}\n`,
      };
    }
    case "telegram-py":
      return {
        "requirements.txt": "python-telegram-bot\n",
        "bot.py": `from telegram import Update\nfrom telegram.ext import Application, CommandHandler, ContextTypes\nasync def start(update: Update, context: ContextTypes.DEFAULT_TYPE): await update.message.reply_text('Hello from ${name}!')\napp=Application.builder().token('TOKEN').build()\napp.add_handler(CommandHandler('start', start))\napp.run_polling()\n`,
        "README.md": `# ${name} — Telegram Bot (Python)\n`,
      };
    case "slack": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ scripts: { start: isTS ? "tsx app.ts" : "node app.js" }, dependencies: { "@slack/bolt": "^3.17.1", ...(isTS ? { typescript: "^5.5.2" } : {}) } }),
        [ext === "ts" ? "app.ts" : "app.js"]: isTS ? `import { App } from '@slack/bolt';\nconst app=new App({token:process.env.SLACK_BOT_TOKEN, signingSecret:process.env.SLACK_SIGNING_SECRET});\napp.message('hello',async({message,say})=>{await say('Hello from ${name}!')});\n(async()=>{await app.start(3000);console.log('Bolt running')})();\n` : `const { App } = require('@slack/bolt');\nconst app=new App({token:process.env.SLACK_BOT_TOKEN, signingSecret:process.env.SLACK_SIGNING_SECRET});\napp.message('hello',async({message,say})=>{await say('Hello')});\napp.start(3000);\n`,
        ".env.example": "SLACK_BOT_TOKEN=xoxb-\nSLACK_SIGNING_SECRET=\n",
        "README.md": `# ${name} — Slack Bot${isTS ? " + TS" : ""}\n`,
      };
    }
    case "whatsapp": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ dependencies: { "whatsapp-web.js": "^1.23.0", qrcode: "^1.5.3", ...(isTS ? { typescript: "^5.5.2" } : {}) } }),
        [ext === "ts" ? "index.ts" : "index.js"]: isTS ? `import qrcode from 'qrcode';\nimport pkg from 'whatsapp-web.js';\nconst { Client, LocalAuth } = pkg;\nconst client=new Client({authStrategy:new LocalAuth()});\nclient.on('qr',(qr)=>{qrcode.toString(qr,{type:'terminal'},(_,url)=>console.log(url))});\nclient.on('ready',()=>console.log('${name} ready'));\nclient.initialize();\n` : `const qrcode=require('qrcode');\nconst { Client, LocalAuth } = require('whatsapp-web.js');\nconst client=new Client({authStrategy:new LocalAuth()});\nclient.on('qr',(qr)=>{qrcode.toString(qr,{type:'terminal'},(_,url)=>console.log(url))});\nclient.initialize();\n`,
        "README.md": `# ${name} — WhatsApp Bot\n`,
      };
    }
    case "twitter": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ dependencies: { "twitter-api-v2": "^1.15.1", ...(isTS ? { typescript: "^5.5.2" } : {}) } }),
        [ext === "ts" ? "index.ts" : "index.js"]: isTS ? `import { TwitterApi } from 'twitter-api-v2';\nconst client=new TwitterApi(process.env.BEARER_TOKEN!);\nawait client.v2.tweet('Hello from ${name}!');\n` : `const { TwitterApi } = require('twitter-api-v2');\nconst client=new TwitterApi(process.env.BEARER_TOKEN);\nclient.v2.tweet('Hello from ${name}!');\n`,
        ".env.example": "BEARER_TOKEN=\n",
        "README.md": `# ${name} — Twitter Bot\n`,
      };
    }
    case "chrome-ext":
      return {
        "manifest.json": JSON.stringify({ manifest_version: 3, name, version: "0.1.0", action: { default_popup: "popup.html" }, permissions: ["storage"] }, null, 2),
        "popup.html": `<!doctype html><html><body><h1>${name}</h1><script src="popup.js"></script></body></html>`,
        "popup.js": `console.log('${name} — Chrome Extension');\n`,
        "README.md": `# ${name} — Chrome Extension\n`,
      };
    case "cli": {
      const ext = isTS ? "ts" : "js";
      return {
        "package.json": pkg({ bin: { [pn]: `./bin/${ext === "ts" ? "index.js" : "index.js"}` }, scripts: { start: isTS ? "tsx bin/index.ts" : "node bin/index.js" }, dependencies: { commander: "^11.1.0", ...(isTS ? { typescript: "^5.5.2", tsx: "^4.15.6" } : {}) } }),
        [ext === "ts" ? "bin/index.ts" : "bin/index.js"]: isTS ? `#!/usr/bin/env node\nimport { Command } from 'commander';\nconst program=new Command();\nprogram.name('${pn}').description('${name} — CLI').action(()=>console.log('Hello from ${name}!'));program.parse();\n` : `#!/usr/bin/env node\nconst { Command } = require('commander');\nconst program=new Command();\nprogram.name('${pn}').description('${name}').action(()=>console.log('Hello'));\nprogram.parse();\n`,
        "README.md": `# ${name} — CLI${isTS ? " + TS" : ""}\n`,
      };
    }
    default:
      return {
        "README.md": `# ${name} — ${id}\n\nStarter for ${id}. Edit files to begin.\n`,
        "package.json": pkg({ version: "0.1.0" }),
      };
  }
};

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
  const [cloningTarget, setCloningTarget] = useState(null);
  const [cloneLogs, setCloneLogs] = useState([]);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showFrameworks, setShowFrameworks] = useState(false);
  const [frameworkSearch, setFrameworkSearch] = useState("");
  const [frameworkCategory, setFrameworkCategory] = useState("All");
  const [selectedFramework, setSelectedFramework] = useState(null);
  const [frameworkLang, setFrameworkLang] = useState("TypeScript");

  // ── Xterm console for git clone ────────────────────────────────────────
  const cloneTermRef = useRef(null);
  const cloneFitRef = useRef(null);
  const cloneContainerRef = useRef(null);
  const clonePrevLenRef = useRef(0);

  useEffect(() => {
    if (!showCloneDialog) return;
    if (!(cloning || cloneLogs.length > 0)) return;
    const el = cloneContainerRef.current;
    if (!el || cloneTermRef.current) return;
    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "block",
      fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      theme: {
        background: "#0a0a0a",
        foreground: "#cccccc",
        cursor: "#cccccc",
        selectionBackground: "#264f78",
        black: "#0a0a0a",
        white: "#cccccc",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try { fit.fit(); } catch {}
    cloneTermRef.current = term;
    cloneFitRef.current = fit;
    // write existing logs
    if (cloneLogs.length) {
      term.write(cloneLogs.join("").replace(/\r?\n/g, "\r\n"));
      clonePrevLenRef.current = cloneLogs.length;
    }
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(el);
    const onResize = () => { try { fit.fit(); } catch {} };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      try { ro.disconnect(); } catch {}
      // keep term alive while dialog open — dispose only on dialog close
    };
  }, [showCloneDialog, cloning, cloneLogs.length]);

  // dispose xterm when dialog closes
  useEffect(() => {
    if (!showCloneDialog) {
      if (cloneTermRef.current) { try { cloneTermRef.current.dispose(); } catch {} cloneTermRef.current = null; cloneFitRef.current = null; }
      clonePrevLenRef.current = 0;
    }
  }, [showCloneDialog]);

  // incremental write when new chunks arrive
  useEffect(() => {
    const term = cloneTermRef.current;
    if (!term) { clonePrevLenRef.current = cloneLogs.length; return; }
    if (cloneLogs.length === 0) {
      try { term.clear(); } catch {}
      clonePrevLenRef.current = 0;
      return;
    }
    if (cloneLogs.length < clonePrevLenRef.current) {
      try { term.clear(); term.write(cloneLogs.join("").replace(/\r?\n/g, "\r\n")); } catch {}
      clonePrevLenRef.current = cloneLogs.length;
      return;
    }
    const newChunks = cloneLogs.slice(clonePrevLenRef.current);
    for (const chunk of newChunks) {
      try { term.write(String(chunk).replace(/\r?\n/g, "\r\n")); } catch {}
    }
    clonePrevLenRef.current = cloneLogs.length;
  }, [cloneLogs]);

  useEffect(() => {
    const unsubLog = window.electronAPI.onCloneLog?.((data) => {
      setCloneLogs((prev) => [...prev, data]);
    });
    const unsubDone = window.electronAPI.onCloneDone?.(() => {
      // keep logs, just stop spinning via cloning state
    });
    return () => { try { unsubLog?.(); } catch {} try { unsubDone?.(); } catch {} };
  }, []);

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

  const handleFrameworkSelect = useCallback((fw) => {
    setSelectedFramework(fw);
    if (fw.languages?.length) setFrameworkLang(fw.languages.includes("TypeScript") ? "TypeScript" : fw.languages[0]);
    else setFrameworkLang("TypeScript");
    setShowFrameworks(false);
    setShowNewProjectDialog(true);
    setShowCloneDialog(false);
    const base = fw.id.replace(/-node|-py$/, "").replace(/[^a-z0-9]/g, "-");
    setNewProjectName(`${base}-app`);
  }, []);

  const createNewProject = useCallback(async () => {
    const legacy = newProjectPath.trim();
    const full = getFullProjectPath();
    const target = full || legacy;
    if (!target) return;
    const fw = selectedFramework;
    try {
      await window.electronAPI.menuNewProject(target);
      // if framework selected — populate starter files
      if (fw) {
        const files = getFrameworkFiles(fw.id, newProjectName.trim() || fw.name, frameworkLang);
        const sep = target.includes("\\") ? "\\" : "/";
        const base = target.replace(/[\\/]+$/, "");
        for (const [rel, content] of Object.entries(files)) {
          const filePath = base + sep + rel.replace(/\//g, sep);
          try { await window.electronAPI.writeFileText(filePath, content); } catch (e) { console.warn("template write failed", rel, e); }
        }
        // reopen to refresh file tree
        try { await window.electronAPI.menuOpenProject(target); } catch {}
      }
      setNewProjectPath("");
      setNewProjectName("");
      setNewProjectLocation("");
      setSelectedFramework(null);
      setShowNewProjectDialog(false);
    } catch (err) {
      console.error("Failed to create project:", err);
    }
  }, [newProjectPath, getFullProjectPath, selectedFramework, newProjectName, frameworkLang]);

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
    setCloningTarget(targetUrl);
    setCloneLogs([]);
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
      setCloningTarget(null);
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
          onClick={() => { setShowNewProjectDialog(true); setShowCloneDialog(false); setShowFrameworks(false); }}
        >
          <Plus size={14} /> Create Project
        </button>
        <button
          className="phub__sidebar-btn phub__btn--secondary"
          onClick={() => { setShowCloneDialog(true); setShowNewProjectDialog(false); setShowFrameworks(false); }}
        >
          <CloudDownload size={14} /> Clone Repo
        </button>
        <button
          className="phub__sidebar-btn phub__btn--secondary"
          onClick={async () => { try { await window.electronAPI.openFolder(); } catch {} }}
          title="Open Existing Folder"
        >
          <FolderOpen size={14} /> Open Folder
        </button>
        <div className="phub__sidebar-divider" />
        <button
          className="phub__sidebar-btn phub__btn--secondary"
          title="Frameworks"
          onClick={() => { setShowFrameworks(true); setShowNewProjectDialog(false); setShowCloneDialog(false); }}
        >
          <Layers size={14} /> Frameworks
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
                  setSelectedFramework(null);
                }}
                aria-label="Back"
              >
                <ArrowLeft size={16} />
              </button>
              <span className="phub__panel-title">Create Project{selectedFramework ? ` — ${selectedFramework.name}` : ""}</span>
            </div>
            <div className="phub__panel-body">
              {selectedFramework && (
                <div className="phub__dialog-field">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 6 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 4, background: "#fff", border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                      {selectedFramework.iconUrl ? (
                        <img src={selectedFramework.iconUrl} alt={selectedFramework.name} style={{ width: 16, height: 16, objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; const sib = e.currentTarget.nextElementSibling; if (sib) sib.style.display = "inline-flex"; }} />
                      ) : null}
                      <span style={{ display: selectedFramework.iconUrl ? "none" : "inline-flex", color: selectedFramework.color }}>
                        {(() => { const I = selectedFramework.icon; return <I size={14} />; })()}
                      </span>
                    </span>
                    <span style={{ fontWeight: 600, fontSize: "var(--fs-small)", color: "var(--text-primary)" }}>{selectedFramework.name}</span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", background: "var(--bg-active)", padding: "2px 6px", borderRadius: 10 }}>{selectedFramework.category}</span>
                    <button className="phub__btn--tiny" style={{ marginLeft: "auto" }} onClick={() => setSelectedFramework(null)}>Clear</button>
                  </div>
                </div>
              )}
              {selectedFramework?.languages && (
                <div className="phub__dialog-field">
                  <label className="phub__dialog-label">Language</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {selectedFramework.languages.map((l) => (
                      <button key={l} onClick={() => setFrameworkLang(l)} className={frameworkLang === l ? "phub__fw-cat phub__fw-cat--active" : "phub__fw-cat"}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedFramework?.variants?.includes("Tailwind") && (
                <div className="phub__dialog-field">
                  <label className="phub__dialog-label">Variant</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", padding: "4px 8px", background: "var(--bg-active)", borderRadius: 6 }}>Tailwind available — will be included in template</span>
                  </div>
                </div>
              )}
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
            <div className="phub__panel-footer phub__create-actions">
              <button
                className="phub__dialog-cancel"
                onClick={() => {
                  setShowNewProjectDialog(false);
                  setNewProjectName("");
                  setNewProjectLocation("");
                  setNewProjectPath("");
                  setSelectedFramework(null);
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
                    {searchLoading || (cloning && cloningTarget === searchQuery.trim()) ? <Loader2 size={14} className="phub__spin" /> : <Search size={14} />} Go
                  </button>
                </div>
              </div>
              {(cloning || cloneLogs.length > 0) && (
                <div className="phub__clone-logs">
                  <div className="phub__clone-logs-header">Console {cloning && <Loader2 size={12} className="phub__spin" />}</div>
                  <div ref={cloneContainerRef} className="phub__clone-logs-body phub__clone-xterm" />
                </div>
              )}
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
                          {cloning && cloningTarget === repo.clone_url ? <Loader2 size={12} className="phub__spin" /> : <CloudDownload size={12} />} Clone
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
        ) : showFrameworks ? (
          <div className="phub__panel phub__panel--frameworks">
            <div className="phub__panel-header">
              <button
                className="phub__panel-back"
                onClick={() => setShowFrameworks(false)}
                aria-label="Back"
              >
                <ArrowLeft size={16} />
              </button>
              <span className="phub__panel-title">Frameworks</span>
              <span className="phub__panel-count">{FRAMEWORKS.filter(fw => {
                const q = frameworkSearch.trim().toLowerCase();
                if (frameworkCategory !== "All" && fw.category !== frameworkCategory) return false;
                if (!q) return true;
                return fw.name.toLowerCase().includes(q) || fw.desc.toLowerCase().includes(q) || fw.id.toLowerCase().includes(q);
              }).length}</span>
            </div>
            <div className="phub__panel-body">
              <div className="phub__dialog-field">
                <div className="phub__dialog-inputWrap">
                  <Search size={14} className="phub__dialog-inputIcon" />
                  <input
                    className="phub__dialog-input phub__dialog-input--flex"
                    type="text"
                    placeholder="Search frameworks — e.g., react, discord, expo..."
                    value={frameworkSearch}
                    onChange={(e) => setFrameworkSearch(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {FRAMEWORK_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setFrameworkCategory(cat)}
                      className={frameworkCategory === cat ? "phub__fw-cat phub__fw-cat--active" : "phub__fw-cat"}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div className="phub__dialog-results phub__dialog-results--full">
                {FRAMEWORKS.filter(fw => {
                  const q = frameworkSearch.trim().toLowerCase();
                  if (frameworkCategory !== "All" && fw.category !== frameworkCategory) return false;
                  if (!q) return true;
                  return fw.name.toLowerCase().includes(q) || fw.desc.toLowerCase().includes(q) || fw.id.toLowerCase().includes(q);
                }).map((fw) => {
                  const Icon = fw.icon;
                  return (
                    <div key={fw.id} className="phub__dialog-result phub__dialog-result--card phub__fw-card" onClick={() => handleFrameworkSelect(fw)} style={{ cursor: "pointer" }}>
                      <div className="phub__dialog-result-main">
                        <span style={{ width: 28, height: 28, borderRadius: 6, background: "#fff", border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                          {fw.iconUrl ? (
                            <img src={fw.iconUrl} alt={fw.name} style={{ width: 18, height: 18, objectFit: "contain" }} loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; const sib = e.currentTarget.nextElementSibling; if (sib) sib.style.display = "inline-flex"; }} />
                          ) : null}
                          <span style={{ display: fw.iconUrl ? "none" : "inline-flex", color: fw.color }}>
                            <Icon size={16} />
                          </span>
                        </span>
                        <span className="phub__dialog-result-name" title={fw.name}>{fw.name}</span>
                        <span className="phub__fw-badge">{fw.category}</span>
                      </div>
                      <div className="phub__dialog-result-desc" title={fw.desc}>{fw.desc}</div>
                      <div className="phub__dialog-result-foot">
                        <span className="phub__dialog-result-url" title={fw.id}>{fw.id}</span>
                        <button className="phub__dialog-cloneBtn" onClick={(e) => { e.stopPropagation(); handleFrameworkSelect(fw); }}>Use</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {FRAMEWORKS.filter(fw => {
                const q = frameworkSearch.trim().toLowerCase();
                if (frameworkCategory !== "All" && fw.category !== frameworkCategory) return false;
                if (!q) return true;
                return fw.name.toLowerCase().includes(q) || fw.desc.toLowerCase().includes(q) || fw.id.toLowerCase().includes(q);
              }).length === 0 && (
                <div className="phub__panel-empty" style={{ padding: "var(--space-16)" }}>No frameworks found</div>
              )}
            </div>
          </div>
        ) : (
          <div className="phub__stack">
            <div className="phub__panel phub__panel--note">
              <div className="phub__panel-body phub__note-body">
                {/* blank — will handle later */}
              </div>
            </div>
            <div className="phub__panel phub__panel--recents">
              <div className="phub__panel-header">
                <span className="phub__panel-title">Recents</span>
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
