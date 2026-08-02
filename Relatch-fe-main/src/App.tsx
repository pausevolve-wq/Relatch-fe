import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from "pdfjs-dist";
import {
  Upload, FolderKanban, Settings, Sparkles, ArrowRight, ArrowLeft,
  ChevronRight, Zap, FileText, Shield, X, Image, Code, Database,
  Globe, AlertCircle, CheckCircle2, Brain, BookOpen, ListChecks, FileCode,
  Layers, ChevronDown, MessageSquare, Download, Copy, Check, Package, Info, Lock,
  Tag
} from 'lucide-react';
import { Show, SignIn, SignUp, UserButton, useUser, useAuth } from "@clerk/react";
import { CLAUDE_LOGO_URI, CODEX_BASE_URI, CODEX_EYE_URI, CODEX_UNDERSCORE_URI, CLAUDE_LOGO_WHITE_URI, CODEX_LOGO_WHITE_URI } from "./agentLogos";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

let _getToken: (() => Promise<string | null>) | null = null;

type FileCategory = 'personality' | 'knowledge' | 'instructions' | 'examples' | 'context' | 'preferences';
type AppStep = 'agent' | 'upload' | 'organize' | 'configure' | 'generate';
type Priority = 'high' | 'medium' | 'low';

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
  category: FileCategory;
  parsedAt: Date;
  extractionWarning?: string;
}

interface CategoryConfig {
  enabled: boolean;
  label: string;
  description: string;
  icon: string;
  priority: Priority;
}

interface SkillConfig {
  skillName: string;
  description: string;
  customNotes: string;
  categories: Record<FileCategory, CategoryConfig>;
  target: 'claude' | 'codex';
}

type CodexDescriptionSource = 'model' | 'backend_placeholder' | 'frontend_recovered' | 'missing';

interface CodexMeta {
  name?: string;
  description?: string;
  descriptionSource: CodexDescriptionSource;
}

interface GeneratedSkill {
  filename: string;
  content: string;
  category: FileCategory | 'main';
  tokenEstimate: number;
  codexMeta?: CodexMeta; // backend Codex frontmatter extracted before it is stripped
}

let idCounter = 0;
const generateId = () => `file_${Date.now()}_${++idCounter}`;

const ACCEPTED_TYPES: Record<string, string[]> = {
  'Text': ['.txt', '.md', '.csv', '.log'],
  'Documents': ['.pdf', '.doc', '.docx'],
  'Web': ['.html', '.htm', '.xml'],
  'Data': ['.json', '.yaml', '.yml', '.toml'],
  'Code': ['.js', '.ts', '.py', '.rb', '.go', '.rs'],
};

const OCR_PROXY_URL = 'https://claudly-proxy.vercel.app/api/ocr';
const ENRICH_PROXY_URL = 'https://claudly-proxy.vercel.app/api/enrich';

function getFileExtension(name: string): string {
  return '.' + name.split('.').pop()?.toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type NormalizedFileType = 'pdf' | 'docx' | 'txt' | 'html' | 'unknown';

interface ExtractedTextResult {
  type: NormalizedFileType;
  text: string;
  warnings: string[];
}

interface FileValidationResult {
  ok: boolean;
  reason?: string;
}

function detectFileType(file: File): NormalizedFileType {
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

const SUPPORTED_EXTENSIONS = new Set([
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
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function validateInputFile(file: File): FileValidationResult {
  if (!file || file.size <= 0) return { ok: false, reason: 'File is empty and cannot be processed.' };
  if (file.size > MAX_FILE_SIZE_BYTES) return { ok: false, reason: `File too large (${formatBytes(file.size)}). Maximum size is ${formatBytes(MAX_FILE_SIZE_BYTES)}.` };
  const ext = getFileExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.has(ext)) return { ok: false, reason: `Unsupported file type: ${ext}` };
  return { ok: true };
}

function isLikelyAppAssetText(text: string, fileType: NormalizedFileType): boolean {
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

function inferCategory(file: File, content: string): FileCategory {
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

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error(`Failed to read binary data from ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeArrayBuffer(buffer: ArrayBuffer, encoding: string = 'utf-8'): string {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(new Uint8Array(buffer));
  } catch {
    return new TextDecoder('latin1').decode(new Uint8Array(buffer));
  }
}

function stripArtifacts(text: string): string {
  return text
    .replace(/%PDF-[\d.]+/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripXmlArtifacts(text: string): string {
  return text
    .replace(/w:[a-zA-Z]+/g, ' ')
    .replace(/xmlns:[a-zA-Z]+="[^"]*"/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractTextFromHtml(html: string): string {
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

async function callOcrProxy(file: File): Promise<{ text: string; source: string } | null> {
  try {
    const buffer = await readAsArrayBuffer(file);
    const base64 = arrayBufferToBase64(buffer);
    const mimeType = file.type || 'application/pdf';

    const token = _getToken ? await _getToken() : null;
    const response = await fetch(OCR_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ base64, mimeType, fileName: file.name }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.text && data.text.length > 50) {
      return { text: data.text, source: data.source };
    }

    return null;
  } catch (err) {
    return null;
  }
}

// Returns true when pdfjs-extracted text is structurally weak for the document size  - 
// indicating a diagram-heavy or caption-dominated PDF where OCR may recover more content.
// Only applied for multi-page PDFs (single-page cover/title pages are trusted as-is).
// Requires at least 2 of 3 signals to fire, reducing false positives on short-but-valid docs.
function isPdfTextWeak(text: string, numPages: number): boolean {
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

async function extractPdfText(file: File): Promise<ExtractedTextResult> {
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
    warnings.push('PDF text layer empty - attempting OCR extraction.');
    const ocrResult = await callOcrProxy(file);
    if (ocrResult) {
      warnings.push(`Text extracted via OCR (${ocrResult.source}). Quality may vary for handwritten or low-resolution documents.`);
      return { type: 'pdf', text: ocrResult.text, warnings };
    }
    warnings.push('Both PDF text extraction and OCR failed. This document may be encrypted, corrupted, or very low resolution.');
    return { type: 'pdf', text: '', warnings };
  }

  // Confidence heuristic: escalate to OCR for diagram-heavy / text-sparse PDFs
  if (isPdfTextWeak(pdfjsText, numPages)) {
    warnings.push('PDF appears diagram-heavy or text-sparse - attempting OCR for richer extraction.');
    const ocrResult = await callOcrProxy(file);
    if (ocrResult && ocrResult.text.length > pdfjsText.length * 0.8) {
      warnings.push(`Enhanced extraction via OCR (${ocrResult.source}).`);
      return { type: 'pdf', text: ocrResult.text, warnings };
    }
    warnings.push('OCR did not improve extraction — using text layer.');
  }

  return { type: 'pdf', text: pdfjsText, warnings };
}

async function extractDocxText(file: File): Promise<ExtractedTextResult> {
  const warnings: string[] = [];
  try {
    const buffer = await readAsArrayBuffer(file);
    const { default: JSZip } = await import('jszip');
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
    if (text.trim().length > 0) return { type: 'docx', text: stripArtifacts(text), warnings };
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

    warnings.push('DOCX extraction failed - attempting OCR.');
    const ocrResult = await callOcrProxy(file);
    if (ocrResult) {
      warnings.push(`Text extracted via OCR (${ocrResult.source}).`);
      return { type: 'docx', text: ocrResult.text, warnings };
    }
    return { type: 'docx', text: '', warnings };
  }
  const fallbackBuffer = await readAsArrayBuffer(file);
  const fallback = stripXmlArtifacts(decodeArrayBuffer(fallbackBuffer, 'latin1'));
  return { type: 'docx', text: fallback, warnings };
}

async function extractText(file: File, type: NormalizedFileType): Promise<ExtractedTextResult> {
  if (type === 'pdf') return extractPdfText(file);
  if (type === 'docx') return extractDocxText(file);
  if (type === 'html') {
    const raw = await readAsText(file);
    return { type, text: stripArtifacts(extractTextFromHtml(raw)), warnings: [] };
  }
  if (type === 'txt') {
    const raw = await readAsText(file);
    return { type, text: stripArtifacts(raw), warnings: [] };
  }
  const raw = stripArtifacts(await readAsText(file));
  return { type: 'unknown', text: raw, warnings: [] };
}

const SKILL_DOMAINS = [
  {
    id: 'email_copywriting',
    label: 'email copywriting & outreach',
    role: 'a direct-response email copywriter',
    outputType: 'emails, sequences, and outreach campaigns',
    frame: 'write emails that get opened, read, and replied to',
    keywords: /\b(subject.?line|open.?rate|click.?through|drip|sequence|outreach|followup|follow.?up|prospect|cold.?email|reply.?rate|unsubscribe|deliverability|broadcast|nurture|autoresponder|opt.?in|inbox|sender|preview.?text)\b/i,
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
    keywords: /\b(function|async.?await|interface|component|props|useState|useEffect|endpoint|refactor|deploy|ci.?cd|unit.?test|lint|compile|algorithm|big.?o|typescript|javascript|python|react|node|kubernetes|docker|microservice)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'table', 'flowchart'],
  },
  {
    id: 'growth_marketing',
    label: 'growth marketing & performance',
    role: 'a growth-focused performance marketer',
    outputType: 'growth strategies, paid campaigns, and conversion systems',
    frame: 'drive measurable growth through data-informed marketing decisions',
    keywords: /\b(acquisition|retention|churn.?rate|ltv|cac|roas|a.?b.?test|landing.?page|paid.?ads|ppc|cpc|cpm|attribution|cohort|activation|referral.?program|viral.?loop|growth.?lever|north.?star.?metric|activation.?rate)\b/i,
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
    keywords: /\b(wireframe|prototype|usability.?test|heuristic|user.?journey|figma|sketch|affordance|interaction.?design|friction|empty.?state|microcopy|onboarding.?flow|accessibility|wcag|design.?system|component.?library|modal|tooltip)\b/i,
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
    keywords: /\b(learning.?objective|curriculum|lesson.?plan|instructional|assessment|rubric|scaffold|pedagogy|student.?engagement|course.?design|syllabus|bloom.?taxonomy|formative|summative|differentiat|learning.?outcome|e.?learning)\b/i,
    template: 'C' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'legal',
    label: 'legal & compliance',
    role: 'a legal professional',
    outputType: 'contracts, policies, and compliance documentation',
    frame: 'draft precise, enforceable language that protects all parties',
    keywords: /\b(clause|liability|indemnif|jurisdiction|termination|breach.?of|obligations|warranties|representation|consideration|contract|statute|regulation|compliance|gdpr|hipaa|counsel|attorney|whereas|hereinafter|pursuant)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'finance',
    label: 'finance & financial analysis',
    role: 'a financial analyst',
    outputType: 'financial models, analysis, and investment recommendations',
    frame: 'produce rigorous financial analysis that supports sound decisions',
    keywords: /\b(ebitda|ebit|cash.?flow|free.?cash.?flow|balance.?sheet|income.?statement|trial.?balance|gross.?margin|operating.?margin|net.?margin|amortization|depreciation|accrual|ledger|debit|credit|gaap|ifrs|wacc|dcf|npv|irr|eps|valuation|dividend|equity|debt|liability|fiscal.?year|fiscal.?quarter|hedge|derivative|bond.?yield|capex|opex|working.?capital|return.?on.?equity|return.?on.?assets|leverage.?ratio|debt.?to.?equity|interest.?rate|principal|maturity|coupon|underwriting|portfolio.?allocation|annual.?report|quarterly.?report|earnings.?call|earnings.?per.?share|book.?value|market.?cap)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'seo',
    label: 'SEO & search strategy',
    role: 'an SEO strategist',
    outputType: 'SEO strategies, content briefs, and optimized copy',
    frame: 'create content and strategies that earn search visibility and organic traffic',
    keywords: /\b(keyword.?research|search.?ranking|backlink|serp|meta.?description|title.?tag|canonical|crawl.?budget|index|schema.?markup|anchor.?text|domain.?authority|search.?intent|topical.?authority|content.?cluster|featured.?snippet|core.?web.?vital)\b/i,
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
    keywords: /\b(onboarding|performance.?review|compensation.?band|benefits|pto|termination|employee.?handbook|headcount|talent.?acquisition|leveling|pip|career.?ladder|comp|total.?rewards|people.?ops|culture.?add|hiring.?manager|offer.?letter)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'data_science',
    label: 'data science & machine learning',
    role: 'a data scientist and ML engineer',
    outputType: 'models, analyses, and data-driven recommendations',
    frame: 'extract signal from data and build systems that learn and improve',
    keywords: /\b(dataframe|pandas|numpy|sklearn|train.?test|accuracy|precision.?recall|feature.?engineering|regression|neural.?network|embedding|inference|dataset|etl|sql.?query|data.?warehouse|feature.?store|model.?drift|overfitting)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'table', 'flowchart'],
  },
  {
    id: 'product_management',
    label: 'product management',
    role: 'a product manager',
    outputType: 'PRDs, roadmaps, and product strategy documents',
    frame: 'define and ship products that solve real user problems at scale',
    keywords: /\b(product.?requirement|user.?story|acceptance.?criteria|sprint.?planning|epic|product.?backlog|roadmap.?item|north.?star|success.?metric|discovery|product.?hypothesis|go.?to.?market|launch.?plan|prd|feature.?flag|experiment)\b/i,
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
    keywords: /\b(mece|issue.?tree|so.?what|pyramid.?principle|workstream|deliverable|engagement.?manager|hypothesis.?driven|executive.?summary|straw.?man|benchmarking|best.?practice|operating.?model|change.?management|transformation)\b/i,
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
    keywords: /\b(vulnerability|cve|exploit|penetration.?test|pen.?test|firewall|encryption|ssl|tls|oauth|authentication|authorization|owasp|threat.?model|attack.?vector|incident.?response|soc|siem|zero.?trust|hardening|red.?team)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'social_media',
    label: 'social media & community',
    role: 'a social media strategist and content creator',
    outputType: 'social content, captions, and community strategies',
    frame: 'create social content that builds community and drives engagement',
    keywords: /\b(instagram|tiktok|linkedin.?post|twitter|youtube|hashtag|caption|reel|carousel|content.?calendar|ugc|creator.?economy|influencer|viral.?content|community.?management|engagement.?rate)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
  },
  {
    id: 'healthcare',
    label: 'healthcare & clinical',
    role: 'a healthcare professional',
    outputType: 'clinical documentation, patient communications, and protocols',
    frame: 'communicate clinical information clearly, accurately, and compassionately',
    keywords: /\b(patient|diagnosis|treatment.?protocol|medication|dosage|symptom|clinical.?trial|contraindication|prognosis|evidence.?based|ehr|icd.?code|cpt.?code|hipaa|care.?plan|referral|triage|differential|comorbidity)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
  },
  {
    id: 'academic_research',
    label: 'academic research & writing',
    role: 'an academic researcher and writer',
    outputType: 'research papers, literature reviews, and academic analyses',
    frame: 'produce rigorous, well-cited academic work that advances knowledge',
    keywords: /\b(hypothesis|research.?methodology|sample.?size|statistical.?significance|p.?value|literature.?review|peer.?review|citation|abstract|dissertation|thesis|empirical|independent.?variable|control.?group|replication|apa|mla|chicago)\b/i,
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
    keywords: /\b(listing|property|mortgage|appraisal|comparable|comps|escrow|title.?deed|zoning|commission|closing.?cost|inspection|mls|cap.?rate|noi|lease.?agreement|tenant|landlord|arv|cash.?on.?cash)\b/i,
    template: 'D' as const,
    richFormats: ['table'],
  },
  {
    id: 'creative_writing',
    label: 'creative writing & storytelling',
    role: 'a creative writer and storyteller',
    outputType: 'stories, scripts, copy, and narrative content',
    frame: 'craft narratives that move people and stay with them',
    keywords: /\b(protagonist|antagonist|plot.?arc|dialogue|scene.?setting|chapter|theme|motif|narrative.?structure|prose.?style|stanza|verse|character.?development|conflict|resolution|pacing|show.?don.?t.?tell|point.?of.?view|unreliable.?narrator)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
  },
  {
    id: 'direct_response_copywriting',
    label: 'direct response copywriting',
    role: 'a direct-response copywriter',
    outputType: 'sales pages, ads, and persuasive copy',
    frame: 'write copy that earns attention and drives action',
    keywords: /\b(hook|headline|sub.?headline|call.?to.?action|cta|swipe.?file|swipe|lede|big.?idea|conversion.?copy|persuasion|objection|pain.?point|open.?loop|sales.?page|sales.?letter|landing.?page.?copy|vsl|long.?form.?copy|copywriting|copywriter|direct.?response|aida|pas|fab|features.?benefits|benefit.?driven|emotional.?appeal|urgency|scarcity|social.?proof|testimonial|guarantee|risk.?reversal|offer.?stack|fascination|curiosity.?gap|reason.?why|power.?word|postscript|sales.?hook|click.?bait|conversion.?rate.?optimization|cro.?copy)\b/i,
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
function templateToShape(tmpl: string | undefined): 'execute' | 'expertise' | 'specialist' {
  if (tmpl === 'B') return 'execute';
  if (tmpl === 'A') return 'expertise';
  if (tmpl === 'C' || tmpl === 'D') return 'specialist';
  return 'execute';
}

// v2.3: Codex domain intelligence - separate from Claude path, never collides.
// CODEX_DOMAIN_SUPPLEMENTS provides Codex-specific role/frame/keyword overrides for every
// existing SKILL_DOMAIN. Claude path is untouched - supplements are only applied when
// target === 'codex'. The Claude role/frame values in SKILL_DOMAINS are never modified.
interface CodexDomainSupplement {
  codexRole: string;
  codexFrame: string;
  codexKeywordsExtra?: RegExp;
}

const CODEX_DOMAIN_SUPPLEMENTS: Record<string, CodexDomainSupplement> = {
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
    codexRole: 'an API design reviewer operating within defined contract standards and versioning constraints â€" flags breaking changes and enforces error-response conventions',
    codexFrame: 'validate API contracts against OpenAPI standards and internal conventions, enforce versioning discipline, flag breaking changes before shipping, and refuse spec additions that violate defined contract boundaries',
    codexKeywordsExtra: /\b(restful|endpoints|crud|payload|idempotency|rest[\s.-]?api|api[\s.-]?design|http[\s.-]?method|http[\s.-]?verb|resource[\s.-]?design|resource[\s.-]?model|api[\s.-]?evolution|api[\s.-]?lifecycle|api[\s.-]?strategy|api[\s.-]?contract|api[\s.-]?versioning|hypermedia|hateoas|self[\s.-]?link|link[\s.-]?relation|api[\s.-]?style|api[\s.-]?consumer|url[\s.-]?convention)\b/i,
  },
};

const CODEX_NATIVE_DOMAINS = [
  {
    id: 'devops',
    label: 'DevOps & infrastructure',
    role: 'a DevOps engineer executing infrastructure automation and deployment tasks within defined safety rails and rollback criteria',
    outputType: 'infrastructure configs, deployment scripts, and operational runbooks',
    frame: 'automate, deploy, and validate infrastructure changes - verify each step before proceeding, maintain rollback readiness at every stage',
    keywords: /\b(terraform|kubernetes|k8s|helm|docker|ci\.?cd|pipeline|deploy|rollback|infra|pod|node|cluster|ingress|nginx|github\.?action|jenkins|ansible|cloudformation|vpc|subnet|iam|s3|ecr|ecs|eks|gke|aks|argocd|flux|gitops|slo|sli|runbook|incident|escalation|dockerfile|docker\.?compose|service\.?mesh|istio|envoy)\b/i,
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
    keywords: /\b(unit\.?test|integration\.?test|e2e|end\.?to\.?end|test\.?suite|fixture|mock|stub|spy|assertion|coverage|jest|vitest|pytest|mocha|cypress|playwright|selenium|test\.?driven|tdd|bdd|given\.?when\.?then|snapshot|regression|smoke\.?test|load\.?test|performance\.?test|test\.?data|factory|faker|seeding|test\.?runner|beforeEach|afterEach)\b/i,
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
    keywords: /\b(migration|schema|index|query\.?optimization|foreign\.?key|constraint|transaction|deadlock|replication|sharding|partition|stored\.?procedure|trigger|view|materialized|postgres|mysql|mongodb|redis|cassandra|dynamodb|supabase|prisma|alembic|flyway|liquibase|orm|explain\.?plan|query\.?plan|rollback\.?migration|seed\.?data|database\.?design|erd|entity\.?relationship)\b/i,
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
    keywords: /\b(endpoint|endpoints|restful|crud|payload|openapi|swagger|rest|graphql|grpc|webhook|rate\.?limit|authentication|authorization|oauth|jwt|api\.?key|versioning|breaking\.?change|idempotent|pagination|cursor|response\.?code|status\.?code|contract|schema\.?validation|json\.?schema|content\.?type|api\.?first|consumer\.?driven|api\.?gateway|graphql\.?schema|resolver)\b/i,
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

function detectSkillDomain(fileName: string, text: string, target: 'claude' | 'codex' = 'claude') {
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
    const rawCount =
      (combined.match(new RegExp(baseKeywords.source, 'gi')) || []).length +
      (extraKeywords ? (combined.match(new RegExp(extraKeywords.source, 'gi')) || []).length : 0);
    const density = (rawCount * 1000) / wordCount;
    return { domain: d, score: rawCount, density };
  }).filter(r => r.score > 0).sort((a, b) => b.density - a.density);

  const MIN_RAW = 3;
  const MIN_DENSITY = 1.5;
  if (scores.length > 0 && scores[0].score >= MIN_RAW && scores[0].density >= MIN_DENSITY) {
    return scores[0].domain;
  }
  return null;
}

function profileDocument(file: File, extractedText: string, extractionWarning?: string) {
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
    'data_science', 'pr_communications'];
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

function sampleLargeDocument(text: string, charCap: number): string {
  if (text.length <= charCap) return text;
  const chunkSize = Math.floor(charCap / 3);
  const start = text.slice(0, chunkSize);
  const middleStart = Math.floor(text.length / 2) - Math.floor(chunkSize / 2);
  const middle = text.slice(middleStart, middleStart + chunkSize);
  const end = text.slice(text.length - chunkSize);
  return start + '\n\n...[content continues]...\n\n' + middle + '\n\n...[content continues]...\n\n' + end;
}

function distillForCodex(text: string, charCap: number): string {
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

function isGenericCodexDescription(desc: string, nameHint?: string): boolean {
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

function validateCodexDescription(desc: string): boolean {
  if (!desc || desc.trim().length < 20) return false;
  if (isGenericCodexDescription(desc)) return false;
  const d = desc.toLowerCase();
  const GENERIC = ['helps with', 'assists with', 'applies expertise', 'supports tasks', 'applies to ', 'provides assistance', 'general purpose'];
  if (GENERIC.some(p => d.includes(p))) return false;
  return /\b(refactor|migrate|review|deploy|execute|generate|create|fix|build|run|analyze|extract|check|validate|enforce|when (you|i|the user|codex)|set up|configure|implement|debug)\b/i.test(desc);
}

function formatCodexDisplayName(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function validateCodexSkillReadiness(normalizedMd: string): 'ready' | 'degraded' | 'invalid' {
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

function sanitizeYamlValue(val: string): string {
  if (/[&:#|>!?*{}[\],@`]/.test(val) || val.includes('"')) {
    return '"' + val.replace(/"/g, '\\"') + '"';
  }
  return val;
}

function generateFallbackSkill(rawText: string, fileName: string, category: string): string {
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
    .map(l => l.replace(/^[-â€¢*\d.)\s]+/, '').trim())
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

function fixAiYamlFrontmatter(content: string): string {
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
          const fixed = items.split(',').map((item: string) => {
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

async function enrichWithAI(rawText: string, category: string, fileName: string, template: string = 'A', richFormats: string[] = [], charCap: number = 3500, sizeClass: string = 'small', target: 'claude' | 'codex' = 'claude', sessionId?: string): Promise<string | { content: string; degraded: boolean }> {
  // v2.4: shared Codex error stub - used at every point where Claude would fall through
  // to generateFallbackSkill(). Returns { content, degraded: true } so parseFile surfaces
  // the degraded warning. Structurally valid for Codex CLI; not enriched content.
  const codexErrorStub = (desc: string): { content: string; degraded: true } => {
    const s = fileName.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-skill';
    return { content: `---\nname: ${s}\ndescription: "${desc}"\n---\n\n## When to Activate\n### Must Use\n- Retry generation with a cleaner source document\n### Recommended\n- Review source document for sufficient signal\n### Skip\n- Using this artifact as-is without regenerating\n\n## Key Principles\n- This artifact was not generated successfully - regenerate before use.`, degraded: true };
  };

  if (!rawText || rawText.trim().length < 20) {
    if (target === 'codex') return codexErrorStub('Insufficient source content. Provide a longer document and regenerate.');
    return generateFallbackSkill(rawText || '', fileName, category);
  }

  try {
    // v2.3: pass target to detectSkillDomain so Codex path searches CODEX_NATIVE_DOMAINS too.
    // profileDocument and generateFallbackSkill still call detectSkillDomain without target
    // (Claude default) - their behavior is unchanged.
    const detectedDomain = detectSkillDomain(fileName, rawText, target);

    // v2.3: look up Codex-specific role/frame overrides from CODEX_DOMAIN_SUPPLEMENTS.
    // For CODEX_NATIVE_DOMAINS hits, supplement is undefined - their role/frame are already
    // Codex-oriented, so the fallback to detectedDomain?.role is correct in that case.
    const supplement = detectedDomain ? CODEX_DOMAIN_SUPPLEMENTS[(detectedDomain as any).id] : undefined;

    // v2.2: derive codexShape from detected domain (explicit override) or fall back to
    // template-mapped default. Only sent when target === 'codex' - backend defaults to
    // 'execute' if absent, so omitting on Claude requests preserves the existing contract.
    const codexShape = target === 'codex'
      ? ((detectedDomain as any)?.codexShape || templateToShape((detectedDomain as any)?.template))
      : undefined;

    const token = _getToken ? await _getToken() : null;
    const response = await fetch(ENRICH_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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
      }),
    });

    if (response.status === 422) {
      if (target === 'codex') return codexErrorStub('Source content did not contain enough operational signal. Provide a richer document and regenerate.');
      return generateFallbackSkill(rawText, fileName, category);
    }

    if (response.status === 429) {
      const errData = await response.json().catch(() => ({}));
      const quotaErr = new Error('QUOTA_REACHED');
      (quotaErr as any).isQuotaError = true;
      (quotaErr as any).limitType = errData.limitType || 'daily';
      (quotaErr as any).weeklyCount = errData.weeklyCount ?? 0;
      throw quotaErr;
    }

    if (!response.ok) {
      if (target === 'codex') return codexErrorStub('Skill generation encountered an error. Review source and regenerate.');
      return generateFallbackSkill(rawText, fileName, category);
    }

    const data = await response.json();
    if (!data.enriched) {
      if (target === 'codex') return codexErrorStub('Skill generation encountered an error. Review source and regenerate.');
      return generateFallbackSkill(rawText, fileName, category);
    }

    // v2.4: When the backend used the deterministic fallback assembler, surface a degraded
    // signal to parseFile so it can attach a warning to the file card.
    // The artifact itself is structurally valid and renderable - this only adds a notice.
    if (data.model === 'deterministic-fallback' && target === 'codex') {
      return { content: fixAiYamlFrontmatter(data.enriched), degraded: true };
    }

    return fixAiYamlFrontmatter(data.enriched);
  } catch (err) {
    // Quota errors must bubble up to handleFiles — do not swallow them here.
    if ((err as any)?.isQuotaError) throw err;
    if (target === 'codex') return codexErrorStub('Skill generation encountered an error. Review source and regenerate.');
    return generateFallbackSkill(rawText, fileName, category);
  }
}

async function parseFile(file: File, target: 'claude' | 'codex' = 'claude', sessionId?: string): Promise<UploadedFile> {
  const traceId = `ingest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const precheck = validateInputFile(file);
  if (!precheck.ok) throw new Error(precheck.reason || 'Invalid file');

  const type = detectFileType(file);
  const extracted = await extractText(file, type);

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

  const category = inferCategory(file, extracted.text);
  const profile = profileDocument(file, extracted.text, extracted.warnings.join(' '));

  if (profile.template === 'REJECT') {
    throw new Error(profile.rejectReason || 'This file type cannot be processed.');
  }

  const textForEnrichment = target === 'codex'
    ? distillForCodex(extracted.text, profile.charCap)
    : profile.sizeClass === 'large'
      ? sampleLargeDocument(extracted.text, profile.charCap)
      : extracted.text;

  // v2.4: enrichWithAI returns string on success or { content, degraded: true } when the
  // backend used the deterministic Codex fallback assembler. Unpack here - content is always
  // a string, degraded flag triggers a user-visible warning on the file card.
  const enrichResult = await enrichWithAI(
    textForEnrichment,
    category,
    file.name,
    profile.template,
    profile.richFormats,
    profile.charCap,
    profile.sizeClass,
    target,
    sessionId
  );
  const content = typeof enrichResult === 'string' ? enrichResult : (enrichResult as any).content;
  const isDegraded = typeof enrichResult !== 'string' && (enrichResult as any).degraded === true;
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
  };
}

const PRIORITY_ORDER: FileCategory[] = ['instructions', 'personality', 'preferences', 'context', 'knowledge', 'examples'];
const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'Always active',
  medium: 'When relevant',
  low: 'Background',
};
const CATEGORY_TOOLTIPS: Record<FileCategory, string> = {
  instructions: 'Rules Claude must always follow',
  personality: 'How Claude should sound and communicate',
  preferences: 'Your personal settings and formatting choices',
  context: 'Background info Claude should always keep in mind',
  knowledge: 'Facts, data, or reference material to draw from',
  examples: 'Sample outputs or templates to follow',
};
const SAMPLE_FILE_NAME = 'sample-brand-guidelines.txt';
const SAMPLE_FILE_CONTENT = `Brand voice:
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
const SPLITFORMS_ENDPOINT = ((import.meta.env.VITE_SPLITFORMS_ENDPOINT as string | undefined)?.trim() || 'https://splitforms.com/api/submit');
const SPLITFORMS_ACCESS_KEY = ((import.meta.env.VITE_SPLITFORMS_ACCESS_KEY as string | undefined)?.trim() || 'f277a53be64748cc802c0de0c130951f');
const WAITLIST_CHECK_URL = 'https://claudly-proxy.vercel.app/api/waitlist-check';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Waitlist popup: how long after a real download click to interrupt with the join prompt.
const WAITLIST_POPUP_DELAY_MS = 6000;
const WAITLIST_STATUS_KEY = 'relatch_waitlist_status';
type WaitlistStatus = 'joined' | 'dismissed' | null;

// 'joined' vs 'dismissed' are tracked separately (not one boolean) because they answer two
// different questions: both suppress the auto-popup, but only 'joined' hides the footer fallback link.
function getWaitlistStatus(): WaitlistStatus {
  try { return localStorage.getItem(WAITLIST_STATUS_KEY) as WaitlistStatus; } catch { return null; }
}
function persistWaitlistStatus(status: 'joined' | 'dismissed') {
  try { localStorage.setItem(WAITLIST_STATUS_KEY, status); } catch { /* storage unavailable, non-fatal */ }
}

function toSkillSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 60) || 'my-skill';
}

function makeSampleUploadedFile(): UploadedFile {
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

function getSkillSizeLabel(tokens: number): string {
  if (tokens < 1500) return 'Light skill';
  if (tokens < 4000) return 'Standard skill';
  return 'Heavy skill';
}

function AnimatedSection({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { threshold: 0.08 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const PROCESSING_MESSAGES = [
  'Categorizing your document...',
  'Parsing your document...',
  'Building logic flows...',
  'Enriching your skill file...',
  'Cleaning up the errors...',
];

function FileUploadZone({ files, onFilesAdded, onRemoveFile, onSampleLoad, target, onQuotaReached, quotaLocked, onLockedClick }: { files: UploadedFile[]; onFilesAdded: (f: UploadedFile[]) => void; onRemoveFile: (id: string) => void; onSampleLoad: () => void; target: 'claude' | 'codex'; onQuotaReached: (info: { limitType: 'daily' | 'weekly'; weeklyCount: number }) => void; quotaLocked: boolean; onLockedClick: () => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusIdx, setStatusIdx] = useState(0);
  useEffect(() => {
    if (!isProcessing) { setStatusIdx(0); return; }
    const id = setInterval(() => setStatusIdx(i => (i + 1) % PROCESSING_MESSAGES.length), 1800);
    return () => clearInterval(id);
  }, [isProcessing]);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    setIsProcessing(true); setError(null);

    const remaining = 3 - files.length;
    if (remaining <= 0) {
      setError('Maximum 3 files allowed. Remove a file before adding more.');
      setIsProcessing(false);
      return;
    }

    const allFiles = Array.from(fileList).slice(0, remaining).filter(file => {
      const validation = validateInputFile(file);
      if (!validation.ok) {
        setError(`Skipped ${file.name}: ${validation.reason}`);
        return false;
      }
      return true;
    });

    if (Array.from(fileList).length > remaining) {
      setError(`Only ${remaining} more file${remaining === 1 ? '' : 's'} allowed. First ${remaining} selected.`);
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const results = await Promise.allSettled(allFiles.map(file => parseFile(file, target, sessionId)));
    const parsed: UploadedFile[] = [];
    const errors: string[] = [];
    let quotaInfo: { limitType: 'daily' | 'weekly'; weeklyCount: number } | null = null;

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        parsed.push(result.value);
      } else {
        const err = result.reason;
        if ((err as any)?.isQuotaError) {
          if (!quotaInfo) quotaInfo = { limitType: (err as any).limitType || 'daily', weeklyCount: (err as any).weeklyCount ?? 0 };
        } else {
          errors.push(`${allFiles[i].name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    });
    if (parsed.length > 0) onFilesAdded(parsed);
    if (errors.length > 0) setError(errors.join(' | '));
    if (quotaInfo) onQuotaReached(quotaInfo);
    setIsProcessing(false);
  }, [onFilesAdded, files.length, target, onQuotaReached]);

  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files); }, [handleFiles]);

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    if (['js', 'ts', 'py', 'rb', 'go', 'rs'].includes(ext || '')) return <Code className="w-4 h-4" />;
    if (['json', 'yaml', 'yml', 'csv', 'toml'].includes(ext || '')) return <Database className="w-4 h-4" />;
    if (['html', 'htm', 'xml'].includes(ext || '')) return <Globe className="w-4 h-4" />;
    return <FileText className="w-4 h-4" />;
  };

  const catStyles: Record<string, string> = {
    personality: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    knowledge: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    instructions: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    examples: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    context: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    preferences: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  };

  return (
    <div className="space-y-6">
      <AnimatedSection>
        <div
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleDrop(e); }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          className={`relative rounded-2xl p-10 text-center transition-all duration-500 group overflow-hidden ${isDragging ? 'border-2 border-blue-500 bg-blue-500/[0.06] scale-[1.01]' : 'border-2 border-dashed border-white/[0.08] hover:border-white/[0.15] bg-white/[0.015]'} ${files.length >= 3 ? 'opacity-50 pointer-events-none cursor-not-allowed' : quotaLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={() => { if (quotaLocked) { onLockedClick(); return; } if (files.length < 3) document.getElementById('file-input')?.click(); }}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.04] via-transparent to-blue-600/[0.02]" />
          </div>
          <input id="file-input" type="file" multiple accept=".txt,.md,.pdf,.doc,.docx,.html,.htm,.xml,.json,.yaml,.yml,.csv,.toml,.js,.ts,.py,.rb,.go,.rs,.log" className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          <div className={`relative z-10 transition-all duration-500 ${isProcessing ? 'blur-md' : 'blur-0'}`}>
            <div className={`w-14 h-14 mx-auto mb-5 rounded-2xl flex items-center justify-center transition-all duration-500 ${isDragging ? 'bg-blue-500/20 scale-110 rotate-6' : 'bg-white/[0.04] border border-white/[0.06] group-hover:bg-white/[0.06]'}`}>
              <Upload className={`w-6 h-6 transition-all duration-300 ${isDragging ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-300'}`} />
            </div>
            <h3 className="text-base font-semibold text-white mb-1.5">{isProcessing ? 'Reading your files...' : isDragging ? 'Drop to upload' : 'Drop your files to get started'}</h3>
            <p className="text-sm text-gray-400 mb-2">
              Drop the documents that define how you work.
            </p>
            <p className="text-sm text-gray-500 mb-5">Guidelines, notes, examples, writing samples, anything! Up to 3 files.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {Object.entries(ACCEPTED_TYPES).map(([label, exts]) => (
                <span key={label} className="px-2.5 py-1 text-[11px] rounded-lg bg-white/[0.03] text-gray-500 border border-white/[0.05] font-medium">
                  {label} <span className="text-gray-600">({exts.slice(0, 3).join(', ')})</span>
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSampleLoad(); }}
              className="mt-4 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-4"
            >
              See it in action with a sample file →
            </button>
          </div>
          {isProcessing && (
            <div className="absolute inset-0 rounded-2xl bg-[#050a12]/90 flex items-center justify-center backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 text-blue-400">
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Reading your files...</span>
                <span key={statusIdx} className="text-xs text-gray-500 processing-msg-in">{PROCESSING_MESSAGES[statusIdx]}</span>
              </div>
            </div>
          )}
        </div>
      </AnimatedSection>

      {error && (
        <AnimatedSection>
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /><span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
          </div>
        </AnimatedSection>
      )}

      {files.length > 0 && (
        <AnimatedSection delay={100}>
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <h4 className="text-sm font-medium text-white">{files.length} file{files.length !== 1 ? 's' : ''} ready</h4>
              </div>
              <span className="text-xs text-gray-500 font-mono">{formatBytes(files.reduce((s, f) => s + f.size, 0))}</span>
            </div>
            <div className="space-y-1.5">
              {files.map((file, i) => (
                <AnimatedSection key={file.id} delay={i * 50}>
                  <div className="px-4 py-3 rounded-xl bg-white/[0.025] border border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.08] transition-all duration-200 group/item">
                    <div className="flex items-center gap-3">
                      <div className="text-gray-500">{getFileIcon(file.name)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-200 truncate">{file.name}</p>
                        <p className="text-[11px] text-gray-600 font-mono">{formatBytes(file.size)}</p>
                      </div>
                      <span className={`px-2 py-0.5 text-[11px] rounded-md border font-medium ${catStyles[file.category] || 'text-gray-400 bg-gray-500/10 border-gray-500/20'}`}>{file.category}</span>
                      <button onClick={(e) => { e.stopPropagation(); onRemoveFile(file.id); }} className="opacity-0 group-hover/item:opacity-100 p-1 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    {file.extractionWarning && (
                      <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300 bg-amber-500/[0.08] border border-amber-500/20 rounded-lg px-2.5 py-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{file.extractionWarning}</span>
                      </div>
                    )}
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </AnimatedSection>
      )}
    </div>
  );
}

const CATEGORIES: { key: FileCategory; label: string; icon: React.ReactNode; color: string; desc: string }[] = [
  { key: 'instructions', label: 'Instructions', icon: <ListChecks className="w-4 h-4" />, color: 'amber', desc: 'Rules & behavioral guidelines' },
  { key: 'personality', label: 'Personality', icon: <Brain className="w-4 h-4" />, color: 'violet', desc: 'Tone, style & communication' },
  { key: 'preferences', label: 'Preferences', icon: <Settings className="w-4 h-4" />, color: 'rose', desc: 'User preferences & settings' },
  { key: 'context', label: 'Context', icon: <Layers className="w-4 h-4" />, color: 'cyan', desc: 'Background information' },
  { key: 'knowledge', label: 'Knowledge', icon: <BookOpen className="w-4 h-4" />, color: 'blue', desc: 'Reference data & facts' },
  { key: 'examples', label: 'Examples', icon: <FileCode className="w-4 h-4" />, color: 'emerald', desc: 'Templates & samples' },
];

const colorMap: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  amber: { bg: 'bg-amber-500/[0.04]', border: 'border-amber-500/15', text: 'text-amber-400', badge: 'bg-amber-500/15' },
  violet: { bg: 'bg-violet-500/[0.04]', border: 'border-violet-500/15', text: 'text-violet-400', badge: 'bg-violet-500/15' },
  rose: { bg: 'bg-rose-500/[0.04]', border: 'border-rose-500/15', text: 'text-rose-400', badge: 'bg-rose-500/15' },
  cyan: { bg: 'bg-cyan-500/[0.04]', border: 'border-cyan-500/15', text: 'text-cyan-400', badge: 'bg-cyan-500/15' },
  blue: { bg: 'bg-blue-500/[0.04]', border: 'border-blue-500/15', text: 'text-blue-400', badge: 'bg-blue-500/15' },
  emerald: { bg: 'bg-emerald-500/[0.04]', border: 'border-emerald-500/15', text: 'text-emerald-400', badge: 'bg-emerald-500/15' },
};

function FileOrganizer({ files, onUpdateCategory }: { files: UploadedFile[]; onUpdateCategory: (id: string, cat: FileCategory) => void }) {
  const grouped = CATEGORIES.map(cat => ({ ...cat, files: files.filter(f => f.category === cat.key) }));
  const sectionCount = grouped.filter(g => g.files.length > 0).length;

  return (
    <div className="space-y-6">
      <AnimatedSection>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Files', value: files.length.toString(), color: 'text-white' },
            { label: 'Sections Used', value: sectionCount.toString(), color: 'text-blue-400' },
          ].map(stat => (
            <div key={stat.label} className="px-4 py-3.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-1">{stat.label}</p>
              <p className={`text-xl font-bold ${stat.color} font-mono`}>{stat.value}</p>
            </div>
          ))}
        </div>
      </AnimatedSection>
      <AnimatedSection delay={80}>
        <p className="text-sm text-gray-500">Files are auto-categorized. Use the dropdown to reassign any file to a different category.</p>
      </AnimatedSection>
      <div className="space-y-3">
        {grouped.map(({ key, label, icon, color, desc, files: catFiles }, catIndex) => {
          const colors = colorMap[color];
          return (
            <AnimatedSection key={key} delay={(catIndex + 2) * 80}>
              <div className={`rounded-xl border overflow-hidden transition-all duration-300 ${catFiles.length > 0 ? `${colors.border} ${colors.bg}` : 'border-white/[0.04] bg-white/[0.01]'}`}>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04]">
                  <span className={colors.text}>{icon}</span>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-white inline-flex items-center gap-1.5" title={CATEGORY_TOOLTIPS[key]}>
                      {label}<span className="text-[10px] text-gray-600">?</span>
                    </h4>
                    <p className="text-[11px] text-gray-500">{desc}</p>
                  </div>
                  <span className={`px-2 py-0.5 text-[11px] rounded-md font-bold ${colors.badge} ${colors.text}`}>{catFiles.length}</span>
                </div>
                {catFiles.length > 0 ? (
                  <div className="divide-y divide-white/[0.03]">
                    {catFiles.map(file => (
                      <div key={file.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-200 truncate">{file.name}</p>
                          <p className="text-[11px] text-gray-600 font-mono">{formatBytes(file.size)}</p>
                        </div>
                        <div className="relative">
                          <select value={file.category} onChange={(e) => onUpdateCategory(file.id, e.target.value as FileCategory)} className="appearance-none bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 pr-7 text-xs text-gray-300 cursor-pointer hover:bg-white/[0.08] focus:ring-1 focus:ring-blue-500/40 transition-colors">
                            {CATEGORIES.map(cat => (
                              <option
                                key={cat.key}
                                value={cat.key}
                                style={{ backgroundColor: '#0d1117', color: '#e5e7eb' }}
                              >
                                {cat.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-5 text-center"><p className="text-[11px] text-gray-600">No files assigned</p></div>
                )}
              </div>
            </AnimatedSection>
          );
        })}
      </div>
    </div>
  );
}

const CATEGORY_META: Record<FileCategory, { icon: React.ReactNode; color: string }> = {
  instructions: { icon: <ListChecks className="w-4 h-4" />, color: 'amber' },
  personality: { icon: <Brain className="w-4 h-4" />, color: 'violet' },
  preferences: { icon: <Settings className="w-4 h-4" />, color: 'rose' },
  context: { icon: <Layers className="w-4 h-4" />, color: 'cyan' },
  knowledge: { icon: <BookOpen className="w-4 h-4" />, color: 'blue' },
  examples: { icon: <FileCode className="w-4 h-4" />, color: 'emerald' },
};

function SkillConfigurator({ config, files, onUpdateConfig }: { config: SkillConfig; files: UploadedFile[]; onUpdateConfig: (c: SkillConfig) => void }) {
  const updateField = (field: keyof SkillConfig, value: string) => onUpdateConfig({ ...config, [field]: value });
  const toggleCategory = (cat: FileCategory) => onUpdateConfig({ ...config, categories: { ...config.categories, [cat]: { ...config.categories[cat], enabled: !config.categories[cat].enabled } } });
  const updatePriority = (cat: FileCategory, priority: Priority) => onUpdateConfig({ ...config, categories: { ...config.categories, [cat]: { ...config.categories[cat], priority } } });
  const fileCounts = Object.fromEntries((Object.keys(config.categories) as FileCategory[]).map(c => [c, files.filter(f => f.category === c).length]));
  const slug = toSkillSlug(config.skillName);
  const isValidName = config.skillName.trim().length > 0;

  const nameSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    nameSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className={config.target === 'codex' ? 'space-y-10' : 'space-y-6'}>
      <AnimatedSection>
        <div ref={nameSectionRef} className="p-6 rounded-2xl bg-white/[0.025] border border-white/[0.06]">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><Tag className="w-4 h-4 text-blue-400" /></div>
            <div><h3 className="text-sm font-semibold text-white">Name your skill</h3><p className="text-[11px] text-gray-500">{config.target === 'codex' ? 'Give your skill a name. This becomes the folder slug in your Codex skills directory.' : 'Give your skill a name. This is how Claude will remember it.'}</p></div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Skill Name <span className="text-red-400">*</span></label>
            <input type="text" value={config.skillName} onChange={(e) => updateField('skillName', e.target.value)} placeholder="e.g., My Personal Assistant" className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/40 transition-all text-sm outline-none" />
            <p className="mt-2 text-[11px] text-gray-500">{config.target === 'codex' ? 'Your skill folder will be named after this slug. Copy it into .agents/skills/ in your repo.' : 'Your skill will be saved as a .md file. Drop it straight into Claude Projects.'}</p>
            {isValidName && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] text-gray-500">{config.target === 'codex' ? 'Folder:' : 'Filename:'}</span>
                <code className="text-[11px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md font-mono border border-blue-500/15">{config.target === 'codex' ? `${slug}/SKILL.md` : `${slug}.md`}</code>
              </div>
            )}
            {config.skillName.trim() && !/^[a-z0-9\s-]+$/i.test(config.skillName) && (
              <div className="mt-2 flex items-center gap-1.5 text-amber-400"><AlertCircle className="w-3 h-3" /><span className="text-[11px]">Special characters will be removed from the filename</span></div>
            )}
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection delay={100}>
        <div className="p-6 rounded-2xl bg-white/[0.025] border border-white/[0.06]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><MessageSquare className="w-4 h-4 text-blue-400" /></div>
            <div><h3 className="text-sm font-semibold text-white">{config.target === 'codex' ? 'Anything Codex should always follow?' : 'Anything Claude should always remember?'}</h3><p className="text-[11px] text-gray-500">{config.target === 'codex' ? 'Rules and context injected into your Codex skill as highest-priority instructions' : 'Rules, quirks, preferences you didn\'t upload - type them here directly'}</p></div>
          </div>
          <textarea value={config.customNotes} onChange={(e) => updateField('customNotes', e.target.value)} placeholder={config.target === 'codex' ? "Rules Codex should always apply when this skill is active...\n\nExamples:\n- Always check for existing tests before adding new ones\n- Never modify package.json without confirmation\n- Use the project's existing error handling pattern\n- Default to TypeScript strict mode" : "Anything you'd tell a new assistant on their first day...\n\nExamples:\n- Keep the tone sharp and direct. Skip the corporate speak.\n- I work in TypeScript, always default to that\n- My company is Acme. Never call it \"your company.\"\n- Keep responses short unless I explicitly ask for detail"} rows={config.target === 'codex' ? 7 : 5} className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/40 transition-all resize-none text-sm leading-relaxed outline-none" />
          <p className="mt-2 text-[11px] text-gray-600">These go at the top of your {config.target === 'codex' ? 'Codex skill file' : 'skill file'} as the highest-priority instructions.</p>
        </div>
      </AnimatedSection>

      {config.target !== 'codex' && (
        <AnimatedSection delay={200}>
          <div className="p-6 rounded-2xl bg-white/[0.025] border border-white/[0.06]">
            <h3 className="text-sm font-semibold text-white mb-1">What goes into your skill</h3>
            <p className="text-[11px] text-gray-500 mb-5">Only include what's relevant. You can always add more later.</p>
            <div className="space-y-2">
              {(Object.entries(config.categories) as [FileCategory, CategoryConfig][]).map(([key, cat], idx) => {
                const meta = CATEGORY_META[key];
                const count = fileCounts[key] || 0;
                return (
                  <AnimatedSection key={key} delay={(idx + 4) * 60}>
                    <div className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 rounded-xl border transition-all duration-200 ${cat.enabled ? 'bg-white/[0.025] border-white/[0.06]' : 'bg-white/[0.008] border-white/[0.03] opacity-40'}`}>
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <button onClick={() => toggleCategory(key)} className={`relative w-9 h-5 rounded-full transition-all duration-300 shrink-0 ${cat.enabled ? 'bg-blue-500' : 'bg-white/[0.08]'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${cat.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                        <span className={`text-${meta.color}-400 shrink-0`}>{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2"><span className="text-sm font-medium text-white">{cat.label}</span>{count > 0 && <span className="text-[11px] text-gray-500 font-mono">{count}</span>}</div>
                          <p className="text-[11px] text-gray-600">{cat.description}</p>
                        </div>
                      </div>
                      {cat.enabled && (
                        <div className="flex flex-wrap gap-1 pl-12 sm:pl-0 sm:justify-end">
                          {(['high', 'medium', 'low'] as const).map(p => (
                            <button key={p} onClick={() => updatePriority(key, p)} className={`px-2 py-1 text-[11px] rounded-lg font-medium transition-all ${cat.priority === p ? (p === 'high' ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/25' : p === 'medium' ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25' : 'bg-gray-500/15 text-gray-400 ring-1 ring-gray-500/25') : 'text-gray-600 hover:text-gray-400'}`}>{PRIORITY_LABELS[p]}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </AnimatedSection>
                );
              })}
            </div>
          </div>
        </AnimatedSection>
      )}
    </div>
  );
}

function SkillOutput({ files, config, videoSeenSignature, setVideoSeenSignature, waitlistStatus, setWaitlistStatus, showWaitlistPopup, setShowWaitlistPopup }: { files: UploadedFile[]; config: SkillConfig; videoSeenSignature: string | null; setVideoSeenSignature: (s: string | null) => void; waitlistStatus: WaitlistStatus; setWaitlistStatus: (s: WaitlistStatus) => void; showWaitlistPopup: boolean; setShowWaitlistPopup: (v: boolean) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState(0);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);
  const [waitlistAlreadyJoined, setWaitlistAlreadyJoined] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedSkill[] | null>(null);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  useEffect(() => { setActiveFile(0); }, [generatedFiles]);
  const [codexExportError, setCodexExportError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const videoSectionRef = useRef<HTMLDivElement>(null);
  const prevVideoVisibleRef = useRef<boolean | null>(null);

  // Deterministic content fingerprint of the currently generated files. Used to
  // decide whether the user has already seen the video-guide reveal for THIS
  // exact file. Same files + same config (Backâ†’Forward with no edits) â†’ same
  // signature â†’ video stays visible. Any change (skill name, custom notes,
  // categories, target) â†’ different signature â†’ flow resets to first-time UX.
  const currentSignature = useMemo(() => {
    if (!generatedFiles || generatedFiles.length === 0) return null;
    return JSON.stringify({ t: config.target, f: generatedFiles.map(g => [g.filename, g.content]) });
  }, [generatedFiles, config.target, config.categories]);

  const videoVisible = currentSignature !== null && currentSignature === videoSeenSignature;

  // Warm the setup-guide video into browser cache the moment Step 5 is reachable
  // (generation completed). By the time the user clicks Download, the file is
  // already fetched and the <video> element below starts playing immediately.
  useEffect(() => {
    if (!generatedFiles || generatedFiles.length === 0) return;
    const src = config.target === 'codex' ? '/videos/codex-setup.mp4' : '/videos/claude-setup.mp4';
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'video';
    link.href = src;
    document.head.appendChild(link);
    return () => { if (link.parentNode) link.parentNode.removeChild(link); };
  }, [generatedFiles, config.target]);

  // Remount guard: if videoVisible is already true on mount (persisted signature),
  // reveal immediately without animation or scroll.
  useEffect(() => {
    if (videoVisible && prevVideoVisibleRef.current === null) {
      const el = videoSectionRef.current;
      if (el) {
        el.setAttribute('data-reveal', 'true');
        el.style.animation = 'none';
        el.style.opacity = '1';
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only

  // Smooth-scroll the video guide into view only on the falseâ†’true transition
  // (i.e. the user just clicked Download). Returning to Step 5 with the video
  // already revealed must NOT auto-scroll - they should land where they left.
  useEffect(() => {
    const prev = prevVideoVisibleRef.current;
    prevVideoVisibleRef.current = videoVisible;
    if (prev === null) return; // first render in this mount - no transition
    if (videoVisible && !prev) {
      // Phase 1: scroll the video section into view immediately (no delay)
      requestAnimationFrame(() => {
        videoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      // Phase 2: trigger the reveal animation only after scroll has settled.
      // smooth-scroll takes ~400â€“600ms; 520ms gives a reliable post-scroll window.
      const revealTimer = setTimeout(() => {
        const el = videoSectionRef.current;
        if (el) el.setAttribute('data-reveal', 'true');
      }, 520);
      return () => clearTimeout(revealTimer);
    }
  }, [videoVisible]);

  // Waitlist popup trigger, deliberately a SEPARATE effect with its OWN ref rather than folded
  // into the video-transition effect above. That effect writes prevVideoVisibleRef.current =
  // videoVisible as its first statement, so by the time any other code reads that same ref it
  // would already see the new value -- a shared ref can never observe a genuine transition twice.
  // Only a real Download click reaches here (videoVisible, same as above; Copy never touches it).
  const prevVideoVisibleForPopupRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevVideoVisibleForPopupRef.current;
    prevVideoVisibleForPopupRef.current = videoVisible;
    if (prev === null) return; // first render in this mount -- no transition
    if (videoVisible && !prev) {
      if (waitlistStatus) return; // already joined or already dismissed -- don't re-interrupt
      const popupTimer = setTimeout(() => setShowWaitlistPopup(true), WAITLIST_POPUP_DELAY_MS);
      return () => clearTimeout(popupTimer);
    }
  }, [videoVisible, waitlistStatus]);

  // useCallback so identity stays stable across the re-renders that happen while typing into the
  // popup's email field (waitlistEmail changes) -- otherwise WaitlistPopup's effects, keyed on
  // onClose, would tear down and re-subscribe (keydown listener, scroll lock, auto-close timer)
  // on every keystroke instead of only when waitlistSuccess itself actually changes.
  const closeWaitlistPopup = useCallback(() => {
    if (!waitlistSuccess) {
      persistWaitlistStatus('dismissed');
      setWaitlistStatus('dismissed');
    }
    setShowWaitlistPopup(false);
  }, [waitlistSuccess, setWaitlistStatus, setShowWaitlistPopup]);

  const LOADING_MESSAGES = [
    'Building your skill file...',
    'Almost there - structuring the final sections...',
  ];

  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => { setLoadingMsgIndex(i => (i + 1) % LOADING_MESSAGES.length); }, 2000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  useEffect(() => {
    let cancelled = false;
    async function generate() {
      setIsGenerating(true); setGenerationError(null); setLoadingMsgIndex(0);
      try {
        const slug = toSkillSlug(config.skillName);
        const results: GeneratedSkill[] = files
          .filter(f => config.target === 'codex' || config.categories[f.category]?.enabled)
          .map(f => {
          const injectCustomNotes = (content: string, notes: string): string => {
                let cleanContent = content.replace(/\r/g, '').trim();
                cleanContent = cleanContent.replace(/^```[a-z]*\n/i, '').replace(/\n```$/, '').trim();

                // Codex target: strip backend frontmatter entirely - buildCodexSkillMd() is the
                // single owner of final Codex frontmatter. Return NOTES + BODY only.
                if (config.target === 'codex') {
                  const notesBlock = (notes && notes.trim())
                    ? '## Custom Instructions\n\n> These instructions take highest priority.\n\n' + notes.trim() + '\n\n'
                    : '';
                  const fmM = cleanContent.match(/---\n[\s\S]*?\n---\n?/);
                  const body = (fmM && fmM.index !== undefined)
                    ? cleanContent.slice(fmM.index + fmM[0].length).trim()
                    : cleanContent.trim();
                  return (notesBlock + body).trim();
                }

               const domainMatch = cleanContent.match(/domain:\s*([^\n]+)/);
        let domain = domainMatch ? domainMatch[1].replace(/^["']+|["']+$/g, '').trim() : "General";
        if (!domain) domain = "General";

        const typeMatch = cleanContent.match(/content_type:\s*([^\n]+)/);
        let contentType = typeMatch ? typeMatch[1].replace(/^["']+|["']+$/g, '').trim() : "behavioral skill";
        if (!contentType) contentType = "behavioral skill";

                let useCases: string[] = ["Professional Communication"];
                const useCasesMatch = cleanContent.match(/use_cases:\s*(\[[^\]]+\]|(\n\s*-\s*[^\n]+)+)/);
                
                if (useCasesMatch) {
                  const rawCases = useCasesMatch[1];
                  if (rawCases.startsWith('[')) {
                    useCases = rawCases.replace(/[\[\]"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
                  } else {
                    useCases = rawCases.split('\n').map(s => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
                  }
                }

                const baseSkillName = config.skillName ? config.skillName.replace(/"/g, '') : "My Custom Skill";
                const fileSlug = f.name
                  .replace(/\.[^/.]+$/, '')
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .slice(0, 24);
                const activeFileCount = files.filter(x => config.categories[x.category]?.enabled).length;
                const safeSkillName = activeFileCount > 1
                  ? `${baseSkillName}-${fileSlug}`
                  : baseSkillName;

                let frontmatter = `---\n`;
                frontmatter += `name: "${safeSkillName}"\n`;
                frontmatter += `domain: "${domain}"\n`;
                frontmatter += `content_type: "${contentType}"\n`;
                frontmatter += `priority: "${config.categories[f.category]?.priority ?? 'medium'}"\n`;
                frontmatter += `use_cases:\n`;
                useCases.forEach(uc => {
                  frontmatter += `  - "${uc}"\n`;
                });
                frontmatter += `---`;

                let body = cleanContent;
                const yamlRegex = /---\n[\s\S]*?\n---/;
                const oldYamlMatch = cleanContent.match(yamlRegex);
                if (oldYamlMatch) {
                  body = cleanContent.slice(cleanContent.indexOf(oldYamlMatch[0]) + oldYamlMatch[0].length).trim();
                }

                // Residual FM guard: if a second (possibly unclosed) frontmatter block survived
                // the first strip - e.g. when an existing skill file is re-uploaded as source  - 
                // drop everything before the first ## section header.
                if (body.startsWith('---')) {
                  const firstSection = body.search(/^##\s/m);
                  if (firstSection !== -1) body = body.slice(firstSection).trim();
                }

                let finalOutput = frontmatter + '\n\n';

                if (notes && notes.trim()) {
                  finalOutput += '## Custom Instructions\n\n> These instructions take highest priority.\n\n' + notes.trim() + '\n\n';
                }

                finalOutput += body;
                
                return finalOutput.trim();
              };
            // Capture backend Codex frontmatter BEFORE injectCustomNotes strips it.
            let codexMeta: CodexMeta | undefined;
            if (config.target === 'codex') {
              const raw = (f.content || '').replace(/\r/g, '').trim();
              const fmM = raw.match(/---\n([\s\S]*?)\n---/);
              if (fmM) {
                const nM = fmM[1].match(/^name:\s*"?([\s\S]*?)"?\s*$/m);
                let dM = fmM[1].match(/^description:\s*(.+)$/m);
                if (!dM) {
                  const blockMatch = fmM[1].match(/^description:\s*([\s\S]*?)(?=\n\S|\s*$)/m);
                  if (blockMatch) dM = blockMatch;
                }
                const n = nM ? nM[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
                const d = dM
                  ? dM[1]
                      .replace(/^["']|["']$/g, '')
                      .replace(/\\"/g, '"')
                      .replace(/\\\\/g, '\\')
                      .replace(/\n/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim()
                  : '';
                const fileSlugHint = f.name
                  .replace(/\.[^/.]+$/, '')
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .slice(0, 24);
                codexMeta = {
                  name: n || undefined,
                  description: d || undefined,
                  descriptionSource: d
                    ? (isGenericCodexDescription(d, n || fileSlugHint) ? 'backend_placeholder' : 'model')
                    : 'missing',
                };
              }
            }
            const finalContent = injectCustomNotes(f.content, config.customNotes ?? '');
            // Disambiguate filenames in multi-file sessions to prevent collisions when
            // inferCategory() routes multiple files to the same category.
            const fileSlug = f.name
              .replace(/\.[^/.]+$/, '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .slice(0, 24);
            const activeFileCount = files.filter(x => config.categories[x.category]?.enabled).length;
            const disambiguatedSlug = fileSlug.startsWith(slug + '-')
              ? fileSlug.slice(slug.length + 1)
              : fileSlug;
            // Multi-file: drop the category infix from the filename. Category is
            // implicit in the skill's organization - the filename should read as a
            // clean skill component (e.g. "fusion-finance.md"), not an internal tag.
            // Single-file path preserves `${slug}-${category}.md` byte-identically.
            const filename = activeFileCount > 1 && disambiguatedSlug
              ? `${slug}-${disambiguatedSlug}.md`
              : `${slug}-${f.category}.md`;
            return {
              filename,
              content: finalContent,
              category: f.category,
              tokenEstimate: estimateTokens(finalContent),
              codexMeta,
            };
          });
        if (!cancelled) setGeneratedFiles(results);
      } catch (err) {
        if (!cancelled) setGenerationError(err instanceof Error ? err.message : 'Generation failed');
      } finally {
        if (!cancelled) setIsGenerating(false);
      }
    }
    generate();
    return () => { cancelled = true; };
  }, [files, config]);

  const singleFile = useMemo(() => generatedFiles ? generatedFiles.map(f => f.content).join('\n\n---\n\n') : '', [generatedFiles]);
  const totalTokens = generatedFiles ? generatedFiles.reduce((s, f) => s + f.tokenEstimate, 0) : 0;
  const sizeLabel = getSkillSizeLabel(totalTokens);
  const sectionSummary = useMemo(() => PRIORITY_ORDER.map((category) => ({ category, label: config.categories[category].label, count: files.filter((f) => config.categories[category]?.enabled && f.category === category).length })).filter((entry) => entry.count > 0), [files, config]);

  const handleCopy = async (content: string, id: string) => {
    try { await navigator.clipboard.writeText(content); } catch {
      const ta = document.createElement('textarea'); ta.value = content; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(id); setTimeout(() => setCopied(null), 2500);
  };

 const handleDownloadSingle = (skill: GeneratedSkill) => {
    const blob = new Blob([skill.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = skill.filename; a.click(); URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    if (!generatedFiles) return;
    if (generatedFiles.length === 1) { handleDownloadSingle(generatedFiles[0]); if (currentSignature) setVideoSeenSignature(currentSignature); return; }
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const slug = toSkillSlug(config.skillName);
    // Generate a minimal SKILL.md (name + description only). Do NOT promote any
    // enriched file into this slot - each enriched file keeps its own filename.
    // Extract the domain from each file's frontmatter for the description.
    const domains = [...new Set(generatedFiles.map(f => {
      const m = f.content.match(/^domain:\s*"?([^"\n]+)"?/m);
      return m ? m[1].trim() : f.category;
    }))];
    const domainList = domains.length === 1
      ? domains[0]
      : domains.length === 2
        ? `${domains[0]} and ${domains[1]}`
        : `${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;
    const skillMdContent = `---\nname: "${slug}"\ndescription: "A combined skill integrating ${domainList} across ${generatedFiles.length} source documents."\n---\n`;
    zip.file(`${slug}/SKILL.md`, skillMdContent);
    for (const file of generatedFiles) {
      zip.file(`${slug}/${file.filename}`, file.content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${slug}.zip`; a.click(); URL.revokeObjectURL(url);
    if (currentSignature) setVideoSeenSignature(currentSignature);
  };

  // â”€â”€ Codex assembly helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Parses name + description from a SKILL.md top frontmatter block.
  const extractCodexFm = (md: string): { name: string; description: string } | null => {
    const m = md.match(/---\n([\s\S]*?)\n---/);
    if (!m) return null;
    const nameM = m[1].match(/^name:\s*(.+)$/m);
    if (!nameM) return null;
    let descM = m[1].match(/^description:\s*(.+)$/m);
    if (!descM) {
      const blockMatch = m[1].match(/^description:\s*([\s\S]*?)(?=\n\S|\s*$)/m);
      if (blockMatch) descM = blockMatch;
    }
    const rawDesc = descM
      ? descM[1].replace(/^["']|["']$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    const name = nameM[1].trim().replace(/^["']|["']$/g, '');
    return { name, description: rawDesc };
  };

  const resolveCodexFrontmatter = (f: GeneratedSkill | undefined, fallbackName: string): { name: string; description: string; status: 'ready' | 'degraded' | 'invalid' } => {
    const body = f ? stripCodexFm(f.content).trim() : '';
    const fallbackDesc = `${fallbackName.replace(/[-_]+/g, ' ')} skill.`;
    const meta = f?.codexMeta;

    const name = meta?.name || fallbackName;
    if (!name || !body) {
      return { name: name || fallbackName, description: fallbackDesc, status: 'invalid' };
    }

    if (meta?.description && meta.descriptionSource === 'model') {
      return { name, description: meta.description, status: 'ready' };
    }

    if (meta?.description) {
      return { name, description: meta.description, status: 'degraded' };
    }

    return { name, description: fallbackDesc, status: 'degraded' };
  };

  // Finds the first ---...--- block anywhere in content, strips it and any preamble before it.
  const stripCodexFm = (md: string): string => {
    const m = md.match(/---\n[\s\S]*?\n---\n?/);
    if (!m || m.index === undefined) return md.trim();
    return md.slice(m.index + m[0].length).trim();
  };

  // Deduplicates exact heading lines (## / ###), keeping first occurrence + its body.
  const dedupeHeadings = (text: string): string => {
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
  };

  const codexSlug = useMemo(() => {
    const raw = (config.skillName || 'my-skill').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return raw || 'my-skill';
  }, [config.skillName]);

  const bestCodexFile = (): GeneratedSkill => {
    if (!generatedFiles || generatedFiles.length === 0) return generatedFiles![0];
    const rank = (src?: CodexDescriptionSource) =>
      src === 'model' ? 0 : src === 'backend_placeholder' ? 1 : src === 'frontend_recovered' ? 2 : 3;
    return [...generatedFiles].sort((a, b) => rank(a.codexMeta?.descriptionSource) - rank(b.codexMeta?.descriptionSource))[0];
  };

  const buildCodexSkillMd = (): string => {
    if (!generatedFiles || generatedFiles.length === 0) return '';
    const slug = codexSlug;
    const resolved = resolveCodexFrontmatter(bestCodexFile(), slug);
    const escDesc = resolved.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const frontmatter = `---\nname: ${resolved.name}\ndescription: "${escDesc}"\n---`;
    const bodies: string[] = [];
    generatedFiles.forEach((f, idx) => {
      const body = stripCodexFm(f.content);
      if (!body) return;
      if (idx === 0) {
        bodies.push(body);
      } else {
        const label = f.filename.replace(/\.md$/, '').replace(/-/g, ' ');
        bodies.push(`## Source Notes: ${label}\n\n${body}`);
      }
    });
    const combined = dedupeHeadings(bodies.join('\n\n'));
    // Strip any stray frontmatter block that leaked to the top of the combined body
    const afterFmStrip = combined.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    // Strip any intro prose before the first ## section (backend occasionally adds preamble text)
    const firstHeadingIdx = afterFmStrip.search(/^## /m);
    const cleanBody = firstHeadingIdx > 0 ? afterFmStrip.slice(firstHeadingIdx).trim() : afterFmStrip;
    return `${frontmatter}\n\n${cleanBody}`.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  };

  const buildCompanionYaml = (): string => {
    const resolved = resolveCodexFrontmatter(bestCodexFile(), codexSlug);
    const displayName = formatCodexDisplayName(resolved.name);
    const firstSentence = resolved.description.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() || resolved.description;
    const short = (firstSentence.length > 100 ? firstSentence.slice(0, 97) + '...' : firstSentence)
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `interface:\n  display_name: "${displayName}"\n  short_description: "${short}"\n  brand_color: "#8b5cf6"\n\npolicy:\n  allow_implicit_invocation: true\n`;
  };

  // Single shared normalization function - used by preview, copy, yaml, and ZIP export.
  // Calls buildCodexSkillMd() then silently repairs any structural issues.
  // Never throws; always returns a string (empty string only if content is truly unrecoverable).
  const getNormalizedCodexSkillMd = (): string => {
    let md = buildCodexSkillMd();
    if (!md.trim()) return '';
    // Fix 1: ensure frontmatter block exists at top
    if (!md.match(/^---\n/)) {
      const resolved = resolveCodexFrontmatter(generatedFiles?.[0], codexSlug);
      const desc = resolved.description.replace(/"/g, '\\"');
      md = `---\nname: ${resolved.name}\ndescription: "${desc}"\n---\n\n${md}`;
    }
    // Fix 2: strip forbidden Claude-era keys from frontmatter
    md = md.replace(/^(---\n)([\s\S]*?)(\n---)/m, (_m, open, body, close) => {
      const cleaned = body.split('\n').filter((l: string) =>
        !l.match(/^(domain|content_type|use_cases|origin|tags):/)
      ).join('\n');
      return `${open}${cleaned}${close}`;
    });
    // Fix 3: strip any duplicate frontmatter blocks after the first
    const fmEnd = md.indexOf('\n---\n');
    if (fmEnd !== -1) {
      const header = md.slice(0, fmEnd + 5);
      const rest = md.slice(fmEnd + 5).replace(/^---\n[\s\S]*?\n---\n?/gm, '');
      md = (header + rest).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }
    // Fix 4: strip any intro prose before the first ## section
    const fmEnd2 = md.indexOf('\n---\n');
    if (fmEnd2 !== -1) {
      const afterFm = md.slice(fmEnd2 + 5).trim();
      const firstH = afterFm.search(/^## /m);
      if (firstH > 0) md = md.slice(0, fmEnd2 + 5) + '\n' + afterFm.slice(firstH).trim() + '\n';
    }
    return md;
  };

  const getNormalizedCodexSkillMdForFile = (f: GeneratedSkill): string => {
    const fileSlug = f.filename.replace(/\.md$/, '');
    const resolved = resolveCodexFrontmatter(f, fileSlug);
    const escDesc = resolved.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const skillName = resolved.name;
    const rawBody = stripCodexFm(f.content);
    const afterFmStrip = rawBody.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    const firstHeadingIdx = afterFmStrip.search(/^## /m);
    const cleanBody = firstHeadingIdx > 0 ? afterFmStrip.slice(firstHeadingIdx).trim() : afterFmStrip;
    if (!cleanBody.trim()) return '';
    let md = `---\nname: ${skillName}\ndescription: "${escDesc}"\n---\n\n${cleanBody}`.replace(/\n{3,}/g, '\n\n').trim() + '\n';
    md = md.replace(/^(---\n)([\s\S]*?)(\n---)/m, (_m, open, body, close) => {
      const cleaned = body.split('\n').filter((l: string) => !l.match(/^(domain|content_type|use_cases|origin|tags):/)).join('\n');
      return `${open}${cleaned}${close}`;
    });
    const fmEnd = md.indexOf('\n---\n');
    if (fmEnd !== -1) {
      const header = md.slice(0, fmEnd + 5);
      const rest = md.slice(fmEnd + 5).replace(/^---\n[\s\S]*?\n---\n?/gm, '');
      md = (header + rest).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }
    const fmEnd2 = md.indexOf('\n---\n');
    if (fmEnd2 !== -1) {
      const afterFm = md.slice(fmEnd2 + 5).trim();
      const firstH = afterFm.search(/^## /m);
      if (firstH > 0) md = md.slice(0, fmEnd2 + 5) + '\n' + afterFm.slice(firstH).trim() + '\n';
    }
    return md;
  };

  const handleDownloadCodex = async () => {
    if (!generatedFiles || generatedFiles.length === 0) return;
    setCodexExportError(null);
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    if (generatedFiles.length === 1) {
      const skillMd = getNormalizedCodexSkillMd();
      if (!skillMd.includes('## ')) {
        setCodexExportError('Skill content is empty - please try generating again.');
        return;
      }
      zip.file(`${codexSlug}/SKILL.md`, skillMd);
      zip.file(`${codexSlug}/agents/openai.yaml`, buildCompanionYaml());
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${codexSlug}-codex-skill.zip`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const failedFiles: string[] = [];
      let hasValid = false;
      for (const f of generatedFiles) {
        const skillMd = getNormalizedCodexSkillMdForFile(f);
        const fileSlug = f.filename.replace(/\.md$/, '');
        if (!skillMd.includes('## ')) { failedFiles.push(f.filename); continue; }
        hasValid = true;
        const fmData = extractCodexFm(skillMd);
        const resolved = resolveCodexFrontmatter(f, fileSlug);
        const rawDesc = fmData?.description || resolved.description;
        const firstSentence = rawDesc.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() || rawDesc;
        const short = (firstSentence.length > 100 ? firstSentence.slice(0, 97) + '...' : firstSentence).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const canonicalName = fmData?.name || resolved.name;
        const displayName = formatCodexDisplayName(canonicalName);
        const yaml = `interface:\n  display_name: "${displayName}"\n  short_description: "${short}"\n  brand_color: "#8b5cf6"\n\npolicy:\n  allow_implicit_invocation: true\n`;
        zip.file(`${fileSlug}/SKILL.md`, skillMd);
        zip.file(`${fileSlug}/agents/openai.yaml`, yaml);
      }
      if (!hasValid) {
        setCodexExportError('All files failed validation - please try generating again.');
        return;
      }
      if (failedFiles.length > 0) {
        setCodexExportError(`Some files could not be packaged and were skipped: ${failedFiles.join(', ')}`);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${codexSlug}-codex-skills.zip`; a.click();
      URL.revokeObjectURL(url);
    }
    if (currentSignature) setVideoSeenSignature(currentSignature);
  };

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setWaitlistError(null); setWaitlistAlreadyJoined(false);
    const email = waitlistEmail.trim();
    if (!email) { setWaitlistError('Please enter your email.'); return; }
    if (!EMAIL_REGEX.test(email)) { setWaitlistError('Please enter a valid email address.'); return; }
    try {
      setWaitlistSubmitting(true);
      // Duplicate guardrail: check this email against existing SplitForms submissions before
      // writing a new one. Deliberately best-effort -- any failure here (network, missing
      // backend config) falls through to the normal submit below rather than blocking a real
      // signup, so this can ship even before the backend's SPLITFORMS_READ_TOKEN is configured.
      try {
        const checkToken = _getToken ? await _getToken() : null;
        const checkResponse = await fetch(WAITLIST_CHECK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(checkToken ? { 'Authorization': `Bearer ${checkToken}` } : {}) },
          body: JSON.stringify({ email }),
        });
        if (checkResponse.ok) {
          const { alreadyJoined } = await checkResponse.json();
          if (alreadyJoined) {
            persistWaitlistStatus('joined'); setWaitlistStatus('joined');
            setWaitlistAlreadyJoined(true); setWaitlistSuccess(true); setWaitlistEmail('');
            return;
          }
        }
      } catch { /* dedup check unavailable -- proceed to submit as normal */ }
      const formBody = new URLSearchParams();
      formBody.set('access_key', SPLITFORMS_ACCESS_KEY);
      formBody.set('email', email); formBody.set('source', 'relatch-step4');
      formBody.set('generatedFiles', (generatedFiles || []).map((file) => file.filename).join(', '));
      formBody.set('timestamp', new Date().toISOString());
      const response = await fetch(SPLITFORMS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: formBody.toString() });
      if (!response.ok) throw new Error('Request failed');
      persistWaitlistStatus('joined'); setWaitlistStatus('joined');
      setWaitlistSuccess(true); setWaitlistEmail('');
    } catch { setWaitlistError('Could not submit right now. Please try again.'); }
    finally { setWaitlistSubmitting(false); }
  };

  const renderMarkdownPreview = (content: string) => {
    const lines = content.split('\n');
    let inFrontmatter = false, frontmatterDone = false;
    const frontmatterLines: string[] = [];
    let inCodeBlock = false;
    let codeAccumulator: string[] = [];
    let codeLanguage = '';
    const bodyLines: { line: string; index: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0 && line.trim() === '---') { inFrontmatter = true; continue; }
      if (inFrontmatter && line.trim() === '---') { inFrontmatter = false; frontmatterDone = true; continue; }
      if (inFrontmatter) { frontmatterLines.push(line); continue; }
      bodyLines.push({ line, index: i });
    }
    return (
      <div className="space-y-0.5">
        {frontmatterDone && frontmatterLines.length > 0 && (
          <div className="mb-4 rounded-lg bg-blue-500/[0.06] border border-blue-500/15 overflow-hidden">
            <div className="px-3 py-1.5 bg-blue-500/10 border-b border-blue-500/10"><span className="text-[11px] font-medium text-blue-400 font-mono">YAML Frontmatter</span></div>
            <pre className="px-3 py-2 text-xs text-blue-300/80 font-mono leading-relaxed">{frontmatterLines.join('\n')}</pre>
          </div>
        )}
        {bodyLines.map(({ line, index }) => {
          if (line.startsWith('# ')) return <h1 key={index} className="text-lg font-bold text-white mt-4 mb-2">{line.replace('# ', '')}</h1>;
          if (line.startsWith('## ')) return <h2 key={index} className="text-base font-semibold text-blue-400 mt-5 mb-1.5 pb-1.5 border-b border-white/[0.06]">{line.replace('## ', '')}</h2>;
          if (line.startsWith('### ')) return <h3 key={index} className="text-sm font-medium text-gray-200 mt-3 mb-1">{line.replace('### ', '')}</h3>;
          if (line.startsWith('> ')) return <blockquote key={index} className="border-l-2 border-blue-500/30 pl-3 py-0.5 text-gray-400 text-sm my-1">{line.replace('> ', '')}</blockquote>;
          if (line.startsWith('- ') || line.startsWith('* ')) return <li key={index} className="ml-4 text-sm text-gray-300 list-disc leading-relaxed">{line.replace(/^[-*]\s/, '')}</li>;
          if (line.startsWith('---')) return <hr key={index} className="border-white/[0.06] my-3" />;
          // Code block handling
          if (line.startsWith('```')) {
            if (!inCodeBlock) {
              inCodeBlock = true;
              codeLanguage = line.replace('```', '').trim();
              codeAccumulator = [];
              return null;
            } else {
              inCodeBlock = false;
              const codeContent = codeAccumulator.join('\n');
              codeAccumulator = [];
              return (
                <div key={index} className="my-3 rounded-lg overflow-hidden border border-white/[0.08]">
                  {codeLanguage && (
                    <div className="px-3 py-1 bg-white/[0.04] border-b border-white/[0.06]">
                      <span className="text-[11px] text-gray-500 font-mono">{codeLanguage}</span>
                    </div>
                  )}
                  <pre className="p-3 text-xs text-green-300 font-mono leading-relaxed overflow-x-auto bg-[#0a0f1a]">
                    <code>{codeContent}</code>
                  </pre>
                </div>
              );
            }
          }
          if (inCodeBlock) {
            codeAccumulator.push(line);
            return null;
          }
          // Table handling
          if (line.includes('|') && (line.match(/\|/g) || []).length >= 2) {
            // Skip separator rows like |---|---|
            if (/^\|[\s\-:|]+\|/.test(line)) return null;
            const cells = line.split('|').filter(c => c.trim().length > 0).map(c => c.trim());
            return (
              <div key={index} className="overflow-x-auto my-3">
                <table className="w-full text-xs border-collapse">
                  <tr>
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 border border-white/[0.08] text-gray-300 bg-white/[0.02]">
                        {cell}
                      </td>
                    ))}
                  </tr>
                </table>
              </div>
            );
          }
          if (line.trim() === '') return <div key={index} className="h-1.5" />;
          const escapeHtml = (str: string): string =>
            str
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
          let parsed = escapeHtml(line);
          parsed = parsed.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>');
          parsed = parsed.replace(/\*(.*?)\*/g, '<em class="text-gray-400 italic">$1</em>');
          parsed = parsed.replace(/`(.*?)`/g, '<code class="px-1 py-0.5 text-[11px] bg-white/[0.06] text-blue-300 rounded font-mono">$1</code>');
          return <p key={index} className="text-sm text-gray-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: parsed }} />;
        })}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {isGenerating && (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3 text-blue-400">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium">{LOADING_MESSAGES[loadingMsgIndex]}</span>
          </div>
        </div>
      )}
      {generationError && (
        <AnimatedSection>
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /><span className="flex-1">{generationError}</span>
          </div>
        </AnimatedSection>
      )}
      {!isGenerating && generatedFiles && (<>
      <AnimatedSection>
        <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-500/[0.08] via-blue-500/[0.04] to-transparent border border-blue-500/15">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0"><Zap className="w-5 h-5 text-blue-400" /></div>
            {config.target === 'codex' ? (
              <div>
                <h3 className="text-base font-semibold text-white">Your Codex skill is ready</h3>
                <p className="text-sm text-gray-400 mt-0.5">
                  Codex will follow your rules every time it's invoked.
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Unzip and copy the folder to <code className="text-blue-400 bg-blue-500/10 px-1 rounded text-[11px] font-mono">.agents/skills/</code> in your repo</p>
              </div>
            ) : (
              <div>
                <h3 className="text-base font-semibold text-white">Your skill file is ready</h3>
                <p className="text-sm text-gray-400 mt-0.5">
                  No more rewriting prompts. Claude will follow your rules every time.
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Drag this <code className="text-blue-400 bg-blue-500/10 px-1 rounded text-[11px] font-mono">.md</code> file into any Claude Project and it&apos;ll apply every time you chat</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-5">
            <div><p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Files</p><p className="text-lg font-bold text-white font-mono">{generatedFiles.length}</p></div>
            <div className="w-px h-8 bg-white/[0.06]" />
            <div><p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Size</p><p className="text-lg font-bold text-blue-400">{sizeLabel}</p></div>
            <div className="flex-1" />
            {config.target === 'codex' ? (
              <button onClick={handleDownloadCodex} className="flex items-center gap-2 pl-4 pr-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.97]">
                <img src={CODEX_LOGO_WHITE_URI} alt="" draggable={false} className="w-5 h-5 object-contain shrink-0" />Download Codex ZIP
              </button>
            ) : (
              <button onClick={handleDownloadAll} className="flex items-center gap-2 pl-4 pr-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.97]">
                <img src={CLAUDE_LOGO_WHITE_URI} alt="" draggable={false} className="w-5 h-5 object-contain shrink-0" />{generatedFiles.length > 1 ? 'Download ZIP' : 'Download .md'}
              </button>
            )}
          </div>
          {codexExportError && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/[0.08] border border-red-500/20 text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{codexExportError}</span>
            </div>
          )}
        </div>
      </AnimatedSection>
      {generatedFiles.length > 1 && (
        <AnimatedSection delay={100}>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {generatedFiles.map((file, i) => (
              <button key={i} onClick={() => setActiveFile(i)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${activeFile === i ? 'bg-white/[0.08] text-white border border-white/[0.1]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03] border border-transparent'}`}>
                <FileText className="w-3 h-3" />{file.filename}
                {config.target === 'codex' && (() => { const s = validateCodexSkillReadiness(getNormalizedCodexSkillMdForFile(file)); return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s === 'ready' ? 'bg-emerald-400' : s === 'degraded' ? 'bg-amber-400' : 'bg-red-400'}`} />; })()}
              </button>
            ))}
          </div>
        </AnimatedSection>
      )}
      {generatedFiles.length > 0 && (
        <AnimatedSection delay={200}>
          <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/[0.05]">
              <div className="text-xs text-gray-500 font-medium flex items-center gap-2">{config.target === 'codex' ? 'Preview - SKILL.md content (packaged in ZIP on download)' : 'Preview'}{config.target === 'codex' && (() => { const md = generatedFiles.length > 1 ? getNormalizedCodexSkillMdForFile(generatedFiles[activeFile]) : getNormalizedCodexSkillMd(); const s = validateCodexSkillReadiness(md); return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s === 'ready' ? 'bg-emerald-400' : s === 'degraded' ? 'bg-amber-400' : 'bg-red-400'}`} />; })()}</div>
              <div className="flex items-center gap-1.5">
                {config.target === 'codex' ? (
                  <button onClick={() => handleCopy(generatedFiles.length > 1 ? getNormalizedCodexSkillMdForFile(generatedFiles[activeFile]) : getNormalizedCodexSkillMd(), 'codex-skill-preview')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/[0.06] transition-all">
                    {copied === 'codex-skill-preview' ? <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Copied</span></> : <><Copy className="w-3.5 h-3.5" /><span>Copy SKILL.md</span></>}
                  </button>
                ) : (
                  <button onClick={() => handleCopy(generatedFiles[activeFile].content, `file-${activeFile}`)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/[0.06] transition-all">
                    {copied === `file-${activeFile}` ? <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Copied</span></> : <><Copy className="w-3.5 h-3.5" /><span>Copy</span></>}
                  </button>
                )}
              </div>
            </div>
            <div className="p-5 max-h-[450px] overflow-y-auto skill-preview bg-[#050a12]">
              {renderMarkdownPreview(config.target === 'codex' ? (generatedFiles.length > 1 ? getNormalizedCodexSkillMdForFile(generatedFiles[activeFile]) : getNormalizedCodexSkillMd()) : generatedFiles[activeFile].content)}
            </div>
          </div>
        </AnimatedSection>
      )}
      {generatedFiles && generatedFiles.length > 0 && !videoVisible && (
        <video key={config.target} muted playsInline preload="auto" aria-hidden="true" className="hidden"
          src={config.target === 'codex' ? '/videos/codex-setup.mp4' : '/videos/claude-setup.mp4'} />
      )}
      {videoVisible && (
        <AnimatedSection delay={0}>
          <div ref={videoSectionRef} className="relatch-video-section rounded-2xl overflow-hidden border border-white/[0.08] bg-black/30" data-reveal="false">
            <div className="px-4 py-2.5 flex items-center gap-2.5 bg-white/[0.025] border-b border-white/[0.06]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span className="text-xs font-medium text-gray-300 tracking-wide">Watch Setup Guide</span>
            </div>
            <video
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              className="w-full block"
              src={config.target === 'codex'
                ? '/videos/codex-setup.mp4'
                : '/videos/claude-setup.mp4'}
            />
          </div>

          <div className="mt-3 rounded-xl border border-white/[0.05] overflow-hidden bg-white/[0.015]">
            <button
              type="button"
              onClick={() => setShowInstructions(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.025] transition-colors group"
              aria-expanded={showInstructions}
            >
              <span className="text-xs font-medium text-gray-500 group-hover:text-gray-400 transition-colors">
                Need written instructions?
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-gray-600 transition-transform duration-200 ${showInstructions ? 'rotate-180' : ''}`} />
            </button>
            {showInstructions && (
              <div className="px-4 pb-4 pt-2 space-y-2.5 border-t border-white/[0.04]">
                {config.target === 'codex' ? (
                  [
                    { step: '1', text: 'Download the ZIP above' },
                    { step: '2', text: "Unzip. You'll get a folder containing SKILL.md and agents/openai.yaml" },
                    { step: '3', text: "Copy that folder into .agents/skills/ at your repo root (create the directory if it doesn't exist)" },
                    { step: '4', text: "Run codex in your repo. The skill auto-activates when the description's trigger contexts match" },
                  ].map(item => (
                    <div key={item.step} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-md bg-violet-500/15 text-violet-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{item.step}</span>
                      <p className="text-sm text-gray-400 leading-relaxed">{item.text}</p>
                    </div>
                  ))
                ) : (
                  [
                    { step: '1', text: 'Download your skill file above' },
                    { step: '2', text: 'Open Claude → Customize section' },
                    { step: '3', text: 'Go to Skills → tap the + icon to upload' },
                    { step: '4', text: 'Upload your downloaded file (ZIP or .md) to Claude. Claude now works exactly like you do.' },
                  ].map(item => (
                    <div key={item.step} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-md bg-blue-500/15 text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{item.step}</span>
                      <p className="text-sm text-gray-400 leading-relaxed">{item.text}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </AnimatedSection>
      )}
      </>)}
      {showWaitlistPopup && (
        <WaitlistPopup
          target={config.target}
          email={waitlistEmail}
          onEmailChange={setWaitlistEmail}
          error={waitlistError}
          success={waitlistSuccess}
          alreadyJoined={waitlistAlreadyJoined}
          submitting={waitlistSubmitting}
          onSubmit={handleWaitlistSubmit}
          onClose={closeWaitlistPopup}
        />
      )}
    </div>
  );
}

const DEFAULT_CONFIG: SkillConfig = {
  skillName: '', description: '', customNotes: '',
  target: 'claude',
  categories: {
    personality: { enabled: true, label: 'Personality & Style', description: 'Communication tone and style', icon: 'ðŸ§ ', priority: 'high' },
    knowledge: { enabled: true, label: 'Knowledge Base', description: 'Domain knowledge and reference data', icon: 'ðŸ“š', priority: 'medium' },
    instructions: { enabled: true, label: 'Instructions', description: 'Rules and behavioral guidelines', icon: 'ðŸ“‹', priority: 'high' },
    examples: { enabled: true, label: 'Examples', description: 'Templates and sample outputs', icon: 'ðŸ’¡', priority: 'medium' },
    context: { enabled: true, label: 'Context', description: 'Background information', icon: 'ðŸ”', priority: 'medium' },
    preferences: { enabled: true, label: 'Preferences', description: 'User preferences and settings', icon: 'âš™ï¸', priority: 'high' },
  },
};

const STEPS: { key: AppStep; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 'agent', label: 'Choose Agent', icon: <Brain className="w-4 h-4" />, desc: 'Pick your AI agent' },
  { key: 'upload', label: 'Upload', icon: <Upload className="w-4 h-4" />, desc: 'Add your files' },
  { key: 'organize', label: 'Organize', icon: <FolderKanban className="w-4 h-4" />, desc: 'Categorize data' },
  { key: 'configure', label: 'Configure', icon: <Settings className="w-4 h-4" />, desc: 'Skill options' },
  { key: 'generate', label: 'Generate', icon: <Sparkles className="w-4 h-4" />, desc: 'Export .md' },
];



function ConfirmAgentPopup({ agent, onCancel, onConfirm }: {
  agent: 'claude' | 'codex';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    confirmBtnRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel, onConfirm]);

  const name = agent === 'claude' ? 'Claude' : 'Codex';

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4">
      <div
        className="relatch-overlay-enter absolute inset-0 bg-black/55"
        style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="relatch-confirm-title"
        className="relatch-popup-enter relative w-full max-w-sm rounded-2xl border border-white/[0.08] p-7 text-center"
        style={{
          background: 'rgba(12,16,24,0.92)',
          boxShadow: '0 0 40px rgba(58,123,255,0.18)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <h2 id="relatch-confirm-title" className="text-lg font-bold text-white tracking-tight">Confirm selection</h2>
        <p className="text-[12px] text-gray-400 mt-2 leading-relaxed max-w-[280px] mx-auto">
          You're selecting <span className="text-white font-medium">{name}</span>. Once locked, you won't be able to switch agents. You can reset the session to choose a different agent.
        </p>
        <div className="flex items-center justify-center gap-2.5 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-[12px] font-medium text-white/80 bg-transparent border border-white/[0.08] hover:bg-white/[0.04] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
            style={{
              background: 'linear-gradient(180deg, #3b82ff, #2563ff)',
              boxShadow: '0 0 24px rgba(59,130,255,0.28)',
            }}
          >
            Confirm
            <Lock className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function QuotaModal({ limitType, weeklyCount, onClose }: { limitType: 'daily' | 'weekly'; weeklyCount: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const WEEKLY_LIMIT = 35;
  const weeklyPct = Math.min((weeklyCount / WEEKLY_LIMIT) * 100, 100);
  const isWeekly = limitType === 'weekly';

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4">
      <div
        className="relatch-overlay-enter absolute inset-0 bg-black/55"
        style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="relatch-quota-title"
        className="relatch-popup-enter relative w-full max-w-[440px] rounded-2xl border border-white/[0.08] p-7 text-center"
        style={{
          background: 'rgba(12,16,24,0.92)',
          boxShadow: '0 0 40px rgba(58,123,255,0.18)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <div className="mx-auto mb-4 flex items-center justify-center">
          <img src="/lock.png" className="w-9 h-9 object-contain" alt="" />
        </div>
        <h2 id="relatch-quota-title" className="text-base font-bold text-white tracking-tight">
          {isWeekly ? `Weekly Quota Exhausted ${WEEKLY_LIMIT} / ${WEEKLY_LIMIT}` : 'Daily Quota Exhausted 5 / 5'}
        </h2>
        <p className="text-[12px] text-gray-400 mt-2 leading-relaxed">
          Relatch is currently free and in product validation. We've capped usage per user to keep access fair.
        </p>
        <p className="text-[12px] text-gray-500 mt-1.5 leading-relaxed">
          Your daily quota refreshes every day and your weekly quota refreshes every week.
        </p>
        <div className="mt-4 text-left">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-gray-500">Weekly usage</span>
            <span className="text-[11px] text-gray-400 font-mono">{weeklyCount} / {WEEKLY_LIMIT}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${weeklyPct}%`, background: weeklyPct >= 100 ? '#f59e0b' : 'linear-gradient(90deg, #3b82f6, #2563eb)' }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 px-6 py-2 rounded-xl text-[13px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
          style={{
            background: 'linear-gradient(180deg, #3b82ff, #2563ff)',
            boxShadow: '0 0 24px rgba(59,130,255,0.28)',
          }}
        >
          Okay
        </button>
      </div>
    </div>,
    document.body
  );
}

function WaitlistPopup({ target, email, onEmailChange, error, success, alreadyJoined, submitting, onSubmit, onClose }: {
  target: 'claude' | 'codex';
  email: string;
  onEmailChange: (v: string) => void;
  error: string | null;
  success: boolean;
  alreadyJoined: boolean;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  const { user } = useUser();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Step 5 guarantees a signed-in Clerk session (requireAuth gates every step advance), so seed
  // the field once from the account's own email rather than making the user type it from scratch.
  useEffect(() => {
    if (!email && user?.primaryEmailAddress?.emailAddress) {
      onEmailChange(user.primaryEmailAddress.emailAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Timer-triggered and unprompted (unlike ConfirmAgentPopup, which appears in direct response to
  // a click) -- deliberately no autofocus on the input, so it doesn't feel forced.

  // Give the success state a moment to register, then get out of the way on its own.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [success, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4">
      <div
        className="relatch-overlay-enter absolute inset-0 bg-black/55"
        style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="relatch-waitlist-title"
        className="relatch-popup-enter relative w-full max-w-sm rounded-2xl border border-white/[0.08] p-7"
        style={{
          background: 'rgba(12,16,24,0.92)',
          boxShadow: '0 0 40px rgba(58,123,255,0.18)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <h2 id="relatch-waitlist-title" className="text-lg font-bold text-white tracking-tight pr-6">Get early access</h2>
        <p className="text-[12px] text-gray-400 mt-2 leading-relaxed">
          Skip the file upload entirely, direct {target === 'codex' ? 'Codex' : 'Claude'} integration is next. Early access members help test it first.
        </p>
        {success ? (
          <div className="mt-4 rounded-lg px-3 py-2.5 text-sm bg-emerald-500/[0.1] border border-emerald-500/20 text-emerald-300">
            {alreadyJoined
              ? "You're already on the list - we'll reach out when it's time."
              : "You're on the list. We'll reach out first - feedback welcome anytime."}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-2.5">
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="you@company.com"
                className="flex-1 px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/40 transition-all outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${submitting ? 'bg-white/[0.04] text-gray-600 cursor-not-allowed border border-white/[0.05]' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
              >
                {submitting ? 'Joining...' : 'Join'}
              </button>
            </div>
            <p className="text-[11px] text-gray-500">Occasional updates. We&apos;ll ask for feedback, not fill your inbox.</p>
            {error && <p className="text-[11px] text-red-300">{error}</p>}
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

function AgentSelector({ target, locked, onConfirm, requireAuth }: {
  target: 'claude' | 'codex';
  locked: boolean;
  onConfirm: (t: 'claude' | 'codex') => void;
  requireAuth: (action: () => void) => void;
}) {
  const [pending, setPending] = useState<'claude' | 'codex' | null>(null);

  const handleSelect = (t: 'claude' | 'codex') => {
    if (locked) return;
    requireAuth(() => setPending(t));
  };

  const handleConfirm = () => {
    if (!pending) return;
    const choice = pending;
    setPending(null);
    onConfirm(choice);
  };

  const isClaudeSelected = target === 'claude';
  const isCodexSelected = target === 'codex';

  return (
    <div className="relative">
      <p className="text-center text-[13px] text-gray-400 mb-6 max-w-md mx-auto leading-relaxed px-2">
        Select the AI agent you want to build skills for.
        <span className="block text-gray-500 mt-0.5">This choice will be locked for this session.</span>
      </p>

      <div className="flex flex-col sm:flex-row gap-3.5 justify-center items-stretch max-w-2xl mx-auto">
        {/* Claude card */}
        <button
          type="button"
          aria-pressed={isClaudeSelected}
          aria-label="Select Claude as export target"
          disabled={locked && !isClaudeSelected}
          onClick={() => handleSelect('claude')}
          className={`relatch-claude-card relative flex-1 min-w-0 flex flex-col items-center justify-center text-center px-5 pt-7 pb-6 rounded-2xl border bg-gradient-to-b from-white/[0.03] to-white/[0.01] transition-all duration-300 ${locked ? 'is-locked' : ''} ${
            isClaudeSelected
              ? 'border-blue-500/60 shadow-[0_0_30px_-8px_rgba(59,130,255,0.45)]'
              : locked
                ? 'border-white/[0.07]'
                : 'border-white/[0.07] hover:border-white/[0.14] hover:bg-white/[0.04]'
          } ${locked && !isClaudeSelected ? 'opacity-40 cursor-not-allowed' : locked ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <span className={`absolute top-3.5 right-3.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${isClaudeSelected ? 'border-blue-500 bg-blue-500/15' : 'border-white/15'}`}>
            {isClaudeSelected && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
          </span>

          <div className="h-[78px] w-[78px] flex items-center justify-center mb-4 mt-1.5">
            <img
              src={CLAUDE_LOGO_URI}
              alt="Claude"
              draggable={false}
              className="relatch-claude-logo w-full h-full object-contain select-none"
              style={{ transformOrigin: 'center' }}
            />
          </div>

          <p className="text-[15px] font-semibold text-white leading-none">Claude</p>
          <p className="text-[11px] text-gray-400 mt-2 leading-none">Claude Skills</p>
          <p className="text-[10px] font-mono text-gray-600 mt-2 leading-none">.md skill file</p>
        </button>

        {/* Codex card */}
        <button
          type="button"
          aria-pressed={isCodexSelected}
          aria-label="Select Codex as export target"
          disabled={locked && !isCodexSelected}
          onClick={() => handleSelect('codex')}
          className={`relatch-codex-card relative flex-1 min-w-0 flex flex-col items-center justify-center text-center px-5 pt-7 pb-6 rounded-2xl border bg-gradient-to-b from-white/[0.03] to-white/[0.01] transition-all duration-300 ${locked ? 'is-locked' : ''} ${
            isCodexSelected
              ? 'border-blue-500/60 shadow-[0_0_30px_-8px_rgba(59,130,255,0.45)]'
              : locked
                ? 'border-white/[0.07]'
                : 'border-white/[0.07] hover:border-white/[0.14] hover:bg-white/[0.04]'
          } ${locked && !isCodexSelected ? 'opacity-40 cursor-not-allowed' : locked ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <span className={`absolute top-3.5 right-3.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${isCodexSelected ? 'border-blue-500 bg-blue-500/15' : 'border-white/15'}`}>
            {isCodexSelected && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
          </span>

          <div className="h-[78px] w-[78px] mb-4 mt-1.5" role="img" aria-label="Codex">
            <div className="relatch-codex-logo-container w-full h-full">
              <img src={CODEX_BASE_URI} alt="" draggable={false} className="relatch-codex-base" />
              <img src={CODEX_EYE_URI} alt="" draggable={false} className="relatch-codex-eye" />
              <img src={CODEX_UNDERSCORE_URI} alt="" draggable={false} className="relatch-codex-underscore" />
            </div>
          </div>

          <p className="text-[15px] font-semibold text-white leading-none">Codex</p>
          <p className="text-[11px] text-gray-400 mt-2 leading-none">Codex Skills</p>
          <p className="text-[10px] font-mono text-gray-600 mt-2 leading-none">SKILL.md + agents.yaml</p>
        </button>
      </div>

      <div className="max-w-2xl mx-auto mt-5 flex items-start gap-2.5 px-4 py-3 rounded-xl border border-blue-500/15 bg-blue-500/[0.04]">
        <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-gray-300 leading-relaxed">
          {locked
            ? <>Agent locked for this session. Reset the session to choose a different agent.</>
            : <>Once locked, you won't be able to switch agents. You can reset the session to choose a different agent.</>}
        </p>
      </div>

      {pending && (
        <ConfirmAgentPopup
          agent={pending}
          onCancel={() => setPending(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}

function AuthGate({ initialView, onClose }: { initialView: 'sign-up' | 'sign-in'; onClose: () => void }) {
  const [view, setView] = useState<'sign-up' | 'sign-in'>(initialView);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-[#050a12] overflow-y-auto flex items-center justify-center px-4 py-10">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-blue-600/[0.06] via-blue-500/[0.02] to-transparent rounded-full blur-[100px]" />
        <div className="absolute top-[40%] right-[-10%] w-[400px] h-[400px] bg-gradient-to-l from-blue-600/[0.03] to-transparent rounded-full blur-[80px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[500px] h-[300px] bg-gradient-to-tr from-blue-500/[0.025] to-transparent rounded-full blur-[80px]" />
      </div>
      <div className="fixed inset-0 pointer-events-none opacity-[0.012]" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`, backgroundSize: '64px 64px' }} />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="fixed top-4 right-4 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-gray-400 hover:text-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        <div className="mb-6 text-center flex flex-col items-center">
          <img src="/logo.png" alt="Relatch" className="w-14 h-14 mb-3 select-none" draggable={false} />
          <h1 className="text-2xl font-bold text-white tracking-tight">Welcome to Relatch</h1>
          <p className="text-[12px] text-gray-400 mt-1.5">Sign up or sign in to continue. Skills that make AI yours.</p>
        </div>
        {view === 'sign-up' ? (
          <SignUp routing="hash" />
        ) : (
          <SignIn routing="hash" />
        )}
        <button
          type="button"
          onClick={() => setView(view === 'sign-up' ? 'sign-in' : 'sign-up')}
          className="mt-5 text-[12px] text-blue-400 hover:text-blue-300 font-medium transition-colors"
        >
          {view === 'sign-up' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  useEffect(() => { _getToken = getToken; }, [getToken]);

  const [currentStep, setCurrentStep] = useState<AppStep>('agent');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [config, setConfig] = useState<SkillConfig>(DEFAULT_CONFIG);
  const [targetLocked, setTargetLocked] = useState<boolean>(false);
  // Persists the file-content signature for which the video setup-guide has already
  // been revealed. Survives SkillOutput unmount/remount across step navigation,
  // so going Backâ†’Forward without editing keeps the video visible. Any change to
  // skill name / notes / categories / target â†’ new signature â†’ flow resets.
  const [videoSeenSignature, setVideoSeenSignature] = useState<string | null>(null);
  // Lifted (not local to SkillOutput) for the same reason as videoSeenSignature above: the
  // footer's fallback waitlist link needs to read it too, and must reflect a join that happens
  // inside SkillOutput without a reload. Seeded from localStorage so a prior visit is remembered.
  const [waitlistStatus, setWaitlistStatus] = useState<WaitlistStatus>(() => getWaitlistStatus());
  // Also lifted (rather than local to SkillOutput): the footer's manual "join waitlist" fallback
  // link lives in App(), and needs to be able to open the same popup SkillOutput renders.
  const [showWaitlistPopup, setShowWaitlistPopup] = useState(false);
  const [authGateView, setAuthGateView] = useState<'sign-up' | 'sign-in' | null>(null);
  const [quotaInfo, setQuotaInfo] = useState<{ limitType: 'daily' | 'weekly'; weeklyCount: number } | null>(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const quotaReached = quotaInfo !== null;

  const stepIndex = STEPS.findIndex(s => s.key === currentStep);
  const canGoNext =
    currentStep === 'agent' ? targetLocked :
    currentStep === 'upload' ? files.length > 0 :
    currentStep === 'configure' ? config.skillName.trim().length > 0 :
    true;
  const missingSkillName = currentStep === 'configure' && config.skillName.trim().length === 0;

  const handleAgentConfirm = useCallback((t: 'claude' | 'codex') => {
    setConfig(prev => ({ ...prev, target: t }));
    setTargetLocked(true);
    setCurrentStep('upload');
  }, []);

  const handleFilesAdded = useCallback((newFiles: UploadedFile[]) => setFiles(prev => [...prev, ...newFiles]), []);
  const handleAddSample = useCallback(() => setFiles(prev => prev.length >= 3 ? prev : [...prev, makeSampleUploadedFile()]), []);
  const handleRemoveFile = useCallback((id: string) => setFiles(prev => prev.filter(f => f.id !== id)), []);
  const handleUpdateCategory = useCallback((fileId: string, category: FileCategory) => setFiles(prev => prev.map(f => f.id === fileId ? { ...f, category } : f)), []);
  const handleQuotaReached = useCallback((info: { limitType: 'daily' | 'weekly'; weeklyCount: number }) => {
    setQuotaInfo(info);
    setShowQuotaModal(true);
  }, []);

  useEffect(() => { if (isSignedIn) setAuthGateView(null); }, [isSignedIn]);

  const requireAuth = useCallback((action: () => void) => {
    if (!isLoaded) return;
    if (isSignedIn) {
      action();
    } else {
      setAuthGateView('sign-up');
    }
  }, [isLoaded, isSignedIn]);

  const goNext = () => {
    requireAuth(() => {
      if (stepIndex < STEPS.length - 1) setCurrentStep(STEPS[stepIndex + 1].key);
    });
  };
  const goPrev = () => { if (stepIndex > 0) setCurrentStep(STEPS[stepIndex - 1].key); };

  if (!isLoaded) {
    return <div className="min-h-screen bg-[#050a12]" />;
  }

  return (
    <>
    {authGateView && <AuthGate initialView={authGateView} onClose={() => setAuthGateView(null)} />}
    {showQuotaModal && quotaInfo && <QuotaModal limitType={quotaInfo.limitType} weeklyCount={quotaInfo.weeklyCount} onClose={() => setShowQuotaModal(false)} />}
    <div className="min-h-screen bg-[#050a12] relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-blue-600/[0.06] via-blue-500/[0.02] to-transparent rounded-full blur-[100px]" />
        <div className="absolute top-[40%] right-[-10%] w-[400px] h-[400px] bg-gradient-to-l from-blue-600/[0.03] to-transparent rounded-full blur-[80px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[500px] h-[300px] bg-gradient-to-tr from-blue-500/[0.025] to-transparent rounded-full blur-[80px]" />
      </div>
      <div className="fixed inset-0 pointer-events-none opacity-[0.012]" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`, backgroundSize: '64px 64px' }} />
      <div className="relative z-10">
        <header className="border-b border-white/[0.05]">
          <div className="max-w-5xl mx-auto px-6 py-3.5 flex items-center justify-between">
           <div className="flex items-center gap-2">
  <img
    src="/logo.png"
    alt="Relatch Logo"
    className="w-9 h-9 object-contain translate-x-[1px]"
  />
  <div>
    <h1 className="text-sm font-bold text-white tracking-tight leading-none">
      Relatch
    </h1>
    <p className="text-[10px] text-gray-500 leading-none mt-0.5">
      Skills that make AI yours.
    </p>
  </div>
</div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.025] border border-white/[0.05]">
                <Shield className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] text-gray-400 font-medium">Private by design.</span>
              </div>
              <Show when="signed-out">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthGateView('sign-in')}
                    className="text-[11px] text-gray-400 hover:text-white transition-colors font-medium px-3 py-1.5 rounded-lg hover:bg-white/[0.05] border border-white/[0.05]"
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthGateView('sign-up')}
                    className="text-[11px] text-white font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors"
                  >
                    Sign up
                  </button>
                </div>
              </Show>
              <Show when="signed-in">
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    elements: {
                      avatarBox: "w-7 h-7",
                    },
                  }}
                />
              </Show>
            </div>
          </div>
        </header>
        {(currentStep === 'agent' || (currentStep === 'upload' && files.length === 0)) && (
          <div className="max-w-5xl mx-auto px-6 pt-14 pb-6 text-center">
            <AnimatedSection delay={100}>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-3 leading-tight tracking-tight">
                Your Work.<br /><span className="bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 bg-clip-text text-transparent">Built Into Every Response.</span>
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={200}>
              <p className="text-gray-400 max-w-lg mx-auto text-sm leading-relaxed mb-8">Every document holds a pattern. Relatch finds it, structures it, and turns it into a skill file your AI follows every single time. Under a minute.</p>
            </AnimatedSection>
            <AnimatedSection delay={300}>
              <div className="flex flex-wrap justify-center gap-3 mb-10">
                {[
                  { icon: <FileText className="w-3.5 h-3.5" />, label: 'PDF, TXT, MD' },
                  { icon: <FolderKanban className="w-3.5 h-3.5" />, label: 'JSON, YAML, CSV' },
                  { icon: <Upload className="w-3.5 h-3.5" />, label: 'HTML, XML' },
                  { icon: <Code className="w-3.5 h-3.5" />, label: 'JS, TS, PY' },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.025] border border-white/[0.05] text-xs text-gray-400">
                    <span className="text-blue-400">{item.icon}</span>{item.label}
                  </div>
                ))}
              </div>
            </AnimatedSection>
          </div>
        )}
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between mb-7">
            {STEPS.map((step, i) => (
              <div key={step.key} className="flex items-center flex-1 last:flex-none">
                <button onClick={() => { if (i <= stepIndex || (i === stepIndex + 1 && canGoNext)) setCurrentStep(step.key); }} className={`flex items-center gap-2 group transition-all ${i <= stepIndex ? 'cursor-pointer' : 'cursor-default'}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-400 ${i === stepIndex ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25' : i < stepIndex ? 'bg-blue-500/15 text-blue-400' : 'bg-white/[0.03] text-gray-600 border border-white/[0.05]'}`}>{step.icon}</div>
                  <div className="hidden sm:block">
                    <p className={`text-xs font-semibold transition-colors leading-none ${i === stepIndex ? 'text-white' : i < stepIndex ? 'text-gray-300' : 'text-gray-600'}`}>{step.label}</p>
                    <p className="text-[10px] text-gray-600 mt-0.5 leading-none">{step.desc}</p>
                  </div>
                </button>
                {i < STEPS.length - 1 && <div className="flex-1 mx-3 hidden sm:block"><div className={`h-px transition-colors duration-300 ${i < stepIndex ? 'bg-blue-500/25' : 'bg-white/[0.05]'}`} /></div>}
                {i < STEPS.length - 1 && <div className="mx-1.5 sm:hidden"><ChevronRight className={`w-3.5 h-3.5 ${i < stepIndex ? 'text-blue-500/40' : 'text-gray-800'}`} /></div>}
              </div>
            ))}
          </div>
          <div className="max-w-3xl mx-auto">
            <div key={currentStep}>
              {currentStep === 'agent' && (
                <AnimatedSection>
                  <AgentSelector
                    target={config.target}
                    locked={targetLocked}
                    onConfirm={handleAgentConfirm}
                    requireAuth={requireAuth}
                  />
                </AnimatedSection>
              )}
              {currentStep === 'upload' && (
                <FileUploadZone
                  files={files}
                  onFilesAdded={handleFilesAdded}
                  onRemoveFile={handleRemoveFile}
                  onSampleLoad={handleAddSample}
                  target={config.target}
                  onQuotaReached={handleQuotaReached}
                  quotaLocked={quotaReached}
                  onLockedClick={() => setShowQuotaModal(true)}
                />
              )}
              {currentStep === 'organize' && <FileOrganizer files={files} onUpdateCategory={handleUpdateCategory} />}
              {currentStep === 'configure' && <SkillConfigurator config={config} files={files} onUpdateConfig={setConfig} />}
              {currentStep === 'generate' && <SkillOutput files={files} config={config} videoSeenSignature={videoSeenSignature} setVideoSeenSignature={setVideoSeenSignature} waitlistStatus={waitlistStatus} setWaitlistStatus={setWaitlistStatus} showWaitlistPopup={showWaitlistPopup} setShowWaitlistPopup={setShowWaitlistPopup} />}
            </div>
            <div className="flex items-center justify-between mt-7 pb-10">
              <button onClick={goPrev} disabled={stepIndex === 0} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${stepIndex === 0 ? 'opacity-0 pointer-events-none' : 'text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]'}`}>
                <ArrowLeft className="w-3.5 h-3.5" />Back
              </button>
              {currentStep !== 'generate' && (
                <button title={currentStep === 'agent' && !targetLocked ? 'Select an agent and confirm to continue' : missingSkillName ? 'Enter a skill name to continue' : ''} onClick={goNext} disabled={!canGoNext} className={`flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${canGoNext ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/15 hover:shadow-blue-500/25' : 'bg-white/[0.04] text-gray-600 cursor-not-allowed border border-white/[0.05]'}`}>
                  {currentStep === 'configure' ? 'Generate Skill' : 'Continue'}<ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              {currentStep === 'generate' && waitlistStatus !== 'joined' && (
                <button
                  type="button"
                  onClick={() => setShowWaitlistPopup(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]"
                >
                  Join waitlist
                </button>
              )}
            </div>
          </div>
        </div>
        <footer className="border-t border-white/[0.03]">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
            <p className="text-[11px] text-gray-600">All processing happens in your browser. Your files never touch our servers.</p>
            <p className="text-[11px] text-gray-700">Relatch v1.2.3</p>
          </div>
        </footer>
      </div>
    </div>
    </>
  );
}

