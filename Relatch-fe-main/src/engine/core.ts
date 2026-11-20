// Relatch engine: file extraction, document profiling, the /api/enrich client and fallbacks.
// Moved byte-identically out of App.tsx (see scripts/extract-engine.mjs); only `export` was added.
// No React, no Clerk: UI code imports from here.
import * as pdfjsLib from "pdfjs-dist";
// 2026-11-20: static, not `await import('jszip')`: a lazy jszip was its own hashed file that each deploy renamed,
// so a tab opened before a deploy failed to read .docx files (and to download ZIPs, src/v3/skillExport.ts).
import JSZip from "jszip";
import { captureEvent } from "../analytics";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export let _getToken: (() => Promise<string | null>) | null = null;

export type FileCategory = 'personality' | 'knowledge' | 'instructions' | 'examples' | 'context' | 'preferences';
export type AppStep = 'agent' | 'upload' | 'organize' | 'configure' | 'generate';
export type Priority = 'high' | 'medium' | 'low';

export interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
  category: FileCategory;
  parsedAt: Date;
  extractionWarning?: string;
  ocrBlocks?: OcrPageBlocks[];
}

export interface CategoryConfig {
  enabled: boolean;
  label: string;
  description: string;
  icon: string;
  priority: Priority;
}

export interface SkillConfig {
  skillName: string;
  description: string;
  customNotes: string;
  categories: Record<FileCategory, CategoryConfig>;
  target: 'claude' | 'codex';
}

export type CodexDescriptionSource = 'model' | 'backend_placeholder' | 'frontend_recovered' | 'missing';

export interface CodexMeta {
  name?: string;
  description?: string;
  descriptionSource: CodexDescriptionSource;
}

export interface GeneratedSkill {
  filename: string;
  content: string;
  category: FileCategory | 'main';
  tokenEstimate: number;
  codexMeta?: CodexMeta; // backend Codex frontmatter extracted before it is stripped
}

export let idCounter = 0;
export const generateId = () => `file_${Date.now()}_${++idCounter}`;

export const ACCEPTED_TYPES: Record<string, string[]> = {
  'Text': ['.txt', '.md', '.csv', '.log'],
  'Documents': ['.pdf', '.doc', '.docx'],
  'Web': ['.html', '.htm', '.xml'],
  'Data': ['.json', '.yaml', '.yml', '.toml'],
  'Code': ['.js', '.ts', '.py', '.rb', '.go', '.rs'],
};

export const OCR_PROXY_URL = 'https://claudly-proxy.vercel.app/api/ocr';
export const ENRICH_PROXY_URL = 'https://claudly-proxy.vercel.app/api/enrich';
export const ANON_TOKEN_URL = 'https://claudly-proxy.vercel.app/api/anon-token';
export const ANON_TOKEN_STORAGE_KEY = 'relatch_anon_token';
// localStorage can throw (blocked site data, sandboxed frames): a read that fails is just "nothing stored",
// never a failed upload or a failed skill (item 6, approved 2026-11-09).
export function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
// Set once this journey reaches the terminal 'generate' step (see the useEffect in App())
// — distinct from ANON_TOKEN_STORAGE_KEY merely existing, which stays true throughout the
// current journey's own remaining steps. requireAuth checks this first so a *returning*
// visitor (reload, new tab) who already completed a trial is sent straight to sign-up at
// step 1, instead of walking the whole wizard again and only discovering it's dead at the
// final generate call. This is a UX convenience, not the real enforcement boundary —
// enrich.js's own per-token sessionId binding is what actually prevents a second free
// generation server-side, even if this flag is cleared, bypassed, or never set (e.g. the
// journey is abandoned before reaching 'generate').
export const ANON_TRIAL_USED_KEY = 'relatch_anon_trial_used';

export function getFileExtension(name: string): string {
  return '.' + name.split('.').pop()?.toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type NormalizedFileType = 'pdf' | 'docx' | 'txt' | 'html' | 'unknown';

// Mirrors the `blocks` shape returned by /api/ocr (Mistral's include_blocks output) —
// paragraph-level bounding boxes, OCR4+ only. See relatch-main/api/ocr.js.
export interface OcrBlock {
  type: string;
  top_left_x: number;
  top_left_y: number;
  bottom_right_x: number;
  bottom_right_y: number;
  content: string;
}

export interface OcrPageBlocks {
  page: number;
  blocks: OcrBlock[];
}

export interface ExtractedTextResult {
  type: NormalizedFileType;
  text: string;
  warnings: string[];
  blocks?: OcrPageBlocks[];
}

export interface FileValidationResult {
  ok: boolean;
  reason?: string;
}

export function detectFileType(file: File): NormalizedFileType {
  const ext = getFileExtension(file.name);
  const mime = (file.type || '').toLowerCase();
  if (mime.includes('application/pdf')) return 'pdf';
  if (mime.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || mime.includes('application/msword')) return 'docx';
  if (mime.includes('text/html') || mime.includes('application/xhtml+xml')) return 'html';
  if (mime.startsWith('text/')) return 'txt';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx' || ext === '.doc') return 'docx';
  if (ext === '.html' || ext === '.htm' || ext === '.xml') return 'html';
  if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.log' || ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml' || ext === '.js' || ext === '.ts' || ext === '.py' || ext === '.rb' || ext === '.go' || ext === '.rs') return 'txt';
  return 'unknown';
}

export const SUPPORTED_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.log',
  '.pdf', '.doc', '.docx',
  '.html', '.htm', '.xml',
  '.json', '.yaml', '.yml', '.toml',
  '.js', '.ts', '.py', '.rb', '.go', '.rs',
]);

// Client-side upload size cap. Bounds worst-case memory use during parsing —
// in particular JSZip's decompression of word/document.xml in extractDocxText(),
// which has no output-size limit of its own. 20MB is generous for the actual
// use case (extracting text for a skill file) while keeping a maliciously
// crafted small-but-high-ratio .docx from trying to inflate to an unbounded
// size in the browser's own memory.
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// Matches api/ocr.js's own ~3MB decoded-size cap (Vercel's 4.5MB request-body ceiling sits
// just above that). Checked in callOcrProxy before the synchronous arrayBufferToBase64 encode
// below, so a file we already know the backend will reject with 413 is rejected instantly
// client-side instead of freezing the tab encoding megabytes of base64 first. Deliberately
// separate from MAX_FILE_SIZE_BYTES above - most files in the 3-20MB band never need OCR at
// all (pdfjs extracts their text layer directly), so this only gates the OCR escalation path.
export const MAX_OCR_FILE_SIZE_BYTES = 3 * 1000 * 1000;

export function validateInputFile(file: File): FileValidationResult {
  if (!file || file.size <= 0) return { ok: false, reason: 'File is empty and cannot be processed.' };
  if (file.size > MAX_FILE_SIZE_BYTES) return { ok: false, reason: `File too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(MAX_FILE_SIZE_BYTES)}.` };
  const ext = getFileExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.has(ext)) return { ok: false, reason: `Unsupported file type: ${ext}` };
  return { ok: true };
}

export function isLikelyAppAssetText(text: string, fileType: NormalizedFileType): boolean {
  if (fileType === 'pdf' || fileType === 'docx') return false;
  const sample = text.substring(0, 1200).toLowerCase();
  return (
    sample.includes('<!doctype html') ||
    sample.includes('<script type="module"') ||
    sample.includes('__vite__') ||
    sample.includes('webpack') ||
    sample.includes('sourcemappingurl') ||
    sample.includes('/assets/index-')
  );
}

export function inferCategory(file: File, content: string): FileCategory {
  const name = file.name.toLowerCase();
  const text = content.toLowerCase();
  if (name.includes('persona') || name.includes('style') || name.includes('tone') || name.includes('voice')) return 'personality';
  if (name.includes('pref') || name.includes('setting') || name.includes('config')) return 'preferences';
  if (name.includes('example') || name.includes('sample') || name.includes('template')) return 'examples';
  if (name.includes('instruct') || name.includes('guide') || name.includes('rule') || name.includes('prompt')) return 'instructions';
  if (name.includes('context') || name.includes('background') || name.includes('about')) return 'context';
  if (text.includes('you should') || text.includes('always ') || text.includes('never ') || text.includes('make sure')) return 'instructions';
  if (text.includes('example:') || text.includes('for instance') || text.includes('sample')) return 'examples';
  if (text.includes('i am') || text.includes('my name') || text.includes('i prefer') || text.includes('i like')) return 'preferences';
  if (text.includes('tone') || text.includes('style') || text.includes('personality') || text.includes('voice')) return 'personality';
  return 'knowledge';
}

export function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

export function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error(`Failed to read binary data from ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decodeArrayBuffer(buffer: ArrayBuffer, encoding: string = 'utf-8'): string {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(new Uint8Array(buffer));
  } catch {
    return new TextDecoder('latin1').decode(new Uint8Array(buffer));
  }
}

export function stripArtifacts(text: string): string {
  return text
    .replace(/%PDF-[\d.]+/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// 2026-09-26 content fidelity (vault: "Relatch Content Fidelity - Extraction and Selection").
// stripArtifacts above collapses EVERY run of 2+ whitespace into one space and deletes anything
// shaped like <...>. A Windows line break (\r\n) is 2 whitespace chars, so an Excel CSV became one
// line and was rejected as "no behavioral patterns"; YAML and Python lost their line breaks and
// indentation; TypeScript generics (useState<Project[]>) and markdown autolinks were deleted.
// This keeps line breaks, indentation and <...> text and removes only invisible characters.
// stripArtifacts stays for the raw-HTML fallback and unknown types.
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripXmlArtifacts(text: string): string {
  return text
    .replace(/w:[a-zA-Z]+/g, ' ')
    .replace(/xmlns:[a-zA-Z]+="[^"]*"/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function extractTextFromHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: string[] = [];
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li').forEach((el) => {
    const t = el.textContent?.trim();
    if (!t) return;
    if (el.tagName.toLowerCase() === 'li') blocks.push(`- ${t}`);
    else blocks.push(t);
  });
  if (blocks.length === 0) return stripArtifacts(doc.body?.textContent || html);
  return blocks.join('\n');
}

// sessionId: the upload batch id. The backend (2026-10-23) counts a batch's OCR and generation calls
// as ONE credit of the daily/weekly allowance only when both carry it. (Ported from production
// Relatch-fe c06f42d on 2026-11-15; the V3 engine had been copied before it.)
export async function callOcrProxy(file: File, sessionId?: string): Promise<{ text: string; source: string; blocks?: OcrPageBlocks[] } | null> {
  if (file.size > MAX_OCR_FILE_SIZE_BYTES) return null;
  try {
    const buffer = await readAsArrayBuffer(file);
    const base64 = arrayBufferToBase64(buffer);
    const mimeType = file.type || 'application/pdf';

    const token = _getToken ? await _getToken() : null;
    const anonToken = !token ? readStorage(ANON_TOKEN_STORAGE_KEY) : null;
    const response = await fetch(OCR_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(anonToken ? { 'X-Anon-Token': anonToken } : {}),
      },
      body: JSON.stringify({ base64, mimeType, fileName: file.name, ...(sessionId ? { sessionId } : {}) }),
    });

    // Daily/weekly allowance used up: surface it exactly like enrichWithAI's 429, instead of the
    // misleading "PDF may be encrypted or corrupted" warning a silent null produces for scanned PDFs.
    if (response.status === 429) {
      const errData = await response.json().catch(() => ({}));
      if (errData.error === 'QUOTA_REACHED') {
        const quotaErr = new Error('QUOTA_REACHED');
        (quotaErr as any).isQuotaError = true;
        (quotaErr as any).limitType = errData.limitType === 'weekly' ? 'weekly' : 'daily';
        (quotaErr as any).weeklyCount = errData.weeklyCount ?? 0;
        throw quotaErr;
      }
    }

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.text && data.text.length > 50) {
      captureEvent('ocr_used', { provider: data.source, session_id: readStorage('rl_session_id') });
      return { text: data.text, source: data.source, blocks: data.blocks };
    }

    return null;
  } catch (err) {
    // Quota errors must bubble up to the caller - same rule as enrichWithAI.
    if ((err as any)?.isQuotaError) throw err;
    return null;
  }
}

// Returns true when pdfjs-extracted text is structurally weak for the document size  - 
// indicating a diagram-heavy or caption-dominated PDF where OCR may recover more content.
// Only applied for multi-page PDFs (single-page cover/title pages are trusted as-is).
// Requires at least 2 of 3 signals to fire, reducing false positives on short-but-valid docs.
export function isPdfTextWeak(text: string, numPages: number): boolean {
  if (numPages < 2) return false;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return true;

  // Signal 1: Sparse text per page - architecture/diagram PDFs typically extract < 200 chars/page
  const isSparse = (text.length / numPages) < 200;

  // Signal 2: Fragment-dominated - avg line < 38 chars means mostly labels/captions, not prose
  const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
  const isFragmentDominated = avgLineLen < 38;

  // Signal 3: Prose-less - < 8% of lines end with sentence punctuation
  const sentenceLikeLines = lines.filter(l => /[.!?]$/.test(l)).length;
  const isProseLess = (sentenceLikeLines / lines.length) < 0.08;

  return [isSparse, isFragmentDominated, isProseLess].filter(Boolean).length >= 2;
}

export async function extractPdfText(file: File, sessionId?: string): Promise<ExtractedTextResult> {
  const warnings: string[] = [];
  let pdfjsText = '';
  let numPages = 1;

  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    numPages = pdf.numPages;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as { str?: string; hasEOL?: boolean }[])
        .map((item) => {
          const str = item.str || '';
          return item.hasEOL ? str + '\n' : str + ' ';
        })
        .join('');
      fullText += `\n${pageText}`;
    }
    pdfjsText = fullText.trim();
  } catch {
    warnings.push('PDF text layer extraction failed.');
  }

  if (pdfjsText.length < 50) {
    const ocrResult = await callOcrProxy(file, sessionId);
    if (ocrResult) {
      warnings.push(`Extracted via OCR — accuracy may vary on scans.`);
      return { type: 'pdf', text: ocrResult.text, warnings, blocks: ocrResult.blocks };
    }
    // Give the real reason when it's a size mismatch - OCR silently returning null for a
    // 413 looked identical to a genuinely corrupted/encrypted file, misleading users whose
    // scanned PDF was simply too large for the OCR path (still well within MAX_FILE_SIZE_BYTES).
    if (file.size > MAX_OCR_FILE_SIZE_BYTES) {
      warnings.push(`This file (${formatBytes(file.size)}) has no extractable text layer, so it needs OCR - but OCR is only available for files up to ${formatBytes(MAX_OCR_FILE_SIZE_BYTES)}. Try a smaller or lower-resolution scan.`);
    } else {
      warnings.push('Both PDF text extraction and OCR failed. This document may be encrypted, corrupted, or very low resolution.');
    }
    return { type: 'pdf', text: '', warnings };
  }

  // Confidence heuristic: escalate to OCR for diagram-heavy / text-sparse PDFs
  if (isPdfTextWeak(pdfjsText, numPages)) {
    const ocrResult = await callOcrProxy(file, sessionId);
    if (ocrResult && ocrResult.text.length > pdfjsText.length * 0.8) {
      warnings.push(`Enhanced via OCR.`);
      return { type: 'pdf', text: ocrResult.text, warnings, blocks: ocrResult.blocks };
    }
    warnings.push('OCR did not improve extraction — using text layer.');
  }

  return { type: 'pdf', text: pdfjsText, warnings };
}

export async function extractDocxText(file: File, sessionId?: string): Promise<ExtractedTextResult> {
  const warnings: string[] = [];
  try {
    const buffer = await readAsArrayBuffer(file);
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) throw new Error('word/document.xml missing');
    const parser = new DOMParser();
    const xml = parser.parseFromString(docXml, 'application/xml');
    const paragraphs = Array.from(xml.getElementsByTagName('w:p'));
    const lines: string[] = [];
    for (const p of paragraphs) {
      const texts = Array.from(p.getElementsByTagName('w:t')).map((t) => t.textContent || '').join('').trim();
      if (!texts) continue;
      const styleEl = p.getElementsByTagName('w:pStyle')[0];
      const style = styleEl?.getAttribute('w:val') || '';
      const isHeading = /^Heading\d+/i.test(style);
      const isList = p.getElementsByTagName('w:numPr').length > 0;
      if (isHeading) lines.push(`## ${texts}`);
      else if (isList) lines.push(`- ${texts}`);
      else lines.push(texts);
    }
    const text = lines.join('\n');
    if (text.trim().length > 0) return { type: 'docx', text: normalizeExtractedText(text), warnings };
  } catch (err) {
    warnings.push('DOCX structure is complex — attempting secondary extraction.');
    try {
      const fallbackBuffer = await readAsArrayBuffer(file);
      const fallback = stripXmlArtifacts(decodeArrayBuffer(new Uint8Array(fallbackBuffer), 'utf-8'));
      if (fallback.length > 100 && !fallback.includes('PK\u0003\u0004')) { 
        return { type: 'docx', text: fallback, warnings };
      }
    } catch {
    }

    const ocrResult = await callOcrProxy(file, sessionId);
    if (ocrResult) {
      warnings.push(`Extracted via OCR.`);
      return { type: 'docx', text: ocrResult.text, warnings, blocks: ocrResult.blocks };
    }
    if (file.size > MAX_OCR_FILE_SIZE_BYTES) {
      warnings.push(`This file (${formatBytes(file.size)}) could not be parsed directly, so it needs OCR - but OCR is only available for files up to ${formatBytes(MAX_OCR_FILE_SIZE_BYTES)}. Try a smaller file.`);
    }
    return { type: 'docx', text: '', warnings };
  }
  const fallbackBuffer = await readAsArrayBuffer(file);
  const fallback = stripXmlArtifacts(decodeArrayBuffer(fallbackBuffer, 'latin1'));
  return { type: 'docx', text: fallback, warnings };
}

export async function extractText(file: File, type: NormalizedFileType, sessionId?: string): Promise<ExtractedTextResult> {
  if (type === 'pdf') return extractPdfText(file, sessionId);
  if (type === 'docx') return extractDocxText(file, sessionId);
  if (type === 'html') {
    const raw = await readAsText(file);
    return { type, text: normalizeExtractedText(extractTextFromHtml(raw)), warnings: [] };
  }
  if (type === 'txt') {
    const raw = await readAsText(file);
    return { type, text: normalizeExtractedText(raw), warnings: [] };
  }
  const raw = stripArtifacts(await readAsText(file));
  return { type: 'unknown', text: raw, warnings: [] };
}

export const SKILL_DOMAINS = [
  {
    id: 'email_copywriting',
    label: 'email copywriting & outreach',
    role: 'a direct-response email copywriter',
    outputType: 'emails, sequences, and outreach campaigns',
    frame: 'write emails that get opened, read, and replied to',
    keywords: /\b(subject.?line|open.?rate|click.?through|drip|cold.?email|reply.?rate|unsubscribe|deliverability|nurture|autoresponder|opt.?in|inbox|preview.?text)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
  },
  {
    id: 'brand_voice',
    label: 'brand voice & content strategy',
    role: 'a brand voice and content strategist',
    outputType: 'brand copy, messaging frameworks, and content',
    frame: 'maintain a consistent, distinctive brand voice across all touchpoints',
    keywords: /\b(brand.?voice|tone.?of.?voice|brand.?guideline|messaging.?pillar|tagline|brand.?persona|style.?guide|visual.?identity|brand.?positioning|brand.?manifesto|brand.?story|typography|color.?palette|logo.?usage)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
  },
  {
    id: 'software_engineering',
    label: 'software engineering',
    role: 'a senior software engineer',
    outputType: 'code, architecture decisions, and technical documentation',
    frame: 'write clean, maintainable, production-ready code',
    keywords: /\b(function|async.?await|props|useState|useEffect|endpoint|refactor|deploy|unit.?test|lint|compile|algorithm|big.?o|typescript|javascript|python|react|node|kubernetes|docker|microservice)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'table', 'flowchart'],
  },
  {
    id: 'growth_marketing',
    label: 'growth marketing & performance',
    role: 'a growth-focused performance marketer',
    outputType: 'growth strategies, paid campaigns, and conversion systems',
    frame: 'drive measurable growth through data-informed marketing decisions',
    keywords: /\b(churn.?rate|ltv|cac|roas|a.?b.?test|landing.?page|paid.?ads|ppc|cpc|cpm|attribution|cohort|referral.?program|viral.?loop|growth.?lever|north.?star.?metric|activation.?rate)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
    codexShape: 'execute' as const,
  },
  {
    id: 'product_design',
    label: 'product design & UX',
    role: 'a product designer and UX specialist',
    outputType: 'design decisions, UX flows, and interface copy',
    frame: 'create intuitive, accessible user experiences grounded in research',
    keywords: /\b(wireframe|usability.?test|heuristic|user.?journey|figma|sketch|affordance|interaction.?design|friction|empty.?state|microcopy|onboarding.?flow|accessibility|wcag|design.?system|component.?library|modal|tooltip)\b/i,
    template: 'C' as const,
    richFormats: ['table', 'flowchart'],
    codexShape: 'expertise' as const,
  },
  {
    id: 'education',
    label: 'education & instructional design',
    role: 'an instructional designer and educator',
    outputType: 'curricula, lesson plans, and learning materials',
    frame: 'design learning experiences that produce measurable skill change',
    keywords: /\b(learning.?objective|curriculum|lesson.?plan|instructional|rubric|scaffold|pedagogy|student.?engagement|course.?design|syllabus|bloom.?taxonomy|formative|summative|differentiat|learning.?outcome|e.?learning)\b/i,
    template: 'C' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'legal',
    label: 'legal & compliance',
    role: 'a legal professional',
    outputType: 'contracts, policies, and compliance documentation',
    frame: 'draft precise, enforceable language that protects all parties',
    keywords: /\b(clause|liability|indemnif|jurisdiction|breach.?of|obligations|warranties|statute|regulation|compliance|gdpr|hipaa|attorney|hereinafter|pursuant)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'finance',
    label: 'finance & financial analysis',
    role: 'a financial analyst',
    outputType: 'financial models, analysis, and investment recommendations',
    frame: 'produce rigorous financial analysis that supports sound decisions',
    keywords: /\b(ebitda|ebit|cash.?flow|free.?cash.?flow|balance.?sheet|income.?statement|trial.?balance|gross.?margin|operating.?margin|net.?margin|amortization|depreciation|accrual|ledger|debit|credit|gaap|ifrs|wacc|dcf|npv|irr|eps|valuation|dividend|equity|debt|fiscal.?year|fiscal.?quarter|hedge|derivative|bond.?yield|capex|opex|working.?capital|return.?on.?equity|return.?on.?assets|leverage.?ratio|debt.?to.?equity|interest.?rate|principal|coupon|underwriting|portfolio.?allocation|annual.?report|quarterly.?report|earnings.?call|earnings.?per.?share|book.?value|market.?cap)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  // 2026-10-24 (domain detection: server decides): economics existed only on the server (Jev),
  // so economics documents were labelled finance or nothing here. Same strings as the server.
  {
    id: 'economics',
    label: 'economics & policy analysis',
    role: 'an economist',
    outputType: 'economic analysis, model explanations, and policy briefs',
    frame: 'explain economic mechanisms, models and evidence precisely, with their assumptions and uncertainty',
    keywords: /\b(inflation|deflation|stagflation|monetary.?policy|fiscal.?policy|central.?bank|interest.?rate|gdp|gross.?domestic.?product|unemployment.?rate|phillips.?curve|aggregate.?demand|aggregate.?supply|recession|macroeconomic|microeconomic|elasticity|fiscal.?multiplier|okun|taylor.?rule|output.?gap|money.?supply|quantitative.?easing|consumer.?price.?index|labou?r.?market|nairu|keynesian|monetarist|business.?cycle)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'seo',
    label: 'SEO & search strategy',
    role: 'an SEO strategist',
    outputType: 'SEO strategies, content briefs, and optimized copy',
    frame: 'create content and strategies that earn search visibility and organic traffic',
    keywords: /\b(keyword.?research|search.?ranking|backlink|serp|meta.?description|title.?tag|crawl.?budget|schema.?markup|anchor.?text|domain.?authority|search.?intent|topical.?authority|content.?cluster|featured.?snippet|core.?web.?vital)\b/i,
    template: 'D' as const,
    richFormats: ['table'],
    codexShape: 'execute' as const,
  },
  {
    id: 'hr_people',
    label: 'HR & people operations',
    role: 'an HR and people operations specialist',
    outputType: 'HR policies, job descriptions, and people communications',
    frame: 'build people systems that attract, develop, and retain talent',
    keywords: /\b(onboarding|performance.?review|compensation.?band|pto|employee.?handbook|headcount|talent.?acquisition|leveling|pip|career.?ladder|comp|total.?rewards|people.?ops|culture.?add|hiring.?manager|offer.?letter)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'data_science',
    label: 'data science & machine learning',
    role: 'a data scientist and ML engineer',
    outputType: 'models, analyses, and data-driven recommendations',
    frame: 'extract signal from data and build systems that learn and improve',
    keywords: /\b(dataframe|pandas|numpy|sklearn|train.?test|precision.?recall|feature.?engineering|regression|neural.?network|embedding|inference|dataset|etl|sql.?query|data.?warehouse|feature.?store|model.?drift|overfitting)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'table', 'flowchart'],
  },
  {
    id: 'product_management',
    label: 'product management',
    role: 'a product manager',
    outputType: 'PRDs, roadmaps, and product strategy documents',
    frame: 'define and ship products that solve real user problems at scale',
    keywords: /\b(product.?requirement|user.?story|acceptance.?criteria|sprint.?planning|epic|product.?backlog|roadmap.?item|north.?star|success.?metric|product.?hypothesis|go.?to.?market|launch.?plan|prd|feature.?flag)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
    codexShape: 'expertise' as const,
  },
  {
    id: 'pr_communications',
    label: 'PR & communications',
    role: 'a communications and PR strategist',
    outputType: 'press releases, media pitches, and communications plans',
    frame: 'shape narratives and manage communications that build reputation',
    keywords: /\b(press.?release|media.?pitch|spokesperson|embargo|lede|inverted.?pyramid|boilerplate|wire.?service|newswire|journalist|media.?coverage|talking.?point|crisis.?comms|on.?the.?record|off.?the.?record|media.?list)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
  },
  {
    id: 'consulting',
    label: 'management consulting',
    role: 'a management consultant',
    outputType: 'frameworks, decks, and strategic recommendations',
    frame: 'structure ambiguous problems and deliver clear, actionable recommendations',
    keywords: /\b(mece|issue.?tree|so.?what|pyramid.?principle|workstream|deliverable|engagement.?manager|hypothesis.?driven|executive.?summary|straw.?man|operating.?model|change.?management)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
    codexShape: 'expertise' as const,
  },
  {
    id: 'security',
    label: 'cybersecurity',
    role: 'a cybersecurity specialist',
    outputType: 'security assessments, policies, and technical documentation',
    frame: 'identify, assess, and mitigate security risks systematically',
    keywords: /\b(vulnerability|cve|exploit|penetration.?test|pen.?test|firewall|encryption|oauth|owasp|threat.?model|attack.?vector|incident.?response|soc|siem|zero.?trust|hardening|red.?team)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'social_media',
    label: 'social media & community',
    role: 'a social media strategist and content creator',
    outputType: 'social content, captions, and community strategies',
    frame: 'create social content that builds community and drives engagement',
    keywords: /\b(instagram|tiktok|linkedin.?post|hashtag|caption|reel|carousel|content.?calendar|ugc|creator.?economy|influencer|viral.?content|community.?management|engagement.?rate)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
  },
  {
    id: 'healthcare',
    label: 'healthcare & clinical',
    role: 'a healthcare professional',
    outputType: 'clinical documentation, patient communications, and protocols',
    frame: 'communicate clinical information clearly, accurately, and compassionately',
    keywords: /\b(patient|diagnosis|treatment.?protocol|medication|dosage|symptom|clinical.?trial|contraindication|prognosis|evidence.?based|ehr|icd.?code|cpt.?code|hipaa|care.?plan|triage|differential|comorbidity)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'academic_research',
    label: 'academic research & writing',
    role: 'an academic researcher and writer',
    outputType: 'research papers, literature reviews, and academic analyses',
    frame: 'produce rigorous, well-cited academic work that advances knowledge',
    keywords: /\b(hypothesis|research.?methodology|sample.?size|statistical.?significance|p.?value|literature.?review|peer.?review|citation|dissertation|thesis|independent.?variable|control.?group|replication|apa|mla)\b/i,
    template: 'D' as const,
    richFormats: ['table'],
    codexShape: 'expertise' as const,
  },
  {
    id: 'real_estate',
    label: 'real estate',
    role: 'a real estate professional',
    outputType: 'listings, client communications, and property analyses',
    frame: 'communicate property value and guide clients through complex transactions',
    keywords: /\b(property|mortgage|appraisal|comparable|comps|escrow|title.?deed|zoning|closing.?cost|mls|cap.?rate|noi|lease.?agreement|tenant|landlord|arv|cash.?on.?cash)\b/i,
    template: 'D' as const,
    richFormats: ['table'],
  },
  {
    id: 'creative_writing',
    label: 'creative writing & storytelling',
    role: 'a creative writer and storyteller',
    outputType: 'stories, scripts, copy, and narrative content',
    frame: 'craft narratives that move people and stay with them',
    keywords: /\b(protagonist|antagonist|plot.?arc|dialogue|scene.?setting|motif|narrative.?structure|prose.?style|stanza|verse|character.?development|pacing|show.?don.?t.?tell|point.?of.?view|unreliable.?narrator)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
  },
  {
    id: 'direct_response_copywriting',
    label: 'direct response copywriting',
    role: 'a direct-response copywriter',
    outputType: 'sales pages, ads, and persuasive copy',
    frame: 'write copy that earns attention and drives action',
    keywords: /\b(headline|sub.?headline|call.?to.?action|cta|swipe.?file|swipe|lede|big.?idea|conversion.?copy|persuasion|open.?loop|sales.?page|sales.?letter|landing.?page.?copy|vsl|long.?form.?copy|copywriting|copywriter|direct.?response|aida|pas|fab|features.?benefits|benefit.?driven|emotional.?appeal|scarcity|social.?proof|testimonial|risk.?reversal|offer.?stack|fascination|curiosity.?gap|reason.?why|power.?word|postscript|sales.?hook|click.?bait|conversion.?rate.?optimization|cro.?copy)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
  },
] as const;

// v2.2: derive default Codex generation shape from the Claude template assignment.
// Used only when the detected SKILL_DOMAIN doesn't override codexShape explicitly.
// Mapping reflects each shape's cognitive profile:
//   B (code) â†’ execute     - procedural code work
//   A (persona/voice) â†’ expertise - creative judgment, human-loop
//   C (process) / D (domain) â†’ specialist - constrained role with branching/bounds
// Falls back to 'execute' (the 70% bet) for unknown templates.
export function templateToShape(tmpl: string | undefined): 'execute' | 'expertise' | 'specialist' {
  if (tmpl === 'B') return 'execute';
  if (tmpl === 'A') return 'expertise';
  if (tmpl === 'C' || tmpl === 'D') return 'specialist';
  return 'execute';
}

// v2.3: Codex domain intelligence - separate from Claude path, never collides.
// CODEX_DOMAIN_SUPPLEMENTS provides Codex-specific role/frame/keyword overrides for every
// existing SKILL_DOMAIN. Claude path is untouched - supplements are only applied when
// target === 'codex'. The Claude role/frame values in SKILL_DOMAINS are never modified.
export interface CodexDomainSupplement {
  codexRole: string;
  codexFrame: string;
  codexKeywordsExtra?: RegExp;
}

export const CODEX_DOMAIN_SUPPLEMENTS: Record<string, CodexDomainSupplement> = {
  email_copywriting: {
    codexRole: 'an email sequence reviewer and conversion copy auditor',
    codexFrame: 'audit email drafts against direct-response criteria, surface weak hooks, and recommend minimal-diff fixes before send',
    codexKeywordsExtra: /\b(split\.?test|a\.?b\.?variant|template\.?library|sequence\.?step|trigger\.?email|drip\.?step|transactional\.?email)\b/i,
  },
  brand_voice: {
    codexRole: 'a brand voice compliance reviewer operating within established brand guidelines',
    codexFrame: 'audit content against defined brand rules, flag specific deviations with corrections, escalate ambiguous voice decisions before publishing',
    codexKeywordsExtra: /\b(style\.?guide|brand\.?compliance|tone\.?audit|voice\.?check|brand\.?review|guideline\.?violation)\b/i,
  },
  software_engineering: {
    codexRole: 'a senior software engineer executing codebase-specific tasks according to the architectural patterns and conventions visible in the source',
    codexFrame: 'implement, refactor, and verify code against the architectural decisions and conventions extracted from the source - no patterns invented outside what the source shows',
    codexKeywordsExtra: /\b(goroutine|channel|go\.mod|go\.sum|cargo\.toml|cargo\.lock|impl|trait|lifetime|borrow|rustc|tokio|actix|axum|wasm|dataclass|pydantic|fastapi|django|flask|sqlalchemy|alembic|celery|uvicorn|gunicorn|requirements\.txt|pyproject|decorator|pytest|bash|shell\.?script|zsh|chmod|cron|crontab|makefile|cmake|gradle|maven|pom\.xml|build\.gradle|refactor|migration|pull\.?request|code\.?review|lint\.?error|build\.?fail|ci\.?pipeline|test\.?coverage|dependency|package\.?lock)\b/i,
  },
  growth_marketing: {
    codexRole: 'a growth experiment executor automating paid-ads setup, landing-page optimizations, and A/B test implementation sequences',
    codexFrame: 'execute growth experiment workflows, implement conversion optimizations, and verify measurement setup before activating campaigns',
    codexKeywordsExtra: /\b(experiment\.?setup|variant|control\.?group|ad\.?copy|campaign\.?launch|conversion\.?tracking|pixel\.?setup|gtm)\b/i,
  },
  product_design: {
    codexRole: 'a UX design reviewer auditing interface decisions against usability criteria and design system compliance before handoff',
    codexFrame: 'review designs for friction, accessibility gaps, and design system violations - surface minimal-diff corrections before engineering handoff',
    codexKeywordsExtra: /\b(design\.?review|handoff|component\.?spec|design\.?token|accessibility\.?audit|contrast\.?ratio|focus\.?trap)\b/i,
  },
  education: {
    codexRole: 'a curriculum structure validator operating within defined instructional design standards and learning objective frameworks',
    codexFrame: 'validate learning materials against pedagogical frameworks, surface structural gaps, and apply standardized scaffolding templates',
    codexKeywordsExtra: /\b(course\.?structure|learning\.?path|assessment\.?rubric|competency|objective\.?alignment|lms|scorm)\b/i,
  },
  legal: {
    codexRole: 'a legal document drafter operating within strict compliance boundaries - refuses advisory, interpretive, or strategic legal decisions',
    codexFrame: 'produce structured legal documents from source templates, flag ambiguous clauses for human review, refuse all legal advice or risk assessment',
    codexKeywordsExtra: /\b(clause\.?template|contract\.?template|nda|msa|sla|compliance\.?checklist|gdpr\.?article|dpa|data\.?processing)\b/i,
  },
  finance: {
    codexRole: 'a financial model executor and report generator operating within defined formula conventions and compliance boundaries',
    codexFrame: 'build and validate financial models, generate structured reports from templates, and escalate valuation assumptions and interpretive decisions for human review',
    codexKeywordsExtra: /\b(model\.?template|formula|spreadsheet|financial\.?model|forecast\.?template|variance\.?analysis|budget\.?vs\.?actual)\b/i,
  },
  economics: {
    codexRole: 'an economic analysis executor applying the models, definitions and data conventions stated in the source - refuses forecasts or policy advice the source does not support',
    codexFrame: 'apply the source\'s economic models and definitions exactly, state assumptions, units and periods, and escalate interpretive or policy judgments for human review',
  },
  seo: {
    codexRole: 'an SEO task executor implementing meta tags, content briefs, technical SEO fixes, internal linking structures, and schema markup',
    codexFrame: 'execute SEO checklist items, apply technical optimizations, validate against defined ranking criteria, and verify implementation before publishing',
    codexKeywordsExtra: /\b(meta\.?tag|title\.?tag|robots\.?txt|sitemap|redirect|canonical\.?tag|core\.?web\.?vital|page\.?speed|structured\.?data|json\.?ld)\b/i,
  },
  hr_people: {
    codexRole: 'an HR document drafter and people-ops workflow executor operating within defined policy and legal boundaries',
    codexFrame: 'generate structured HR documents and execute onboarding workflows from defined templates - escalate policy-ambiguous and jurisdiction-specific edge cases',
    codexKeywordsExtra: /\b(hr\.?template|offer\.?template|policy\.?document|handbook\.?section|onboarding\.?checklist|leveling\.?rubric)\b/i,
  },
  data_science: {
    codexRole: 'a data science code executor implementing data pipelines, model training sequences, and data validation workflows according to the patterns in the source',
    codexFrame: 'implement data pipelines and ML code according to source conventions, verify data quality checkpoints, and run defined validation steps before shipping',
    codexKeywordsExtra: /\b(pipeline|etl|feature\.?store|model\.?training|inference\.?pipeline|data\.?validation|schema\.?check|great\.?expectations|dbt|airflow|prefect)\b/i,
  },
  product_management: {
    codexRole: 'a product document reviewer validating PRD structure, scope definition, acceptance criteria quality, and success metric clarity',
    codexFrame: 'review product documents for completeness and logical coherence, surface scope gaps and undefined success criteria, escalate priority tradeoffs and strategic decisions',
    codexKeywordsExtra: /\b(prd\.?review|acceptance\.?criteria|story\.?point|scope\.?definition|success\.?metric|product\.?brief)\b/i,
  },
  pr_communications: {
    codexRole: 'a communications draft reviewer applying inverted pyramid structure, spokesperson safety checks, and narrative tone standards before publication',
    codexFrame: 'review and tighten communications drafts, enforce structural conventions, flag spokesperson risk and embargo violations, and recommend specific edits before release',
    codexKeywordsExtra: /\b(press\.?review|spokesperson\.?quote|embargo\.?check|crisis\.?statement|media\.?brief|on\.?message)\b/i,
  },
  consulting: {
    codexRole: 'a strategic framework reviewer auditing MECE structure, hypothesis integrity, recommendation logic, and executive summary clarity',
    codexFrame: 'validate strategic documents for logical completeness, surface gaps in argument chains, apply pyramid principle structure, and escalate missing data or assumption risks',
    codexKeywordsExtra: /\b(mece\.?check|slide\.?review|deck\.?structure|hypothesis\.?test|executive\.?summary|issue\.?tree|so\.?what)\b/i,
  },
  security: {
    codexRole: 'a security audit executor operating within defined threat models and remediation playbooks - escalates novel threats, unknown attack vectors, and incidents immediately',
    codexFrame: 'execute security assessments against defined checklists, implement hardening steps from playbooks, and escalate any threat pattern not covered by the source model',
    codexKeywordsExtra: /\b(security\.?checklist|hardening\.?guide|remediation\.?playbook|audit\.?procedure|compliance\.?scan|soc2|iso27001|pen\.?test\.?report)\b/i,
  },
  social_media: {
    codexRole: 'a social content reviewer applying platform-specific format rules, community guidelines, and brand standards before posting',
    codexFrame: 'audit social drafts against platform constraints, flag policy risks, verify hashtag and format compliance, and recommend caption and CTA optimizations',
    codexKeywordsExtra: /\b(caption\.?review|post\.?review|platform\.?guideline|community\.?standard|content\.?policy|hashtag\.?strategy|scheduling)\b/i,
  },
  healthcare: {
    codexRole: 'a clinical documentation executor operating strictly within defined protocols - refuses all diagnostic, prescriptive, or clinical judgment decisions without human oversight',
    codexFrame: 'generate protocol-compliant clinical documents from defined templates, apply care plan structures, and escalate all clinical judgment, medication, and diagnostic calls',
    codexKeywordsExtra: /\b(clinical\.?protocol|care\.?pathway|documentation\.?template|patient\.?summary|discharge\.?summary|referral\.?letter)\b/i,
  },
  academic_research: {
    codexRole: 'an academic document reviewer validating research structure, methodology transparency, citation integrity, and argument coherence',
    codexFrame: 'review research documents for structural and methodological rigor, flag unsupported claims and citation gaps, and apply academic conventions before submission',
    codexKeywordsExtra: /\b(manuscript\.?review|literature\.?review|citation\.?check|methodology\.?gap|peer\.?review|abstract\.?structure|apa\.?format|research\.?gap)\b/i,
  },
  real_estate: {
    codexRole: 'a real estate document generator operating within defined listing templates and transaction compliance rules',
    codexFrame: 'produce listings, comparative analyses, and transaction documents from templates - escalates regulatory, valuation, and negotiation decisions to human agents',
    codexKeywordsExtra: /\b(listing\.?template|property\.?report|comp\.?analysis|transaction\.?checklist|disclosure\.?form|lease\.?template)\b/i,
  },
  creative_writing: {
    codexRole: 'a narrative editor reviewing prose drafts against defined style rules, story structure criteria, and voice guidelines',
    codexFrame: 'edit and tighten narrative drafts, apply story structure corrections, flag pacing and POV inconsistencies, and pause for author direction on voice ambiguities',
    codexKeywordsExtra: /\b(draft\.?review|prose\.?edit|story\.?structure|pacing\.?check|voice\.?consistency|line\.?edit|developmental\.?edit)\b/i,
  },
  direct_response_copywriting: {
    codexRole: 'a conversion copy reviewer applying AIDA/PAS persuasion frameworks and direct-response criteria before campaign launch',
    codexFrame: 'audit sales and ad copy against persuasion frameworks, surface weak hooks and unclear CTAs, and recommend specific word-level improvements before going live',
    codexKeywordsExtra: /\b(copy\.?review|headline\.?audit|cta\.?test|conversion\.?review|ad\.?copy\.?check|lander\.?review|swipe\.?critique)\b/i,
  },
  api_design: {
    codexRole: 'an API design reviewer operating within defined contract standards and versioning constraints - flags breaking changes and enforces error-response conventions',
    codexFrame: 'validate API contracts against OpenAPI standards and internal conventions, enforce versioning discipline, flag breaking changes before shipping, and refuse spec additions that violate defined contract boundaries',
    codexKeywordsExtra: /\b(restful|endpoints|crud|payload|idempotency|rest[\s.-]?api|api[\s.-]?design|http[\s.-]?method|http[\s.-]?verb|resource[\s.-]?design|resource[\s.-]?model|api[\s.-]?evolution|api[\s.-]?lifecycle|api[\s.-]?strategy|api[\s.-]?contract|api[\s.-]?versioning|hypermedia|hateoas|self[\s.-]?link|link[\s.-]?relation|api[\s.-]?style|api[\s.-]?consumer|url[\s.-]?convention)\b/i,
  },
};

export const CODEX_NATIVE_DOMAINS = [
  {
    id: 'devops',
    label: 'DevOps & infrastructure',
    role: 'a DevOps engineer executing infrastructure automation and deployment tasks within defined safety rails and rollback criteria',
    outputType: 'infrastructure configs, deployment scripts, and operational runbooks',
    frame: 'automate, deploy, and validate infrastructure changes - verify each step before proceeding, maintain rollback readiness at every stage',
    keywords: /\b(terraform|kubernetes|k8s|helm|docker|ci\.?cd|deploy|rollback|infra|pod|cluster|ingress|nginx|github\.?action|jenkins|ansible|cloudformation|vpc|subnet|iam|s3|ecr|ecs|eks|gke|aks|argocd|flux|gitops|slo|sli|runbook|incident|escalation|dockerfile|docker\.?compose|service\.?mesh|istio|envoy)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'flowchart'],
    codexShape: 'execute' as const,
  },
  {
    id: 'testing',
    label: 'testing & quality assurance',
    role: 'a QA engineer executing test suite implementations, fixture setups, mock configurations, and coverage validation workflows',
    outputType: 'test suites, fixture configurations, mock setups, and coverage reports',
    frame: 'implement tests against defined coverage targets and patterns - set up fixtures and mocks, validate boundary conditions, and verify before merging',
    keywords: /\b(unit\.?test|integration\.?test|e2e|end\.?to\.?end|test\.?suite|fixture|mock|stub|spy|assertion|jest|vitest|pytest|mocha|cypress|playwright|selenium|test\.?driven|tdd|bdd|given\.?when\.?then|snapshot|smoke\.?test|load\.?test|performance\.?test|test\.?data|faker|seeding|test\.?runner|beforeEach|afterEach)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'table'],
    codexShape: 'execute' as const,
  },
  {
    id: 'database_engineering',
    label: 'database engineering',
    role: 'a database engineer executing schema migrations and query optimizations within defined safety boundaries - escalates destructive or high-risk operations',
    outputType: 'schema migrations, query optimizations, index strategies, and data model documentation',
    frame: 'design and execute database changes safely - validate before applying, maintain rollback scripts, and escalate any operation that cannot be reversed or affects production data',
    keywords: /\b(schema|query\.?optimization|foreign\.?key|constraint|deadlock|replication|sharding|partition|stored\.?procedure|materialized|postgres|mysql|mongodb|redis|cassandra|dynamodb|supabase|prisma|alembic|flyway|liquibase|orm|explain\.?plan|query\.?plan|rollback\.?migration|seed\.?data|database\.?design|erd|entity\.?relationship)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
    codexShape: 'specialist' as const,
  },
  {
    id: 'api_design',
    label: 'API design & integration',
    role: 'an API design reviewer operating within defined contract standards and versioning constraints - flags breaking changes and enforces error-response conventions',
    outputType: 'API specs, endpoint documentation, integration guides, and contract validation reports',
    frame: 'validate API contracts against OpenAPI standards and internal conventions, enforce versioning discipline, flag breaking changes before shipping, and refuse spec additions that violate defined contract boundaries',
    keywords: /\b(endpoint|endpoints|restful|crud|payload|openapi|swagger|graphql|grpc|webhook|rate\.?limit|authentication|authorization|oauth|jwt|api\.?key|versioning|breaking\.?change|idempotent|pagination|cursor|response\.?code|status\.?code|schema\.?validation|json\.?schema|content\.?type|api\.?first|consumer\.?driven|api\.?gateway|graphql\.?schema|resolver)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
    codexShape: 'specialist' as const,
  },
  {
    id: 'frontend_engineering',
    label: 'frontend engineering & design systems',
    role: 'a frontend engineer executing component builds, CSS system implementations, and design token applications according to the conventions and constraints visible in the source',
    outputType: 'component code, CSS systems, design token files, and frontend architecture documentation',
    frame: 'implement frontend code from design specifications - no CSS values invented outside defined tokens, no component patterns added beyond what the source shows, verify token application before shipping',
    keywords: /\b(design\.?token|css\.?variable|css\.?custom\.?property|tailwind|styled\.?component|css\.?module|storybook|atomic\.?design|bem|scss|sass\.?mixin|color\.?system|typography\.?scale|spacing\.?system|spacing\.?scale|breakpoint|component\.?spec|component\.?variant|figma\.?variable|figma\.?token|token\.?set|theme\.?variable|dark\.?mode|font\.?scale|line\.?height|z\.?index|border\.?radius|shadow\.?token|motion\.?token|animation\.?token|css\.?architecture|layout\.?system|grid\.?system|flex\.?utility|utility\.?class|design\.?system\.?implementation|component\.?library\.?implementation|style\.?dictionary|vanilla\.?extract|stitches|panda\.?css)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'table'],
    codexShape: 'execute' as const,
  },
  {
    id: 'technical_documentation',
    label: 'technical documentation & developer writing',
    role: 'a technical writer executing documentation tasks - README generation, API reference writing, changelog authoring, and architecture documentation - according to the structure conventions and style patterns visible in the source',
    outputType: 'READMEs, API reference docs, changelogs, architecture decision records, and technical guides',
    frame: 'produce technical documentation that matches the structural patterns and terminology of the source - consistent heading hierarchy, code example placement, and section ordering; escalate when source material is ambiguous or scope is unclear',
    keywords: /\b(readme|changelog|architecture\.?decision\.?record|adr|api\.?reference|api\.?doc|technical\.?guide|developer\.?guide|integration\.?guide|getting\.?started|installation\.?guide|contributing\.?guide|code\.?example|snippet\.?documentation|docstring|jsdoc|typedoc|sphinx|mkdocs|docusaurus|gitbook|confluence\.?page|wiki\.?page|runbook\.?doc|technical\.?spec|design\.?doc|engineering\.?spec|rfc|request\.?for\.?comment|tech\.?spec|system\.?design|c4\.?diagram|sequence\.?diagram|data\.?flow\.?diagram)\b/i,
    template: 'D' as const,
    richFormats: ['codeblock', 'table'],
    codexShape: 'expertise' as const,
  },
  {
    id: 'content_operations',
    label: 'content operations & editorial production',
    role: 'a content operations reviewer auditing drafts and briefs against defined frameworks, angle structures, and format standards - operating within the editorial patterns established in the source',
    outputType: 'content briefs, article drafts, editorial audits, and copy production workflows',
    frame: 'review and produce content according to the structural frameworks and angle formulas defined in the source - flag weak hooks, inconsistent structure, and missing format elements before publishing; escalate tone and brand-voice decisions',
    keywords: /\b(content\.?brief|editorial\.?framework|content\.?template|writing\.?framework|content\.?pillar|content\.?angle|story\.?angle|narrative\.?framework|article\.?structure|blog\.?framework|newsletter\.?template|email\.?newsletter|video\.?script|script\.?template|podcast\.?outline|episode\.?brief|show\.?note|content\.?formula|hook\.?formula|headline\.?formula|listicle\.?structure|thought\.?leadership\.?framework|content\.?calendar\.?template|editorial\.?guideline|writing\.?style\.?guide|content\.?swipe|swipe\.?file|angle\.?swipe|repurpose\.?framework|content\.?series\.?structure|content\.?type\.?guide)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
    codexShape: 'expertise' as const,
  },
] as const;

export function detectSkillDomain(fileName: string, text: string, target: 'claude' | 'codex' = 'claude') {
  // Codex path expands the detection pool to include Codex-native domains.
  // Claude path searches SKILL_DOMAINS only - behavior byte-identical to pre-v2.3.
  const domainsToSearch: any[] = target === 'codex'
    ? [...SKILL_DOMAINS, ...CODEX_NATIVE_DOMAINS]
    : [...SKILL_DOMAINS];
  const combined = (fileName + ' ' + text).toLowerCase();
  const rawWordCount = combined.split(/\s+/).filter(w => w.length > 0).length;
  const wordCount = Math.max(rawWordCount, 500);
  const scores = domainsToSearch.map(d => {
    const baseKeywords: RegExp = d.keywords;
    // For Codex path: add extra keyword hits from supplements where defined.
    // Extra keywords are Codex-vocabulary additions - they don't exist on the Claude path.
    const supplement = CODEX_DOMAIN_SUPPLEMENTS[d.id];
    const extraKeywords: RegExp | null = (target === 'codex' && supplement?.codexKeywordsExtra)
      ? supplement.codexKeywordsExtra
      : null;
    const matches = [
      ...(combined.match(new RegExp(baseKeywords.source, 'gi')) || []),
      ...(extraKeywords ? (combined.match(new RegExp(extraKeywords.source, 'gi')) || []) : []),
    ];
    const rawCount = matches.length;
    const distinct = new Set(matches.map(m => m.toLowerCase())).size;
    const density = (rawCount * 1000) / wordCount;
    return { domain: d, score: rawCount, distinct, density };
  }).filter(r => r.score > 0).sort((a, b) => b.density - a.density);

  // 2026-10-24 (vault "Relatch Domain Detection - Server Decides"): this label is now only a
  // HINT - the server (Jev, reading the whole document) decides, and replaces a label it is sure
  // is wrong or that it cannot confirm. So the hint must be precise rather than eager: it names a
  // field only when at least 2 DIFFERENT keywords matched (one word repeated is not evidence) and
  // the top field clearly beats the runner-up (1.5x its density). Otherwise null, i.e. "general
  // professional", which the server can still correct. Measured on 104 labelled documents
  // (jev-harness/keyword-accuracy.js, held-out half): precision 76% -> 93% (Claude), 77% -> 96%
  // (Codex). Generic everyday words that pointed at the wrong field were removed from the lists.
  const MIN_RAW = 3;
  const MIN_DENSITY = 1.5;
  const MIN_DISTINCT = 2;
  const MIN_MARGIN = 1.5;
  if (scores.length > 0 && scores[0].score >= MIN_RAW && scores[0].density >= MIN_DENSITY
    && scores[0].distinct >= MIN_DISTINCT && (scores.length < 2 || scores[0].density >= MIN_MARGIN * scores[1].density)) {
    return scores[0].domain;
  }
  return null;
}

export function profileDocument(file: File, extractedText: string, extractionWarning?: string) {
  const ext = getFileExtension(file.name);
  const textLength = extractedText.length;
  const wordCount = extractedText.split(/\s+/).filter(w => w.length > 2).length;

  // Size classification
  let sizeClass: 'small' | 'medium' | 'large' = 'small';
  let charCap = 3500;
  if (textLength > 40000) { sizeClass = 'large'; charCap = 8000; }
  else if (textLength > 3000) { sizeClass = 'medium'; charCap = 5000; }

  // Template E: Structured financial data - must be checked BEFORE the REJECT gate.
  // Finance CSVs with numeric-heavy rows often have low word counts (numbers don't
  // count well) and would otherwise be incorrectly rejected as "no behavioral patterns."
  // .xlsx/.xls deferred post-launch (requires binary parser dependency).
  const isFinanceDataFormat = ext === '.csv';
  const financeTabularPattern = /\b(budget|actual|variance|revenue|expense|margin|P&L|profit|loss|quarter|fiscal|forecast|YTD|MTD|EBITDA|cash\s*flow|balance\s*sheet|income\s*statement|operating|COGS|gross|net|ROI|KPI|headcount|capex|opex|earnings|liabilities|assets|equity)\b/i;
  const hasFinanceTerms = financeTabularPattern.test(extractedText) || financeTabularPattern.test(file.name);
  const csvLineCount = extractedText.split('\n').filter(l => l.trim().length > 0).length;
  const numericTokenCount = (extractedText.match(/\b\d[\d,.]*%?\b/g) || []).length;
  const totalTokenCount = Math.max(extractedText.split(/\s+/).filter(w => w.length > 0).length, 1);
  const numericDensity = numericTokenCount / totalTokenCount;

  const isStructuredFinance =
    isFinanceDataFormat &&
    csvLineCount >= 5 &&
    (hasFinanceTerms || numericDensity > 0.3);

  if (isStructuredFinance) {
    return { template: 'E' as const, richFormats: ['table', 'matrix', 'bullets'], charCap, sizeClass, contentType: 'structured-data', rejectReason: undefined };
  }

  // Reject: pure data files
  const dataExtensions = ['.csv', '.json', '.yaml', '.yml', '.toml'];
  if (dataExtensions.includes(ext) && wordCount < 100) {
    return {
      template: 'REJECT' as const,
      richFormats: [],
      charCap,
      sizeClass,
      contentType: 'data',
      rejectReason: 'This file contains structured data but no behavioral patterns Relatch can extract. Try uploading a document that describes how you work, think, or communicate.',
    };
  }

  // Reject: scanned large document
  if (sizeClass === 'large' && extractionWarning && extractionWarning.includes('OCR')) {
    return {
      template: 'REJECT' as const,
      richFormats: [],
      charCap,
      sizeClass,
      contentType: 'scanned-large',
      rejectReason: 'This scanned document is too large to process reliably. Try uploading individual chapters or sections instead.',
    };
  }

  // Template B: Code files
  const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.rb', '.html', '.css'];
  if (codeExtensions.includes(ext)) {
    return { template: 'B' as const, richFormats: ['codeblock', 'table', 'flowchart'], charCap, sizeClass, contentType: 'code', rejectReason: undefined };
  }
  const codeLines = (extractedText.match(/^(const|let|var|def|func|fn|import|export|class|interface|type)\s/mg) || []).length;
  if (codeLines >= 5) {
    return { template: 'B' as const, richFormats: ['codeblock', 'table', 'flowchart'], charCap, sizeClass, contentType: 'code', rejectReason: undefined };
  }

  // Template C: Process/workflow documents
  const processKeywords = ['procedure', 'step-by-step', 'workflow', 'sop', 'standard operating',
    'phase', 'milestone', 'checklist', 'if this then', 'decision tree', 'escalation', 'approval process'];
  const processHits = processKeywords.filter(kw => extractedText.toLowerCase().includes(kw)).length;
  if (processHits >= 4) {
    return { template: 'C' as const, richFormats: ['table', 'flowchart'], charCap, sizeClass, contentType: 'process', rejectReason: undefined };
  }

  // Template D: Professional domain documents
  const detected = detectSkillDomain(file.name, extractedText);
  const domainDTemplates = ['finance', 'legal', 'hr_people', 'consulting', 'product_management',
    'security', 'healthcare', 'academic_research', 'real_estate', 'seo', 'growth_marketing',
    'data_science', 'pr_communications', 'economics'];
  if (detected && domainDTemplates.includes(detected.id)) {
    // Finance CSVs that passed the word-count gate above land here - intercept before D.
    // Any CSV flagged as finance (even with 100+ words) belongs in Template E, not D.
    if (detected.id === 'finance' && isStructuredFinance) {
      return { template: 'E' as const, richFormats: ['table', 'matrix', 'bullets'], charCap, sizeClass, contentType: 'structured-data', rejectReason: undefined };
    }
    return { template: 'D' as const, richFormats: (detected as any).richFormats || ['table', 'flowchart'], charCap, sizeClass, contentType: 'professional', rejectReason: undefined };
  }

  // Template D: via domain objects that have template D assigned
  if (detected && (detected as any).template === 'D') {
    return { template: 'D' as const, richFormats: (detected as any).richFormats || ['table'], charCap, sizeClass, contentType: 'professional', rejectReason: undefined };
  }

  // Template A: Default - persona, voice, creative, general
  const detectedTemplate = detected ? (detected as any).template || 'A' : 'A';
  const detectedRichFormats = detected ? (detected as any).richFormats || ['examples'] : ['examples'];
  return { template: detectedTemplate as 'A', richFormats: detectedRichFormats, charCap, sizeClass, contentType: 'prose', rejectReason: undefined };
}

export function sampleLargeDocument(text: string, charCap: number): string {
  if (text.length <= charCap) return text;
  const chunkSize = Math.floor(charCap / 3);
  const start = text.slice(0, chunkSize);
  const middleStart = Math.floor(text.length / 2) - Math.floor(chunkSize / 2);
  const middle = text.slice(middleStart, middleStart + chunkSize);
  const end = text.slice(text.length - chunkSize);
  return start + '\n\n...[content continues]...\n\n' + middle + '\n\n...[content continues]...\n\n' + end;
}

export function distillForCodex(text: string, charCap: number): string {
  if (text.length <= charCap) return text;
  const lines = text.split('\n');
  const scoreLineForCodex = (line: string): number => {
    const l = line.trim();
    if (l.length < 15) return -1;
    let s = 0;
    if (/\b(always|never|must|must not|should|don't|do not|require|enforce|ensure|refuse|reject|halt|block)\b/i.test(l)) s += 7;
    if (/^\s*\d+[.)]\s/.test(l) || /^#{1,3}\s/.test(l)) s += 6;
    if (/\b(const|let|var|function|class|def|fn|import|export|async|npm|yarn|git|pip|docker)\b/i.test(l) || /[{};]|=>|::|->/.test(l)) s += 6;
    if (/\b(when|trigger|activate|if you|run|execute|apply|refactor|review|deploy|fix|build)\b/i.test(l)) s += 5;
    if (/\b(refuse|escalate|pause|ask|clarify|human|approve|out.?of.?scope)\b/i.test(l)) s += 5;
    if (/\b(example|before|after|wrong|avoid|instead|prefer|correct|anti.?pattern)\b/i.test(l)) s += 4;
    if (l.includes(':') && l.length > 30) s += 2;
    if (/^[-•*]\s/.test(l) && l.length > 20) s += 2;
    if (/^(https?:|www\.|mailto:|@\w)/.test(l)) s -= 8;
    return s;
  };
  const n = lines.length;
  const t = Math.floor(n / 3);
  const thirds = [lines.slice(0, t), lines.slice(t, 2 * t), lines.slice(2 * t)];
  const budgets = [Math.floor(charCap * 0.4), Math.floor(charCap * 0.3), Math.floor(charCap * 0.3)];
  const parts: string[] = [];
  for (let si = 0; si < thirds.length; si++) {
    const seg = thirds[si];
    const scored = seg
      .map((line, li) => ({ line, score: scoreLineForCodex(line), li }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    let used = 0;
    const picked: { line: string; li: number }[] = [];
    for (const { line, li } of scored) {
      if (used + line.length + 1 > budgets[si]) break;
      picked.push({ line, li });
      used += line.length + 1;
    }
    picked.sort((a, b) => a.li - b.li);
    if (picked.length > 0) parts.push(picked.map(p => p.line).join('\n'));
  }
  const result = parts.join('\n\n');
  return result.trim() || sampleLargeDocument(text, charCap);
}

export function isGenericCodexDescription(desc: string, nameHint?: string): boolean {
  const trimmed = desc.trim();
  if (!trimmed) return true;
  if (/^[\w\s-]+ skill\.?$/i.test(trimmed)) return true;
  if (nameHint) {
    const normalizedName = nameHint.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedDesc = trimmed.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalizedDesc === `${normalizedName} skill.` || normalizedDesc === `${normalizedName} skill`) return true;
  }
  return false;
}

export function validateCodexDescription(desc: string): boolean {
  if (!desc || desc.trim().length < 20) return false;
  if (isGenericCodexDescription(desc)) return false;
  const d = desc.toLowerCase();
  const GENERIC = ['helps with', 'assists with', 'applies expertise', 'supports tasks', 'applies to ', 'provides assistance', 'general purpose'];
  if (GENERIC.some(p => d.includes(p))) return false;
  return /\b(refactor|migrate|review|deploy|execute|generate|create|fix|build|run|analyze|extract|check|validate|enforce|when (you|i|the user|codex)|set up|configure|implement|debug)\b/i.test(desc);
}

export function formatCodexDisplayName(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function validateCodexSkillReadiness(normalizedMd: string): 'ready' | 'degraded' | 'invalid' {
  if (!normalizedMd.trim()) return 'invalid';
  const fmMatch = normalizedMd.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return 'invalid';
  const fm = fmMatch[1];
  if (!fm.includes('name:') || !fm.includes('description:')) return 'invalid';
  if (!normalizedMd.includes('## ')) return 'invalid';
  const descMatch = fm.match(/^description:\s*"?([\s\S]*?)"?\s*$/m);
  const desc = descMatch ? descMatch[1].replace(/\\"/g, '"').replace(/\n/g, ' ').trim() : '';
  const hasPlaceholder = normalizedMd.includes('[Not extracted') || normalizedMd.includes('[review source') || normalizedMd.includes('Review source document') || normalizedMd.includes('to be added');
  if (hasPlaceholder || !validateCodexDescription(desc)) return 'degraded';
  return 'ready';
}

export function sanitizeYamlValue(val: string): string {
  if (/[&:#|>!?*{}[\],@`]/.test(val) || val.includes('"')) {
    return '"' + val.replace(/"/g, '\\"') + '"';
  }
  return val;
}

// The items of a one-line YAML list's inside (`"a, b", c` -> [`"a, b"`, ` c`]), split only on commas outside
// quotes. Found 2026-11-19 in the launch test: a plain split(',') cut "A refund totals $1,820 ..." in two,
// and the skill header then said "$1; 820". A quote opens only at the start of an item, so an apostrophe in
// plain text (customer's) is just a letter. An unclosed quote keeps the rest as one item.
export function splitYamlListItems(items: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && i + 1 < items.length) cur += items[++i];
      else if (c === quote) quote = null;
    } else if ((c === '"' || c === "'") && !cur.trim()) {
      quote = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function generateFallbackSkill(rawText: string, fileName: string, category: string): string {
  // Matches enrich.js's own skillName derivation exactly, so a fallback file's frontmatter
  // has the same shape a successful Gemini generation would have had. Without this, the
  // downloaded file has no name: field at all (this function never passes through the
  // backend's sanitize(), which is the only place that field is normally force-injected).
  const skillNameFromFile = fileName
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || 'Untitled Skill';

  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 8);
  const fullText = lines.join(' ');

  const detected = detectSkillDomain(fileName, rawText);
  const domain     = detected?.label      ?? 'professional communication';
  const role       = detected?.role       ?? 'a domain specialist';
  const outputType = detected?.outputType ?? 'written outputs';
  const frame      = detected?.frame      ?? 'operate at a high level in this domain';

  const wordFreq: Record<string, number> = {};
  fullText.toLowerCase().split(/\W+/).forEach(w => {
    if (
      w.length > 4 &&
      !/^(that|this|with|from|have|will|your|they|been|were|when|what|then|than|also|just|more|some|into|over|only|each|very|such|most|after|about|would|could|should|their|there|these|those|other|which|where|while|through|always|never|every|first|second|third|before|because|between|without|another|however|although)$/.test(w)
    ) {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
  });
  const domainWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);

  const sentences = fullText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 35 && s.length < 180 && /[a-zA-Z]{4,}/.test(s) && !/^(http|www)/.test(s));

  const actionLines = lines.filter(l =>
    /^(use|write|make|keep|build|create|start|lead|focus|ensure|apply|design|send|open|close|show|tell|give|ask|add|set|run|check|avoid|never|always)/i.test(l) &&
    l.length > 15 && l.length < 160
  );

  const ruleLines = lines
    .filter(l => {
      if (l.length <= 20 || l.length >= 160) return false;
      if (/^(http|www|@|\d{4})/.test(l)) return false;
      if (/^subject.?line/i.test(l)) return false;
      if (/email\s*#\d/i.test(l)) return false;
      if (/^\d+\s*emails?[;,]/i.test(l)) return false;
      if (/\[name\]/i.test(l)) return false;
      if (/^(ps:|p\.s\.|p\.s:)/i.test(l)) return false;
      const hasInstruction = /\b(always|never|write|use|make|keep|lead|start|end|ensure|avoid|focus|apply|send|create|build|design|follow|check)\b/i.test(l);
      const hasBullet = /^[-•*]/.test(l);
      const hasColon = l.includes(':') && l.indexOf(':') > 8;
      return hasInstruction || hasBullet || hasColon;
    })
    .map(l => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(l => l.length > 15);

  const principleSource = [...ruleLines, ...sentences].slice(0, 10);
  const principles = principleSource.length >= 3
    ? principleSource
        .slice(0, 5)
        .map(l => `- ${l.charAt(0).toUpperCase() + l.slice(1).replace(/[.!?]$/, '')}.`)
        .join('\n')
    : `- Every output must serve a clear, specific purpose - not just fill space.
- Precision and specificity outweigh length and elaboration every time.
- The audience's reaction is the only reliable measure of quality.
- Patterns that work should be repeated deliberately; everything else should be cut.
- Constraints are information - what you exclude defines the work as much as what you include.`;

  const alwaysLines = actionLines
    .filter(l => !/\b(never|avoid|don't|not)\b/i.test(l))
    .slice(0, 5)
    .map(l => `- ${l.charAt(0).toUpperCase() + l.slice(1).replace(/[.!?]$/, '')}.`);

  const neverLines = actionLines
    .filter(l => /\b(never|avoid|don't|not)\b/i.test(l))
    .slice(0, 4)
    .map(l => `- ${l.charAt(0).toUpperCase() + l.slice(1).replace(/[.!?]$/, '')}.`);

  const alwaysSection = alwaysLines.length >= 3
    ? alwaysLines.join('\n')
    : `- Deliver complete, usable outputs - never outlines or half-finished drafts.
- Match the tone and register of the source material exactly.
- Lead with what matters most - bury nothing important below the fold.
- Apply structural patterns consistently across every output.
- Stay specific - if it could have been written for anyone, rewrite it.`;

  const neverSection = neverLines.length >= 2
    ? neverLines.join('\n')
    : `- Never produce output that ignores the established patterns of this domain.
- Never use generic language when specific language is available.
- Never let length substitute for substance - cut anything that doesn't earn its place.
- Never present a draft as finished work before testing it against the quality bar.`;

  const createSection = ruleLines.length >= 3
    ? ruleLines
        .slice(0, 4)
        .map(l => `- ${l.charAt(0).toUpperCase() + l.slice(1).replace(/[.!?]$/, '')}.`)
        .join('\n')
    : `- Structure every output so the most important element comes first.
- Use the length the content demands - no more, no less.
- Match the vocabulary and register of this domain exactly.
- Make every sentence earn its place before including it in the final output.`;

  const voiceWords = domainWords.slice(0, 8).join(', ');
  const vocabLine = voiceWords
    ? `Key vocabulary from this domain: ${voiceWords}.`
    : `Vocabulary must be native to this domain - avoid borrowed jargon from adjacent fields.`;

  const sanitizedUseCases = (domainWords.slice(0, 3).length > 0
    ? domainWords.slice(0, 3).map(w => sanitizeYamlValue(w)).join(', ')
    : 'consistency, patterns, accuracy');

  return `---
name: ${sanitizeYamlValue(skillNameFromFile)}
domain: ${sanitizeYamlValue(domain)}
content_type: behavioral skill
use_cases: [${sanitizedUseCases}]
---

## Identity & Role
You are ${role} who thinks, decides, and creates using the exact patterns distilled from the source material below. You do not explain your methodology - you execute it. Every output you produce should be indistinguishable from someone who has spent years learning to ${frame}.

## Core Principles
${principles}

## How to Think
Start by identifying the single most important outcome this output must achieve. Work backwards from that outcome: what structure, tone, and content best serve it? Treat every constraint as useful information - the things you exclude define the work as much as what you include. When uncertain, default to what the source material does, not what feels intuitively right in the moment.

## How to Create
${createSection}

## What to Always Do
${alwaysSection}

## What to Never Do
${neverSection}

## Voice & Language
${vocabLine} Sentences must move forward - no filler, no throat-clearing, no hedging. The opening must earn attention immediately. The closing must prompt a specific response or action. Every transition should be invisible. If a sentence can be cut without any loss of meaning, cut it.

## Quality Bar
The output is ready when it matches the pattern of the source material closely enough that someone familiar with this domain would not suspect it was produced without that context. If it reads as generic - if it could have been written for anyone - it needs another pass. Specificity is the quality bar. If it does not feel like it came from a ${role}, it is not done yet.`;
}

export function fixAiYamlFrontmatter(content: string): string {
  let cleanContent = content.trim();
  if (cleanContent.startsWith('```markdown')) {
    cleanContent = cleanContent.replace(/^```markdown\s*\n/i, '');
  } else if (cleanContent.startsWith('```')) {
    cleanContent = cleanContent.replace(/^```[a-z]*\s*\n/i, '');
  }
  if (cleanContent.endsWith('```')) {
    cleanContent = cleanContent.replace(/\n```$/, '');
  }

  return cleanContent.replace(
    /^(---\n)([\s\S]*?)\n(^---)/m,
    (_match, open, body, close) => {
      const fixedBody = body
        .replace(/^(domain:\s*)(.+)$/m, (_l: string, key: string, val: string) => {
          const trimmed = val.trim();
          if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
              (trimmed.startsWith("'") && trimmed.endsWith("'"))) return `${key}${trimmed}`;
          return `${key}${sanitizeYamlValue(trimmed)}`;
        })
        .replace(/^(content_type:\s*)(.+)$/m, (_l: string, key: string, val: string) => {
          const trimmed = val.trim();
          if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
              (trimmed.startsWith("'") && trimmed.endsWith("'"))) return `${key}${trimmed}`;
          return `${key}${sanitizeYamlValue(trimmed)}`;
        })
        .replace(/^(use_cases:\s*\[)(.+?)(\])$/m, (_l: string, prefix: string, items: string, suffix: string) => {
          const fixed = splitYamlListItems(items).map((item: string) => {
            const t = item.trim();
            if ((t.startsWith('"') && t.endsWith('"')) ||
                (t.startsWith("'") && t.endsWith("'"))) return ` ${t}`;
            return ` ${sanitizeYamlValue(t)}`;
          }).join(',');
          return `${prefix}${fixed}${suffix}`;
        });
      return `${open}${fixedBody}\n${close}`;
    }
  );
}

// agents (2026-11-02): on the Agents target, the template (lens) and Codex shape the backend combined.
// `preview` (2026-11-17): set when the server returned only a preview of a signed-out free try
// (ANON_PREVIEW_ONLY=on); claimId is null when the server could not hold the full skill for unlocking.
export interface EnrichMeta { plan?: any; content?: any; model?: string; latencyMs: number; agents?: { lens?: string; shape?: string }; preview?: { claimId: string | null; sections: number; lockedSections: number } }

// V3 progress events from parseFile, in order. Each carries only facts the code actually has at
// that moment, so the UI never narrates work that has not happened.
export type EngineStage =
  | { stage: 'extracted'; chars: number; fileType: string; warnings: string[]; preview: string }
  | { stage: 'profiled'; sizeClass: string; template: string; contentType?: string; category: string }
  | { stage: 'sent'; target: 'claude' | 'codex' | 'agents' }
  | { stage: 'done'; degraded: boolean; meta?: EnrichMeta; outputChars: number };

export async function enrichWithAI(rawText: string, category: string, fileName: string, template: string = 'A', richFormats: string[] = [], charCap: number = 3500, sizeClass: string = 'small', target: 'claude' | 'codex' | 'agents' = 'claude', sessionId?: string, onMeta?: (m: EnrichMeta) => void, fullText?: string): Promise<string | { content: string; degraded: boolean }> {
  // Funnel session id (landing→app→backend), read directly from localStorage since this
  // is a module-level function outside the component tree — distinct from the `sessionId`
  // parameter above, which is the per-upload-batch quota-replay-dedup id sent to the backend.
  const rlSessionId = readStorage('rl_session_id');
  // v2.4: shared Codex error stub - used at every point where Claude would fall through
  // to generateFallbackSkill(). Returns { content, degraded: true } so parseFile surfaces
  // the degraded warning. Structurally valid for Codex CLI; not enriched content.
  const codexErrorStub = (desc: string): { content: string; degraded: true } => {
    const s = fileName.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-skill';
    return { content: `---\nname: ${s}\ndescription: "${desc}"\n---\n\n## When to Activate\n### Must Use\n- Retry generation with a cleaner source document\n### Recommended\n- Review source document for sufficient signal\n### Skip\n- Using this artifact as-is without regenerating\n\n## Key Principles\n- This artifact was not generated successfully - regenerate before use.`, degraded: true };
  };

  // Fix: every Claude-path failure branch below used to return generateFallbackSkill(...) as
  // a bare string, so parseFile's isDegraded check (which only recognizes the {content,
  // degraded} object shape, same as codexErrorStub above) never fired for Claude - only for
  // Codex. Claude is the default target, so every Claude-path failure (422, non-2xx, missing
  // data.enriched, network throw) was shipping a silent, unwarned fallback file with no
  // indication to the user that AI enrichment never ran.
  const claudeFallback = (): { content: string; degraded: true } =>
    ({ content: generateFallbackSkill(rawText || '', fileName, category), degraded: true });

  if (!rawText || rawText.trim().length < 20) {
    if (target === 'codex') return codexErrorStub('Insufficient source content. Provide a longer document and regenerate.');
    return claudeFallback();
  }

  const genStartedAt = Date.now();
  captureEvent('skill_generation_started', { template_used: template, target, session_id: rlSessionId });

  try {
    // v2.3: pass target to detectSkillDomain so Codex path searches CODEX_NATIVE_DOMAINS too.
    // profileDocument and generateFallbackSkill still call detectSkillDomain without target
    // (Claude default) - their behavior is unchanged.
    // 2026-11-02 (Agents target): the request is the Claude one (domain, role, frame) plus the Codex
    // shape, the request the backend's Agents path was measured with (relatch api/enrich.js).
    const detectedDomain = detectSkillDomain(fileName, rawText, target === 'codex' ? 'codex' : 'claude');
    const shapeDomain = target === 'agents' ? detectSkillDomain(fileName, rawText, 'codex') : detectedDomain;

    // v2.3: look up Codex-specific role/frame overrides from CODEX_DOMAIN_SUPPLEMENTS.
    // For CODEX_NATIVE_DOMAINS hits, supplement is undefined - their role/frame are already
    // Codex-oriented, so the fallback to detectedDomain?.role is correct in that case.
    const supplement = detectedDomain ? CODEX_DOMAIN_SUPPLEMENTS[(detectedDomain as any).id] : undefined;

    // v2.2: derive codexShape from detected domain (explicit override) or fall back to
    // template-mapped default. Only sent when target === 'codex' - backend defaults to
    // 'execute' if absent, so omitting on Claude requests preserves the existing contract.
    const codexShape = target === 'codex' || target === 'agents'
      ? ((shapeDomain as any)?.codexShape || templateToShape((shapeDomain as any)?.template))
      : undefined;

    const token = _getToken ? await _getToken() : null;
    const anonToken = !token ? readStorage(ANON_TOKEN_STORAGE_KEY) : null;
    const response = await fetch(ENRICH_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(anonToken ? { 'X-Anon-Token': anonToken } : {}),
      },
      body: JSON.stringify({
        rawText,
        category,
        fileName,
        domainLabel: detectedDomain?.label || 'general professional',
        // v2.3: Codex path uses supplement.codexRole (operational constraint language) instead of
        // the Claude-flavored role. Claude path is byte-identical - always takes the else branch.
        domainRole: (target === 'codex' && supplement?.codexRole)
          ? supplement.codexRole
          : (detectedDomain as any)?.role || 'an expert',
        domainFrame: (target === 'codex' && supplement?.codexFrame)
          ? supplement.codexFrame
          : (detectedDomain as any)?.frame || 'communicate effectively',
        template,
        richFormats,
        charCap,
        sizeClass,
        target,
        ...(codexShape ? { codexShape } : {}),
        ...(sessionId ? { sessionId } : {}),
        // 2026-10-25 (production f4bf4c1, ported 2026-11-15): Codex also sends the whole document
        // for the backend's DELIVERABLE auto-detection. Claude and Agents: not sent.
        ...(target === 'codex' && fullText ? { fullText } : {}),
      }),
    });

    if (response.status === 422) {
      captureEvent('skill_generation_failed', { error_code: '422', latency_ms: Date.now() - genStartedAt, session_id: rlSessionId });
      if (target === 'codex') return codexErrorStub('Source content did not contain enough operational signal. Provide a richer document and regenerate.');
      return claudeFallback();
    }

    if (response.status === 429) {
      captureEvent('skill_generation_failed', { error_code: '429', latency_ms: Date.now() - genStartedAt, session_id: rlSessionId });
      const errData = await response.json().catch(() => ({}));
      const quotaErr = new Error('QUOTA_REACHED');
      (quotaErr as any).isQuotaError = true;
      (quotaErr as any).limitType = errData.limitType || 'daily';
      (quotaErr as any).weeklyCount = errData.weeklyCount ?? 0;
      throw quotaErr;
    }

    if (response.status === 401 && anonToken) {
      // Only special-cased on the anonymous path — a signed-in user's own 401 (expired
      // Clerk session) is a different, existing scenario and falls through to the generic
      // handling below unchanged. Mirrors the isQuotaError pattern just above: this must
      // bubble up to handleFiles rather than silently degrading to a fallback skill, so the
      // trial-exhausted anonymous user actually sees the sign-up gate instead of walking
      // away thinking a real (but unenriched) generation succeeded.
      captureEvent('skill_generation_failed', { error_code: '401_anon', latency_ms: Date.now() - genStartedAt, session_id: rlSessionId });
      const anonErr = new Error('ANON_TOKEN_INVALID');
      (anonErr as any).isAnonTokenInvalid = true;
      throw anonErr;
    }

    if (!response.ok) {
      captureEvent('skill_generation_failed', { error_code: String(response.status), latency_ms: Date.now() - genStartedAt, session_id: rlSessionId });
      if (target === 'codex') return codexErrorStub('Skill generation encountered an error. Review source and regenerate.');
      return claudeFallback();
    }

    const data = await response.json();
    if (!data.enriched) {
      captureEvent('skill_generation_failed', { error_code: 'no_enriched_content', latency_ms: Date.now() - genStartedAt, session_id: rlSessionId });
      if (target === 'codex') return codexErrorStub('Skill generation encountered an error. Review source and regenerate.');
      return claudeFallback();
    }

    // v2.4: When the backend used the deterministic fallback assembler, surface a degraded
    // signal to parseFile so it can attach a warning to the file card.
    // The artifact itself is structurally valid and renderable - this only adds a notice.
    captureEvent('skill_generation_completed', { template_used: template, model_used: data.model, latency_ms: Date.now() - genStartedAt, session_id: rlSessionId });
    // V3: hand the server's own analysis (the Jev `plan` and the `content` selection summary,
    // both enums/numbers only) to the UI that shows the reasoning steps. Optional; V2 never passes it.
    onMeta?.({ plan: data.plan, content: data.content, model: data.model, latencyMs: Date.now() - genStartedAt, ...(data.agents ? { agents: data.agents } : {}), ...(data.preview && typeof data.preview === 'object' ? { preview: { claimId: typeof data.preview.claimId === 'string' ? data.preview.claimId : null, sections: Number(data.preview.sections) || 0, lockedSections: Number(data.preview.lockedSections) || 0 } } : {}) });
    if (data.model === 'deterministic-fallback' && target === 'codex') {
      return { content: fixAiYamlFrontmatter(data.enriched), degraded: true };
    }

    return fixAiYamlFrontmatter(data.enriched);
  } catch (err) {
    // Quota errors and anon-trial-exhausted errors must bubble up to handleFiles — do not
    // swallow them here.
    if ((err as any)?.isQuotaError || (err as any)?.isAnonTokenInvalid) throw err;
    captureEvent('skill_generation_failed', { error_code: 'network_error', latency_ms: Date.now() - genStartedAt, session_id: rlSessionId });
    if (target === 'codex') return codexErrorStub('Skill generation encountered an error. Review source and regenerate.');
    return claudeFallback();
  }
}

export async function parseFile(file: File, target: 'claude' | 'codex' | 'agents' = 'claude', sessionId?: string, onStage?: (s: EngineStage) => void): Promise<UploadedFile> {
  const traceId = `ingest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const precheck = validateInputFile(file);
  if (!precheck.ok) throw new Error(precheck.reason || 'Invalid file');

  const type = detectFileType(file);
  const extracted = await extractText(file, type, sessionId);

  if (file.size <= 0) throw new Error('Invalid buffer size (0 bytes).');

  if (type === 'pdf' && !(file.type || '').toLowerCase().includes('pdf') && getFileExtension(file.name) !== '.pdf') {
    throw new Error('File is not a valid PDF MIME/extension for PDF pipeline.');
  }

  if (type === 'txt' && isLikelyAppAssetText(extracted.text, type)) {
    throw new Error('Detected app HTML/JS bundle content instead of a user document.');
  }

  if (extracted.text.trim().length < 20) {
    const reason = extracted.warnings.length > 0
      ? extracted.warnings[extracted.warnings.length - 1]
      : 'Could not extract any text from this file.';
    throw new Error(reason);
  }

  // preview: the start of the user's own text, shown while Relatch reads it (never leaves the browser).
  onStage?.({ stage: 'extracted', chars: extracted.text.length, fileType: type, warnings: extracted.warnings, preview: extracted.text.slice(0, 6000) });

  const category = inferCategory(file, extracted.text);
  const profile = profileDocument(file, extracted.text, extracted.warnings.join(' '));

  if (profile.template === 'REJECT') {
    throw new Error(profile.rejectReason || 'This file type cannot be processed.');
  }
  onStage?.({ stage: 'profiled', sizeClass: profile.sizeClass, template: profile.template, contentType: (profile as any).contentType, category });

  // 2026-10-04 input-cap study (vault "Relatch Model Provider Routing - Plan", status block):
  // letting the model read 2x more of a medium or large document kept more of the source (key
  // terms, numbers) with no cut-offs, no invented numbers and no added latency; 4x added nothing
  // more. Claude target only: Codex text is distilled to the cap and was not studied, so it keeps
  // profile.charCap. Small documents are already read whole. The backend accepts at most this
  // (SERVER_CHAR_CAP in relatch api/enrich.js), so raising it there alone changes nothing.
  // 2026-10-24 (domain templates plan, Step C): 4x on the Claude target (medium 20000, large a
  // 32000-char sample), matching the backend's raised SERVER_CHAR_CAP. SUPERSEDED the same day:
  // Step C was scoped to templates F-K on the server, so the line below mirrors production App.tsx.
  // 2026-10-24 (input limits, vault "Relatch Input Limits - Safe Ceilings per Template"): Codex now
  // reads 2x too (10000 medium / 16000 large, distilled). Blind-judged on 13 docs, production env:
  // W5 / T7 / L1, every rubric dimension +1.0 (at 1x the trimmed text misled domain detection on a
  // marketing FAQ). The backend already accepts 2x (SERVER_CHAR_CAP), so this file alone ships it.
  // 2026-10-24 (domain templates F-K, large documents): Claude large documents are sampled at 4x
  // (32000). The backend rebuilds the 2x (16000) sample from it byte for byte for every template
  // except F-K, which read the whole 32000 sample (relatch api/enrich.js shrinkLargeSample, keyed
  // on charCap === 32000). Medium stays 2x. Ship the backend change first.
  const charCap = profile.sizeClass === 'small' ? profile.charCap : profile.charCap * (target !== 'codex' && profile.sizeClass === 'large' ? 4 : 2); // Agents reads as Claude does

  const textForEnrichment = target === 'codex'
    ? distillForCodex(extracted.text, charCap)
    : profile.sizeClass === 'large'
      ? sampleLargeDocument(extracted.text, charCap)
      : extracted.text;

  // v2.4: enrichWithAI returns string on success or { content, degraded: true } when the
  // backend used the deterministic Codex fallback assembler. Unpack here - content is always
  // a string, degraded flag triggers a user-visible warning on the file card.
  onStage?.({ stage: 'sent', target });
  let meta: EnrichMeta | undefined;
  const enrichResult = await enrichWithAI(
    textForEnrichment,
    category,
    file.name,
    profile.template,
    profile.richFormats,
    charCap,
    profile.sizeClass,
    target,
    sessionId,
    (m) => { meta = m; },
    // Codex: the whole document (up to the backend's 20000 medium / a 32000 start-middle-end sample
    // for large), as production sends it. Claude and Agents: undefined.
    target === 'codex'
      ? (extracted.text.length <= (profile.sizeClass === 'large' ? 32000 : 20000) ? extracted.text : sampleLargeDocument(extracted.text, profile.sizeClass === 'large' ? 32000 : 20000))
      : undefined
  );
  const content = typeof enrichResult === 'string' ? enrichResult : (enrichResult as any).content;
  const isDegraded = typeof enrichResult !== 'string' && (enrichResult as any).degraded === true;
  onStage?.({ stage: 'done', degraded: isDegraded, meta, outputChars: content.length });
  if (target === 'codex') {
    console.log('[Codex]', { file: file.name, sizeClass: profile.sizeClass, distilledLen: textForEnrichment.length, rawLen: extracted.text.length, degraded: isDegraded });
  }
  const extractionWarning = [
    ...(extracted.warnings.length ? [extracted.warnings.join(' ')] : []),
    ...(isDegraded ? ['Enrichment service was temporarily unavailable. This skill was assembled from your source using local signal extraction - review and refine before deploying.'] : []),
  ].join(' ') || undefined;

  return {
    id: generateId(),
    name: file.name,
    type: file.type || type,
    size: file.size,
    content,
    category,
    parsedAt: new Date(),
    extractionWarning,
    ocrBlocks: extracted.blocks,
  };
}

export const PRIORITY_ORDER: FileCategory[] = ['instructions', 'personality', 'preferences', 'context', 'knowledge', 'examples'];
export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'Always active',
  medium: 'When relevant',
  low: 'Background',
};
export const CATEGORY_TOOLTIPS: Record<FileCategory, string> = {
  instructions: 'Rules Claude must always follow',
  personality: 'How Claude should sound and communicate',
  preferences: 'Your personal settings and formatting choices',
  context: 'Background info Claude should always keep in mind',
  knowledge: 'Facts, data, or reference material to draw from',
  examples: 'Sample outputs or templates to follow',
};
export const SAMPLE_FILE_NAME = 'sample-brand-guidelines.txt';
export const SAMPLE_FILE_CONTENT = `Brand voice:
- Clear, practical, and friendly
- Never sound robotic or overly formal
- Prefer short paragraphs and simple words

Writing rules:
1. Start with the answer first
2. Use bullet points when listing steps
3. Add one concrete example when explaining concepts

Audience context:
- Solo founders and small teams
- Building products fast with limited resources
- Care about clarity over jargon`;
export const SPLITFORMS_ENDPOINT = ((import.meta.env.VITE_SPLITFORMS_ENDPOINT as string | undefined)?.trim() || 'https://splitforms.com/api/submit');
export const SPLITFORMS_ACCESS_KEY = ((import.meta.env.VITE_SPLITFORMS_ACCESS_KEY as string | undefined)?.trim() || 'f277a53be64748cc802c0de0c130951f');
// Contact and the feedback note post to WebForms (2026-11-17), not SplitForms: 300 free submissions a month that
// reset, instead of 500 ever. The waitlist above stays on SplitForms (its duplicate check reads SplitForms' API).
// Each form's endpoint is its PUBLIC submit key (wft_...) on this host; the secret API key (wf_live_...) is never used here.
export const webformsUrl = (key: string) => `https://send.webforms.to/${encodeURIComponent(key)}`;
export const WAITLIST_CHECK_URL = 'https://claudly-proxy.vercel.app/api/waitlist-check';
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Waitlist popup: how long after a real download click to interrupt with the join prompt.
export const WAITLIST_POPUP_DELAY_MS = 6000;
export const WAITLIST_STATUS_KEY = 'relatch_waitlist_status';
export type WaitlistStatus = 'joined' | 'dismissed' | null;

// 'joined' vs 'dismissed' are tracked separately (not one boolean) because they answer two
// different questions: both suppress the auto-popup, but only 'joined' hides the footer fallback link.
export function getWaitlistStatus(): WaitlistStatus {
  try { return localStorage.getItem(WAITLIST_STATUS_KEY) as WaitlistStatus; } catch { return null; }
}
export function persistWaitlistStatus(status: 'joined' | 'dismissed') {
  try { localStorage.setItem(WAITLIST_STATUS_KEY, status); } catch { /* storage unavailable, non-fatal */ }
}

export function toSkillSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 60) || 'my-skill';
}

export function makeSampleUploadedFile(): UploadedFile {
  const file = { name: SAMPLE_FILE_NAME } as File;
  return {
    id: generateId(),
    name: SAMPLE_FILE_NAME,
    type: 'text/plain',
    size: SAMPLE_FILE_CONTENT.length,
    content: SAMPLE_FILE_CONTENT,
    category: inferCategory(file, SAMPLE_FILE_CONTENT),
    parsedAt: new Date(),
  };
}

export function getSkillSizeLabel(tokens: number): string {
  if (tokens < 1500) return 'Light skill';
  if (tokens < 4000) return 'Standard skill';
  return 'Heavy skill';
}

// App() hands Clerk's getToken to the engine (an imported binding cannot be assigned directly).
export function setTokenGetter(fn: (() => Promise<string | null>) | null) {
  _getToken = fn;
}
