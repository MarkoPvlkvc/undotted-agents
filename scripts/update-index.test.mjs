import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "./update-index.mjs";

const START = "<!-- skills:start -->";
const END = "<!-- skills:end -->";

function fixture({ skills, readme = `# t\n\n${START}\n${END}\n`, marketplace }) {
  const root = mkdtempSync(join(tmpdir(), "update-index-"));
  for (const [dir, frontmatter] of Object.entries(skills)) {
    mkdirSync(join(root, "skills-standalone", dir), { recursive: true });
    writeFileSync(join(root, "skills-standalone", dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# body\n`);
  }
  writeFileSync(join(root, "README.md"), readme);
  if (marketplace) {
    mkdirSync(join(root, ".claude-plugin"));
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify(marketplace));
  }
  return root;
}

const plain = (name, description = `${name} desc`) => `name: ${name}\ndescription: ${description}`;

test("builds one bundle plugin covering every skill, names sorted", () => {
  const root = fixture({ skills: { b: plain("b"), a: plain("a") } });
  const { marketplace } = buildIndex(root);
  assert.deepEqual(marketplace.plugins, [
    {
      name: "undotted",
      source: "./",
      description: "Every skill in undotted-agents: a, b.",
      skills: ["./skills-standalone/"],
    },
  ]);
});

test("keeps existing top-level marketplace fields", () => {
  const root = fixture({
    skills: { a: plain("a") },
    marketplace: { name: "m", owner: { name: "x" }, extra: 1, plugins: [{ name: "old", source: "./old" }] },
  });
  const { marketplace } = buildIndex(root);
  assert.equal(marketplace.owner.name, "x");
  assert.equal(marketplace.name, "m");
  assert.equal(marketplace.extra, 1);
  assert.deepEqual(marketplace.plugins.map((p) => p.name), ["undotted"]);
});

test("creates marketplace defaults when absent", () => {
  const root = fixture({ skills: { a: plain("a") } });
  const { marketplace } = buildIndex(root);
  assert.equal(marketplace.name, "undotted-agents");
  assert.equal(marketplace.owner.name, "markopvlkvc");
  assert.equal(typeof marketplace.description, "string");
  assert.ok(marketplace.description.length > 0);
});

test("description with quotes and colons round-trips through JSON", () => {
  const root = fixture({ skills: { a: plain("a", 'Runs "x": y') } });
  const { marketplace, readme } = buildIndex(root);
  const parsed = JSON.parse(JSON.stringify(marketplace, null, 2));
  assert.equal(typeof parsed.plugins[0].description, "string");
  assert.ok(readme.includes('Runs "x": y'));
});

test("quoted descriptions are unquoted", () => {
  const root = fixture({
    skills: {
      a: `name: a\ndescription: "Say \\"hi\\": now"`,
      b: `name: 'b'\ndescription: 'It''s: fine'`,
    },
  });
  const { readme } = buildIndex(root);
  assert.ok(readme.includes('Say "hi": now'));
  assert.ok(readme.includes("It's: fine"));
});

test("double-quoted description decodes escaped quotes and backslashes", () => {
  const root = fixture({
    skills: { a: `name: a\ndescription: "Use when someone says \\"take the next part\\", path a\\\\b."\nargument-hint: "[n]"` },
  });
  const { readme } = buildIndex(root);
  assert.ok(readme.includes('Use when someone says "take the next part", path a\\b.'));
});

test("plain description wrapped onto indented lines joins with spaces", () => {
  const root = fixture({
    skills: { a: "name: a\ndescription: Add Clerk authentication by following the official quickstart\n  guides.\nlicense: MIT" },
  });
  const { readme } = buildIndex(root);
  assert.ok(readme.includes("Add Clerk authentication by following the official quickstart guides."));
});

test("single-quoted description wrapped onto indented lines joins with spaces", () => {
  const root = fixture({
    skills: {
      a:
        "name: a\ndescription: 'TanStack React Start auth patterns with @clerk/tanstack-react-start\n" +
        "  - createServerFn, beforeLoad guards, loaders, Vinxi server. Triggers on: TanStack\n" +
        "  auth, createServerFn clerk, beforeLoad protection, TanStack Start middleware.'\nlicense: MIT",
    },
  });
  const { readme } = buildIndex(root);
  assert.ok(
    readme.includes(
      "TanStack React Start auth patterns with @clerk/tanstack-react-start - createServerFn, beforeLoad guards, loaders, Vinxi server. Triggers on: TanStack auth, createServerFn clerk, beforeLoad protection, TanStack Start middleware.",
    ),
  );
});

test("double-quoted description wrapped onto indented lines joins with spaces", () => {
  const root = fixture({
    skills: {
      a: 'name: a\ndescription: "Say \\"hi\\" to the\n  wrapped value: now."\nlicense: MIT',
    },
  });
  const { readme } = buildIndex(root);
  assert.ok(readme.includes('Say "hi" to the wrapped value: now.'));
});

test("folded description", () => {
  const root = fixture({
    skills: {
      a: "name: a\ndescription: >\n  First line,\n  second line.\nlicense: MIT",
      b: "name: b\ndescription: >-\n  One\n  two.\nmetadata:\n  author: x",
      c: "name: c\ndescription: |-\n  Keep\n  lines",
    },
  });
  const { readme } = buildIndex(root);
  assert.ok(readme.includes("First line, second line."));
  assert.ok(readme.includes("One two."));
  assert.ok(readme.includes("Keep\nlines"));
});

test("replaces only the marker span", () => {
  const before = `# Title\n\nIntro text.\n\n${START}`;
  const after = `${END}\n\n## After\n\nMore.\n`;
  const root = fixture({ skills: { a: plain("a") }, readme: `${before}\n- stale\n${after}` });
  const { readme } = buildIndex(root);
  assert.equal(readme, `${before}\n- [a](skills-standalone/a): a desc\n${after}`);
});

test("escapes < in the README bullet only", () => {
  const root = fixture({ skills: { a: plain("a", "run <x> until done") } });
  const { readme } = buildIndex(root);
  assert.ok(readme.includes(`${START}\n- [a](skills-standalone/a): run &lt;x> until done\n${END}`));
});

test("errors when markers are missing", () => {
  const root = fixture({ skills: { a: plain("a") }, readme: "# no markers\n" });
  assert.throws(() => buildIndex(root), /skills:start/);
});
