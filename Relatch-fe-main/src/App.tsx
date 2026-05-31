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
import { Show, SignIn, SignUp, UserButton, useUser } from "@clerk/react";
import { CLAUDE_LOGO_URI, CODEX_BASE_URI, CODEX_EYE_URI, CODEX_UNDERSCORE_URI, CLAUDE_LOGO_WHITE_URI, CODEX_LOGO_WHITE_URI } from "./agentLogos";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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

interface GeneratedSkill {
  filename: string;
  content: string;
  category: FileCategory | 'main';
  tokenEstimate: number;
  codexDescription?: string; // backend description extracted before frontmatter is stripped
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

function validateInputFile(file: File): FileValidationResult {
  if (!file || file.size <= 0) return { ok: false, reason: 'File is empty and cannot be processed.' };
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

    const response = await fetch(OCR_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// Returns true when pdfjs-extracted text is structurally weak for the document size —
// indicating a diagram-heavy or caption-dominated PDF where OCR may recover more content.
// Only applied for multi-page PDFs (single-page cover/title pages are trusted as-is).
// Requires at least 2 of 3 signals to fire, reducing false positives on short-but-valid docs.
function isPdfTextWeak(text: string, numPages: number): boolean {
  if (numPages < 2) return false;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return true;

  // Signal 1: Sparse text per page — architecture/diagram PDFs typically extract < 200 chars/page
  const isSparse = (text.length / numPages) < 200;

  // Signal 2: Fragment-dominated — avg line < 38 chars means mostly labels/captions, not prose
  const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
  const isFragmentDominated = avgLineLen < 38;

  // Signal 3: Prose-less — < 8% of lines end with sentence punctuation
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
    warnings.push('PDF text layer empty — attempting OCR extraction.');
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
    warnings.push('PDF appears diagram-heavy or text-sparse — attempting OCR for richer extraction.');
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

    warnings.push('DOCX extraction failed — attempting OCR.');
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
//   B (code) → execute     — procedural code work
//   A (persona/voice) → expertise — creative judgment, human-loop
//   C (process) / D (domain) → specialist — constrained role with branching/bounds
// Falls back to 'execute' (the 70% bet) for unknown templates.
function templateToShape(tmpl: string | undefined): 'execute' | 'expertise' | 'specialist' {
  if (tmpl === 'B') return 'execute';
  if (tmpl === 'A') return 'expertise';
  if (tmpl === 'C' || tmpl === 'D') return 'specialist';
  return 'execute';
}

// v2.3: Codex domain intelligence — separate from Claude path, never collides.
// CODEX_DOMAIN_SUPPLEMENTS provides Codex-specific role/frame/keyword overrides for every
// existing SKILL_DOMAIN. Claude path is untouched — supplements are only applied when
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
    codexFrame: 'implement, refactor, and verify code against the architectural decisions and conventions extracted from the source — no patterns invented outside what the source shows',
    codexKeywordsExtra: /\b(goroutine|channel|go\.mod|go\.sum|cargo\.toml|cargo\.lock|impl|trait|lifetime|borrow|rustc|tokio|actix|axum|wasm|dataclass|pydantic|fastapi|django|flask|sqlalchemy|alembic|celery|uvicorn|gunicorn|requirements\.txt|pyproject|decorator|pytest|bash|shell\.?script|zsh|chmod|cron|crontab|makefile|cmake|gradle|maven|pom\.xml|build\.gradle|refactor|migration|pull\.?request|code\.?review|lint\.?error|build\.?fail|ci\.?pipeline|test\.?coverage|dependency|package\.?lock)\b/i,
  },
  growth_marketing: {
    codexRole: 'a growth experiment executor automating paid-ads setup, landing-page optimizations, and A/B test implementation sequences',
    codexFrame: 'execute growth experiment workflows, implement conversion optimizations, and verify measurement setup before activating campaigns',
    codexKeywordsExtra: /\b(experiment\.?setup|variant|control\.?group|ad\.?copy|campaign\.?launch|conversion\.?tracking|pixel\.?setup|gtm)\b/i,
  },
  product_design: {
    codexRole: 'a UX design reviewer auditing interface decisions against usability criteria and design system compliance before handoff',
    codexFrame: 'review designs for friction, accessibility gaps, and design system violations — surface minimal-diff corrections before engineering handoff',
    codexKeywordsExtra: /\b(design\.?review|handoff|component\.?spec|design\.?token|accessibility\.?audit|contrast\.?ratio|focus\.?trap)\b/i,
  },
  education: {
    codexRole: 'a curriculum structure validator operating within defined instructional design standards and learning objective frameworks',
    codexFrame: 'validate learning materials against pedagogical frameworks, surface structural gaps, and apply standardized scaffolding templates',
    codexKeywordsExtra: /\b(course\.?structure|learning\.?path|assessment\.?rubric|competency|objective\.?alignment|lms|scorm)\b/i,
  },
  legal: {
    codexRole: 'a legal document drafter operating within strict compliance boundaries — refuses advisory, interpretive, or strategic legal decisions',
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
    codexFrame: 'generate structured HR documents and execute onboarding workflows from defined templates — escalate policy-ambiguous and jurisdiction-specific edge cases',
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
    codexRole: 'a security audit executor operating within defined threat models and remediation playbooks — escalates novel threats, unknown attack vectors, and incidents immediately',
    codexFrame: 'execute security assessments against defined checklists, implement hardening steps from playbooks, and escalate any threat pattern not covered by the source model',
    codexKeywordsExtra: /\b(security\.?checklist|hardening\.?guide|remediation\.?playbook|audit\.?procedure|compliance\.?scan|soc2|iso27001|pen\.?test\.?report)\b/i,
  },
  social_media: {
    codexRole: 'a social content reviewer applying platform-specific format rules, community guidelines, and brand standards before posting',
    codexFrame: 'audit social drafts against platform constraints, flag policy risks, verify hashtag and format compliance, and recommend caption and CTA optimizations',
    codexKeywordsExtra: /\b(caption\.?review|post\.?review|platform\.?guideline|community\.?standard|content\.?policy|hashtag\.?strategy|scheduling)\b/i,
  },
  healthcare: {
    codexRole: 'a clinical documentation executor operating strictly within defined protocols — refuses all diagnostic, prescriptive, or clinical judgment decisions without human oversight',
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
    codexFrame: 'produce listings, comparative analyses, and transaction documents from templates — escalates regulatory, valuation, and negotiation decisions to human agents',
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
};

// v2.3: Codex-native domains — only searched when target === 'codex'. Never included in
// Claude detection pool. These cover dominant Codex CLI use cases that have no equivalent
// in the Claude SKILL_DOMAINS (which were authored for behavioral/persona extraction).
// Role and frame are already Codex-oriented; no supplement entry needed.
const CODEX_NATIVE_DOMAINS = [
  {
    id: 'devops',
    label: 'DevOps & infrastructure',
    role: 'a DevOps engineer executing infrastructure automation and deployment tasks within defined safety rails and rollback criteria',
    outputType: 'infrastructure configs, deployment scripts, and operational runbooks',
    frame: 'automate, deploy, and validate infrastructure changes — verify each step before proceeding, maintain rollback readiness at every stage',
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
    frame: 'implement tests against defined coverage targets and patterns — set up fixtures and mocks, validate boundary conditions, and verify before merging',
    keywords: /\b(unit\.?test|integration\.?test|e2e|end\.?to\.?end|test\.?suite|fixture|mock|stub|spy|assertion|coverage|jest|vitest|pytest|mocha|cypress|playwright|selenium|test\.?driven|tdd|bdd|given\.?when\.?then|snapshot|regression|smoke\.?test|load\.?test|performance\.?test|test\.?data|factory|faker|seeding|test\.?runner|beforeEach|afterEach)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'table'],
    codexShape: 'execute' as const,
  },
  {
    id: 'database_engineering',
    label: 'database engineering',
    role: 'a database engineer executing schema migrations and query optimizations within defined safety boundaries — escalates destructive or high-risk operations',
    outputType: 'schema migrations, query optimizations, index strategies, and data model documentation',
    frame: 'design and execute database changes safely — validate before applying, maintain rollback scripts, and escalate any operation that cannot be reversed or affects production data',
    keywords: /\b(migration|schema|index|query\.?optimization|foreign\.?key|constraint|transaction|deadlock|replication|sharding|partition|stored\.?procedure|trigger|view|materialized|postgres|mysql|mongodb|redis|cassandra|dynamodb|supabase|prisma|alembic|flyway|liquibase|orm|explain\.?plan|query\.?plan|rollback\.?migration|seed\.?data|database\.?design|erd|entity\.?relationship)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
    codexShape: 'specialist' as const,
  },
  {
    id: 'api_design',
    label: 'API design & integration',
    role: 'an API design reviewer operating within defined contract standards and versioning constraints — flags breaking changes and enforces error-response conventions',
    outputType: 'API specs, endpoint documentation, integration guides, and contract validation reports',
    frame: 'validate API contracts against OpenAPI standards and internal conventions, enforce versioning discipline, flag breaking changes before shipping, and refuse spec additions that violate defined contract boundaries',
    keywords: /\b(endpoint|openapi|swagger|rest|graphql|grpc|webhook|rate\.?limit|authentication|authorization|oauth|jwt|api\.?key|versioning|breaking\.?change|idempotent|pagination|cursor|response\.?code|status\.?code|contract|schema\.?validation|json\.?schema|content\.?type|api\.?first|consumer\.?driven|api\.?gateway|graphql\.?schema|resolver)\b/i,
    template: 'D' as const,
    richFormats: ['table', 'flowchart'],
    codexShape: 'specialist' as const,
  },
  {
    id: 'frontend_engineering',
    label: 'frontend engineering & design systems',
    role: 'a frontend engineer executing component builds, CSS system implementations, and design token applications according to the conventions and constraints visible in the source',
    outputType: 'component code, CSS systems, design token files, and frontend architecture documentation',
    frame: 'implement frontend code from design specifications — no CSS values invented outside defined tokens, no component patterns added beyond what the source shows, verify token application before shipping',
    keywords: /\b(design\.?token|css\.?variable|css\.?custom\.?property|tailwind|styled\.?component|css\.?module|storybook|atomic\.?design|bem|scss|sass\.?mixin|color\.?system|typography\.?scale|spacing\.?system|spacing\.?scale|breakpoint|component\.?spec|component\.?variant|figma\.?variable|figma\.?token|token\.?set|theme\.?variable|dark\.?mode|font\.?scale|line\.?height|z\.?index|border\.?radius|shadow\.?token|motion\.?token|animation\.?token|css\.?architecture|layout\.?system|grid\.?system|flex\.?utility|utility\.?class|design\.?system\.?implementation|component\.?library\.?implementation|style\.?dictionary|vanilla\.?extract|stitches|panda\.?css)\b/i,
    template: 'B' as const,
    richFormats: ['codeblock', 'table'],
    codexShape: 'execute' as const,
  },
  {
    id: 'technical_documentation',
    label: 'technical documentation & developer writing',
    role: 'a technical writer executing documentation tasks — README generation, API reference writing, changelog authoring, and architecture documentation — according to the structure conventions and style patterns visible in the source',
    outputType: 'READMEs, API reference docs, changelogs, architecture decision records, and technical guides',
    frame: 'produce technical documentation that matches the structural patterns and terminology of the source — consistent heading hierarchy, code example placement, and section ordering; escalate when source material is ambiguous or scope is unclear',
    keywords: /\b(readme|changelog|architecture\.?decision\.?record|adr|api\.?reference|api\.?doc|technical\.?guide|developer\.?guide|integration\.?guide|getting\.?started|installation\.?guide|contributing\.?guide|code\.?example|snippet\.?documentation|docstring|jsdoc|typedoc|sphinx|mkdocs|docusaurus|gitbook|confluence\.?page|wiki\.?page|runbook\.?doc|technical\.?spec|design\.?doc|engineering\.?spec|rfc|request\.?for\.?comment|tech\.?spec|system\.?design|c4\.?diagram|sequence\.?diagram|data\.?flow\.?diagram)\b/i,
    template: 'D' as const,
    richFormats: ['codeblock', 'table'],
    codexShape: 'expertise' as const,
  },
  {
    id: 'content_operations',
    label: 'content operations & editorial production',
    role: 'a content operations reviewer auditing drafts and briefs against defined frameworks, angle structures, and format standards — operating within the editorial patterns established in the source',
    outputType: 'content briefs, article drafts, editorial audits, and copy production workflows',
    frame: 'review and produce content according to the structural frameworks and angle formulas defined in the source — flag weak hooks, inconsistent structure, and missing format elements before publishing; escalate tone and brand-voice decisions',
    keywords: /\b(content\.?brief|editorial\.?framework|content\.?template|writing\.?framework|content\.?pillar|content\.?angle|story\.?angle|narrative\.?framework|article\.?structure|blog\.?framework|newsletter\.?template|email\.?newsletter|video\.?script|script\.?template|podcast\.?outline|episode\.?brief|show\.?note|content\.?formula|hook\.?formula|headline\.?formula|listicle\.?structure|thought\.?leadership\.?framework|content\.?calendar\.?template|editorial\.?guideline|writing\.?style\.?guide|content\.?swipe|swipe\.?file|angle\.?swipe|repurpose\.?framework|content\.?series\.?structure|content\.?type\.?guide)\b/i,
    template: 'A' as const,
    richFormats: ['examples'],
    codexShape: 'expertise' as const,
  },
] as const;

function detectSkillDomain(fileName: string, text: string, target: 'claude' | 'codex' = 'claude') {
  // Codex path expands the detection pool to include Codex-native domains.
  // Claude path searches SKILL_DOMAINS only — behavior byte-identical to pre-v2.3.
  const domainsToSearch: any[] = target === 'codex'
    ? [...SKILL_DOMAINS, ...CODEX_NATIVE_DOMAINS]
    : [...SKILL_DOMAINS];
  const combined = (fileName + ' ' + text).toLowerCase();
  const rawWordCount = combined.split(/\s+/).filter(w => w.length > 0).length;
  const wordCount = Math.max(rawWordCount, 500);
  const scores = domainsToSearch.map(d => {
    const baseKeywords: RegExp = d.keywords;
    // For Codex path: add extra keyword hits from supplements where defined.
    // Extra keywords are Codex-vocabulary additions — they don't exist on the Claude path.
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
    return { template: 'D' as const, richFormats: (detected as any).richFormats || ['table', 'flowchart'], charCap, sizeClass, contentType: 'professional', rejectReason: undefined };
  }

  // Template D: via domain objects that have template D assigned
  if (detected && (detected as any).template === 'D') {
    return { template: 'D' as const, richFormats: (detected as any).richFormats || ['table'], charCap, sizeClass, contentType: 'professional', rejectReason: undefined };
  }

  // Template A: Default — persona, voice, creative, general
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
    .map(l => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(l => l.length > 15);

  const principleSource = [...ruleLines, ...sentences].slice(0, 10);
  const principles = principleSource.length >= 3
    ? principleSource
        .slice(0, 5)
        .map(l => `- ${l.charAt(0).toUpperCase() + l.slice(1).replace(/[.!?]$/, '')}.`)
        .join('\n')
    : `- Every output must serve a clear, specific purpose — not just fill space.
- Precision and specificity outweigh length and elaboration every time.
- The audience's reaction is the only reliable measure of quality.
- Patterns that work should be repeated deliberately; everything else should be cut.
- Constraints are information — what you exclude defines the work as much as what you include.`;

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
    : `- Deliver complete, usable outputs — never outlines or half-finished drafts.
- Match the tone and register of the source material exactly.
- Lead with what matters most — bury nothing important below the fold.
- Apply structural patterns consistently across every output.
- Stay specific — if it could have been written for anyone, rewrite it.`;

  const neverSection = neverLines.length >= 2
    ? neverLines.join('\n')
    : `- Never produce output that ignores the established patterns of this domain.
- Never use generic language when specific language is available.
- Never let length substitute for substance — cut anything that doesn't earn its place.
- Never present a draft as finished work before testing it against the quality bar.`;

  const createSection = ruleLines.length >= 3
    ? ruleLines
        .slice(0, 4)
        .map(l => `- ${l.charAt(0).toUpperCase() + l.slice(1).replace(/[.!?]$/, '')}.`)
        .join('\n')
    : `- Structure every output so the most important element comes first.
- Use the length the content demands — no more, no less.
- Match the vocabulary and register of this domain exactly.
- Make every sentence earn its place before including it in the final output.`;

  const voiceWords = domainWords.slice(0, 8).join(', ');
  const vocabLine = voiceWords
    ? `Key vocabulary from this domain: ${voiceWords}.`
    : `Vocabulary must be native to this domain — avoid borrowed jargon from adjacent fields.`;

  const sanitizedUseCases = (domainWords.slice(0, 3).length > 0
    ? domainWords.slice(0, 3).map(w => sanitizeYamlValue(w)).join(', ')
    : 'consistency, patterns, accuracy');

  return `---
domain: ${sanitizeYamlValue(domain)}
content_type: behavioral skill
use_cases: [${sanitizedUseCases}]
---

## Identity & Role
You are ${role} who thinks, decides, and creates using the exact patterns distilled from the source material below. You do not explain your methodology — you execute it. Every output you produce should be indistinguishable from someone who has spent years learning to ${frame}.

## Core Principles
${principles}

## How to Think
Start by identifying the single most important outcome this output must achieve. Work backwards from that outcome: what structure, tone, and content best serve it? Treat every constraint as useful information — the things you exclude define the work as much as what you include. When uncertain, default to what the source material does, not what feels intuitively right in the moment.

## How to Create
${createSection}

## What to Always Do
${alwaysSection}

## What to Never Do
${neverSection}

## Voice & Language
${vocabLine} Sentences must move forward — no filler, no throat-clearing, no hedging. The opening must earn attention immediately. The closing must prompt a specific response or action. Every transition should be invisible. If a sentence can be cut without any loss of meaning, cut it.

## Quality Bar
The output is ready when it matches the pattern of the source material closely enough that someone familiar with this domain would not suspect it was produced without that context. If it reads as generic — if it could have been written for anyone — it needs another pass. Specificity is the quality bar. If it does not feel like it came from a ${role}, it is not done yet.`;
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

async function enrichWithAI(rawText: string, category: string, fileName: string, template: string = 'A', richFormats: string[] = [], charCap: number = 3500, sizeClass: string = 'small', target: 'claude' | 'codex' = 'claude'): Promise<string | { content: string; degraded: boolean }> {
  // v2.4: shared Codex error stub — used at every point where Claude would fall through
  // to generateFallbackSkill(). Returns { content, degraded: true } so parseFile surfaces
  // the degraded warning. Structurally valid for Codex CLI; not enriched content.
  const codexErrorStub = (desc: string): { content: string; degraded: true } => {
    const s = fileName.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-skill';
    return { content: `---\nname: ${s}\ndescription: "${desc}"\n---\n\n## When to Activate\n### Must Use\n- Retry generation with a cleaner source document\n### Recommended\n- Review source document for sufficient signal\n### Skip\n- Using this artifact as-is without regenerating\n\n## Key Principles\n- This artifact was not generated successfully — regenerate before use.`, degraded: true };
  };

  if (!rawText || rawText.trim().length < 20) {
    if (target === 'codex') return codexErrorStub('Insufficient source content. Provide a longer document and regenerate.');
    return generateFallbackSkill(rawText || '', fileName, category);
  }

  try {
    // v2.3: pass target to detectSkillDomain so Codex path searches CODEX_NATIVE_DOMAINS too.
    // profileDocument and generateFallbackSkill still call detectSkillDomain without target
    // (Claude default) — their behavior is unchanged.
    const detectedDomain = detectSkillDomain(fileName, rawText, target);

    // v2.3: look up Codex-specific role/frame overrides from CODEX_DOMAIN_SUPPLEMENTS.
    // For CODEX_NATIVE_DOMAINS hits, supplement is undefined — their role/frame are already
    // Codex-oriented, so the fallback to detectedDomain?.role is correct in that case.
    const supplement = detectedDomain ? CODEX_DOMAIN_SUPPLEMENTS[(detectedDomain as any).id] : undefined;

    // v2.2: derive codexShape from detected domain (explicit override) or fall back to
    // template-mapped default. Only sent when target === 'codex' — backend defaults to
    // 'execute' if absent, so omitting on Claude requests preserves the existing contract.
    const codexShape = target === 'codex'
      ? ((detectedDomain as any)?.codexShape || templateToShape((detectedDomain as any)?.template))
      : undefined;

    const response = await fetch(ENRICH_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawText,
        category,
        fileName,
        domainLabel: detectedDomain?.label || 'general professional',
        // v2.3: Codex path uses supplement.codexRole (operational constraint language) instead of
        // the Claude-flavored role. Claude path is byte-identical — always takes the else branch.
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
        ...(codexShape ? { codexShape } : {})
      }),
    });

    if (response.status === 422) {
      if (target === 'codex') return codexErrorStub('Source content did not contain enough operational signal. Provide a richer document and regenerate.');
      return generateFallbackSkill(rawText, fileName, category);
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
    // The artifact itself is structurally valid and renderable — this only adds a notice.
    if (data.model === 'deterministic-fallback' && target === 'codex') {
      return { content: fixAiYamlFrontmatter(data.enriched), degraded: true };
    }

    return fixAiYamlFrontmatter(data.enriched);
  } catch (err) {
    if (target === 'codex') return codexErrorStub('Skill generation encountered an error. Review source and regenerate.');
    return generateFallbackSkill(rawText, fileName, category);
  }
}

async function parseFile(file: File, target: 'claude' | 'codex' = 'claude'): Promise<UploadedFile> {
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

  const textForEnrichment = profile.sizeClass === 'large'
    ? sampleLargeDocument(extracted.text, profile.charCap)
    : extracted.text;

  // v2.4: enrichWithAI returns string on success or { content, degraded: true } when the
  // backend used the deterministic Codex fallback assembler. Unpack here — content is always
  // a string, degraded flag triggers a user-visible warning on the file card.
  const enrichResult = await enrichWithAI(
    textForEnrichment,
    category,
    file.name,
    profile.template,
    profile.richFormats,
    profile.charCap,
    profile.sizeClass,
    target
  );
  const content = typeof enrichResult === 'string' ? enrichResult : (enrichResult as any).content;
  const isDegraded = typeof enrichResult !== 'string' && (enrichResult as any).degraded === true;
  const extractionWarning = [
    ...(extracted.warnings.length ? [extracted.warnings.join(' ')] : []),
    ...(isDegraded ? ['Enrichment service was temporarily unavailable. This skill was assembled from your source using local signal extraction — review and refine before deploying.'] : []),
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
const FORMSPREE_ENDPOINT = ((import.meta.env.VITE_FORMSPREE_ENDPOINT as string | undefined)?.trim() || 'https://formspree.io/f/xeepqopa');
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function FileUploadZone({ files, onFilesAdded, onRemoveFile, onSampleLoad, target }: { files: UploadedFile[]; onFilesAdded: (f: UploadedFile[]) => void; onRemoveFile: (id: string) => void; onSampleLoad: () => void; target: 'claude' | 'codex' }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    const results = await Promise.allSettled(allFiles.map(file => parseFile(file, target)));
    const parsed: UploadedFile[] = [];
    const errors: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        parsed.push(result.value);
      } else {
        errors.push(`${allFiles[i].name}: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}`);
      }
    });
    if (parsed.length > 0) onFilesAdded(parsed);
    if (errors.length > 0) setError(errors.join(' | '));
    setIsProcessing(false);
  }, [onFilesAdded, files.length, target]);

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
          className={`relative rounded-2xl p-10 text-center transition-all duration-500 group overflow-hidden ${isDragging ? 'border-2 border-blue-500 bg-blue-500/[0.06] scale-[1.01]' : 'border-2 border-dashed border-white/[0.08] hover:border-white/[0.15] bg-white/[0.015]'} ${files.length >= 3 ? 'opacity-50 pointer-events-none cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={() => { if (files.length < 3) document.getElementById('file-input')?.click(); }}
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
            <p className="text-sm text-gray-500 mb-5">Guidelines, notes, examples, writing samples, anything !  Up to 3 files.</p>
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
                <span className="text-xs text-gray-500">Heavier files take a few extra seconds</span>
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

  return (
    <div className="space-y-6">
      <AnimatedSection>
        <div className="p-6 rounded-2xl bg-white/[0.025] border border-white/[0.06]">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><Tag className="w-4 h-4 text-blue-400" /></div>
            <div><h3 className="text-sm font-semibold text-white">Name your skill</h3><p className="text-[11px] text-gray-500">{config.target === 'codex' ? 'Give your skill a name. This becomes the folder slug in your Codex skills directory.' : 'Give your skill a name. This is how Claude will remember it.'}</p></div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div className="md:col-span-2">
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
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Description</label>
              <textarea value={config.description} onChange={(e) => updateField('description', e.target.value)} placeholder="Brief description of what this skill does..." rows={2} className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/40 transition-all resize-none text-sm outline-none" />
            </div>
          </div>
        </div>
      </AnimatedSection>

      <AnimatedSection delay={100}>
        <div className="p-6 rounded-2xl bg-white/[0.025] border border-white/[0.06]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center"><MessageSquare className="w-4 h-4 text-violet-400" /></div>
            <div><h3 className="text-sm font-semibold text-white">{config.target === 'codex' ? 'Anything Codex should always follow?' : 'Anything Claude should always remember?'}</h3><p className="text-[11px] text-gray-500">{config.target === 'codex' ? 'Rules and context injected into your Codex skill as highest-priority instructions' : 'Rules, quirks, preferences you didn\'t upload — type them here directly'}</p></div>
          </div>
          <textarea value={config.customNotes} onChange={(e) => updateField('customNotes', e.target.value)} placeholder={config.target === 'codex' ? "Rules Codex should always apply when this skill is active...\n\nExamples:\n• Always check for existing tests before adding new ones\n• Never modify package.json without confirmation\n• Use the project's existing error handling pattern\n• Default to TypeScript strict mode" : "Anything you'd tell a new assistant on their first day...\n\nExamples:\n• Keep the tone sharp and direct. Skip the corporate speak.\n• I work in TypeScript, always default to that\n• My company is Acme. Never call it \"your company.\"\n• Keep responses short unless I explicitly ask for detail"} rows={5} className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-violet-500/25 focus:border-violet-500/40 transition-all resize-none text-sm leading-relaxed outline-none" />
          <p className="mt-2 text-[11px] text-gray-600">These go at the top of your {config.target === 'codex' ? 'Codex skill file' : 'skill file'} as the highest-priority instructions.</p>
        </div>
      </AnimatedSection>

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
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200 ${cat.enabled ? 'bg-white/[0.025] border-white/[0.06]' : 'bg-white/[0.008] border-white/[0.03] opacity-40'}`}>
                    <button onClick={() => toggleCategory(key)} className={`relative w-9 h-5 rounded-full transition-all duration-300 shrink-0 ${cat.enabled ? 'bg-blue-500' : 'bg-white/[0.08]'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${cat.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                    <span className={`text-${meta.color}-400`}>{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2"><span className="text-sm font-medium text-white">{cat.label}</span>{count > 0 && <span className="text-[11px] text-gray-500 font-mono">{count}</span>}</div>
                      <p className="text-[11px] text-gray-600">{cat.description}</p>
                    </div>
                    {cat.enabled && (
                      <div className="flex gap-1">
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
    </div>
  );
}

function SkillOutput({ files, config, videoSeenSignature, setVideoSeenSignature }: { files: UploadedFile[]; config: SkillConfig; videoSeenSignature: string | null; setVideoSeenSignature: (s: string | null) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState(0);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedSkill[] | null>(null);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const [codexExportError, setCodexExportError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const videoSectionRef = useRef<HTMLDivElement>(null);
  const prevVideoVisibleRef = useRef<boolean | null>(null);

  // Deterministic content fingerprint of the currently generated files. Used to
  // decide whether the user has already seen the video-guide reveal for THIS
  // exact file. Same files + same config (Back→Forward with no edits) → same
  // signature → video stays visible. Any change (skill name, custom notes,
  // categories, target) → different signature → flow resets to first-time UX.
  const currentSignature = useMemo(() => {
    if (!generatedFiles || generatedFiles.length === 0) return null;
    return config.target + '
