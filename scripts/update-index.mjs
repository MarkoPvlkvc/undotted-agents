import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILLS_DIR = "skills-standalone";
const MARKETPLACE = join(".claude-plugin", "marketplace.json");
const START = "<!-- skills:start -->";
const END = "<!-- skills:end -->";
const DEFAULTS = {
  name: "undotted-agents",
  owner: { name: "markopvlkvc" },
  description: "The skills I run every day, made public.",
};

function unquote(raw) {
  if (raw.startsWith('"')) return JSON.parse(raw);
  if (raw.startsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  return raw;
}

// Joins block-scalar lines. Trailing newlines are dropped whatever the
// chomping indicator, since an index entry never wants one.
function blockScalar(style, lines) {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  const body = lines.map((l) => l.slice(indent));
  if (style === "|") return body.join("\n").trimEnd();
  return body
    .join("\n")
    .trimEnd()
    .replace(/([^\n])\n(?=[^\n])/g, "$1 ")
    .replace(/\n\n/g, "\n");
}

// Reads only top-level `name` and `description`: plain or quoted (wrapped or
// not), and >, >-, |, |- block scalars. Not a YAML parser.
export function readFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("no frontmatter");
  const lines = match[1].split("\n");
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^(name|description):\s*(.*?)\s*$/);
    if (!field) continue;
    const [, key, value] = field;
    const block = value.match(/^([>|])[-+]?$/);
    if (!block) {
      const parts = [value];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      out[key] = unquote(parts.filter(Boolean).join(" "));
      continue;
    }
    const body = [];
    while (i + 1 < lines.length && (lines[i + 1].startsWith(" ") || !lines[i + 1].trim())) body.push(lines[++i]);
    out[key] = blockScalar(block[1], body);
  }
  return out;
}

function readSkills(root) {
  const dirs = readdirSync(join(root, SKILLS_DIR), { withFileTypes: true }).filter((d) => d.isDirectory());
  return dirs
    .map((d) => {
      const file = join(root, SKILLS_DIR, d.name, "SKILL.md");
      const { name, description } = readFrontmatter(readFileSync(file, "utf8"));
      if (!name || !description) throw new Error(`${file}: frontmatter needs name and description`);
      return { name, source: `./${SKILLS_DIR}/${d.name}`, description };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildIndex(root) {
  const skills = readSkills(root);
  const names = skills.map((s) => s.name).join(", ");
  const plugins = [
    {
      name: "undotted",
      source: "./",
      description: `Every skill in undotted-agents: ${names}.`,
      skills: [`./${SKILLS_DIR}/`],
    },
  ];

  const marketplacePath = join(root, MARKETPLACE);
  const existing = existsSync(marketplacePath) ? JSON.parse(readFileSync(marketplacePath, "utf8")) : DEFAULTS;
  const marketplace = { ...existing, plugins };

  const readmePath = join(root, "README.md");
  const current = readFileSync(readmePath, "utf8");
  const start = current.indexOf(START);
  const end = current.indexOf(END, start);
  if (start === -1 || end === -1) throw new Error(`${readmePath}: needs ${START} followed by ${END}`);
  // `<` escaped so GitHub does not strip `<skill>`-style text as an HTML tag.
  const list = skills
    .map((s) => `- [${s.name}](${s.source.slice(2)}): ${s.description.replaceAll("<", "&lt;")}\n`)
    .join("");
  const readme = `${current.slice(0, start + START.length)}\n${list}${current.slice(end)}`;

  return { marketplace, readme, skillCount: skills.length };
}

function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const { marketplace, readme, skillCount } = buildIndex(root);
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, MARKETPLACE), JSON.stringify(marketplace, null, 2) + "\n");
  writeFileSync(join(root, "README.md"), readme);
  console.log(`indexed ${skillCount} skills into 1 plugin`);
}

// import.meta.url is the resolved path, so argv[1] is resolved too, since a
// symlinked checkout or /var resolving to /private/var would otherwise never
// match. argv[1] is unset under `node -e` and the REPL, which import without
// running.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
