const search = (text) => `https://www.google.com/search?q=${encodeURIComponent(text)}`;

function resolveAddress(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  if (/^(https?:\/\/|ibx-file:\/\/|idiotbox:\/\/|file:\/\/|view-source:)/i.test(text)) return text;
  if (/\s/.test(text.split(/[/?#]/, 1)[0])) return search(text);
  const shortcut = text.match(/^:(\d{1,5})([/?#].*)?$/);
  if (shortcut && Number(shortcut[1]) > 0 && Number(shortcut[1]) <= 65535) return `http://localhost:${Number(shortcut[1])}${shortcut[2] || ""}`;
  if (/^[a-z][a-z\d+.-]*:\D/i.test(text)) return search(text);
  try {
    const url = new URL(`https://${text}`);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return `http://${text}`;
    if (host.includes(".")) return `https://${text}`;
  } catch {}
  return search(text);
}

module.exports = { resolveAddress };
