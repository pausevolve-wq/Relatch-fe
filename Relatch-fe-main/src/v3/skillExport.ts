// Packages a finished skill (one file, or a set of up to three) for download the way the live app does
// (src/App.tsx, SkillOutput: handleDownloadAll / handleDownloadCodex), so a V3 download installs exactly
// like a V2 one:
//   Claude, one file : <slug>.md
//   Claude, a set    : <slug>.zip              -> <slug>/SKILL.md (a short index) + <slug>/<part slug>.md each
//   Codex, one file  : <slug>-codex-skill.zip  -> <slug>/SKILL.md + <slug>/agents/openai.yaml
//   Codex, a set     : <slug>-codex-skills.zip -> <part slug>/SKILL.md + <part slug>/agents/openai.yaml each
// The Codex clean-up (frontmatter rebuilt, Claude-only keys dropped, stray blocks and preambles removed,
// the companion yaml) is V2's, rule for rule. Two deliberate differences: a part is named after its own
// skill, never after the document it came from (V3 keeps no trace of the source), and a Codex skill's
// `name:` is the folder's slug, so a rename carries through to both.
// Since 2026-10-19 a Claude file's header follows the Agent Skills format too (agentskills.io, which the
// Claude app checks on upload): see claudeFile.
// Since 2026-11-02 a third target, Agents: one folder any agent that reads skills can load (see agentsFiles):
//   Agents, one file : <slug>-agent-skill.zip  -> README.md + <slug>/SKILL.md, references/, agents/openai.yaml
//   Agents, a set    : <slug>-agent-skills.zip -> README.md + one such folder per part
// 2026-11-20: a static import, not `await import('jszip')`. Lazy, jszip was its own hashed file, and each deploy
// renamed it: a tab opened before a deploy then asked for the old file (404) and Download did nothing at all
// (live on a phone 08:25Z: "Failed to fetch dynamically imported module"). In the one bundle it can't go missing.
import JSZip from 'jszip';
import { formatCodexDisplayName, isGenericCodexDescription, splitYamlListItems, toSkillSlug } from '@/engine/core';

export type Target = 'claude' | 'codex' | 'agents';
// One finished skill file: its own skill name and its text.
export interface SkillPart { name: string; content: string }

// A skill's `name` in the Agent Skills format: lowercase letters, numbers and single hyphens, at most 64,
// never starting or ending with a hyphen. It is the skill's folder name too.
// claude.ai also refuses a name containing "claude" or "anthropic", so those words are dropped (as the live
// app does since 2026-11-02, Relatch-fe#26).
const skillName = (name: string) => toSkillSlug(toSkillSlug(name).replace(/claude|anthropic/g, '-')).slice(0, 64).replace(/^-+|-+$/g, '') || 'my-skill';

// A one-line YAML string.
const yamlString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// The header's top-level fields as written by the backend: `key: value`, `key: ["a", "b"]`, or a key
// followed by `- item` lines. Lists come back as their items.
function headerFields(content: string): [string, string | string[]][] {
  const fm = content.replace(/\r/g, '').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const out: [string, string | string[]][] = [];
  for (const line of fm.split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    const item = /^\s+-\s+(.*)$/.exec(line);
    const unq = (v: string) => v.trim().replace(/^"([\s\S]*)"$|^'([\s\S]*)'$/, '$1$2').replace(/\\"/g, '"');
    if (kv) {
      const v = kv[2].trim();
      // A `[...]` list: every item, quoted or not (2026-11-19: only quoted items were read, so `[a, b]` vanished
      // from the metadata and the description), split on commas outside quotes only
      out.push([kv[1], v.startsWith('[') ? splitYamlListItems(v.slice(1, v.endsWith(']') ? -1 : undefined)).map(unq).filter(Boolean) : v ? unq(v) : []]);
    } else if (item && out.length && Array.isArray(out[out.length - 1][1])) (out[out.length - 1][1] as string[]).push(unq(item[1]));
  }
  return out;
}

// What a skill does and when to use it, in one line: how Claude and Codex decide to use a skill, and what
// the Claude app requires on upload. The backend writes one for Codex only, so for the rest it is built
// from the skill itself: its opening role sentence, then the use cases its header lists (placeholders
// like "case 1" dropped). At most 1024 characters, no angle brackets.
export function describeSkill(content: string, name: string): string {
  const raw = content.replace(/\r/g, '');
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const para = body.split('\n').map((l) => l.trim()).find((l) => l && !/^(#|\||[-*>`]|\d+\.)/.test(l)) ?? '';
  const plain = para.replace(/<[^>]*>/g, '').replace(/[*_`]/g, '');
  let what = (plain.match(/^.+?[.!?](?=\s+[A-Z"'(]|\s*$)/)?.[0] ?? plain).trim().replace(/^You (?:are|act as)\s+/, 'Acts as ');
  if (what.length > 400) what = what.slice(0, 400).replace(/[\s,;:]+\S*$/, '');
  if (!what) what = `${name.replace(/[-_]+/g, ' ')} skill`;
  if (!/[.!?]$/.test(what)) what += '.';
  const cases = (headerFields(raw).find(([k]) => k === 'use_cases')?.[1] ?? []) as string[];
  const real = (Array.isArray(cases) ? cases : [cases]).map((c) => c.trim()).filter((c) => c && !/^case\s*\d+$/i.test(c) && c !== 'general use').slice(0, 4);
  const when = real.length ? ` Use for ${real.length === 1 ? real[0] : `${real.slice(0, -1).join(', ')} and ${real[real.length - 1]}`}.` : '';
  return `${what}${when}`.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1024);
}

// A Claude skill file as it is downloaded and copied: the header in the Agent Skills format (`name` as
// a slug, which is also its folder; a `description`), then Relatch's own labels (domain, content type,
// use cases) under `metadata`, where the format keeps extra properties, then the skill. A file that came
// without a header gets one. Any description the backend did write is kept.
export function claudeFile(md: string, name: string) {
  const raw = md.replace(/\r/g, '');
  const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
  const body = (m ? raw.slice(m[0].length) : raw).replace(/^\n+/, '');
  const fields = headerFields(raw);
  const own = fields.find(([k]) => k === 'description')?.[1];
  const description = typeof own === 'string' && own.trim() ? own.trim() : describeSkill(raw, name);
  const extra = fields.filter(([k]) => k !== 'name' && k !== 'description').map(([k, v]) => `  ${k.replace(/_/g, '-')}: ${yamlString(Array.isArray(v) ? v.join('; ') : v)}`).filter((l) => !/: ""$/.test(l));
  return `---\nname: ${skillName(name)}\ndescription: ${yamlString(description)}\n${extra.length ? `metadata:\n${extra.join('\n')}\n` : ''}---\n\n${body}`;
}

// Each part's full slug inside the set, V2's `<set>-<part>`: the set's name, then the part's own skill
// name without the set's name repeated. A part that IS the set's name (the first one, usually) just takes
// the set's name. Collisions are numbered.
export function partSlugs(setSlug: string, parts: SkillPart[]): string[] {
  const seen = new Set<string>();
  return parts.map((p) => {
    let s = toSkillSlug(p.name);
    if (s.startsWith(`${setSlug}-`)) s = s.slice(setSlug.length + 1);
    const base = !s || s === setSlug || s === 'my-skill' ? setSlug : `${setSlug}-${s}`;
    let full = base;
    for (let n = 2; seen.has(full); n++) full = `${base}-${n}`;
    seen.add(full);
    return full;
  });
}

// What a download will be: the button's words, the file it saves, and the skill folders it unpacks to
// (the install walkthrough shows these).
export function downloadPlan(target: Target, name: string, parts: SkillPart[]) {
  const slug = toSkillSlug(name);
  const multi = parts.length > 1;
  const subs = partSlugs(slug, parts);
  if (target === 'codex') return { label: 'Download ZIP', file: multi ? `${slug}-codex-skills.zip` : `${slug}-codex-skill.zip`, folders: multi ? subs : [slug] };
  // An Agents folder is the skill's `name`, so "claude" and "anthropic" are dropped from it too (skillName),
  // which can make two parts' folders the same: those are numbered, as partSlugs does.
  if (target === 'agents') {
    const seen = new Set<string>();
    const folders = (multi ? subs : [slug]).map(skillName).map((f) => { let u = f; for (let n = 2; seen.has(u); n++) u = `${f.slice(0, 63 - String(n).length).replace(/-+$/, '')}-${n}`; seen.add(u); return u; });
    return { label: 'Download ZIP', file: multi ? `${slug}-agent-skills.zip` : `${slug}-agent-skill.zip`, folders };
  }
  // A Claude skill folder must equal its SKILL.md `name` (Agent Skills spec), and that name drops
  // "claude"/"anthropic" (skillName), so the folder does too. The file keeps the plain slug.
  return { label: multi ? 'Download ZIP' : 'Download skill', file: multi ? `${slug}.zip` : `${slug}.md`, folders: [skillName(slug)] };
}

// ---- Codex (ported from V2) ----

// The backend's own frontmatter on a Codex skill: its name and description, and whether that description
// is real or a placeholder.
function codexMetaOf(content: string, nameHint: string) {
  const raw = content.replace(/\r/g, '').trim();
  const fm = raw.match(/---\n([\s\S]*?)\n---/);
  if (!fm) return undefined;
  const nM = fm[1].match(/^name:\s*"?([\s\S]*?)"?\s*$/m);
  let dM = fm[1].match(/^description:\s*(.+)$/m);
  if (!dM) {
    const block = fm[1].match(/^description:\s*([\s\S]*?)(?=\n\S|\s*$)/m);
    if (block) dM = block;
  }
  const n = nM ? nM[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const d = dM ? dM[1].replace(/^["']|["']$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return { name: n || undefined, description: d || undefined, real: !!d && !isGenericCodexDescription(d, n || nameHint) };
}

// Finds the first ---...--- block anywhere in content, strips it and any preamble before it.
function stripCodexFm(md: string) {
  const m = md.match(/---\n[\s\S]*?\n---\n?/);
  if (!m || m.index === undefined) return md.trim();
  return md.slice(m.index + m[0].length).trim();
}

// Deduplicates exact heading lines (## / ###), keeping the first occurrence and its body.
function dedupeHeadings(text: string) {
  const seen = new Set<string>();
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#{1,3} /.test(line)) {
      if (seen.has(line.trim())) {
        i++;
        while (i < lines.length && !/^#{1,3} /.test(lines[i])) i++;
        continue;
      }
      seen.add(line.trim());
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

function codexDescription(content: string, name: string) {
  const meta = codexMetaOf(content, name);
  return meta?.description || describeSkill(content, name);
}

// A Codex SKILL.md: rebuilt frontmatter (name + description only), then the body with any stray
// frontmatter and any preamble before the first ## section removed. `dedupe` is V2's single-file path.
export function codexSkillMd(content: string, name: string, dedupe = false) {
  const desc = codexDescription(content, name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let body = stripCodexFm(content);
  if (dedupe) body = dedupeHeadings(body);
  body = body.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  const firstH = body.search(/^## /m);
  if (firstH > 0) body = body.slice(firstH).trim();
  if (!body.trim()) return '';
  let md = `---\nname: ${name}\ndescription: "${desc}"\n---\n\n${body}`.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  // Claude-era keys never belong in a Codex frontmatter.
  md = md.replace(/^(---\n)([\s\S]*?)(\n---)/m, (_m, open, fm, close) => `${open}${fm.split('\n').filter((l: string) => !/^(domain|content_type|use_cases|origin|tags):/.test(l)).join('\n')}${close}`);
  // Any further frontmatter blocks after the first.
  const fmEnd = md.indexOf('\n---\n');
  if (fmEnd !== -1) md = (md.slice(0, fmEnd + 5) + md.slice(fmEnd + 5).replace(/^---\n[\s\S]*?\n---\n?/gm, '')).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return md;
}

// How a skill is listed in the agents' skill menus: the name Codex shows, and the first sentence of its
// description, at most 100 characters (the install walkthrough shows the same line for Claude).
export function skillListing(content: string, name: string) {
  return { title: formatCodexDisplayName(name), about: codexShortDescription(codexDescription(content, name)) };
}

// 2026-10-25 (production Relatch-fe 69b3ee9, ported 2026-11-15): openai.yaml text shaped like OpenAI's own
// skills. short_description is cut at a word boundary - never mid-word, no "..." (it used to end
// "following exact te..."). default_prompt is the description's first sentence.
const CODEX_TRAILING_STOPWORD = /^(and|or|for|the|to|with|of|a|an|in|on|by|from|following|including)$/i;
function codexFirstSentence(desc: string): string {
  return (desc.match(/^[^.!?]+[.!?]?/)?.[0] || desc).trim();
}
function codexShortDescription(desc: string): string {
  const s = codexFirstSentence(desc).replace(/[.!?]$/, '');
  if (s.length <= 100) return s;
  // Prefer the last phrase break inside 40-100 chars: a dash, or the word before a connector. Not commas:
  // they are usually list separators ("reporting, investigation, and remediation").
  let cut = -1;
  for (const m of s.matchAll(/ - | (?=(?:following|for|with|by|from|including|using|under|across|when|while|so that|to)\s)/g)) {
    if (m.index !== undefined && m.index >= 40 && m.index <= 100) cut = m.index;
  }
  if (cut > 0) return s.slice(0, cut).trim();
  const words = s.slice(0, s.lastIndexOf(' ', 100)).split(' ');
  while (words.length > 1 && CODEX_TRAILING_STOPWORD.test(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/[,;:]$/, '');
}
function codexDefaultPrompt(desc: string): string {
  const s = codexFirstSentence(desc);
  return s.length <= 240 ? s : `${s.slice(0, s.lastIndexOf(' ', 237)).replace(/[,;:]$/, '')}.`;
}
const codexYamlString = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// agents/openai.yaml: the name Codex shows, a one-sentence description (at most 100 characters, cut at a
// word boundary) and the default prompt.
function codexYaml(content: string, name: string) {
  const desc = codexDescription(content, name);
  const short = codexYamlString(codexShortDescription(desc));
  const prompt = codexYamlString(codexDefaultPrompt(desc));
  return `interface:\n  display_name: "${formatCodexDisplayName(name)}"\n  short_description: "${short}"\n  brand_color: "#8b5cf6"\n  default_prompt: "${prompt}"\n\npolicy:\n  allow_implicit_invocation: true\n`;
}

// ---- Agents (2026-11-02) ----

// Where each agent reads skills, from its own documentation (Claude Code, Codex, OpenClaw, Hermes docs and
// agentskills.io/clients, read 2026-11-02). `{folder}` is the skill's folder. Shown in the README and in
// "How to install".
export const AGENT_INSTALLS: [string, string][] = [
  ['Claude Code', 'Put the {folder} folder in `~/.claude/skills/` (every project) or `.claude/skills/` (one project).'],
  ['Claude app', 'Customize > Skills > Add > Upload skill, with the {folder} folder zipped on its own.'],
  ['Codex', 'Put the {folder} folder in `~/.agents/skills/` (every project) or `.agents/skills/` in a repository.'],
  ['OpenClaw', 'Run `openclaw skills install ./{folder}`, or put the folder in `~/.agents/skills/`.'],
  ['Hermes', 'Put the {folder} folder in `~/.hermes/skills/`.'],
  ['Others', 'Cursor, Gemini CLI, GitHub Copilot and the other agents on agentskills.io/clients: the folder goes where that agent reads skills.'],
];

// The body's `## ` sections in order, each with its own text; a preamble before the first one has no heading.
function sectionsOf(body: string) {
  return body.split(/^(?=## )/m).map((text) => ({ heading: text.match(/^## (.*)/)?.[1]?.trim() ?? '', text }));
}

// One Agents skill folder, from the backend's Agents output (relatch api/enrich.js: the Claude template
// plus one Codex-shape section, ending with "Other Source Rules & Details" and "Verify This Skill Is Working").
//   SKILL.md                    the header claudeFile writes (the strictest host's: the Claude app's upload),
//                               then the skill, minus the two closing sections
//   references/source-rules.md  "Other Source Rules & Details": the long tail of the source, read only when a
//                               request needs it. SKILL.md links it and says when (Hermes installs only files
//                               SKILL.md links; agentskills.io: say when to read a reference)
//   agents/openai.yaml          how Codex and ChatGPT list it
// "Verify This Skill Is Working" is for the person, not the agent: it goes to the README as "Test it".
export function agentsFiles(content: string, folder: string) {
  const md = claudeFile(content, folder);
  const head = md.match(/^---\n[\s\S]*?\n---\n\n?/)?.[0] ?? '';
  const parts = sectionsOf(md.slice(head.length));
  const take = (re: RegExp) => { const i = parts.findIndex((s) => re.test(s.heading)); return i < 0 ? '' : parts.splice(i, 1)[0].text.replace(/^## .*\n+/, '').trim(); };
  const rules = take(/^Other Source Rules/i);
  const tests = take(/^Verify This Skill/i);
  let body = parts.map((s) => s.text).join('').trimEnd();
  if (rules) body += '\n\n## Reference Files\n\n- [references/source-rules.md](references/source-rules.md): every other rule and detail the source gives (named tools, channels, forms, owners, team- or region-specific rules, examples). Read it when a request names something the sections above do not cover.';
  return {
    skill: `${head}${body}\n`,
    rules: rules ? `# Other source rules and details\n\n${rules}\n` : null,
    tests,
    yaml: codexYaml(content, folder),
  };
}

// README.md beside the skill folders (outside them: a skill folder holds only what the agent reads).
function agentsReadme(skills: { folder: string; name: string; tests: string }[]) {
  const names = skills.map((s) => `\`${s.folder}\``).join(', ');
  const one = skills.length === 1;
  const rows = AGENT_INSTALLS.map(([agent, how]) => `| ${agent} | ${how.replace(/the \{folder\} folder/g, one ? `the ${skills[0].folder} folder` : 'each folder').replace(/\{folder\}/g, one ? skills[0].folder : '<folder>')} |`).join('\n');
  const tests = skills.filter((s) => s.tests).map((s) => (one ? s.tests : `### ${s.name}\n\n${s.tests}`)).join('\n\n');
  return `# ${skills.map((s) => s.name).join(' + ')}\n\n${one ? 'An agent skill' : `${skills.length} agent skills`} made with Relatch from your document${one ? '' : 's'}. ${one ? 'It follows' : 'They follow'} the open Agent Skills format (agentskills.io), so any agent that reads skills can load ${one ? 'it' : 'them'}.\n\n## Install\n\nCopy ${one ? `the ${names} folder` : `each folder (${names})`} to where your agent reads skills:\n\n| Agent | Where it goes |\n|---|---|\n${rows}\n\nThen ask for something the skill covers. The agent loads a skill by itself when a request matches its description.${tests ? `\n\n## Test it\n\nTry these requests after installing. A good answer contains what each one lists.\n\n${tests}` : ''}\n`;
}

// ---- Claude ----

// The index a Claude skill set's ZIP opens with. V2's held only a name and a description ("A combined
// skill integrating <domains> across N source documents"), so once Claude opened it, nothing pointed it
// at the files beside it. Now its description names the parts and their use cases, and its body links
// each part file with what that part is for.
function claudeIndex(slug: string, parts: SkillPart[], subs: string[]) {
  const and = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  // Up to four use cases, taken in turn from each part, so the first part doesn't fill them all.
  const lists = parts.map((p) => {
    const v = headerFields(p.content).find(([k]) => k === 'use_cases')?.[1] ?? [];
    return (Array.isArray(v) ? v : [v]).map((c) => c.trim()).filter((c) => c && !/^case\s*\d+$/i.test(c));
  });
  const cases: string[] = [];
  for (let i = 0; cases.length < 4 && lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i] && !cases.includes(l[i]) && cases.length < 4) cases.push(l[i]);
  const description = `Combines ${and(parts.map((p) => p.name))} into one skill.${cases.length ? ` Use for ${and(cases)}.` : ''}`.replace(/[<>]/g, '').slice(0, 1024);
  const links = parts.map((p, i) => `- [${p.name}](${subs[i]}.md): ${describeSkill(p.content, p.name)}`).join('\n');
  return `---\nname: ${skillName(slug)}\ndescription: ${yamlString(description)}\n---\n\n# ${parts.map((p) => p.name).join(' + ')}\n\nThis skill is in ${parts.length} parts. Read the part that fits the task, or all of them when it spans several:\n\n${links}\n`;
}

// The header the file of the part at `index` downloads with, for the preview: the lines between its
// `---` markers. A Claude file's (claudeFile) or a Codex SKILL.md's (codexSkillMd), named as pack names it.
export function downloadedHeader(target: Target, name: string, parts: SkillPart[], index: number): string {
  const part = parts[index];
  if (!part) return '';
  const own = target === 'agents' ? downloadPlan(target, name, parts).folders[index] : parts.length === 1 ? (target === 'claude' ? name : toSkillSlug(name)) : downloadPlan(target, name, parts).folders[index];
  const md = target === 'agents'
    ? agentsFiles(part.content, own).skill
    : target === 'claude'
      ? claudeFile(part.content, parts.length === 1 ? own : partSlugs(toSkillSlug(name), parts)[index])
      : codexSkillMd(part.content, own, parts.length === 1);
  return md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
}

function save(blob: Blob, file: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: file });
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Writes one skill into a ZIP under `root`, laid out exactly as its own download unpacks. Returns the
// names of files left out because they came out empty.
function pack(zip: JSZip, target: Target, name: string, parts: SkillPart[], root = ''): string[] {
  const slug = toSkillSlug(name);
  if (target === 'claude') {
    if (parts.length === 1) { zip.file(`${root}${slug}.md`, claudeFile(parts[0].content, name)); return []; }
    const subs = partSlugs(slug, parts);
    const folder = skillName(slug); // = the index's `name`, as the spec requires
    zip.file(`${root}${folder}/SKILL.md`, claudeIndex(slug, parts, subs));
    subs.forEach((p, i) => zip.file(`${root}${folder}/${p}.md`, claudeFile(parts[i].content, p)));
    return [];
  }
  if (target === 'agents') {
    const skipped: string[] = [];
    const done: { folder: string; name: string; tests: string }[] = [];
    downloadPlan(target, name, parts).folders.forEach((folder, i) => {
      const f = agentsFiles(parts[i].content, folder);
      if (!f.skill.includes('## ')) { skipped.push(parts[i].name); return; }
      zip.file(`${root}${folder}/SKILL.md`, f.skill);
      if (f.rules) zip.file(`${root}${folder}/references/source-rules.md`, f.rules);
      zip.file(`${root}${folder}/agents/openai.yaml`, f.yaml);
      done.push({ folder, name: parts[i].name, tests: f.tests });
    });
    if (done.length) zip.file(`${root}README.md`, agentsReadme(done));
    return skipped;
  }
  const folders = parts.length === 1 ? [slug] : downloadPlan(target, name, parts).folders;
  const skipped: string[] = [];
  folders.forEach((folder, i) => {
    const md = codexSkillMd(parts[i].content, folder, parts.length === 1);
    if (!md.includes('## ')) { skipped.push(parts[i].name); return; }
    zip.file(`${root}${folder}/SKILL.md`, md);
    zip.file(`${root}${folder}/agents/openai.yaml`, codexYaml(parts[i].content, folder));
  });
  return skipped;
}

// Builds and saves the download. `note` says what could not be packaged; `saved` is false when nothing was.
export async function downloadSkill(target: Target, name: string, parts: SkillPart[]): Promise<{ saved: boolean; note: string | null }> {
  const plan = downloadPlan(target, name, parts);
  if (target === 'claude' && parts.length === 1) {
    save(new Blob([claudeFile(parts[0].content, name)], { type: 'text/markdown;charset=utf-8' }), plan.file);
    return { saved: true, note: null };
  }
  const zip = new JSZip();
  const skipped = pack(zip, target, name, parts);
  if (skipped.length === parts.length) return { saved: false, note: parts.length === 1 ? 'This skill came out empty. Try building it again.' : 'These skills came out empty. Try building them again.' };
  save(await zip.generateAsync({ type: 'blob' }), plan.file);
  return { saved: true, note: skipped.length ? `Left out of the ZIP because they came out empty: ${skipped.join(', ')}.` : null };
}

// Every saved skill in one ZIP (Settings > Your data > Skill history): a Claude folder and a Codex folder,
// each skill inside laid out as its own download, so a folder can be copied straight to where skills go.
// Two skills with the same name are numbered rather than written over each other.
// Since 2026-11-02 also an Agents folder, one sub-folder per skill (its README sits beside its folders).
export async function downloadAll(skills: { target: Target; name: string; parts: SkillPart[] }[]): Promise<boolean> {
  if (!skills.length) return false;
  const zip = new JSZip();
  const used = new Set<string>();
  for (const s of skills) {
    const dir = s.target === 'codex' ? 'Codex/' : s.target === 'agents' ? 'Agents/' : 'Claude/';
    let name = s.name;
    for (let n = 2; used.has(dir + toSkillSlug(name)); n++) name = `${s.name} ${n}`;
    used.add(dir + toSkillSlug(name));
    // An Agents download has a README beside its folders, so each one gets its own folder here.
    pack(zip, s.target, name, s.parts, s.target === 'agents' ? `${dir}${toSkillSlug(name)}/` : dir);
  }
  // Dated by this person's calendar, not UTC's (toISOString would say yesterday for half the world).
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  save(await zip.generateAsync({ type: 'blob' }), `relatch-skills-${day}.zip`);
  return true;
}
