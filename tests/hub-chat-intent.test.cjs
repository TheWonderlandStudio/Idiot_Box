const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getRepoNameFromChat,
  getRepoSearchQuery,
  hasCloneIntent,
  hasRepoSearchIntent,
} = require("../electron/renderer/components/Project/chat-intent.cjs");

test("repository searches use project terms, not conversational filler", () => {
  const cases = [
    ["find me a React dashboard repo", "react dashboard"],
    ["search GitHub for a Python Discord bot", "python discord bot"],
    ["repo find karo for React", "react"],
    ["I want to find a repo for a desktop app", "desktop app"],
  ];

  for (const [prompt, expectedQuery] of cases) {
    assert.equal(hasRepoSearchIntent(prompt), true, prompt);
    assert.equal(getRepoSearchQuery(prompt), expectedQuery, prompt);
  }
});

test("clone requests do not fall through to generic repository search", () => {
  const prompt = "i want to clone my repo";
  assert.equal(hasCloneIntent(prompt), true);
  assert.equal(hasRepoSearchIntent(prompt), false);
  assert.equal(getRepoSearchQuery(prompt), "");
});

test("ordinary project chat is not treated as a repository search", () => {
  for (const prompt of [
    "I want to make a website",
    "Explain how React hooks work",
    "I made a repo on my GitHub",
  ]) {
    assert.equal(hasRepoSearchIntent(prompt), false, prompt);
  }
});

test("clone-my-repo resolves the repository name from the conversation", () => {
  const messages = [
    { role: "user", content: "I made a repo on my GitHub" },
    { role: "assistant", content: "What is the name of your repository?" },
    { role: "user", content: "idiot-box" },
    { role: "assistant", content: "What kind of website are you building with Idiot-Box?" },
    { role: "user", content: "desktop app" },
    { role: "assistant", content: "What kind of desktop app are you building?" },
    { role: "user", content: "editor" },
    { role: "assistant", content: "Would you like to use Electron or Tauri?" },
    { role: "user", content: "electron" },
    { role: "assistant", content: "Sure!" },
  ];

  assert.equal(getRepoNameFromChat(messages, "I want to clone my repo"), "idiot-box");
});

test("clone flow asks for the repository name instead of searching vague terms", () => {
  assert.equal(getRepoNameFromChat([], "I want to clone my repo"), "");
});
