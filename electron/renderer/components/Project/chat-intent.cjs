const REPO_SEARCH_INTENT =
  /\b(?:find|search|look(?:ing)?\s+for|recommend|suggest|show(?:\s+me)?|get\s+me)\b[\s\S]{0,100}\b(?:github\s+)?repos?(?:itory|itories)?\b|\b(?:find|search|look(?:ing)?\s+for|recommend|suggest|show(?:\s+me)?)\b[\s\S]{0,100}\bgithub\b|\b(?:repo|repository)\b[\s\S]{0,80}\b(?:find|search|look|recommend|suggest|show|dhund\w*|khoj\w*)\b/i;

const REPO_SEARCH_STOP_WORDS = new Set([
  "a", "an", "the", "me", "my", "please", "can", "could", "would", "you",
  "i", "want", "wanna", "to", "need", "like", "looking", "look", "find",
  "search", "recommend", "suggest", "show", "get", "clone", "cloning", "checkout",
  "download", "for", "on", "in", "from",
  "github", "repo", "repos", "repository", "repositories", "project", "projects",
  "with", "that", "which", "some", "best", "good", "koi", "ek", "mujhe",
  "dhundo", "dhundho", "khojo", "khoj", "karo", "karna", "dikhao", "batao", "do",
]);

const hasCloneIntent = (text) => /\b(?:clone|cloning|checkout)\b/i.test(String(text || ""));

const hasRepoSearchIntent = (text) => REPO_SEARCH_INTENT.test(String(text || ""));

const getRepoSearchQuery = (text) => {
  const raw = String(text || "").trim();
  const terms = raw
    .replace(/https?:\/\/\S+/gi, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .split(/\s+/)
    .filter((term) => term && !REPO_SEARCH_STOP_WORDS.has(term));
  return terms.join(" ").slice(0, 120);
};

const getRepoNameFromChat = (messages, currentText) => {
  const explicit = String(currentText || "").match(
    /\b(?:repo(?:sitory)?\s+(?:named|called)\s+)([a-z0-9][\w.-]*)/i,
  )?.[1];
  if (explicit) return explicit.replace(/\.git$/i, "");

  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const answer = String(message.content || "").trim();
    const previous = messages[i - 1];
    if (
      /^[a-z0-9][\w.-]*$/i.test(answer) &&
      /(?:repo|repository)/i.test(previous?.content || "") &&
      /(?:name|called|named|which|what)/i.test(previous?.content || "")
    ) return answer.replace(/\.git$/i, "");
  }
  return "";
};

module.exports = {
  getRepoNameFromChat,
  getRepoSearchQuery,
  hasCloneIntent,
  hasRepoSearchIntent,
};
