import React from "react";
import { Actions } from "flexlayout-react";
import "./blank.css";

// ── Panel icons (line-art: currentColor se panel accent milta hai;
// fixer brand fills (project/ports) literals rakhe hain — artwork hai) ──────
const I = {
  canvas: (
    <svg width="24" height="24" viewBox="0 0 48 48" fill="none" strokeWidth="2" aria-hidden="true">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M9.5 5.5h29c2.216 0 4 1.784 4 4v29c0 2.216-1.784 4-4 4h-29c-2.216 0-4-1.784-4-4v-29c0-2.216 1.784-4 4-4" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M28.512 32.887a3.1 3.1 0 0 1-1.553-.418 3.1 3.1 0 0 1-1.139-1.135" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="m42.329 15.67-3.103 5.373C37.82 23.48 36 25.687 34.012 27.675l-8.64 8.64c-.259.259-1.045-.195-.95-.549l3.162-11.801c.728-2.717 1.73-5.397 3.136-7.833l6.04-10.46" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="m42.174 8.546-4.93 8.539c-.416.72-1.33.964-2.05.549l-.207-.12a1.497 1.497 0 0 1-.55-2.05l5.475-9.482M5.873 12.603c6.006-1.33 15.533.682 15.751 6.888.185 5.237-9.363 7.232-9.616 11.586-.25 4.295 5.798 5.94 12.498 5.123" />
    </svg>
  ),
  terminal: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path strokeLinejoin="round" d="M10 19h10.5" />
        <path d="M6.605 17.25V19m0-13.75V7" />
        <path strokeLinejoin="round" d="M9.686 8.923c-.2-.885-1.343-1.871-3.015-1.871-1.671 0-2.957 1.086-2.957 2.457 0 3.114 6.2 1.514 6.2 5.129 0 1.306-1.571 2.414-3.243 2.414-1.67 0-2.828-1.029-3.171-2.129" />
      </g>
    </svg>
  ),
  browser: (
    <svg width="24" height="24" viewBox="0 0 48 48" fill="none" strokeWidth="2" aria-hidden="true">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M5.383 13.251c5.934-10.286 19.08-13.8 29.366-7.868s13.8 19.08 7.868 29.366c-5.934 10.286-19.08 13.8-29.366 7.868-10.286-5.934-13.8-19.08-7.868-29.366m7.868 29.366C8.091 39.683 6.286 33.12 9.22 27.96s9.496-6.965 14.657-4.031L24 24c5.16-2.934 6.965-9.496 4.031-14.656s-9.496-6.966-14.656-4.032l-.124.071M45.497 24c0 5.936-4.812 10.749-10.748 10.749S24 29.936 24 24" />
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M18.142 29.858c2.698 0 4.88 2.193 4.88 4.89s-2.182 4.891-4.88 4.891-4.89-2.193-4.89-4.89 2.192-4.891 4.89-4.891m-.494-21.981c2.698 0 4.89 2.193 4.89 4.89s-2.193 4.88-4.89 4.88-4.88-2.181-4.88-4.88 2.182-4.89 4.88-4.89M36.705 19.11c2.698 0 4.88 2.192 4.88 4.89s-2.182 4.89-4.88 4.89-4.89-2.192-4.89-4.89 2.192-4.89 4.89-4.89" />
    </svg>
  ),
  project: (
    <svg width="24" height="24" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="#1e88e5" d="m6.922 3.768-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232" />
      <path fill="#bbdefb" d="M13.677 10.436 16 12.67l-1.37 1.313-2.307-2.236v-.368l.974-.945zm.376-1.012-.4-.384-1.977 1.92v.788L9.353 14 8 12.672l2.306-2.237h.813l.322-.312-1.585-1.54H9.32L8.16 7.449 9.243 6.4l1.155 1.12v.524l1.605 1.536 1.097-1.064-.395-.404.535-.524h-1.098l-.268-.26L13.24 6l.272.263v1.065l.541-.529 1.353 1.313a1.11 1.11 0 0 1 0 1.592l-.813-.805Z" />
    </svg>
  ),
  editor: (
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
      <path fill="currentColor" d="M29.992 19h-2v-7a5 5 0 0 0-5-5h-8.995V5h8.995a7 7 0 0 1 7 7zm-18 9h-3c-3.86 0-7-3.14-7-7v-5h2v5c0 2.757 2.243 5 5 5h3zm-2-14h-4c-1.103 0-2-.897-2-2v-2h2v2h4V2h2v10c0 1.103-.897 2-2 2M28.15 26l-2.58 2.58L26.98 30l4-4-4-4-1.42 1.41zm-11.34 0 2.58-2.58L17.98 22l-4 4 4 4 1.42-1.41zm5.17 5-1.915-.577L22.98 21l1.915.577z" />
    </svg>
  ),
  mediaViewer: (
    <svg width="24" height="24" viewBox="0 0 12 12" aria-hidden="true">
      <g fill="currentColor">
        <path d="M3.33 9.07c.1-.1.25-.1.35 0l2.59 2.59c-.29.2-.64.33-1.02.33h-3.5c-.38 0-.73-.12-1.02-.33l2.59-2.59z" />
        <path fillRule="evenodd" d="M7.34 0c.39 0 .78.16 1.06.44l2.16 2.16c.28.28.44.67.44 1.06V9.5c0 .83-.67 1.5-1.5 1.5H7.88c.07-.24.12-.49.12-.75V10h1.5c.28 0 .5-.22.5-.5V4H8c-.55 0-1-.45-1-1V1H3.5c-.28 0-.5.22-.5.5V4H2V1.5C2 .67 2.67 0 3.5 0zM8 3h1.54L8 1.46z" clipRule="evenodd" />
        <path fillRule="evenodd" d="M5.26 5c.97 0 1.75.78 1.75 1.75v3.5c0 .22-.05.43-.12.62l-2.5-2.5c-.48-.48-1.29-.48-1.77 0l-2.5 2.5c-.08-.2-.12-.4-.12-.62v-3.5C0 5.78.78 5 1.75 5zm-.01 1c-.41 0-.75.34-.75.75s.34.75.75.75.75-.34.75-.75S5.66 6 5.25 6" clipRule="evenodd" />
      </g>
    </svg>
  ),
  componentPreview: (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="m21.41 12.09-3.91-1.74V5c0-.4-.23-.75-.59-.91l-4.5-2a.96.96 0 0 0-.81 0l-4.5 2c-.36.16-.59.52-.59.91v5.35L2.6 12.09c-.36.16-.59.52-.59.91v6c0 .4.23.75.59.91l4.5 2a.98.98 0 0 0 .82 0l4.09-1.82 4.09 1.82a.98.98 0 0 0 .82 0l4.5-2c.36-.16.59-.52.59-.91v-6c0-.4-.23-.75-.59-.91Zm-5.91-1.74L13 11.46V8.65l2.5-1.11zm-8 1.74.44.19 2.72 1.21L7.5 14.9l-3.16-1.41zm1 4.56 2.5-1.11v2.81l-2.5 1.11zm8-1.74-3.16-1.41 2.72-1.21.44-.19 3.16 1.4zM12 4.1l3.16 1.4L12 6.91 8.84 5.5zm5.5 15.37v-2.81l2.5-1.11v2.81z" />
    </svg>
  ),
  problems: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6.326 16.343a3.454 3.454 0 1 0 0-6.908 3.454 3.454 0 0 0 0 6.908m5.181 6.907a5.18 5.18 0 0 0-10.361 0m17.021-4.969a2.678 2.678 0 1 0 0-5.356 2.678 2.678 0 0 0 0 5.356m-.446-7.366h.893m-.447 0v2.009m2.999-.951.631.631m-.315-.316-1.421 1.421m2.793 1.447v.893m0-.446h-2.008m.951 2.998-.631.632m.316-.316-1.421-1.421m-1.447 2.794h-.893m.446 0v-2.009m-2.998.952-.632-.632m.316.316 1.42-1.421m-2.793-1.447v-.893m0 .447h2.009m-.952-2.999.632-.631m-.316.315 1.42 1.421M2.83 7.462 1.56 4.311l1.842.381-1.27-3.151m4.259 4.934.056-3.396 1.549 1.068L8.053.75m2.36 6.712L11.655 4.3l1.077 1.542 1.242-3.162" />
    </svg>
  ),
  git: (
    <svg width="24" height="24" viewBox="0 0 48 48" fill="none" strokeWidth="2" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M4.21 22.12a2.87 2.87 0 0 0 0 3.77L22.12 43.8a2.87 2.87 0 0 0 3.77 0l17.9-17.91a2.85 2.85 0 0 0 0-3.77L25.89 4.21a2.68 2.68 0 0 0-1.89-.7h0a2.66 2.66 0 0 0-1.88.71Zm22.12-4.27 3.82 3.82M17.4 8.92l4.27 4.27" />
      <circle cx="24" cy="32.41" r="3.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="15.52" r="3.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32.48" cy="24" r="3.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M24 29.11V18.82" />
    </svg>
  ),
  ports: (
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
      <path fill="#a4b100" d="M27.5 5.5h-9.3l-2.1 4.2H4.4v16.8h25.2v-21Zm0 4.2h-8.2l1.1-2.1h7.1Z" />
      <path fill="#fff" d="M31.239 18.461H23.3a3.458 3.458 0 1 0-1.874 4.612 3.97 3.97 0 0 0 2.018-1.729h7.789a8.3 8.3 0 0 1 .006-2.883m-11.108 3.026a1.585 1.585 0 1 1 1.585-1.587 1.584 1.584 0 0 1-1.585 1.587" />
      <path fill="none" stroke="#fff" strokeMiterlimit="10" strokeWidth="2" d="M25.239 13.951a7.909 7.909 0 1 0 .772 10.965" />
    </svg>
  ),
  android: (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M17.532 15.106a1.003 1.003 0 1 1 .001-2.007 1.003 1.003 0 0 1 0 2.007m-11.044 0a1.003 1.003 0 1 1 .001-2.007 1.003 1.003 0 0 1 0 2.007m11.4-6.018 2.006-3.459a.413.413 0 1 0-.721-.407l-2.027 3.5a12.2 12.2 0 0 0-5.13-1.108c-1.85 0-3.595.398-5.141 1.098l-2.027-3.5a.413.413 0 1 0-.72.407l1.995 3.458C2.696 10.947.345 14.417 0 18.523h24c-.334-4.096-2.675-7.565-6.112-9.435" />
    </svg>
  ),
  ai: (
    <svg width="24" height="24" viewBox="0 0 48 48" fill="none" strokeWidth="2" aria-hidden="true">
      <defs>
        <path id="bp-ai-glyph" fill="none" stroke="currentColor" d="M16.63 29.522v4.224l-2.836 1.638a4.38 4.38 0 0 1-5.981-1.608l-.34-.589a4.37 4.37 0 0 1 1.608-5.971l2.896-1.668 3.535 2.047a2.23 2.23 0 0 1 1.118 1.927m6.252-14.699-3.595-2.077V9.55a4.373 4.373 0 0 1 4.373-4.374h.69a4.37 4.37 0 0 1 4.363 4.374v3.196l-3.595 2.077c-.689.4-1.547.4-2.237 0ZM33.347 24l-3.915 2.257c-.449.26-.719.729-.719 1.238v4.724l-3.994-2.307h-.01c-.44-.26-.979-.26-1.418 0l-.01-.01-3.994 2.307v-4.714c0-.51-.27-.978-.72-1.238L14.654 24l3.915-2.257c.45-.26.719-.729.719-1.238V15.79l3.994 2.307.01-.01c.44.26.979.26 1.418 0l.01.01 3.994-2.307v4.714c0 .51.27.979.72 1.238zm7.17 9.197-.34.6a4.38 4.38 0 0 1-5.971 1.587l-2.836-1.638v-4.224c0-.799.43-1.528 1.118-1.927l3.535-2.047 2.896 1.668a4.375 4.375 0 0 1 1.598 5.981" />
      </defs>
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M31.37 9.33v1.888l-2.657 1.528V9.55a4.37 4.37 0 0 0-4.364-4.374h-.689a4.373 4.373 0 0 0-4.373 4.374v10.955c0 .51-.27.979-.72 1.238L14.654 24l-2.676-1.548 3.535-2.037a2.24 2.24 0 0 0 1.118-1.937V9.34a6.844 6.844 0 0 1 6.84-6.84h1.07a6.827 6.827 0 0 1 6.83 6.83Zm-2.657 22.889v3.035l-3.595-2.077a2.29 2.29 0 0 0-2.236 0l-3.595 2.077-2.657 1.528-1.657.959a6.84 6.84 0 0 1-9.337-2.497l-.27-.47-.27-.458a6.83 6.83 0 0 1 2.507-9.337l1.697-.98 2.677 1.549-2.896 1.668a4.37 4.37 0 0 0-1.608 5.971l.34.59a4.38 4.38 0 0 0 5.981 1.607l2.836-1.638 2.657-1.538 3.994-2.306.01.01c.44-.26.979-.26 1.418 0h.01z" />
      <use href="#bp-ai-glyph" strokeLinecap="round" strokeLinejoin="round" />
      <use href="#bp-ai-glyph" strokeLinecap="round" strokeLinejoin="round" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M19.287 27.495v4.714l-2.657 1.537v-4.224c0-.799-.43-1.528-1.118-1.927l-3.535-2.047L9.3 24l-1.698-.979a6.83 6.83 0 0 1-2.506-9.336l.27-.46.269-.47a6.84 6.84 0 0 1 9.337-2.496l1.657.959v3.036l-2.836-1.638a4.38 4.38 0 0 0-5.981 1.608l-.34.589a4.37 4.37 0 0 0 1.608 5.971l2.896 1.668L14.653 24l3.915 2.257c.45.26.719.729.719 1.238" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="m15.512 20.415-3.535 2.037-2.896-1.668a4.37 4.37 0 0 1-1.608-5.971l.34-.59a4.38 4.38 0 0 1 5.981-1.607l2.836 1.638v4.224c0 .799-.43 1.537-1.118 1.937m20.511 5.133-3.535 2.047a2.23 2.23 0 0 0-1.118 1.927v9.147a6.827 6.827 0 0 1-6.83 6.831h-1.07a6.844 6.844 0 0 1-6.84-6.84v-1.878l2.657-1.528v3.196a4.373 4.373 0 0 0 4.374 4.374h.689a4.37 4.37 0 0 0 4.363-4.374V27.495c0-.51.27-.978.72-1.238L33.346 24z" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="m25.118 33.177 3.595 2.077v3.196a4.37 4.37 0 0 1-4.364 4.374h-.689a4.373 4.373 0 0 1-4.373-4.374v-3.196l3.595-2.077a2.29 2.29 0 0 1 2.237 0Zm15.279-10.156L38.7 24l-2.677-1.548 2.896-1.668a4.375 4.375 0 0 0 1.598-5.981l-.34-.59a4.37 4.37 0 0 0-5.971-1.597l-2.836 1.638-2.657 1.538-3.994 2.306-.01-.01c-.44.26-.979.26-1.418 0l-.01.01-3.994-2.306v-3.046l3.595 2.077c.689.4 1.548.4 2.237 0l3.595-2.077 2.656-1.528 1.658-.959a6.84 6.84 0 0 1 9.337 2.497l.27.47.269.459a6.83 6.83 0 0 1-2.507 9.337Z" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="M29.432 21.743 33.347 24l-3.915 2.257c-.449.26-.719.729-.719 1.238v4.724l-3.994-2.307h-.01c-.44-.26-.979-.26-1.418 0l-.01-.01-3.994 2.307v-4.714c0-.51-.27-.978-.72-1.238L14.654 24l3.915-2.257c.45-.26.719-.729.719-1.238V15.79l3.994 2.307.01-.01c.44.26.979.26 1.418 0l.01.01 3.994-2.307v4.714c0 .51.27.979.72 1.238m9.486-.957-2.897 1.667-3.535-2.037a2.24 2.24 0 0 1-1.118-1.937v-4.224l2.836-1.638a4.37 4.37 0 0 1 5.971 1.598l.34.589a4.375 4.375 0 0 1-1.598 5.982M16.63 14.254v4.224c0 .799-.43 1.537-1.118 1.937l-3.535 2.037-2.896-1.668a4.37 4.37 0 0 1-1.608-5.971l.34-.59a4.38 4.38 0 0 1 5.981-1.607zm12.083 21v3.196a4.37 4.37 0 0 1-4.364 4.374h-.689a4.373 4.373 0 0 1-4.373-4.374v-3.196l3.595-2.077a2.29 2.29 0 0 1 2.237 0z" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="m42.904 34.316-.27.459-.27.47a6.84 6.84 0 0 1-9.337 2.496l-1.657-.959v-3.036l2.836 1.638a4.38 4.38 0 0 0 5.971-1.588l.34-.599a4.375 4.375 0 0 0-1.598-5.981l-2.896-1.668L33.347 24l-3.915-2.257a1.43 1.43 0 0 1-.719-1.238V15.79l2.657-1.537v4.224c0 .799.43 1.537 1.118 1.937l3.535 2.037L38.7 24l1.698.979a6.83 6.83 0 0 1 2.507 9.336Z" />
      <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" d="m33.347 24-3.915 2.257c-.449.26-.719.729-.719 1.238v4.724l-3.994-2.307h-.01c-.44-.26-.979-.26-1.418 0l-.01-.01-3.994 2.307v-4.714c0-.51-.27-.978-.72-1.238L14.654 24l3.915-2.257c.45-.26.719-.729.719-1.238V15.79l3.994 2.307.01-.01c.44.26.979.26 1.418 0l.01.01 3.994-2.307v4.714c0 .51.27.979.72 1.238zm5.573-3.215-2.897 1.667-3.535-2.037a2.24 2.24 0 0 1-1.118-1.937v-4.224l2.836-1.638a4.37 4.37 0 0 1 5.971 1.598l.34.589a4.375 4.375 0 0 1-1.598 5.982" />
      <circle cx="24" cy="24" r=".75" fill="currentColor" stroke="none" />
    </svg>
  ),
};

const PANEL_TYPES = [
  {
    id: "canvas",
    name: "Canvas",
    component: "canvas",
    description: "Visual project map — every page & component as live preview cards",
    accent: "var(--teal)",
    icon: I.canvas,
    config: {},
  },
  {
    id: "terminal",
    name: "Terminal",
    component: "terminal",
    description: "Integrated command line terminal shell",
    accent: "var(--teal)",
    icon: I.terminal,
    config: {},
  },
  {
    id: "browser",
    name: "Browser",
    component: "panel3",
    description: "Internal web browser and previewer",
    accent: "var(--code-blue)",
    icon: I.browser,
    config: { type: "browser", title: "Browser", url: "https://www.google.com" },
  },
  {
    id: "project",
    name: "Project Explorer",
    component: "projectPanel",
    description: "File tree and workspace file navigator",
    accent: "var(--text-secondary)",
    icon: I.project,
    config: {},
  },
  {
    id: "editor",
    name: "Code Editor",
    component: "editor",
    description: "Monaco code editor with syntax highlighting",
    accent: "var(--code-cyan)",
    icon: I.editor,
    config: {},
  },
  {
    id: "mediaViewer",
    name: "Media Viewer",
    component: "mediaViewer",
    description: "Preview images, videos, and media assets",
    accent: "var(--code-magenta)",
    icon: I.mediaViewer,
    config: {},
  },
  {
    id: "componentPreview",
    name: "Component Preview",
    component: "componentPreview",
    description: "Live interactive JSX / TSX React component preview",
    accent: "var(--teal)",
    icon: I.componentPreview,
    config: {},
  },
  {
    id: "problems",
    name: "Problems",
    component: "problems",
    description: "Errors and warnings from TypeScript and linter",
    accent: "var(--danger)",
    icon: I.problems,
    config: {},
  },
  {
    id: "git",
    name: "Git",
    component: "gitPanel",
    description: "Git status, diff and file changes",
    accent: "var(--code-orange)",
    icon: I.git,
    config: {},
  },
  {
    id: "ports",
    name: "Ports",
    component: "ports",
    description: "Forwarded ports & running dev servers",
    accent: "var(--warn-gold)",
    icon: I.ports,
    config: {},
  },
  {
    id: "android",
    name: "Android Emulator",
    component: "androidEmulator",
    description: "Run Android apps — SDK auto-setup with live device screen",
    accent: "var(--success)",
    icon: I.android,
    config: {},
  },
  {
    id: "ai",
    name: "AI Assistant",
    component: "aiPanel",
    description: "Chat assistant (Vercel AI SDK) — ask about your code, attach files, read the project",
    accent: "var(--teal)",
    icon: I.ai,
    config: {},
  },
];

const BlankPanel = ({ nodeId, config }) => {
  const handleSelect = (panelItem) => {
    const m = window.__flexModel?.current;
    if (m && nodeId) {
      try {
        m.doAction(
          Actions.updateNodeAttributes(nodeId, {
            component: panelItem.component,
            name: panelItem.name,
            config: panelItem.config || {},
          })
        );
        // Flexlayout memoizes tab content (SizeTracker) and won't re-render it
        // for attribute-only changes — force a redraw so the new component mounts.
        try {
          [...m.getwindowsMap().values()].forEach((lw) => lw?.layout?.redraw?.("force"));
        } catch {}
      } catch (err) {
        console.error("Failed to set panel component:", err);
      }
    }
  };

  return (
    <div className="bp-root">
      <div className="bp-inner">
        <div className="bp-title">
          New Panel
        </div>
        <div className="bp-sub">
          Select a tool or view to open in this panel
        </div>

        <div className="bp-grid">
          {PANEL_TYPES.map((panel) => (
            <button
              key={panel.id}
              className="bp-card"
              onClick={() => handleSelect(panel)}
            >
              <div className="bp-icon" style={{ color: panel.accent }}>{panel.icon}</div>
              <div className="bp-name">
                {panel.name}
              </div>
              <div className="bp-desc">
                {panel.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BlankPanel;
