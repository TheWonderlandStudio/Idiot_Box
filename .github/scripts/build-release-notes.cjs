#!/usr/bin/env node
/**
 * Build the GitHub Release body for a tag push.
 *
 * Sections, in order:
 *   1. CHANGELOG.md   -> the "## [<version>]" section (curated highlights)
 *   2. Contributors   -> GitHub-native @mentions: PR authors from the
 *                        generate-notes API plus commit authors between the
 *                        previous release and this tag
 *   3. Sponsors       -> curated bullets in docs/SPONSORS.md
 *
 * Usage:
 *   GITHUB_REF_NAME=v0.1.31 GITHUB_TOKEN=... node .github/scripts/build-release-notes.cjs
 */
const fs = require("node:fs")
const path = require("node:path")

const root = process.cwd()
const tag = process.env.GITHUB_REF_NAME || ""
const version = tag.replace(/^v/, "")
const repository = process.env.GITHUB_REPOSITORY || "TheWonderlandStudio/Idiot_Box"
const token = process.env.GITHUB_TOKEN || ""
const outputFile = process.env.RELEASE_NOTES_FILE || "release-notes.md"

const BOT_LOGINS = new Set(["github-actions", "dependabot", "renovate", "codecov", "copilot"])

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8")
}

function changelogSection() {
  const lines = read("CHANGELOG.md").split(/\r?\n/)
  const out = []
  let capturing = false
  for (const line of lines) {
    const heading = line.match(/^## \[(.+?)\]/)
    if (heading) {
      if (capturing) break
      if (heading[1] === version) {
        capturing = true
        continue
      }
    } else if (capturing) {
      out.push(line)
    }
  }
  const body = out.join("\n").trim()
  return body ? `## What's new\n\n${body}` : "See CHANGELOG.md for details."
}

function sponsorsSection() {
  let bullets = ""
  try {
    const md = read("docs/SPONSORS.md")
    const match = md.match(
      /<!--\s*release-notes:sponsors:start\s*-->([\s\S]*?)<!--\s*release-notes:sponsors:end\s*-->/,
    )
    bullets = (match ? match[1] : "").trim()
  } catch {
    // Sponsors file is optional.
  }

  const lines = [
    "## Sponsors",
    "",
    "Idiot Box is free and open source. Thank you to everyone supporting its development.",
    "",
  ]
  if (bullets) lines.push(bullets, "")
  lines.push("[Become a sponsor](https://github.com/sponsors/Jignesh1236)")
  return lines.join("\n")
}

function extractLogins(notes) {
  const logins = []
  const seen = new Set()
  const re = /(?:^|[^\w@/-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g
  let match
  while ((match = re.exec(notes)) !== null) {
    const login = match[1]
    const key = login.toLowerCase()
    if (BOT_LOGINS.has(key) || seen.has(key)) continue
    seen.add(key)
    logins.push(login)
  }
  return logins
}

async function githubApi(apiPath, init = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "idiot-box-release-notes",
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    throw new Error(`${apiPath} failed with ${response.status}`)
  }
  return response.json()
}

async function collectContributors() {
  const entries = []
  const seen = new Set()

  const add = (login, name) => {
    const label = login ? `@${login}` : name
    if (!label) return
    const key = label.toLowerCase()
    if (seen.has(key)) return
    if (name && /\[bot\]/i.test(name)) return
    seen.add(key)
    entries.push(label)
  }

  // PR authors and first-time contributors, exactly as GitHub renders them.
  try {
    const notes = await githubApi(`/repos/${repository}/releases/generate-notes`, {
      method: "POST",
      body: JSON.stringify({ tag_name: tag }),
    })
    for (const login of extractLogins(String(notes.body || ""))) add(login)
  } catch (error) {
    console.warn(`generate-notes skipped: ${error.message}`)
  }

  // Direct pushes (no PR) only show up in the compare range.
  try {
    const latest = await githubApi(`/repos/${repository}/releases/latest`)
    const previous = latest.tag_name
    if (previous && previous !== tag) {
      const compare = await githubApi(`/repos/${repository}/compare/${previous}...${tag}`)
      for (const commit of compare.commits || []) {
        const login = commit.author && commit.author.login
        const name = commit.commit && commit.commit.author && commit.commit.author.name
        if (login) add(login)
        else if (name && name !== "GitHub") add(null, name)
      }
    }
  } catch (error) {
    console.warn(`compare lookup skipped: ${error.message}`)
  }

  if (entries.length === 0) return ""
  return [
    "## Contributors",
    "",
    "Thanks to everyone who contributed to this release:",
    "",
    ...entries.map((entry) => `- ${entry}`),
  ].join("\n")
}

async function main() {
  const contributors = token
    ? await collectContributors()
    : (console.warn("GITHUB_TOKEN not set - skipping contributors section"), "")

  const sections = [changelogSection(), contributors, sponsorsSection()].filter(Boolean)
  const body = `${sections.join("\n\n")}\n`
  fs.writeFileSync(path.join(root, outputFile), body)
  console.log(`release notes for ${tag || "(no tag)"}: ${body.length} chars`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
