import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import * as pdfjsLib from "pdfjs-dist";
import {
  Upload, FolderKanban, Settings, Sparkles, ArrowRight, ArrowLeft,
  ChevronRight, Zap, FileText, Shield, X, Image, Code, Database,
  Globe, AlertCircle, CheckCircle2, Brain, BookOpen, ListChecks, FileCode,
  Layers, ChevronDown, MessageSquare, Download, Copy, Check, Package, Info
} from 'lucide-react';
import { Show, SignInButton, SignUpButton, SignIn, SignUp, UserButton, useUser } from "@clerk/react";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

type FileCategory = 'personality' | 'knowledge' | 'instructions' | 'examples' | 'context' | 'preferences';
type AppStep = 'upload' | 'organize' | 'configure' | 'generate';
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
}

interface GeneratedSkill {
  filename: string;
  content: string;
  category: FileCategory | 'main';
  tokenEstimate: number;
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

async function extractPdfText(file: File): Promise<ExtractedTextResult> {
  const warnings: string[] = [];
  let pdfjsText = '';

  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
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

  if (pdfjsText.length >= 50) {
    return { type: 'pdf', text: pdfjsText, warnings };
  }

  warnings.push('PDF text layer empty — attempting OCR extraction.');

  const ocrResult = await callOcrProxy(file);

  if (ocrResult) {
    warnings.push(`Text extracted via OCR (${ocrResult.source}). Quality may vary for handwritten or low-resolution documents.`);
    return { type: 'pdf', text: ocrResult.text, warnings };
  }

  warnings.push('Both PDF text extraction and OCR failed. This document may be encrypted, corrupted, or very low resolution.');
  return { type: 'pdf', text: '', warnings };
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

function detectSkillDomain(fileName: string, text: string) {
  const combined = (fileName + ' ' + text).toLowerCase();
  // Length-normalized scoring: divide raw match counts by document size so
  // long generic business documents do not win by sheer keyword volume.
  // A 500-word floor prevents very short docs from being unfairly amplified.
  const rawWordCount = combined.split(/\s+/).filter(w => w.length > 0).length;
  const wordCount = Math.max(rawWordCount, 500);
  const scores = SKILL_DOMAINS.map(d => {
    const rawCount = (combined.match(new RegExp(d.keywords.source, 'gi')) || []).length;
    const density = (rawCount * 1000) / wordCount;
    return { domain: d, score: rawCount, density };
  }).filter(r => r.score > 0).sort((a, b) => b.density - a.density);

  // Require both a minimum absolute hit count (avoids one-shot matches on tiny
  // docs) AND a minimum keyword density per 1000 words (kills the long-document
  // bias that previously made finance win on any sufficiently long business doc).
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

async function enrichWithAI(rawText: string, category: string, fileName: string, template: string = 'A', richFormats: string[] = [], charCap: number = 3500, sizeClass: string = 'small'): Promise<string> {
  if (!rawText || rawText.trim().length < 20) {
    return generateFallbackSkill(rawText || '', fileName, category);
  }

  try {
    const detectedDomain = detectSkillDomain(fileName, rawText);
    
    const response = await fetch(ENRICH_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawText,
        category,
        fileName,
        domainLabel: detectedDomain?.label || 'general professional',
        domainRole: detectedDomain?.role || 'an expert',
        domainFrame: detectedDomain?.frame || 'communicate effectively',
        template,
        richFormats,
        charCap,
        sizeClass
      }),
    });

    if (response.status === 422) {
      return generateFallbackSkill(rawText, fileName, category);
    }

    if (!response.ok) {
      return generateFallbackSkill(rawText, fileName, category);
    }

    const data = await response.json();
    if (!data.enriched) {
      return generateFallbackSkill(rawText, fileName, category);
    }

    return fixAiYamlFrontmatter(data.enriched);
  } catch (err) {
    return generateFallbackSkill(rawText, fileName, category);
  }
}

async function parseFile(file: File): Promise<UploadedFile> {
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

  const content = await enrichWithAI(
    textForEnrichment,
    category,
    file.name,
    profile.template,
    profile.richFormats,
    profile.charCap,
    profile.sizeClass
  );
  const extractionWarning = extracted.warnings.length ? extracted.warnings.join(' ') : undefined;

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

function FileUploadZone({ files, onFilesAdded, onRemoveFile, onSampleLoad }: { files: UploadedFile[]; onFilesAdded: (f: UploadedFile[]) => void; onRemoveFile: (id: string) => void; onSampleLoad: () => void }) {
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

    const results = await Promise.allSettled(allFiles.map(file => parseFile(file)));
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
  }, [onFilesAdded, files.length]);

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
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          className={`relative rounded-2xl p-10 text-center transition-all duration-500 group overflow-hidden ${isDragging ? 'border-2 border-blue-500 bg-blue-500/[0.06] scale-[1.01]' : 'border-2 border-dashed border-white/[0.08] hover:border-white/[0.15] bg-white/[0.015]'} ${files.length >= 3 ? 'opacity-50 pointer-events-none cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={() => files.length < 3 && document.getElementById('file-input')?.click()}
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
                            {CATEGORIES.map(cat => (<option key={cat.key} value={cat.key}>{cat.label}</option>))}
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
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><Sparkles className="w-4 h-4 text-blue-400" /></div>
            <div><h3 className="text-sm font-semibold text-white">Name your skill</h3><p className="text-[11px] text-gray-500">Give your skill a name — this is how Claude will remember it</p></div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Skill Name <span className="text-red-400">*</span></label>
              <input type="text" value={config.skillName} onChange={(e) => updateField('skillName', e.target.value)} placeholder="e.g., My Personal Assistant" className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/40 transition-all text-sm outline-none" />
              <p className="mt-2 text-[11px] text-gray-500">Your skill will be saved as a .md file — drop it straight into Claude Projects</p>
              {isValidName && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-gray-500">Filename:</span>
                  <code className="text-[11px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md font-mono border border-blue-500/15">{slug}.md</code>
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
            <div><h3 className="text-sm font-semibold text-white">Anything Claude should always remember?</h3><p className="text-[11px] text-gray-500">Rules, quirks, preferences you didn't upload — type them here directly</p></div>
          </div>
          <textarea value={config.customNotes} onChange={(e) => updateField('customNotes', e.target.value)} placeholder={"Anything you'd tell a new assistant on their first day...\n\nExamples:\n• Keep the tone sharp and direct. Skip the corporate speak.\n• I work in TypeScript, always default to that\n• My company is Acme. Never call it \"your company.\"\n• Keep responses short unless I explicitly ask for detail"} rows={5} className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-violet-500/25 focus:border-violet-500/40 transition-all resize-none text-sm leading-relaxed outline-none" />
          <p className="mt-2 text-[11px] text-gray-600">These go at the top of your skill file as the highest-priority instructions.</p>
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

function SkillOutput({ files, config }: { files: UploadedFile[]; config: SkillConfig }) {
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

  const LOADING_MESSAGES = [
    'Building your skill file...',
    'Almost there — structuring the final sections...',
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
          .filter(f => config.categories[f.category]?.enabled)
          .map(f => {
          const injectCustomNotes = (content: string, notes: string): string => {
                let cleanContent = content.replace(/\r/g, '').trim();
                cleanContent = cleanContent.replace(/^```[a-z]*\n/i, '').replace(/\n```$/, '').trim();

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

                let finalOutput = frontmatter + '\n\n';

                if (notes && notes.trim()) {
                  finalOutput += '## Custom Instructions\n\n> These instructions take highest priority.\n\n' + notes.trim() + '\n\n';
                }

                finalOutput += body;
                
                return finalOutput.trim();
              };
            const finalContent = injectCustomNotes(f.content, config.customNotes ?? '');
            return {
              filename: `${slug}-${f.category}.md`,
              content: finalContent,
              category: f.category,
              tokenEstimate: estimateTokens(finalContent),
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
    if (generatedFiles.length === 1) { handleDownloadSingle(generatedFiles[0]); return; }
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const file of generatedFiles) zip.file(file.filename, file.content);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${generatedFiles[0].filename.replace('.md', '')}-skills.zip`; a.click(); URL.revokeObjectURL(url);
  };

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setWaitlistError(null);
    const email = waitlistEmail.trim();
    if (!email) { setWaitlistError('Please enter your email.'); return; }
    if (!EMAIL_REGEX.test(email)) { setWaitlistError('Please enter a valid email address.'); return; }
    try {
      setWaitlistSubmitting(true);
      const formBody = new URLSearchParams();
      formBody.set('email', email); formBody.set('source', 'relatch-step4');
      formBody.set('generatedFiles', (generatedFiles || []).map((file) => file.filename).join(', '));
      formBody.set('timestamp', new Date().toISOString());
      const response = await fetch(FORMSPREE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: formBody.toString() });
      if (!response.ok) throw new Error('Request failed');
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
          let parsed = line;
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
        <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
          <h4 className="text-sm font-semibold text-white mb-1">This is just the beginning</h4>
          <p className="text-[11px] text-gray-500 mb-3">The full Relatch app connects directly to Claude — no files, no drag & drop. Join the waitlist for early access.</p>
          {waitlistSuccess ? (
            <div className="rounded-lg px-3 py-2 text-sm bg-emerald-500/[0.1] border border-emerald-500/20 text-emerald-300">You&apos;re in. We&apos;ll email you the moment early access opens.</div>
          ) : (
            <form onSubmit={handleWaitlistSubmit} className="space-y-2.5">
              <div className="flex gap-2">
                <input type="email" value={waitlistEmail} onChange={(e) => setWaitlistEmail(e.target.value)} placeholder="you@company.com" className="flex-1 px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/40 transition-all outline-none" />
                <button type="submit" disabled={waitlistSubmitting} className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${waitlistSubmitting ? 'bg-white/[0.04] text-gray-600 cursor-not-allowed border border-white/[0.05]' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>{waitlistSubmitting ? 'Joining...' : 'Join waitlist'}</button>
              </div>
              <p className="text-[11px] text-gray-500">One email when we launch. That&apos;s it.</p>
              {waitlistError && <p className="text-[11px] text-red-300">{waitlistError}</p>}
            </form>
          )}
        </div>
      </AnimatedSection>
      <AnimatedSection>
        <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-500/[0.08] via-blue-500/[0.04] to-transparent border border-blue-500/15">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0"><Zap className="w-5 h-5 text-blue-400" /></div>
            <div>
              <h3 className="text-base font-semibold text-white">Your skill file is ready</h3>
              <p className="text-sm text-gray-400 mt-0.5">
                No more rewriting prompts — Claude will follow your rules every time.
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Drag this <code className="text-blue-400 bg-blue-500/10 px-1 rounded text-[11px] font-mono">.md</code> file into any Claude Project and it&apos;ll apply every time you chat</p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div><p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Files</p><p className="text-lg font-bold text-white font-mono">{generatedFiles.length}</p></div>
            <div className="w-px h-8 bg-white/[0.06]" />
            <div><p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Size</p><p className="text-lg font-bold text-blue-400">{sizeLabel}</p></div>
            <div className="flex-1" />
            <button onClick={handleDownloadAll} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-all hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.97]">
              <Download className="w-4 h-4" />{generatedFiles.length > 1 ? 'Download ZIP' : 'Download .md'}
            </button>
          </div>
        </div>
      </AnimatedSection>
      <AnimatedSection delay={120}>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
          <h4 className="text-sm font-medium text-white mb-2">Included in this file</h4>
          <div className="flex flex-wrap gap-2">
            {sectionSummary.map((item) => (<span key={item.category} className="px-2.5 py-1 rounded-lg text-xs bg-white/[0.04] border border-white/[0.08] text-gray-300">{item.count} {item.label.toLowerCase()}</span>))}
          </div>
        </div>
      </AnimatedSection>
      {generatedFiles.length > 1 && (
        <AnimatedSection delay={100}>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {generatedFiles.map((file, i) => (
              <button key={i} onClick={() => setActiveFile(i)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${activeFile === i ? 'bg-white/[0.08] text-white border border-white/[0.1]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03] border border-transparent'}`}>
                <FileText className="w-3 h-3" />{file.filename}
              </button>
            ))}
          </div>
        </AnimatedSection>
      )}
      {generatedFiles.length > 0 && (
        <AnimatedSection delay={200}>
          <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/[0.05]">
              <div className="text-xs text-gray-500 font-medium">Preview</div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => handleCopy(generatedFiles[activeFile].content, `file-${activeFile}`)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/[0.06] transition-all">
                  {copied === `file-${activeFile}` ? <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Copied</span></> : <><Copy className="w-3.5 h-3.5" /><span>Copy</span></>}
                </button>
                <button onClick={() => handleCopy(generatedFiles[activeFile].content, `raw-file-${activeFile}`)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/[0.06] transition-all">
                  {copied === `raw-file-${activeFile}` ? <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Copied</span></> : <><Code className="w-3.5 h-3.5" /><span>Copy raw</span></>}
                </button>
                <button onClick={() => handleDownloadSingle(generatedFiles[activeFile])} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.06] transition-all"><Download className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="p-5 max-h-[450px] overflow-y-auto skill-preview bg-[#050a12]">{renderMarkdownPreview(generatedFiles[activeFile].content)}</div>
          </div>
        </AnimatedSection>
      )}
      <AnimatedSection delay={300}>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Package className="w-4 h-4 text-gray-400" />
              <div><h4 className="text-sm font-medium text-white">Paste into Claude instead</h4><p className="text-[11px] text-gray-500">Skip the file upload — copy everything and paste directly into Claude&apos;s Custom Instructions.</p></div>
            </div>
            <button onClick={() => handleCopy(singleFile, 'single-file')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.97] ${copied === 'single-file' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-white/[0.05] text-gray-300 border border-white/[0.08] hover:bg-white/[0.08]'}`}>
              {copied === 'single-file' ? <><Check className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy All</>}
            </button>
          </div>
        </div>
      </AnimatedSection>
      <AnimatedSection delay={400}>
        <div className="p-4 rounded-xl bg-blue-500/[0.04] border border-blue-500/10">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-blue-300 mb-1">Built for Claude&apos;s skill system</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Includes YAML frontmatter, structured sections, and priority ordering — the exact format Claude&apos;s skill parser expects. Drop it in and it works.
              </p>
            </div>
          </div>
        </div>
      </AnimatedSection>
      <AnimatedSection delay={500}>
        <div className="p-5 rounded-xl bg-white/[0.015] border border-white/[0.04]">
          <h4 className="text-sm font-semibold text-white mb-3">How to use with Claude</h4>
          <div className="space-y-2.5">
            {[
              { step: '1', text: 'Download your skill file above' },
              { step: '2', text: 'Open claude.ai → go to any Project → Settings' },
              { step: '3', text: 'Drag your .md file into Project Knowledge — or paste into Custom Instructions' },
              { step: '4', text: 'Start a new chat. Claude now works exactly like you do.' },
            ].map(item => (
              <div key={item.step} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-md bg-blue-500/15 text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{item.step}</span>
                <p className="text-sm text-gray-400">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </AnimatedSection>
      </>)}
    </div>
  );
}

const DEFAULT_CONFIG: SkillConfig = {
  skillName: '', description: '', customNotes: '',
  categories: {
    personality: { enabled: true, label: 'Personality & Style', description: 'Communication tone and style', icon: '🧠', priority: 'high' },
    knowledge: { enabled: true, label: 'Knowledge Base', description: 'Domain knowledge and reference data', icon: '📚', priority: 'medium' },
    instructions: { enabled: true, label: 'Instructions', description: 'Rules and behavioral guidelines', icon: '📋', priority: 'high' },
    examples: { enabled: true, label: 'Examples', description: 'Templates and sample outputs', icon: '💡', priority: 'medium' },
    context: { enabled: true, label: 'Context', description: 'Background information', icon: '🔍', priority: 'medium' },
    preferences: { enabled: true, label: 'Preferences', description: 'User preferences and settings', icon: '⚙️', priority: 'high' },
  },
};

const STEPS: { key: AppStep; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 'upload', label: 'Upload', icon: <Upload className="w-4 h-4" />, desc: 'Add your files' },
  { key: 'organize', label: 'Organize', icon: <FolderKanban className="w-4 h-4" />, desc: 'Categorize data' },
  { key: 'configure', label: 'Configure', icon: <Settings className="w-4 h-4" />, desc: 'Skill options' },
  { key: 'generate', label: 'Generate', icon: <Sparkles className="w-4 h-4" />, desc: 'Export .md' },
];

const RELATCH_LOGO_DATA_URL = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjAwMCIgem9vbUFuZFBhbj0ibWFnbmlmeSIgdmlld0JveD0iMCAwIDE1MDAgMTQ5OS45OTk5MzMiIGhlaWdodD0iMjAwMCIgcHJlc2VydmVBc3BlY3RSYXRpbz0ieE1pZFlNaWQgbWVldCIgdmVyc2lvbj0iMS4wIj48ZGVmcz48ZmlsdGVyIHg9IjAlIiB5PSIwJSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgaWQ9ImZhNDEwNmEzOTkiPjxmZUNvbG9yTWF0cml4IHZhbHVlcz0iMCAwIDAgMCAxIDAgMCAwIDAgMSAwIDAgMCAwIDEgMCAwIDAgMSAwIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiLz48L2ZpbHRlcj48ZmlsdGVyIHg9IjAlIiB5PSIwJSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgaWQ9IjM0ZmEzMDA4MWMiPjxmZUNvbG9yTWF0cml4IHZhbHVlcz0iMCAwIDAgMCAxIDAgMCAwIDAgMSAwIDAgMCAwIDEgMC4yMTI2IDAuNzE1MiAwLjA3MjIgMCAwIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiLz48L2ZpbHRlcj48Y2xpcFBhdGggaWQ9IjI3YzlmNmY1MWYiPjxwYXRoIGQ9Ik0gMTAyLjc3NzM0NCA5Ny40ODQzNzUgTCAxMzk3LjI3NzM0NCA5Ny40ODQzNzUgTCAxMzk3LjI3NzM0NCAxNDAyLjQ4NDM3NSBMIDEwMi43NzczNDQgMTQwMi40ODQzNzUgWiBNIDEwMi43NzczNDQgOTcuNDg0Mzc1ICIgY2xpcC1ydWxlPSJub256ZXJvIi8+PC9jbGlwUGF0aD48bWFzayBpZD0iZWZlNjA0YjI3MiI+PGcgZmlsdGVyPSJ1cmwoI2ZhNDEwNmEzOTkpIj48ZyBmaWx0ZXI9InVybCgjMzRmYTMwMDgxYykiIHRyYW5zZm9ybT0ibWF0cml4KDIuNDgwMjk5LCAwLCAwLCAyLjQ4MDM3MiwgLTE2MC4xMDk2MzEsIC0xNzAuNDU5NTI1KSI+PGltYWdlIHg9IjAiIHk9IjAiIHdpZHRoPSI3MzYiIHhsaW5rOmhyZWY9ImRhdGE6aW1hZ2UvcG5nO2Jhc2U2NCxpVkJPUncwS0dnb0FBQUFOU1VoRVVnQUFBdUFBQUFMV0NBQUFBQUFpbG5sbEFBQUFBbUpMUjBRQS80ZVB6TDhBQUNBQVNVUkJWSGljN2IxbmxCelhrZWNiOTJhVzd6SmQxZDZoZ1FaQUdNSVFCT2hBQjRJT3BDakhHWW1ySFVtN0kybG5ScG81TTJ2bW5iTzduL2JyZTIvUE85cmRrVWJpakVhaTdGQ2lTSWtVSFVBSGtpQUppaUJoQ2Q4TnRQZTJ1bHptdmU5RE45QTN1NnQ5VldWa1ZmejBRZWhtZFZkMDVyOGk0MGJFalF0QUVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJCRUFSQkVBUkJFQVJoTTh4dUE5Q2hhWnFtYVl4ejNhMHpBQTdBR0VpUVJuSnlQS08rME8zemFMb0drbXRNTWlaQk1wQ0NTWk54emlYbkhLUmt3SFJUTUpCQ0FqQVFFaVFJS1RrVG5ET3VnU201TkJrM1FRY21UUk80bEJvREtUa0hrV0VhTUM2bjNseWFnazM5Umlra01DYUZaQ0NrTUlWa0lFMGhBSVF3cFduWWRkWFFRZ0svaGtmWGRkM3I4M2o5b1Vpa3pPMHQ4N2s5TGdZYVo1eUJhV2FTL2FkZjdaMmNlWDI0N3U2Tk1iY093dVZpQU1CQmdqQ0ZOQ1J6TThZMXJnRUE0NXlaVWpKcENnWk1tbEpLRU5MVW1LbTVOTTVCZ0JRbUF3RWFCNUhKTUkweGZmb1RJQXpPR2RPQU1RQXBoWmtSbXNhbEVFSUtZQ0NGNUVZeW5Vb0xZRVltbVVrYnhtUXltVXluTWtZaW1UWk1JMm5YWmNTR2JyY0JDUEM0M1I1LzFGOVZFd3RYUmtOZVhkZmRYT09jYXhvRHJra2hnVWtRUnVMT2lxY3ZYUDhoYitPMzc0cDRtUWJBcGhBQ09BaVRTdzZnU2FZeENRQWNRSElwaFFRQUNVeEtKa0NDQk00RmFBQlNBZ001SldLUURLUUpVejhId0EzQk5CMmtuSEw4a2dHVEFBeEFUdjBHQ1FCU0dKSkpJWVVVWUppbWtUYVRrL0d4NGRHUm5vSHgrUGhrS21YYWNqMVJVZUlDRDNwZGdZcmErcnFhV0N6b2N1dWFSM1BwbW11ZUY3dHVmbkhtQzMzTm5qWEJndGk0WklRcE1vYVpFVVk2TlRuYzM5dlgyell3bHNva0p4Zi95U0ttaEFVZTl2dkNHemF0cVN3UCtieHUzZTNoaTEwTGIwV1VpMnRmNlBXQlFKNE5YQzZjZzJmcVgyWXFsVW1sMHZIK2dmNk9NOTFqOGNuU0ZYbUpDandZOU1XMmJhK05WWmI1M0M2M2Uya3JFYzN0bmhFNGo3cDUzc3hiTFpyZkR3QXluVWlsMHVNZDdXMW5yd3pOV2lHWERLVW84R0E0dXUzMjJwcFltZGZqWGM3Znp6VmxUYzU4Nk5mbnpPTUJnUFRhUkhLODk4b25aenFIeDB0dzZWbHlBZytGbzd2dWFxcUplUDIrNWY0bzUwcDBMaGg2Z1UvaGRrZkFiTjU2OTBEbnBRL1BESStYV3JCU1dnSVBoQ3Z2M2xOZlcrNzNyK2p2bHFhYytUZmVBR1V1V2lnRTlldjNQTnh4N3NpWjRiR0UzZVlVa2hJU3VDOGN2ZkhXTGMwUmYwQmI2YTh3cjRmZ3dMaERQUGcxQWdGSU4yKy92KzNzMFZPREk2V1RQeXdaZ1ljcXQrM2QwaGdKaFZhdVM4blVzTVFwSVlxQzJ4MnBicnJwb2ZOSGo3UU5wdTAycGtDVWhzRGQwZGpPUnpaVWhZTXI5dDBBQUV6ejhldXVqM0c1MEd1eDR2R1UxelhlZE9DUGIzODZOR0szTFFXaEZBUWVxTmo0NE5iR3lxQi90YitJZVpRc2l1NDhEejZGSG92VmJOaC8vb09qbC9ydE5xVUFGTC9BdzFXN0h0NWNIUW5NVjU5Y09neUU4cFdZOTNYNENRYXIxK3grNVBYWHJ3NFZmWGRXc1FzOFhIWDdZeHNydzZ0MjNnQUFJSkpLV0pKeVpJaHlEVTlsckhMREEwZGV1anhZNU92TjRoWjR1UHJ1QnpkVmxidHo5T3Vrb21tSHh1QXo4UEx5aXZWM3Z2L3F4YjZpTG5FV3M4Q0ROZmNlYUttSjV1NVBWUFBnYkZYclZSeUVRckYxZTQrK2ZLYS9pTDE0OFFyY1Y3ZmpzOXZxSXQ0Yy9rcWhDdHhwZWZDc0JJTVZ6VGUvOFdwYm45Mkc1STFpRmJpbllzdlhOOVdYZTNMNU82V3dQTXdkSHFKTVUxWVdYblBIeTIrMmpkbHRTSjRvVW9GWHIvdnlyblhsdVZsYXpxRFdkcVNUc3lnV0lwSHlkZmMrODJGSGNYYXBGS1hBUTAyUEhGZ1REZWY4OTJwS0I2RXNEZ2NPQUFEUlVQbTZFei8vdEtzWWM0WkZLSEJQN2U0djNWaFJtWWZmckM0c2kwbmdvRmVGSzF2ZWZQbHNFVloraWsvZ0ZWdStjbE5UTkZlWlFSVnBxcm52b2xJNGVPb2lkVGUvOEZyN2hOMkc1SnBpRTdpMzV1RXZiS3pLZGZBOUJWTnozNnpZQmhMNG04dlgzUEtyWXoxMjI1Rmppa3pnc1YyUDMxRWZ6ZE12bHlLdGVHMnpxRHc0QUVBNEVHbis3YUhXdU4xMjVKU2lFcmlyN3U2dnJhL0paZWJiaW1YRFE5RmtVV2JRYS96VnUzOXlxdHR1TzNKSk1RbThmTk9mN1Y0WHkyUGt3RGhURko2Lzk3R1BrSytzNGZkL3VGSkVlemVMU09EMTkvemJyZEg4amlyUlovckJpMnVOZVIxWFhWblZ4cCtmR3JiYmpweFJOQUl2Vy9mdjlxN05SMjdRZ3RJUDdxUTltY3NoNUEwMC91dmJWNHVsUGFWWUJGNno5MHMzVllmeSt4N1c0S2RZQlE3dUpuL1Z4bWN2RkVudHZqZ0VyamYveWFNdFZYbnY3N040N1NKY1pGNmp3aHR1K3UyUjRtakFLZ3FCK3pkKzQrN0c4dnkvaitaVm5MaFJuRUU0QUFDVXJRM1VWYjlhRkdGS01RaThZc3QzZHRVdmU0elA4bUZxdDFVUnl4c0E5RHBmdE80M0Y0dGdna29SQ0x6dS9qL2JVclg2SFplTEk2WHF0ZFBGTGZGeTl4TjEvM3pXK1R2dkhTOXd0dTdMajJ6TWUvWmtDaW1LckR5L0VJR21CeXIrNllNQnU4MVlMVTRYdUxmbHIrN09XMjErTnF3UXp3azBlQnZkWlUrKzFXdTNHYXZFNFFMM2JmNlB0OWZtcDdWcUx0TW5OVXhUeEZtVWFYaXQrKy9xbnIxaXR4bXJ3OWtDRDI3K0w3ZlVGY3l0U3BsMjZQRE5sUkxiOHU5alA3M2s2R1NLb3dVZTJmSDNPK3NMOTNaUzNYUU02ZUozNFFEaDVzL3JQei92NURtR1RoWjQ1SmEvMjFGYndQZGpsdEZXUlRBMllnbUUxbjR4OHM4blUzYWJzWEljTFBEeU8vNXFaMDBoMHhyQ1VIYjBDTE0wTWlxQjVnZTBINTV5Ym51aGN3VWUzZmNYTnhiU2Z3TXdxZXpLbFpuaXpvTmZ4OTE0ditzZlR6bDJGNFJqQlI3Yjk1ZGJxd3Y4bnRZVzJSSVJPTGdiOTRXKzk3NVRGZTVVZ1ZjKzlMVWJLd29kSktnQzUxcHBoQ2dBb05mdStVdnhrVU83Q3gyYTdJcnUvZk50MVlWZTVqR3V2cU9qazJmTHcxMTN5MTl1dzNZcTZCSnhwc0FqTjMxbmE0SEs4eXJxR2NpeUdLZmt6SWRXZC90ZmJ5bXoyNG9WNFVpQlIyLzcrMjM1Ny82ZUE3T0UzYVdSSnB4R3I3L3RQKzkwcEE5M1lnd2V2dlBiTnhaNmZRa0FJTlNkOUxLa0JBNThqV1orOTRRRHM0VU85T0MrcmQvY1Z0ajg0RFRNVk9OdVo1L3dzR3hZM1czZjJ1UkFkK2c4Z1hzMi91Mk9TbnZNRm1yYzdjQmpCRmVGVm4vdjM3VFliY1R5Y1o3QTEvN05ubHE3MmxiVjBZVEZOOWxxRVR6MWU3Kzl4bTRqbG8zakJONzhuVHRyN05LM21pWjAvQms5eThkWC8rQVROWFlic1Z5Y0p2QzZQOS9YVUlEdGwxbGg2dmhrVm1vaENnQ1UxWDMrc1lqZFJpd1Rod204OGs4ZmJyQXRXeVhWcThWS3BSZEZKYlR1VDNZV2FudEpqbkNXd0NNSC9uUnQ3Zzl1V0RxcTB5NnROT0UwVlZ1L3RUV241eDdsSFVjSlhOL3diOVpWMlBmMm5FbEY0YUpJcHhNdVRPM3QzMXhudHczTHdsRUNYL2Z0VFRFYjMxNWFTcG15Wk5vSlZYakQzVjhyNENhcTFlTWtnVGQ4OWRicWZCeE5zbFNZZWphbUZNVjJ4TVBTY0RVOCtGVWIyb0JXaklNRUhudnNvV3E3RWloVFdBNS9MYUZ1UWd0bGpZL2ZuOThoMVRuRlFRSnYrZUthUWcxQW1RZExackFFMDRSVFZEWThzY0Z1RzVhT2N3Uys0VHMzMkxqQW5FSzlXczVLSnVTU2ltMS82WnlLcG1NRVh2K04zVEZNeGpKWHlicHd2ZWJXTDluOExGMDZtRFN6RU9XZnViL0IvaEtEVmRLbE1CZ2xLNzZHL1Z1ZDh1bDJpc0FiSDIzTTgva05pOE5rV3JtdHJxSTl4R1J4b2x1KzZwUnN1RU51VXVOWE50bi9VR1RxOEUybWxXUWVmSnJLTzc1cy8vMVlFczRRZVBTeCsydnNiN2FYWmxMUmRORWRkYndjdlBVUDNKcS84MGh6aVRNRXZ1YnhCZ1NwVjJzRG9WSEMrZ2FJckgvQ0daa1VSd2k4NFp0TkJUaUJaM0c0VzZsa0Z2TVpQVXVnYXZlZk9LS2c2UVNCQisvYlhXbG5pZjRhMHBKR0tXa0hEdUN1ZmVCV0REZGxNWndnOEliUE5kalpJM3NkenJVWnIxM2krZ1lvWC90RWc5MDJMQUVIQ0R6MmVWdDdDR2VRWm1ibUMxSGFNVGdBVkc3OUxBcS9zekQ0QmM1YjlsZmpLSXRMYWM3VWRwaFJzbldlYVh4MSs1cnR0bUZ4OEF1ODhVc3RTUFlCTW5YRGcvVExVbGQ0ZE5NamRzeGZXaDdvQlI2NDk1NUtKTHZEbU9aUjIyVkxPNHNDQUhyMVF6dlJuenVIWHVCTmo5WmptWWtuTmI4aThDSTRCWGkxaE5jK2puNTNEM2FCUis3ZGpDSUZEZ0RBVks4dGpSTHVSYmxHYk9lZENBcHdDNEw5SmpVOVVvT25KQ3dtMWJDNzVFTVVnRUREQWV5VGdKQUxQSHBndmUxTmhETUl3N0xwdU5RWG1RQVEzbklIY2hlT1hPQnI3Ni9DVXk2VGxzbFdHdFY2QVB3MTJGMDRib0ZYZkc0ZG9sb0M1eTdsY25sSjN3QlF2dWx1SkVuY2VjQXQ4TVpiSzVDa0NBRUFwRlRiQ2RQa3dRSEFVLzBnYmhlT1d1Q3hSOWZpT2hoR25XeFZTbWYwTEVCazh3T0lWa2x6UVMzd3RmZmFOT2srTzh5eURkUCtEUmdvOE5iY2hicm5DcE9BWmxQNWhUV0lJbkFBNnpaajlEVzhBbEcrQmZWSVpjd0NyOTBaeFJYbUNtV2FGWU9TSEw0NUY3M3lWdHZuMVN3QVlvR0g3bDJET01jcXpaS2RpektMeU5xYjdaMm90eUNJQlY1L1Z4UmJHS0FjV3lJRjZYc0tkK1ZuRVc5ZXd5dnc0RzNya1Rsd0xwVU5EN1RJdkU2MFpUZWVhdHhzOEFvOGVtY0ZyaHdoQ0xYUXczUUt3YWZ4MWQ2RjE0V2pGVGlyM1d6L3FEWXJUQ3RUVDNpZ0VPVWFvVzE0TTRWb0JSNTdJSW9zUndpZ2RoQXlhclc2VGxuOWZXam5YS0VWZU1XdU1LSXFQUUFBU0V1N0xOb3JWM2owaXAwazhHVlNkc3RhWkV0TUFNWTl5dVVxMVJNZXNoRm92aEhyTWhPcndNdjN4ckRzVkp2QkdvUFRJdk02dnVwYnNicHdyQUt2WElmT2dRTlRqenFXSHF5WHpnNUNOMkt0WmlLOVMrRzlkZmdjT0RBZjdhclBUckR4Sm9UM0N3Q3R3TXYzaERFV1VwUTFwcVFzb1lJZTNZTzA0d3Fud0ZrOXlqWVVrVks4TnJZY2o3MEVOMWJaYlVKMmNBbzhja2NOc2lvbUFJQVVKVCt1YlY2QzlUY2h2R09BVmVDaEhTR01ocWt6d1dXR1loUUZMYndONThZZWpEb0NxRVF6emNxS29QSEo4MUcySG1jZUJhWEFnenVyY0FwY1BhTEhSVmtVRlYvRGpkaDZod0FBcWNERHU0SW83VktIdFZFV3hZb25zaDFoN3hCU2djZGFVRG9EcVc1eWtCUGt3VlZZYUF2S1JDRkdnWmR0cmthNUI0cEpaUnNtMDhtRlcvQldyc1cyQVFzQXA4RDl1OEk0UFRqVDZCQ3FlZkhITm1Lc1hXQVVlS0FaNXhJVG1KdFVQVC9CbXpBbUNqRUtQRnlKNDB5ZTJUQkxXTUlwQnJmaVc5dG90d2xaUUNqdzRJNFlucEhnS3RKTXpsUXlKWlhxWitFSnIwY1lXU0lVZUdCekVHbjN2RXlTMTU0ZmI2QUJZV2lKVU9DaDlRaXZFOENzOGNtTWR2VE14dCtDTVBtRlQrQzhvaGJoZFFJQUFDMm81TUdwNzJvMjdncUVtWEI4QWc5dGp1QU13YTNYaWdRK0IxOVZBNzRnSEovQWZadktNTzUxQUFBcDAwb01UZ0tmalMvU2dzODE0Uk80SDZFYnVJYmFiTVVwSno0TDVtdkJsOS9GSi9Cd0ZiNnJOQVZqYmtYaCtLNmM3WGhxOEtVSDBOMG1iM001Vm9ITEJiNGlBTUJUam0rVmlVN2d2bm8vMGl3NFNKbFd2dEpJNGJQeHh2QWx3TkFKM05PTTdocGRnNnNMUys2aUdIdzI3c0E2ZEU5ZmZBSnZ3dGgwQ1FBQWhqRFZ1U2drOERuNHEwbmdpK0VMWTQxUWdISDN6T1dpRTNxeTRLMUNseWRFSi9DZ0Y2MEhCMURERW9NVVBnZHZGYnJaRWRnRTdtOElvWHZLWFVPcVl5TVl0aXVIQVU5VkxUYjNoTzAydVp0OGFBVU9VbW1YcFhNeXM2QUg2ckhGS05nRTdxckVkb1VVcEtuMGcxTWxjeTZhSjRDdHpRS2J3UFVvMmpVbU1MVThMNmxkTmd2ZWNtejdRTkFKUEl6MzBTL1VQWm0weE15R3V3YmI3Y01tY0hjQW13dVlRZFBVNVFGMUUyYkJWWTZ0VXc2YndMMEJiQmJOSUl4eHRaM1FQa1B3b3ZuSWd5OU0ySS90Q2luSURNMEhYeGpOaHkxSGdFemdldGlMYlJrK0ErTktETTd3Mm1ralBJQ3Qwb05NNEo2QUc2OW5GS3JYNXBRbXpJTG1LMFBtd3BFSlhJL295Q3hTVVZPRFZNbk1CdGM0TWdlRjdEWnhyUHN4QVFCQUtQM2dqQng0RnBnNldRTUYyTXp4WU5hTlRDdVZUR29ueklLbVl4c1NqazNnSWNRZW5FbjFiTXlVZlliZ2hXbllQQlF5Z1d0QlpDR2NCZFU2U1VkNVo0TmpHOENMVE9ETWk4d2dGYTVIRVNmcGNhQnBKUENGUUoyYmtOWVZBckk3aVFNTjIxWlZaSUppSEpsQktreE9VQXZoSW5Cc3phREk5SVM3ZkdMRzFjUHE3Yk1ETVJ6YjBVWElCTTQwekUxNmxzd2dzaXVIQkhRVDdaRGRKdWJHdkl4amFwa1YyWTFFZ3RTUUtRcVpPYWczeW5DdTlJTmpOdFJHMFBXZ1lSTzRpYzBnQzJ3bVJwRXBDc0t6UUNIS0lqaW54WU1LUFZtaFBQaUNJRy93SUZFdkJqVmJMUUx1aVg5S2lrZGtrSDhZYllJOCtJSXdIYkZxcE9WcW1STFpyVVFCdzFZZlFDWnd3TFlJVjdFSW5ER0c3RmFpQU4zNXo5Z0ViaUl1OUhEMUlGaW1PV2M5WEVEUURmeENKbkNCN1FtbklyaFAyWFNNcmVrQ0NkaWFpWkNaSXlZUUM1eXBvcGJrd0xPQnpZRmpFN2cwN0xaZ0FVeGpSQ24wWUxiVVJyREZtTmdFam5raUdnTmFWem9PWkFJWFNjUXRIb3dyYytVWXRyNVFIRWphOExBZzVpaG1ENjZXNlNTMmlnWU91QXZacGxwc0FoOUdITnBLcWVSNEpMSXJod1VhL0xNZzZYSEVBcmZtZUxBOWk1R0E3Y0dHVE9DSmZzUkJ1T1QrbWJ2SHNkMUpIT2daWk90d1pBSVgvVW04UVRoamlxZ3BvWklWZ2EwRkRabkFZWHdTcndjSE1UN3piMlQzRVEzWUtqM1lCSjRheTlodHdyd3dkUittVEpQRXM0Q3V2b3RONE1aa2V2RVgyWVlTb2xqbUZCTFhRSGRSMEFrOGpqZU5JdFVOaDJJUVcxRWFCUkxidEFGcy9kZVpRYndlWERJbGl5TGFCdnREYmswcTh5TUVTTWxNQUkxSkpoZ3dCZ3hBVG5zMXlZUmtERUJ5WUNDQlNaajYzL1FXSmdtTUN3bkFCREEyTlpwWnlxa2xHd01BQ2NEazFQT2ZNNURBT09mQXBlQ1NBN0s0RjVuTHhDYndWQWZlc2NSUzdRZFBYMzNxa1dxdlBoMTFTc2xBQ21BQVVuS05nUlFNMkpRWUpZQUVJUUdFWkJ3RUFOZUFTUUFwQllBME1zQWs0MHdJbHk0eUFxUUVMazNHSkJlQ20ra01jQ0daTUtXbW1aSnpYUnJNcFhNSm1xYTdYVXdJWUZ3eUFLNXBqSEdYeGpuWE5OM09ReklrdGlBRm04QW4yK0pwckozV1VpaEpYam53MGp0QlQwRGpCdE81WVVnbVRaUHBUQnJTNWRWQUNFMUlwdWthcERsSUNTTERoQUN1bXdhVHVzK3RtV2x1WmdTVGhwRUdKcGltbWFaYk4wM0RsTG8wVGRCMFprcGdJcDBHWFFpUXB1U2FDUnlZYVhLdU1RREdOTDlQeTVqZ2RqTVEwaFVJaE1BVkRQdTlub0RQN1N2emFpN2RaWS9PQmJJc0dEYUJwenRITWxnRnpxU2FwRGZiZ1FHYlVodE1oUlNTTWNtQU1UYTlOWkZOL3hpQWxFeEtBWnpCOUF1a2xCS0FUYmx4WUV3d3p1VFVONldjZHYwTCswSk5ZMElDNDB3eXhqVk5CNjV6enJuSDQ2bTRzVDRjYzBXRFhwZEw5N2dLZklleG5iR0VUZUF3T3BBTTJHM0RQRENtV1RVblFlWnBvYm1FWDJ2TzZ5bzlSM3d1M1IzYTNoeUxoTUxsWlY2UHQ0RHo4QVNtOVFBZ0ZIaHFBSEVRN296eVpTb0ZBTUJPK1QyNko3U3p1YmttRWd4NHZiNkN2RGZEbGdoSEovQjBMMXFCUzNNQ2J3NXpEbkppQWdEZ1ZKbS9MTHAxUzAxMVRjam56WC93eDl3VW9pek01UG1KbEdmeGw5bUJNTkIrOXVabmNoTEFkZHJuaSs2NHVia3U2QS80OC8yR3lCNXk2QVFlUHpPRVZ1QVp2RzBFQzVJWkJJRHpMd1piYnI2aEpSWUo1UE1zWW5TRGY5QUpITVlHMGNySVNOaHR3U29ZSG9hMkQ0TzF1MjliVjFrV3l0K3FFOXNwUy9nRW51aEoybTNDZkdqNHJ0YXlTQ1I2TDUxNXZ1SFc3WnVxUW1WNUVpSzJTNFROSG9ERXB3L2FiY0k4U0ExcDdMUU01T0JnKzZlaHRmZHMzeEQyKy9Odzh4bTJCaDE4QWg4N081ckJlWTVKa1p6OW11cnRiVHRaZWNzOU53WWorUWhWa0YwamZBSTNyN1MzUk93Mklpc3lOYjc0aXdxQXh3V1NUMVVNaFRDblBuZGlXVDFxbWU3dUs2L1g3N3B6YTNrNDErbHhaUHBHS0hDWTZFemdGRGlZS05MZzBlcW1hbTg1ZDBzVFpDWXR1SkV5cEdiMkQ4UlRocEhKU0dGTUxrVmtvNk9Yejd5MmIzOWRSU3lVUytOa0JsbU1nbERna3hjbTdEWWhPMGdHZ3EvNThuNC8wM1VtUVlJUVRFb2hKTWpVUkR5Uk1SSkRJeE1EM1VPcFpOcE1UeXdtdGNIQnJvT050OTI2TVpyRFNFVmk2NUpIS1BEUlB3NU41cjBjc1JJWWlpd0tyN3lucFh6bVN3bFNnSlJDWklRMHBXbW1SV3BrTERFeE10eDlvWHNpblk0dkdMb01EWjMvNUxsN0g3Z2hGczdWWDBhbCtpVXcwSWRUNE1Bd0RMV1JGY0V5NVVzMkovTnNaREtHYVNaVEk3M0RJK2RQOVk4bDRnc1VZRVYvZjllYjkrM2ZWQjdOVWRvUTJ6UU5qQUtQRHlJdGlhTVlpZUQyYXd0SEZMcnVBd0F3VXpla1UvR1JnYzZPcTZjSEVxUHpYOUxCd2M0MzdybC9jMFVrRjlLVTJFWTJZaFQ0K0llMzJXMUNkZ1NHK0ZJdWNTbWcrZjBBUmlxVFRNUUh1NjljUERvU0g1bXZ3WFpvcU92d3ZROXNpcGJQODkrWEE3YTkyQmdGUHZyQmx4c3g5b1JqeVlNdncwZnFPb0JNcjBuRjQrejR5YU1kUXlQemhPUURBKzF2UFhMWHhxcXk3UDk1R2VDNFJETmdGRGowdDI3RUtIQWNzT1dtUEpqSEU2eklKS08zZkxINzVPdnR3NFBaL2ZqUVVNK2JmM0pMUTlVcTgrTElBaFNrQWg4L2RYc1ZzcDRkQUFDbVkxaGtyaXhONFhJRklibDIyOE5keHc5MURBOW1kYk05L1IxYnZuQnpRM1JWT2NQRk50b1ZIQXkzYkE1SmRtY1U0Y2JNZE9mQmJydHRBTkMyM2w2eHNwL1VmWkh5NmcxMzdtMU02RExibWxPTzlody83ZmZvM2xXNDRlU2xONFpYL3RONUFLVUhoNjYyRGF1UEJuT09obUtSS1ZZek04N3JqVld2Mlh6L3BkYy82UnZLb3ZHSmliNUwrejY3dVhMbGNRb04vbGtTWXhkVzZxWHlpY0R4dUZ2bHh5d1FxS3h1MmROKy9JVzJ2aXg5eWVPZkRoNzcraDAxNVN1TlV4Z0tKNkNBNDU3TkpxUGZGc1AzMGN0MHY5Wmx0dzBBK3E3YnExYjVLOXhsc2NwMXQyMHlqRlNXdlNYeGdWTlhmVjdYQ2p1RFUyZmVHbG1kY1RrR3A4QUZ1N2tCWHpFejAvMHFBb0h6Ry9aV3Jqb01ZTjVJcEhIUGRtM1NtSnMzTklZN1BqSEMzTE1pYVV4ZVBFd3grQklZUG5OTHpHNGI1b0FqRHk2U3VURWpHSXpXYlR0MTZFalBYSTg3TkRUOHllTjdhbGZVWm9pdEZ3V25CNGNFMjF1QnpyUjA1MEVNSG56ejNkVzV5YUc2eWtLMU8zYVdKVEp6WS9HeHJ1T2pWUzdmOHQ4bmRlbU5vVnpZbGpPUWVuRG82RnFQTGxISWNHeW96ZUV1SEo4dlZMMzFNeSs5MmhHZi9WL0d4a1l1ZjMxWHhiTHJiUXpiNkRaMGJuSWEzcmdKM2E2SFRNOXJIWGJiQU1BMzNaWERLcGdyRUs3WXVzTklwT2NzTnlmNlR2bWkrbklUaHNuVzF3ZHpaRnB1d0Nyd3ljUnRsZGgyWnFhN0QzYmFiUU1BdE96TGFabFg4d2VyYnQ0RThjVHNFbjZ5Lzd3SWE0SGx2VmY2OG1zazhDVWhOOWVIN2JaaEZ1bk9WeERFNExEeDNoekY0TmZRQStINm5VMEQ2ZGx4aWhpNmRLSFI1MTFXRkp2QzVzR3h4dURRKy9aZWJJUENXYjVteVM2UFBEU2tlcW9qc2Uxdi9iSjliTmIzdXlaN3Z2RmczYklDY1dRaE9HSVBucm1sTnA4enhsWkFwdk1RQmc5K3c3N0szTjgxUFJ4WnUxdnZtNjN3NU9BNVY0VjdHWUY0cXZVZ0xnK09WdUFnWWx1aWR0dGdCWWZBMlpaN3F2TngxenlSNkphYTdzU3NEaFV4ZEw2bnhodGM4bS9KdEI3Q0pYQzBJUW9NdlhxZ01xY1REVllOVzhwYytyd2pFM25hM2M5ai9ySjFQM3QzOWpxNjQrWEI3NWpWUzEzd1MxUUhZZ0ZtRHc2aVlRT3VUS0hSL1JxR0xFcmpRMVY1dW11dVVPekcwR0J5bGhPUEQxeU0rWDFMVkhqNnlxR0IzQnUyQ3BBSlhGZDg1T1Fvc2t4aHB1ZU5xM2JiQUFCYjl1YzRpeklEQzVRMTM1QWVtVFhBSzlsMzBxajJMbTFCbEdrN2lFdmd5RUtVS3FOdjVvdU85OWFpNnJqQ3NWbUZlL1BaN2hFS0JOZmMrS3UyU2NzM0U1OCtsWHA4M1pJYW1Ha3V5c0pFSytJejJkamU1L2FXWTlyM3dBSEQ2RFlwbVpuSDU2NVdHd2pWLytUVXJJYVNLejhmZTN6cjBoNGNLTHpBRE1oQ2xBMjcyNVhtdGxUMWVreFJlS2JuRlF3eCtQcjdhdkthYlBZRXF6ZG1CbWFOenh1LzBsWlY1bDljTGVtMlZ5aUxzZ0R1eldmNlp5NXQvN04zUkJFbFVqaEhNUjljeTNlbzVHbjAxMno4elVXcnhQdmY2Lys3TzJvV0R4bVJPWEJzaFNkWjg4VW01Y3YyOTFGdEQrRW8zQUhQdTRoWXhjWXYvN2M3WnpYa2o1NzV2My9mc2VnWkxzZ2ljSFFlUEIycWZyQno5UHFYL2IrK28zenBSWWE4ZzJRQlZRQXJ5cHI5MFI4ZTdyRjhMM0hoQi9MUk9reUxvcVdBeklNYld1eU9HdVhyOXNPNGtrNElZSzVDMUZMMDJwMy82V3ZyckRGMzh0SVBYcnk2MkJrQVNHWk1Yd2VaQnplbHYyVlgrMHlTYXZDNXZia2QwTDRxNUx5blp4Y1E3aTdJZzRURjNNR21IMXl5NUFzenJmOW9QTHBtNFRnY3lWUHVPdGc4dU9HdWZiaGUrY2JWbDdveDVPWUFBRUFLREthd1FnMG9EclljK0srN3JPMUE2UXMvZVBicTVEeXZCd0FBeHBFcENwa0hOeks2ZDl2ZXJwbGMrT0FMZDRScWJUVElBbzVLVDhId05MbGl2M2pGRW9pTHRwOFlYMnBhd0lkTGJCNGNtOEJORWFpNSswMmw5YjdqelEyUlhCK1V0RUlZaWhDbGdJazR2YzRkR0h2UG9uRGo4aStpRDljdHBIQmtUZ0RaQThVMEdJUzIzYUlvT3Y2SDQxZ0diVEFYaHVVQTB3cm5KTFhxRy83dWNlc0QxTGo4L1VOOTg1OUZqZTRvYjJRQ0Z4a0pnYnFIcXBWdmRmeHk3cDV2bThCeEVHeEJGVlN4OWMrLzJHRDVUdWJ5UDc3VE0rK2pERU5Ec1FWa0FwY21BRVMzNzFhZWdlbGpiL2NodVd4eWZzOVZ0TVRXZnVNdm1pM2ZTVjc2d2NkOTJWOE1BTmo2d1pFSkhBQUF2UFdQcVkvRm5wOWZ3QkdrTUJ6blpMb0tXeTRzWC91RmI3WllFdUlUcDc1M3ZHZStsMk1EbThBNUI0REl0anZWSGZXdHo3WXZXaUl1Q0FMRDRWaXkwUDBla2FiUC8vVUdpOEpIUHZxbmkvUDFVS0FZYjZlQVRPQlRWOGRYLzVpYUN4LzV3NkZlZTh5eGdxTklKek9GWHNjRm13NThlNzFsNjhuQXU3OW96WDVhTDhlV0prUW1jRFlWd2tXMmZFWnRyMi8vOVhrTUErKzRqdUhrSUZuNFRGeXc2Y0gvdU5ieW5aN2YvZUpxMXFVL1IzSE1pd0l5Z2N1cFZMTTd0dGV5ZEc5OXZRZEJkR0NpU0lGeFgrRmI5bndOOTN5bjJmS2RycWYvMEpOMVJZTE1nV01yOUlqazFBV0tidnBzdjdLNW9QL3BockttZVg2a2NHZ29TdlhjWklYL25BVWE5NC84dUZYOVR2dVBhendOV1Y1SldaUUZZZE0zVDY4K2NMZmFtSG5sSitmczN5Z2ljV1I1YlRrR0o5RDgrSGZXV0t4b2UrcGl0azVQYkwwb3lNeTVmZ2hrdVBrTGpjcjNSZXZ6U1lUSjBRQUFJQUJKUkVGVWJZczFhdVlkSEtWNmtiRmxzUnRvZXVnL1dEejI1TWMvdXB3bGZZdkNCeWdnRS9qTTlMK0tIVStvamVHRHo3MklwNjNRVm1UU25wVkFzT0V6WDFNcnpERDQ2bTk2NW83T0Z4aWNnQUl5Z2MvWW85Yy9kTCthdEdqL3hkRitHK3hSRVNoV0xOeXVkbzlJNDJQN0xhTWplbjg3OTl4UWllMnNlbVFDVnc0SUNLeDUzSkthYXYzaFJadkRjQ2t4WEMzdXNtR1JDUUFBNWV1K2NYTzUrbzMybjV5YUhZWWpremMrZ1NzVGltTmJ2cXFXZTFLblg3QzU2NHJCM0NQSkNvL00vNmJqK2FqYzhyZmIxRTdaZE90TEhiTlhSaHlaeEpFSlhLMWh1R3IyM2FudU9CNzY1Zk5YYlMzWlN4U0huSXFNYlpFU3E3N3hMOWFxSzl6aGw5N3NzaFlvSkRaRklUUEg4b3dMcmZteUpVaHBmK3FOUGp2OUEwUFJUU2pBdmpuOHJIclB0eXoxaUk0bjM3R3VqRFJzaWtKbWpyVVNWckg5ejlSY0liVCs2TlQ4ZlpvRkFNY0pEN3FON1I3dW1uMWZVVk1weHBWZm43TzBYUWxxdGxvUVppbUU4ZHA5OTZpejI0enozejl2NHlRZ0lUSDBXVEN2blN1NVlOMkJtOVZiRXYvNHVTNDFWMGc3ZWhabTF1d29mK09mTnF1aUd2L2d4OWw3ZkFvRWhxc2xVN1pLcUtMbG14dlZtOVQzNG1GcmNvdEs5UXN4dTFFdXV1MWJsZ0x4d0N2UEx6NCtMRjh3RkgwV1l0eGVIMWwxMDE5YktwcGR2L3BVTFdnaWMrRFlCRDY3MHV1cXZmZXZMSnRlTzU5NnU5ZTJwWjZHWWg2LzI5Nk42M3JsemordFZMNU9ubm1xZGNibllOTTNPb0Zyc3d6eU50NzNSY3RlOWtzL1BOSnAwMVdVRE1PNWhrellIQVVFYWo1emg3cmhxdi90d3pQSkxXRWdremcyZ2MvSkVBUWJIclhrQ3MwVDMvMncxNTZMeU13Rmh6b1ZDT2F6cTVKNWpjcjFYMSt2NnFiNzJiUFg5Nk9ZU1dRZFE4Z0VubVhIVThXbXIxdkM4TlNaSjQvWnMrVlY0a2lCR2JhdkJHSTNmbDdOaHFmTy9yNzdXbzJYUFBqQzhMbUQ5M2pOQTErMWRMRk5mUEMvVHRpelJ4TkZIbHdrYmYrY2Vhb2ZmVXdOdy9zT2ZuQXRrMUt3eVlsTEJabkFXWllxdEsvaG9kMldNSHpzL1g4NFkwZG5vV1FZOHVBWUZuS2h4c2MycVVPUWVwNitQTjJUb3JtUktRcVpPVm1uNzBZMmZHZTc1UkM3MFNNL09tdEhTWk9qeUtMbzlnc2NZaHYvalJxa2pKODVkQzFJMGNtREwwaldJS0JxMnpmV1diNHgrTXFURndxL3p4NUhzeFdLbzk1WTFaMlBxRUZLMSs4K25yNGZ5UFNOVGVDTVpUT0kxZHhocmZkQS82di9lTHJ3Wno4SURNMVdZSDhNRGdDK2VrdVFJbHFmbVM0eDA1N01CY21xYndDOThZRnZXYmR3OTc3OHZUT0ZqbEtROUZuWW5RZWZJcnJ4RzViaFRNZW0xcG1jWXZBRm1hOVJ6dGY0NkJPV1ZBb01IUHJCcVFMblVpU08yZGZjN2p6NEZMSGRuMU8zOS9TOTNEb09BTUxFOE9sVGNJakFJZFR3eGZ1dFowa1BIUHplc2M2Q0JzVVN4NFphSkMzWC9wcjlHNVdzMHZpbko4Y0E2SXllUlpuUE8xVnMvSXU3ckNjMzlyL3gzYVBkQlpVY1I1RW1aRGdlSkJEWi9GbDE3a0h2NGQ0MGxvWTBCV1FDbDJMZTZ4UGIrRmUzV0EvMkhucnYvMzJ6bzREYkpKRWNzR1FpRWJoV2NmY1daWWZtNUNjbkJnRTBGNHByTkFNeWN4WUtjNnUzL2UwMjY2bXdZNTk4OTQzMnVhTTU4Z1dTRUFXSHZBRWcxUExWT3VYTDN0OWRuc0RpQkdaQVpvNWM2UGJWYlAvUG02MEg3VTZlL0orL2J4dWQ1K1c1QjhWa0swVFQveUkzN1ZQV21XT2ZmRGhzVUpwd1lSWisrdGJ1K2ZzdDFnbkd5WE5QUHQxYXVGMXNTSzRXRm9YN2FoOVJ5eE85TDdZbjVPeCtaN3RCWnM1aUNyLzF2OThldG53bmMvWmZDbGJVdEdYcTVWeFFQRWFtaUc0OW9Ld3pFeGVQRFdWd0xNUm53Q2J3aGVmR3NNYmQvOWR0MWpoY3RqM3oveHp2S2toY2F0L0VIUXNwRTBYSEFBQUFxMzVBYlVucGVQUEtKTFkwSVlacGV3cHlzV2JuT3Y2M295ZXQrNDU3MzVqOHlwNm1RcHp3cCtNNGtYYitURlBCS1Z2ejhKV1pjbHZteFBrR2JJcEM1c0VYbjkxWXMvUHZkMWg5T0F3Yy9wKy91emlXTjV1dXc3aDM4UmZsSHdSblhWeUhWK3hyVWI3cytXZ3dneXhFUVdaTzlLRzFpKzE3RElZMmRnNWFjNFBwZ2ZPeVN2UG0rOE9hN25yMVNwN2ZZaWswUGxTRHgwdDZZT0xzekhGVTZWUXpmNjkxZ1pjWEhtd0NmM0R4V0NNVTNORFhaMVc0R0w3VUh2YTU4cnduMk9oNjdXcCszMkZKck45ZmgraXU2ZXlZY3RhTUVQd2NobXMwQTZKTEJRQlFmcUJwOFRDZ3pMZCtwRy9XL3QveDloT2VxTzdMYTNScWRMMkI0ZWF0M1kvSWc0TWJScy9QcklrbUUrWlloNDNXekFXWndLTVBOeTlodFJnTXJEYzdaNTNUbUI2K09CWnplL0o1NjlOZEJ6SGN2SVlIcWxIc0xKcUdhOGVWcXlJbWhOM25GRmpCSnZDbGVIQ0FnSDhOYTUrMXJEU0gyaTZHZ25vZTE0Rkc3OXR0K2Z2dFM2WnBmeDBpRHc1ZW52bDB4dG1rVENQN0NiRjI0VXlCZzkvZnFIZU56Y3E0eFB0TzhvRHV5dHZkVDNjZHhCQ2l0TnhmZzhtREErY2ZkczE4bFVxaXlkSURBRDZCUDlxNE5CZnNDNnlwN0p5YzFVcVlIcnB3S1JCdzV5c2xudWwrSFlQQW0rNnJSU1Z3ajlsM1dhbE00TkkzT29FdjBZTURlSHlOTGUzeFdZTTQ1V2pQS1NPbStmS1RNTXgwdnRxNStLdnlUc1A5ZGFnRXpwajJvVDF6YXBZQ3BtZ09ZTEZlRkpXZzF4MysyWnV6RlRkNmF1VDhJM3VxSTFsL1pOV2dLTldiT0ZwaVpnaXQzMTNBbHM1bGdremdiQm10REs0R2QyelRUeS9ONmowU1YwZVBQN1ovWTZVLyt3K3RCcVlWb2gvQWVlalJ2YStSd1BOQmxUZFk4NzA1M2JLam8wUHZmdUcrbWtqTzh5bEltdm14bldNR0VGaFgwMmEzRGZPQlRPREwzRzhZOGdicWZ6MDNNTzRaN0RyNjJQYmE4aHd2TUJpT1RsV0piUjBIZ2JvN0x0dDZlTklDSUJQNGN0MlR1OUZUdmVtcHE3TVBhOHhjSHZwazF4ZDJWSVJ5KytmaGFBVVY4d3lQc1E4V3UrTWxyQUpIbGtXcCtFejlNaU9MZ0w5aFEwOWl6c0U5eWNIT2p5ZmNmUGFoUDZ2QzZILzNZdTUrMjRwWjh5Q3VQRGdBdU9ES1pReUg1R1lCbThBZnJWdHU2T3dOeHJaNyt1Tnpvb2RrMzRXUFJvWEc5Sno5aVdiZllRd0MzNFFzRHc0QTNFeC9pSFNaaVMxRVdZRWFQUTIrMkphZm5wMmJpdTBiNkhobDM0TnJvK0djNlFGRkRKN0NrYTIwRU56UWdLR1RPQXZJUEhqMHdISkRGQUJnL2tqTlRkN2V4Snl4cXpMZTMzcHN3TlNGS3lkL3B0bDc2Rkl1ZnM4cXFYK3dIcHRiQWxkbS9BeUc4MTNtZ3V4U0xicGxMVHVlUm45MHk4OVB6ejNaeE96dWJuMWw3ejNiSzRJNXlJc3owRENNQlVTeTk5a0NDKzJvS1B5MDM2V0FUT0JzcFRjdkZnaHRmTzFublZtOFNIOS8xK0U5ZDIrdkRmcFd2eCtDWVJDNGljR0kyWVRYYmNLNXpFUW04SlVud0x4TjRZck52M203Sjh2Tkh4cnFQbkxEdmgyTjBkQXFLNUU0RHFCQk1uelRpamU2NjExY2plRFRJQlA0YWdqN3cydTMvcVl6MjVDVWtaSHVFelczNzk1WkhneG4rYTlMaHJzNWdtVW1oZy9aWE1vMlJVamdpN09xbStlcThVZjIvT3hvWjdhenZ1UHh6dGFYdDkrNWVXM0lIMWlwQStROHYxdmlsb2dtVFd4cFFnQUlORzI0ak9EVFB3ZGtBbCtsZXdvRnduVW5mMzRxNjFCbE1URFErVjdOcmwxcm1zdTl2aFhHS2lpYStaSE00WitGTzdyNS9jSWZtN1E0eUFRdWpOVkpTS3NzcTd6aHRXZXZaajhwTmg3dlBQZGliT3Z0R3hzaVh1L3ltOFlaYUJpa3BlUG9HSmdGRDI3d2s4QVhaZlhINFBoOFpiRzdEejNYTnB6OVAwOU1kTFllcnRpOGExMWpMT2oxTE0rUk0rN0ZFSU1qWEdJQ0FBVFdWbUhZa2owYlpBS1grdXB2WDZpc3ZHTG5zeDkwelZjN0hoL3Z2UEJXc0dIN2xvYWFXTUNyTDBQa0hNTUpmbUFnckdRQ2dMZmgza0tNRjFzdTJBU2VpM3ZIeThzaXpaOGNlcjkvM3JuS2s1UGRiU2Y5NGRwZG01cENJWi9iN1Y3U1RtV0o0aWp2M0Z5ajNPT0tiQXFSd0JlRDVVWkRycXBReFk3VHIzelVNemp2UzlMOUFHZVArZnoxRFd0cUttb3J2QzYzcnJrVzFya3BGcDJjV0Fnd1ZqSUJBSHkxb2NWZlZIQ1FDWnpuSUVRQkFBQnZYWG5WOWd0dnZkVTV0RURVbk80SHVCaDB1ZnlWNjZvclk5RkkyTy9XZFUzWE5KZVd6WTc0K0VLL3JHQmdPYU5uTnI2cTlSZFFuSlJyQVpuQW1UOW5OOC9uaTFSdE9uRGsxZjZoZWRhYlV4akRBSERodUZkeis4dktxaVBoa0tjODRvc0VQWnJHT0dlTVh6dFVSUW94OW5FM0Rtbmg5T0I2Wk92YkMxNXFXMEFtY0hNeWh6ZlA1d3RYcjN2ZzZ1SDNCdm9YOHl6eE9BQ0EyK3ZpVE5QZDNtQjV1ZHZuMTduTHJic3lCbWljR1NuVHZIUUJSWm9BMlMyN2poNW84WlBBRjhITTdmQnJqeWRTMDdMemlST3ZuQjljeXFWUFgyOFg0aTdPR1dlY2N3QWhHUU9RVEpvSkZLTzVrYVlKQVh6MVlReHpZNndnRTNqT0g3NDhHSXpXcnIycjlZUFgrZ2F5bGZEblFhQ1FjbllNcENFS2VFSlY1ekFzVWl3Z0V6alhjeC9sZWp6bFZRMDNmdTc4NFE4SEIvQXRncGJQeWxybUM0Q25mT1BINkRhdUlSTzRGSGxaeHZsODBkcW0zWjFuWGo4L091UjRqUzluT0ZKQjBRUHJ2Q1R3aGNsYktVVUxCcXNhTnUxck8zRzBiWFFFMTREZjVaS3JUR3J1OFRlZ09NVElBaktCNS9NWVg3YzdVdE8wNDdIT3l5ZVBEMHdNbzZpNnJ3Z2RxUU1IMEtQQnhWOVVZTEFKUEwrblpYczgwV1R6enZ2Nk9zOGVhNDlQRGpzeldzRTMyZW9hM3FwMTU3QmRVMlFDejM4WjJ1c3RyMjdhY3ZzWGgzdXVIcjA0a1JwZFJtb0ZDV2l6S09BS3JDdkRsZ25ISnZEOExES3R1RndoU0UrbUpqL1RPOWgxN3VSNElwMmVtRE1aQ3pFTTMvVE5hVFFmdXBGRTZBU2VLZEROYzdzQlVtdFRpUWx2Vjk5ZzcrV0w0L0dNa1pwTXIzSy9SVUhBdWVFQkFBQThWZWdHVEdNVGVDSFBZZmQ0Z21BWXNVdzZtVXJHUnliR3U4NU9KQ2NtMHFZRU01TTJEQ0dFRUNZRHhvRUJrMUxtTDhlekxEaGVnYnZMMFRVVUloTjR3Y05MWGZjQ2dHbGtERE9UVEpnaWxVZ2swNW4wWkdJc2t6VFNtWFJLZ0l0THByR0VJWmpJR0pJTHd4QWdnWE9oZ2NsTm5Xa3AwNlg3VFNrQW1BQ2ZiZ2h1bUxxWk1uVVhaOXlkbGpvM0FGSnVWM3JDNEI1ZkpnT2NDY0ZCU2dCbVpqd211RE9tUjJycGpGczNUQ0VZR0libUVwSzdQSm8waEV5TmpNWFZ6bllYV24yREoxWjdGbGt0RTVuQW1UMDVNRzM2N0FZaFRHbElZWmdad3hSQ1NpbUVCTVlrWTFPWkM5T1UzQlJTQWdEalFtT1NDUVk4SXpTbUN5a0JKRENOZ1FRcHVSU1Njd2FNVGJXeWdPQk1tb0p4TGlXQWxKSUJnQVJnZ3B1Z1NjRWxOMDNPaFdRU3dCVGNaWERRTkM2RllhWUdMcjE4WE5sS2tNZE02bXB4aFJ0OHlJb015QVJ1OHdodWJwbTJmRjJKY25xa2xZU3BQS1prSURrQWdPU1NTYzJVbXRCTk50MVl5eVF3QUM0WmdKUU1nRTk5UFIzZFNHYXlxZitYVEFJQWs3b0pBSUpMSmdVREtUa0lCcEp4eVNRREJreENKalYyOC8vNGFHWnNsSWs0UlBGR3NhMHlrUWxjcEZHRXVWT3dyQkhUM0R1b0F5dyt4VlNiODQ5ckxGYVlkUGtENHcwblpnUXVKZHBTSnVobDJHekRaZzlhNTJRbmJtKzE0b2hXUExpb0FMakR5RHdtT29HVHdyUGhDaXQrSDIrRUF1QXFXLzJFMDl5Q1RlQkk5eHZhakZhbUNCeGJNVnpGRlFuWWJjSXNrQWtjM2ZsS09PRGVHWUV6YkVHQWloNVoxWFRUUElCTVVKZ2Z2elppK2R5N0VWOGpMUkJCZG1ZSU1vRlRnSklWdFlTYTMzN0xWY0k5WG1SQk9ES0I0emptQ1IrRzhzblBGS0loYllVd0RWdmlHWnZBRVQ5KzdjU24vRnRJdkJkSjF5bEVXUmdjeDhHalE5MS9KQkFIY3BvclFBSmZFR3oyNE1DU1BFV2RTZFU5eU80Z01uTVFPeWRiVVlNU2p2a2lhUUZrOFJNSjNBbElTNHNPNW10RUFsOFl5b05uUjAyY1lLNWtRdGF4dkhhQ3pCektvbVJGcWgvOEZLS0d5emt3alJhWkM0STRCV1lqVE8yUXhUb2ZIQUFBOURKa0RlSElCQzZkc091MzhJaWdjbGwweElVZXU3Wmt6UTgyZ1p2SXJnOE9OTFU4a01GNFZ2MDFHTFlOZGNnRURpaE93Y0dIWlR3UjVoQkZrc0FYQnUxUUczdEpLdi9XTUtlYTBObUdUT0FjOFV3RU83R3NUREI3Y0hRZ0V6aERsbVRDZ3FwcGJFR0FCYTRoVXhReWM2UkIzaWticXFZMXpLVk1FMXNsQTVuQWMzd0lWYkVnMVFjYllua0RNR3c1VEdRQ2w1UkZ5WTV5V1JoSEhNZVpoUnd1dVJUUUNSelo5Y0dCWlZtWm52ZGxDR0FDMlo0c2JBTEhNY0FWSDB6OUo3SXdWMFdra1owTmcwemdnQzJFdzRIbG92aXczVE1WbVNDQkw0UW8xQUI4aDZFdVRUam1ZcGlKcmRjUm04QVR5SzRQRGl4cmIyd1NzbUFra0gzNnNBbDhIUFBkc3cvMU5nbk1NYmd4U1FKZkNIT1NCSjROZFpxVmpuZ2hMak5qRklNdmhCaEhsbVhDQVZPdmlzQjIweFNZR0NFUHZoQkdrZ1NlRFRVb2tZaHJtVVk2aml4TmowemdxVEZzZVZRY3FCc2UzT2hhVW1jd0ppZVJuYXlMVE9DWkVVeG5tT0NCemZOdmJCaVRvOGdlTDhnRURtTkpFbmdXVk5Xa01JY29FOGdPV1VNbjhFU0NndkM1TUUxeDI1ajNPeGdqeUNJVWRBSlBKMUhQdGJFTHRYZ3BCZDRnSlRPQ3JkOFptOEF6NDdUSW5JdGwyRUFhc1FzMzR0ajhFemFCRzNFS1ViS0FXTk1xWXJJVDJ4SUttOEF6QThqeXFEaFFIMnRlYlBkc0JpTXhqdTMyWWJ0WTZSNXNxeFFVcUg0UnNjQlQ0OTJUZHRzd0Myd1hhL0xpZUhMeFY1VWM2bTFDdktzKzA5ZUhMWmJDSnZCMDl5QUpmQzdxdUJqRXEzQnpERnNhSEozQVlYd2Myem9jQVpaek1oSHZDVWtOeHUwMllUYm9CSjRhUnV5aGJFUGR5WWQzVjU5STlLRHpUdWdFbnV5Z0VHVU9FbHR1SWp0R3ZCT2RvZWdFUG5FS1hSaG5QOUxsQ0E4K09kU0pMWW1DVCtESlM0T2s4TmxJTmU1T0NHekZsR3RrZXJydE5tRU82QVFPNHdsMGNaenRNRTBSdUM3dzNiUXBFcjM0ZkJPK2E1VzRTa0g0YktRalB2T1orQVY4dHc2ZndKTVg4TGtCdTdHY3NvYjJFS3JrOEFWMElUaENnWStkSE1iV2NtazdYQzNQYzZ3bjBTWDd1dEVsVVJBSzNHaTlncTVhWURjeXBUaHRFMnNhSmQwN2FyY0pjOEVuY0JpN1N2MVdzeEFwcGZvbGtHNVpFeE9YOFVVb0dBVStlWDRNNXgyMEViVzZpL1VVd2NRNHhrY3ZRb0dQSCs4bkZ6NExqeVhzeHFud1ZOODVoSXNuaEFLSEFlb0pud1VQcVljNklPMlhUWFlQMm0xQ0ZqQUtmT0lLSlFxdE1OV0Q2MGhqbE1sekdHOGJSb0dQSFVlM045dG1aRkxSTkxhRCtxWko5SjBZczl1R0xHQzhXSW5qSFJTaldMQUlITjFKZlZOTTlsL0Z1RjhjbzhCaCtBb0ozSXBsdWl4RGVkTW1MdzdaYlVJMlVGNnI4VS9Ic0RiTTJRUExLRTdiQlJndlRucjRKTUl5RDFLQmozM1loYkJrWUNQTXBYemhSWGxPWnFMekkzeWRWb0JVNE5CekZlT0MzRWJVcUR1RE1vc1N2NEF4U1loVjRDTW5SdXcyQVJkcTVnVGxubFV4ZEhUY2JodXlnbFBnbzYrM2t3dFhzQ3dyVVhZVGpyZWR3SG5IY0FvYytxOWd6S25haG1US3VwSmg3QWNmdlRoZ3R3blpRU3J3MGRQRCtGcUw3VU9xcDZ5aHpLRU1mWXpUZ1dNVitNUmJWeEYycHRtRzVTNHhoTTFXOGJhUGNJYmdXQVVPdlJkb21UbURVRE53Ym9UTlZpT24rKzAyWVI2d0Nyei8zUjZrenp3N1lHbkZhWHZ3cGNHVFBlK2dMR01DWG9Gbi9uaVdYUGgxcExwTFRlSzdhYVBuTHFCTVhnSmVnVVAvdTcwVWhWOUhYV1RpaThETm9VK3dPbkM4QWg4LzBrWXh5blUwMUR0Nkp0b1BEOXR0dzN5Z0ZUajAvWEVFWTBMTUh0UUFRRWUzeGh3NmptOWsyelh3Q256dzRGV1U3V24yb0RodGpxMGZmT3pxU3pqN1VBQXdDeHk2VDlFeTh4cHE0Z1RkY203azVFVzhvK1VRQzN6b1hZU3pIRzFDSGQyV1JqYjRKOTUxdU05dUcrWUhzY0NUeHk4Z3JZNFZIRlhma0VTMk5CaysvZ0hpTGJTSUJRNTk3L1hpZmZRVkZsTngyZ3hYTjJHaTYxV2tmVllBZ0Z2Z1k0Yyt4YnQ0S1NoUzNaT0pMSXN5Y3VvNDV1MVhtQVVPWFVjSHlZVURBRENmSW1xTzZwNmwrOTdCMm9ZQ0FNZ0ZIbi9sSENWU0FNQmEyakZRaFNoRHB6OUEzYnFQV3VEUTlTYkNpZE0ySU9QcVhCUk1TWlJNL3hzOWR0dXdJTGdGUHZyU01jd0xtTUtocGxFNHBpMFB3MmVQb0cxREFRRHNBb2Z1NTJuakF3QllnaElkVVlneTJmRTYzaW85QUtBWGVQemo0NmlYTUlWQ1BVWlFNRHdqMGdZL09vaTJ6V29LNUFLSHZvUHQxSkVDbG0zR2lIYlZqN1UranpzQ3h5L3crTkYzK3hHRm5IYmh0dHVBN0F3ZU9ZWTlnc1F1Y09qODdTV3E5akMvdXFzZVRSWmwyUGd0OGdqY0FRSVhsOS9zbzJxUGlzU3k0U0haOTB3NytxY3Jlb0hENEhOb2Qyd1hEcFRWZ0tHVHYrbTEyNFpGd1M5dzZIaStBM3VnbDI5azJ0SnNaWjhoS2hQdEw3UWlNV1VCSENEd2ljUHZZbCtxNTUwMHZrcW1IUGo0TU80YUR3QTRRdURRK2ZOUFM3eWVhWmtQbnNBUjl3NmQvMzJYM1RZc0FTY0kzR3g3cTd2RXp6UlJCWTVqN3M5a3gzTWZJdDduY0IwbkNCd0dmMytxeEYyNFZMeTJocUhPSS9vL1BPaUllNkxiYmNDUzZQeGx0YS9DYmlQc1JNMTlZOUEzREozL2d6TVdSczRRZVB6OTMwZDlBYnV0c0JGdUdaOXN2OFFuMnA4LzRvd2Q0YzRRT1BRL3Z6YlE3RnI4ZFVVS1UzZnhJSmgvYi9hODh5TGluZlFxam9qQkFlRHFVNmNkRWZMbEI2bW1CcVg5Q3UvLzlKbE91MjFZSWc3eDRHQmNmcUhDVzI2M0ZiWmhhWkMxdlp0dzVPSXpwMUdlR1pnRnB3Z2NSbDZ1aXdTUU50WGxIYWxtVGpSdXN3ZWY3SDdqZGNjOFRoMGpjT2o4ZFhPb0hrY091UENvVHR2dXNSR1ovcFBQdE50cndqSndqc0RoeXIvVWU2dnNOc0llTEpLMmV6WmgvOGwvdW1TekNjdkFRUUpQZlBwMFNJL2FiWVU5cUtLMmVYVGIwTVduUDNKR2hoQUFuSk5GQVFBWWZPblpUc3hEbFBLSFNLdVZURnZ6NEtNZGYzak5BVDFXMTNHUUJ3Zm8vazJEdDhsanR4VjJvSllBQW5ZdU1sTTlMejNyaEI2cjZ6aEs0SEQxeVVwUGc1TWVPam1DcWJkSnQxSGdvdmZvMDFkc2UvZVY0Q3lCbTFkK0hIWlZsNTdDcFJxRG04eStFS1gvK0M4dm9OeGROQzhPRTh2NHNYOGRRRDZJSXg5d1hhbjBaT3piZFR4NDlsL2ZkOWpNZG1kNWNJQ0JWeXUrb2tYc3RxTFFTRU54MnZiNTc4RUx6eHh5bW50eG1zQ2g1emRWWHEvWGJpc0tEYk9jazJtVEJ4L3ZmT0YzK0hjWno4SnhBb2YySDVYcERhWFdPcXYyb3RnVmcwKzB2L2lMcTdhODgycHdXQXdPQUxMMSsrOTBsdGcyZTZubXdaazlBbzkzdmZvdnJYYTg4ZXB3bmdlSHpLVi84T2tOcGRWM3BmYmdlR3h4U3NudU4zOTgyWTQzWGlVT0ZEZ2t6LzV2cjE1YlN0c2ZXRUFSdFc2SHdKT2Ryejk1d2U0dW1KWGdSSUZENHV5dnZLeldrYWF2RE9hMWVjdWEwWFh3eWJPT2JKTndwa3BHRHNXL3NhdXVoS0tVdUtKcG8vQjU4SFRYdXovNjFKbVRPNXdwY0JoK0ovSFhVTzJ6MjR5Q29kNG1XZkJ1d2xUM0IvOTh6cG42ZG1BV1pZcXhqMy93eCs2U21Ub3IxZllUczlBQ1QzVzkrLzFQVUIrbHRnQU85ZUFBSSsvSC80YVhUSlJpS0tMT0ZEaENTWFMvL2YwekRpdlF6K0JZZ2NQWWllL0xXMnRMcEtacHFLSXVyTURqWFVlZVBPWGN1b05UUXhRQUdQL291NGV2T25KbHYzelVxS1N3ZXpJbnJyejRmNDQ3Vjk4Tzl1QUFFeWYrdjdIN21vSjJtMUVBcEZxOExPaHN3ckgyWjM5MTBRbEROdWZEeVFLSHlVLy85OWlqalRHN3pjZy9Ga2tYc2xRLzFQSDh6ODdiUG1kb05UaGE0SkMrOU9UNDU5WlYyVDBJSis5WVpsbUpnZ1hoWXFEMTkwOWZjclMrSFM1d0VGZWU2bjFpVTIzUkoxTU15K2kyQXIycDZEMzlxMWM2Q3ZSbStjTGhBZ2ZvZm1Ib2lUMzF4Vjd5OGFnUHFRSXBQTk45NXFlSEhESmljMzRjTDNBWWVMUHJxdzgwRlBkU2s2c0M1NFVKVWVMZEgvejBqODQvb3RUNUFvZXhVLzh3K2xoRFVjL0h0L1NERjRhQnprTlBYWGJRZ0ovNUtBS0JRL0xTRDNzZXY2R3lxQU54eFdrWG90ZEs5SjMvM1hOWG5kZ2VPNXRpRURpWUhiKysrdSszVllmc3RpTi9hRXBCenNpL041L3NQZlhNUVVmTjk1bVhvaEE0UVA4N0ExL1pXMWRadE1Obk00ckF6YnkzRXc1MXZQbmJVODRQdndHZ2FBUU9JOGQ2enoxMlE1WGZianZ5aEtwcFBjOEhDV2I2TGp6N1lxZER1MlBuVUN3Q2gzVHJyMDUrZlU5dGNhNDFMZTJ5ZVM3MGpIY2RmZTd0L255K1EwRXBHb0VEREg3WSsvZ0RhNHV6NktNdUxNMzVYN1o2SmdkYlgzcmhpbU9iWStkU1JBS0h4TGtmbmZ6cXRxcUlnenNrNTZVd2xjek1VTjhIejM3a3VPRStDMUZNQWdmb2VmUEtnUWRib3NWWDlkRUxNcnB0cFAvYzg0ZXZGRXYwUFVWeENSekdUM2QvOEdlNzY4cUw3TSt5bnRHVHB5ZVVNWERsamQ5ZGRueHRmaGJGcGdTei80T3VBd2MyeG9vc0oyNHFBbmZsUitDamZTZWZlNmZMeWEzZldTazJnUU1rem84Y2UreXUybGlaM1lia0ZDWHVkdVVqUmtrTXRyMzl1d3RPT3B0a2lSU2Z3QUg2UnR1T1BIeHpkYlI0Sm5SS2RTZDlKdmNDVHc1M3YvZmk2YTVpbkZKUWpBS0hWUHZROFQzMzdhbUtGVXNYcmN3b3VjR2NuMkJpRFBjZGYrbjliZ2R2dkZ5QW9oUTRRTHkxNzVPNzc5dFpFU21TQ1lZeWY4MVdZcXp2ektIWHUwWnora3Z4VUtRQ0I0aWY3enY2MEYwYkl4WEYwSi9DbU5wc2xjdEV1RGsyZVBtdFYxdUxwUEVrQzBVcmNJQ1JzZTdYOTkrenZpSlVCSCtqVkFRdVpNNkNjR044OE1KN2g4LzMybnUwYkY0cGdwcy9MNkovdU9Qd3ZYZHNpRGsrVUdHUWowS1BHTzQvZS9TdFMwUEZ1TGE4VGpFTEhNRG9IYng0YVArK3Bsakk0Uk93dE56UFJVbU9qWng1NDdYZWdaejhNcndVdDhBQmpJSGh0cGYzMzdrK0ZuWjAwbEM5VFo1Y3JDcFNBNFBuUHp6WVB1anNtUkJMb05nRkRtQU9ETFMvY3ZzdE95ckRaWTV0TkdRdUpVcVcrbW9qTGprMjB2Zko0V045eFMvdlVoQTRBQXdOZFJ6YWZOZVdsdkpnMEtFemdzWVZLWEsrdWo4aU9UcmNldXI5NC8xT0hZaThQRXBDNEFDam85M0hLbTdmMDFKWDduZWt4bDNLZlZxTnZtVWlQakZ3NnYwUCtrYUtxMmR3ZmtwRTRBQ3AzdDcyVjJwdTM3VWxWbGJtdUkxdDNLdmNwNVV2TWxNVG8vMlhMbng4dXI5WXF6cFpLQm1CQThEWVdQdkY1OWZkc3EwbEd2RDU4dFNUbHlkU2xqMlpLMklpUGpGeTl1U3BzOE1UNmR6WTVBeEtTZUFBTUR6YzhYRms0MDNOamZXQnNvRFBNVVZPcGxxcUxiK1NhVXpHeDdyYXpwMjRPRFJlVXVxR2toTTRRR1pvcU9Pb3YzelQ1dlZObFdVK245Y1JGNENyNTJTS1pUV2ptSWxrT2pIZWVmNzB4NFBqOGFMcjlsNGNSOXpmSEpNZUd1cTQ5SHFvWWRPYSt1Wkt2OC9yOVdCZmR6SlYwbW14eE1xNmtVZ21Nc21oenU0ckYxcUhKNHBnRE50S0tFV0JBd0JNVGc1ZVBlRUpOR3h2cUtpcjhYbmN1ay96SUM3b20wcTdyRmhjNERLZFNpZFRrOE5kUGIydHJZUGp5Y2xpR01LMk1rcFY0QUJnamdKY1BlRnhsN2VzQ2NVcXE4cDlIby9McmJzMERkL3lNejJzdHN0bUZoZ2NJZFBwZENhZGpQZDM5dlQxdFBlT3BkS2xrZytjaHhJV09NQ1V5RHN1K25TM1AxcFhWUjZPUnNOK3IwdlhOQmZuakRIR0dFejlIMmNTR0FNR2tnTXdBQ1pCY01tNGxKb0VBQWxpYWh2QzFHdllkSHZVOUZralVnSkltSHFkOHVGaGtvSGtna3NKVERKNTdjZW1mMFpJS1lFeEpwbE1UNDRPS0U1N3ZHOUVjRTFqQXBnVW1tQVNwSkJDQ0dHWVJpWTFOdGcvT0RUWTBUVWVUNlZMNUlTdUJTbHhnUU1BUUNJQkFNeXY2N283R1BZR0EwRy9QK0RYZFYzWE5NbGR1cVpwR2dkRHVKaGtBRnpUTlNFWVo0YktPVllyQUFBQi9VbEVRVlJ1Y2wwQ0E1QlNTaUdCTXdHY1M1QUEyblF4aGpGZ3dLU1FJQUVrZ0NrWmsxT0g3QWdBeHBtVXBpYmsxTXRBU2puMVVlSWNoQ0VaQTJDY1M1RWFPUEsya3Z6by91Rnd0Y2E5bWpDRVpNd1VYQlBKdEdHazQ1T0owZjdSd2VHSlpFYVV1dCtlQWZ2eXF2RG9ubW4zelRsbkFKd3hybWtNVE1HNXlUVEJOWmZMU0VzTlRBMllXNWlTTVpCU2dnQzNuamFaWmdDVG9MczFBeVFJQ1V5VExpMmRtZkxTbW1rdy9Wb0V6U1RqWEVxRFNjbWxaTUM1RUpKellGSnlEY3dNNkJ5RVlEcEFlalE1cE9RL1dOVHYwWUM3d0JDU0FRam1ocFJobWxJSUk1MHF0U3dnUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVRUkFFUVJBRVFSQUVmdjUvTGhHVFB6MmdCWGtBQUFBQVNVVk9SSzVDWUlJPSIgaGVpZ2h0PSI3MjYiIHByZXNlcnZlQXNwZWN0UmF0aW89InhNaWRZTWlkIG1lZXQiLz48L2c+PC9nPjwvbWFzaz48L2RlZnM+PGcgY2xpcC1wYXRoPSJ1cmwoIzI3YzlmNmY1MWYpIj48ZyBtYXNrPSJ1cmwoI2VmZTYwNGIyNzIpIj48ZyB0cmFuc2Zvcm09Im1hdHJpeCgyLjQ4MDI5OSwgMCwgMCwgMi40ODAzNzIsIC0xNjAuMTA5NjMxLCAtMTcwLjQ1OTUyNSkiPjxpbWFnZSB4PSIwIiB5PSIwIiB3aWR0aD0iNzM2IiB4bGluazpocmVmPSJkYXRhOmltYWdlL3BuZztiYXNlNjQsaVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQXVBQUFBTFdDQUlBQUFDSW43SHVBQUFBQm1KTFIwUUEvd0QvQVArZ3ZhZVRBQUFTaFVsRVFWUjRuTzNkMjNvYVdiS0ZVZWl2M3YrVjJSZlNwbFFJUVFKNW1CRXh4blhiVFZsYXdiOGlzWHc2QVFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFOT2NqMzRCVU1ubGN0bm9kejZmbnh6RzdmNnYyY2ZUTHpId2t3TURkeHhTQXcvZXdOUkpiOW9GZm5NcUlPWHQvNjkzcVpDWHg1NGtDL3h6OUF1QUEzakxKOXpOdDZoZVlTRGY5RXhSSWtydXZnK1ZlT1hzUnF3d2hBMEtuWGxycDUrZjM5VmloY1lFQ2czcEVvYTRmcXNyRmZvUktQU2hTeGhMcWRDUFFLRThYUUpYU29VMkJBcFY2Uko0UUtsUW5VQ2hIbWtDeTMyZEY1bENPUUtGTW5RSnZFMm1VSTVBb1FCcEFxdVFLUlFpVUlnbVRXQjFQcDVDQ1FLRlVOSUV0bWFoUWpLQlFoeHBBbnVTS1dRU0tBU1JKbkFVbVVLYS94MzlBdUIwT3AwdWw0czZnY001aHVTd1FlRmdCaUpFc1VvaGhBMEtSMUlua01sU2s4UFpvSEFNc3cveTJhWndJQnNVOXVabUJyVTRzQnhDb0xBcmt3NHFjcTlnZndLRm5SaHdVSjBqeko0RUNuc3cxNkFITncxMkkxRFlsbkVHL1RqVTdFQ2dzQ0ZURExweTkyQnJBb1d0R0Y3UW5tUE9kdndjRk5ablpzRWNmbFlLRzdGQllXWHFCQVp5OEZtZFFHRTFua25EWkk0LzZ4SW9yTU5zQXR4U1dKRkFZUVZHRW5CbElMQUtnY0tuRENQZ2hySEE1d1FLNzdQT0JmNWlPUEFoZ2NLYlRCL2dNVk9DVHdnVTNtSHVBRXVZRmJ4Tm9QQXlFd2RZenJOZzNpTlFlSTFCQTd6QjZPQlZBb1VYR0RIQTJ3d1FYaUpRV01wd0FUNWtqTENjUUdFUll3VlloV0hDUWdLRjV3eVVmZmozWUJuQ1NHRUpnY0lUUmdtd09vT0Zwd1FLanhnaXdFYU1GeDRUS1B6SitBQTJaY2p3Z0VEaFBvTUQySUZSdzE4RUNuY1lHY0J1REJ6dUVpamNNaXlBblJrNy9DWlErQTlqQW9BRUFnV0E0N2tkY1VPZzhDOERBamlRRWNSUEFvVnZSZ053T0lPSUs0SEM2V1FvQURHTUk3NElGSXdESUl1aHhFbWdZQkRrOExVQXVCSW9BTVRSNndpVTBZd0FJSllCTlp4QW1jdmhCOElaVTVNSkZBQWdqa0FaeXIwRUtNR3dHa3VnVE9UQUE0VVlXVE1KbEhFY2RhQWNnMnNnZ1FJQXhCRW9zN2lGQUVVWlg5TUlsRUVjYjZBMFEyd1VnUUlBeEJFb1U3aDVBQTBZWlhNSWxCRWNhYUFOQTIwSWdRSUF4QkVvL2JsdEFNMFlheE1JbE9ZY1l3QXFFaWdBMU9QMjFaNUE2Y3dCQmhvejRub1RLQUJBSElIU2xyc0YwSjVCMTVoQUFRRGlDSlNlM0NxQUlZeTdyZ1FLQUJCSG9EVGtQZ0dNWXVpMUpGQUFnRGdDcFJzM0NXQWdvNjhmZ1FJQXhCRW9yYmhEQUdNWmdNMElGQUFnamtEcHcrMEJHTTRZN0VTZ0FBQnhCRW9UN2cwQUo4T3dFWUVDQU1RUktCMjRNUURRakVBQm9CVjN0aDRFQ2dBUVI2Q1U1NjRBY01OZ2JFQ2dBQUJ4QkFvQUVFZWcxR2FOQ1hDWDhWaWRRQUVBNGdpVXd0d1BBT2hLb0FEUWsxdGNhUUlGQUlnalVBQ0FPQUtsS3F0TGdLZU15cm9FQ2dBUVI2QUFBSEVFU2ttV2xnQUxHWmhGQ1JRQUlJNUFBUURpQ0JRQUlJNUFxY2Z6VklDWEdKc1ZDUlFBSUk1QUFRRGlDSlJpTENvQm1FQ2dBTkNmMjEwNUFnVUFpQ05RQUlBNEFnVUFpQ05RS3ZFTUZZQWhCQW9BSTdqajFTSlFBSUE0QWdVQWlDTlFBSUE0QWdVQWlDTlF5dkR4TG9BUEdhU0ZDQlFBSUk1QUFRRGlDQlFBSUk1QUFRRGlDQlFBSUk1QUFRRGlDQlFBSUk1QXFjSGYzUWRnRklFQ3dDRHVlMVVJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJRkFBZ2prQUJBT0lJbEJyTzUvUFJMd0VBOWlOUUFJQTRBZ1VBaUNOUUFJQTRBZ1VBaUNOUUFJQTRBZ1VBaUNOUUlKMi9aQTRNWlBCVmNybGNqbjRKYk90cGkvZ2V1RHFmejNmL05MYm9PWC9zellqK0VueVJLakVsMnpNM0ozQ1FEK2VnbGZEUDBTOEFZSmJmNzQ2U0JYNFRLSkRDclc2c3UxOTYxY0p3QWdVZzBjOXFFU3NNNU1aV2pEblZtQTBLQzVrREgzTFdTckJCQVNqbSt2NnFWR2hNb0FCVXBWUm9US0FBL01jcWIvWTdQMFJRS3ZRalVBRCt0ZFliL0pMZlo0dUlVU3EwNFlOQzlaZzdYZm5nWG9MRHo5ZnEzd2FIL3hjRmN0WktzRUVCK0pid1huN3pHajUvSzdWVG9TaUJBcERyWjFWOEdDdGZ2MXltVUlVMVYwbEdURXZXem9jcmRMSSsvRzRwOUYrNkJXZXRCQnNVZ0hvKzNLeDQ3a00rZ1FKUTJ6VXkzaTRWbVVJZ2dRTFF4TnVsSWxNSTVEbGNWVVpKUDU2TEg2N2ZzWHJqbTZyZkg4SnZ6bG9KL3p2NkJRQ3dsY3ZsOG1wd25NOW43OThrRUNnQXpWMyszL0pmb2xFNG5FQ3B5dmdBWHZWU3BsaWxjQ3lCQWpDTFRLRUVnUUl3a1V3aG5FQUJtT3ZWVE5uMHhjQlBBcVV3d3dKWXhmSk1zVXBoTndJRmdOTkpwaEJHb05SbVJnRHJlaWxUdG40eFRDWlFBTGkxTUZPc1V0aU9RQUhnUHFzVURpUlF5ak1hZ08wc1g2WHM4R0lZUmFBQWZQTXUreGVQZTlpZlFBSDROdUVmOG4yYlZRbzdFeWdkbUFqQVBqUUt1eEVvQUx4Z3lTckY0eDQrSjFCcWVQcXZwWnNGOERubmFEbXJGTFltVUlyeGpCeTI0M3k5Wk9FcVpaOFhRejhDcFo2L0pvSkJBT3hQbzdBUmdRTEFSNTZ1VW53a2hUY0lsSklzVVlBMFZpbXNTNkFBZlBNTytpR053b29FU2xXV0tFQWdqY0phQkFyQU4zK0xaeFZMUHBLeTI0dWhMb0ZTbUNVS0VFdWo4Q0dCQXNBbU5BcWZFQ2kxV2FJQXlUUUtieE1vQUd4SW8vQWVnVktlSlFvUVRxUHdCb0VDd09ZMENxOFNLQjFZb2dENU5Bb3ZFU2dBN09UeGowalJLUHdrVUpxd1JBR3EwQ2dzSVZENmMrQ0JOQnFGcHdSS0gzNUtOOUNEUnVFa1VJWncyb0UwUGpQTFl3S2xGVnRUb0JDTndnTUNwUnNQZW9CQ05BcC9FU2lET09wQUlOY3E3aElvRFRudFFDMGVUL09iUU9uSmowVUJhdEVvM0JBbzR6anFRQ2FOd2s4Q3BTMUhIU2pINE9KS29IVG13eWhBT1FZWFh3VEtVTzRpUURrRzF5Z0NwVG43VXFBY2c0dVRRSm5BVVFmSzhhQUhnVEtDb3c2VTQ4Y2xEQ2RRcG5QVWdYSU1yZ2tFeWhRZTlBRGxHRnlUQ1pSQkhIV2dIRStveHhJb2ZOTW9RQ1lmUnBsSm9NemlMZ0owb2xFYUV5amplTkFEbE9OeU5aQkFtVWlqQU9WNDBET05RQmxLbzhCdnZ2bUw4b1ZyU2FCd2g5TU9CUEtnWnhTQk10ZmpvNjVSZ0VBZTlNd2hVRWJUS0FCa0VpalRhUlNnRmt1VUlRUUtHZ1VvUnFOTUlGQTRuVFFLQUdFRUN0ODBDbENJSlVwN0FvVi9hUlFBUWdnVS9rT2pBRlZZb3ZRbVVMaWxVUUE0bkVEaERvMENsR0NKMHBoQTRUNk5Bc0NCQkFwLzBpaEFQa3VVcmdRS2p6eHRGQ01BZ0MwSUZKNTQrcytIYWhUZ1dKWW9MUWtVbnRNb0FPeE1vTENJUmdHU1dhTDBJMUJZYWttam1BVUFyRUtnOElLbmpYSnlYd0VPWW9uU2pFRGhOWmZMeGVNZUFMWW1VSGlIeHoxQUlFdVVUZ1FLYi9LNEJ5akVPQ3JIRjZ5R0pUVndpQ1ZuUHZiRnB6RkFFL2gyYmNCUjZzRUdoWThzL0VpS2VRSEFTd1FLSy9DNEI0QjFDUlRXc2JCUlpBcXdOYy9wZWhBb3JHYko0NTZUVEFGZ0FZSEN5aGJlWFRRS3NCMUxsQVlFQ3V1elNubVBrUXB3SlZEWXl2SlZpa3dCNElaQVlVTUxWeWtubVFLc3pVcXlPb0hDNXBhUENZMEN3QmVCd2g2c1VvRDlXYUtVOXMvUkw0QkJ2b2JGa3Y2NC9tL01GNENaYkZEWTIwdk5ZYUVDTUpOQTRRRExuL2g4a1NuQWUyeGg2eElvSEVhbUFQQVhnY0xCWHIzZnlCU0FDWHhJbHVNdC8vRHNsVS9SQXZUbUpsckRuTGZodDdjalBmNklMSWNPMStNYmlSdE9Wa1UyS0dSNVk1dnl4VTRGb0JPQlFxSzNNK1drVkFCYXNQV3FZZmg3N1lmcjJVSi9laGJSaHl2MDNjSkxISzV5YkZBbzRKT0Z5czB2OVBZRFVJSkFvWXhyVzN4eUV4SXJBQ1VJRk9yNWNLRnk5ZnQzT0RaWnJLQUJyZ3pFR3R6MUg5ajBmWDNQUDNtQmtzQlphOHdScThVR2hmSldlZlR6bDhlLzU0cHZaa1lud0U4Q2hUNDJMWlc3VkFYQVJnUUtEZTFmS2dDc1M2RFEyYzlITUdJRm9CQWp1d1lmM0Z1WFdPRXZ6bHB2em40aE5paE1aTE1DRUU2Z01OM3ZHN05rQVRpY1FJRmJENWI4MmdWZ0h3SUZYckRkQnhTa0Q4QlBabUlOUHJnSGE5bnRoKytSeVdXZ2l2OGQvUUlBZGlWQm9BU0JBb3lqVVNDZlFBRUE0Z2dVQUNDT1FBRUE0Z2dVQUNDT1FBSDQ1c096a0VPZ0FEQ0lESzFDb0FBQWNRUUtBQkJIb0FCODgwUFFJWWRBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBQVFEaUNCUUFJSTVBcWVGOFBoLzlFZ0E2TUU2ckVDZ0FRQnlCQWdERUVTZ0FRQnlCQWdERUVTZ0FRQnlCQWdERUVTZ0FRQnlCQXNBVWZnaEtJUUtsRE9jS2dEa0VDZ0FRUjZBQUFIRUVDZ0FRUjZBQU1JSlA4dFVpVUNweHVnQVlRcUFBQUhFRUNnQVFSNkFBQUhFRUNnRDkrUXhmT1FLbEdHY01nQWtFQ2dBUVI2QUFBSEVFU2oyZThnQzh4TmlzU0tBQUFIRUVDZ0FRUjZBQUFIRUVTa21lcHdJc1pHQVdKVkFBZ0RnQ0JRQ0lJMUNxc3JRRWVNcW9yRXVnQUFCeEJBb0FFRWVnRkdaMUNmQ0FJVm1hUUFFQTRnZ1VBQ0NPUUtuTkFoUGdMdU94T29FQ0FNUVJLQUJBSElGU25qVW13QTJEc1FHQkFnREVFU2dkdUNzQVhCbUpQUWdVQUNDT1FHbkNqUUdBVGdRS0FIMjRyYlVoVUFDQU9BS2xEL2NHWURoanNCT0JBZ0RFRVNpdHVEMEFZeG1BelFnVUFDQ09RT25HSFFJWXlPanJSNkFBQUhFRVNrTnVFc0FvaGw1TEFnVUFpQ05RZW5LZkFJWXc3cm9TS0FCQUhJSFNsbHNGMEo1QjE1aEFBUURpQ0pUTzNDMkF4b3k0M2dSS2N3NHdBQlVKRkFEcWNmdHFUNkQwNXhnRHpSaHJFd2dVQUNDT1FCbkJiUU5vdzBBYlFxQk00VWdERFJobGN3Z1VBQ0NPUUJuRXpRTW96UkFiUmFETTRuZ0RSUmxmMHdnVUFDQ09RQm5ITFFRb3grQWFTS0JNNUtnRGhSaFpNd21Vb1J4NG9BVERhaXlCQWdERUVTaHp1WmNBNFl5cHlRVEthQTQvRU11QUdrNmdUR2NFQUlHTUpnUUtBQkJIb09DbUFtUXhsRGdKRkw0WUIwQUk0NGd2QW9WdmhnSndPSU9JSzRIQ3Y0d0c0RUJHRUQ4SkZBQ09wMDY0SVZENER6TUMySi9KdzI4Q2hWc21CUUNIRXlqY29WR0EzUmc0M0NWUXVNL0lBSFpnMVBBWGdjS2ZEQTVnVTRZTUR3Z1VIakUrZ0kwWUx6d21VSGpDRUFGV1o3RHdsRURoT2FNRVdKR1J3aElDaFVVTUZHQVZoZ2tMQ1JTV01sYUFEeGtqTENkUWVJSGhBcnpOQU9FbEFvWFhHREhBRzR3T1hpVlFlSmxCQTd6RTBPQU4veHo5QWlqcGE5eGNMcGVqWHdnUVRacndOaHNVM21mMEFBOFlFWHhDb1BBUkF3aTR5M0RnUXdLRlR4bER3QTFqZ2M4SkZGWmdHQUZYQmdLcjhDRloxdUZqczRBMFlVVTJLS3pKZUlLeEhIL1dKVkJZbVNFRkF6bjRyTTRqSHRibmNRL01JVTNZaUEwS1d6RzJvRDNIbk8zWW9MQWhxeFRvU3Bxd05Sc1VObWVRUVRNT05Uc1FLT3pCT0lNZXp1ZXo0OHcrQkFvN01kZWdPa2VZUGZrTUNydnlxUlNvU0pxd1B4c1VEbURZUVNFT0xJZXdRZUVZVmltUVQ1cHdJSUhDa1dRS1pKSW1IRTZnY0R5WkFqbWtDU0Y4Qm9VVXhpSWN6akVraHcwS1FheFM0Q2pTaERRQ2hUZ3lCWGFqUzRqbEVRK2gvR0EzMkpvalJqSWJGS0pkQjZpRkNxeEltcEJQb0ZDRDV6N3dPVjFDSVFLRlNtUUt2RWVhVUk1QW9SN1BmV0FoWFVKZEFvWENsQXI4UlpwUW5VQ2hBNDkrNElzdW9RMkJRaDhXS295bFMraEhvTkRRejJFdFZ1aEtsTkNiUUtFNWF4V2EwU1VNSVZDWXdscUZvaFFKTXdrVUpycVorSHFGS0lvRVRnSUZUbnFGb3lrUytNMnBnQmRvbHg0ZUJNR21YMkloQWdBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQi8reit2RDBkQ2xibEpld0FBQUFCSlJVNUVya0pnZ2c9PSIgaGVpZ2h0PSI3MjYiIHByZXNlcnZlQXNwZWN0UmF0aW89InhNaWRZTWlkIG1lZXQiLz48L2c+PC9nPjwvZz48L3N2Zz4=";

function AuthGate() {
  const [view, setView] = useState<'sign-up' | 'sign-in'>('sign-up');

  return (
    <div className="min-h-screen bg-[#050a12] relative overflow-hidden flex items-center justify-center px-4 py-10">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-blue-600/[0.06] via-blue-500/[0.02] to-transparent rounded-full blur-[100px]" />
        <div className="absolute top-[40%] right-[-10%] w-[400px] h-[400px] bg-gradient-to-l from-blue-600/[0.03] to-transparent rounded-full blur-[80px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[500px] h-[300px] bg-gradient-to-tr from-blue-500/[0.025] to-transparent rounded-full blur-[80px]" />
      </div>
      <div className="fixed inset-0 pointer-events-none opacity-[0.012]" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`, backgroundSize: '64px 64px' }} />
      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        <div className="mb-6 text-center flex flex-col items-center">
          <img src={RELATCH_LOGO_DATA_URL} alt="Relatch" className="w-14 h-14 mb-3 select-none" draggable={false} />
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

  const [currentStep, setCurrentStep] = useState<AppStep>('upload');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [config, setConfig] = useState<SkillConfig>(DEFAULT_CONFIG);

  const stepIndex = STEPS.findIndex(s => s.key === currentStep);
  const canGoNext = currentStep === 'upload' ? files.length > 0 : currentStep === 'configure' ? config.skillName.trim().length > 0 : true;
  const missingSkillName = currentStep === 'configure' && config.skillName.trim().length === 0;

  const handleFilesAdded = useCallback((newFiles: UploadedFile[]) => setFiles(prev => [...prev, ...newFiles]), []);
  const handleAddSample = useCallback(() => setFiles(prev => prev.length >= 3 ? prev : [...prev, makeSampleUploadedFile()]), []);
  const handleRemoveFile = useCallback((id: string) => setFiles(prev => prev.filter(f => f.id !== id)), []);
  const handleUpdateCategory = useCallback((fileId: string, category: FileCategory) => setFiles(prev => prev.map(f => f.id === fileId ? { ...f, category } : f)), []);

  const goNext = () => { if (stepIndex < STEPS.length - 1) setCurrentStep(STEPS[stepIndex + 1].key); };
  const goPrev = () => { if (stepIndex > 0) setCurrentStep(STEPS[stepIndex - 1].key); };

  if (!isLoaded) {
    return <div className="min-h-screen bg-[#050a12]" />;
  }
  if (!isSignedIn) {
    return <AuthGate />;
  }

  return (
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
                  <SignInButton mode="modal">
                    <button className="text-[11px] text-gray-400 hover:text-white transition-colors font-medium px-3 py-1.5 rounded-lg hover:bg-white/[0.05] border border-white/[0.05]">
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button className="text-[11px] text-white font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors">
                      Sign up
                    </button>
                  </SignUpButton>
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
        {currentStep === 'upload' && files.length === 0 && (
          <div className="max-w-5xl mx-auto px-6 pt-14 pb-6 text-center">
            <AnimatedSection>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/[0.08] border border-blue-500/15 text-blue-400 text-[11px] font-medium mb-5">
                <Sparkles className="w-3 h-3" />Skill files for every AI.
              </div>
            </AnimatedSection>
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
              {currentStep === 'upload' && <FileUploadZone files={files} onFilesAdded={handleFilesAdded} onRemoveFile={handleRemoveFile} onSampleLoad={handleAddSample} />}
              {currentStep === 'organize' && <FileOrganizer files={files} onUpdateCategory={handleUpdateCategory} />}
              {currentStep === 'configure' && <SkillConfigurator config={config} files={files} onUpdateConfig={setConfig} />}
              {currentStep === 'generate' && <SkillOutput files={files} config={config} />}
            </div>
            <div className="flex items-center justify-between mt-7 pb-10">
              <button onClick={goPrev} disabled={stepIndex === 0} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${stepIndex === 0 ? 'opacity-0 pointer-events-none' : 'text-gray-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05]'}`}>
                <ArrowLeft className="w-3.5 h-3.5" />Back
              </button>
              {currentStep !== 'generate' && (
                <button title={missingSkillName ? 'Enter a skill name to continue' : ''} onClick={goNext} disabled={!canGoNext} className={`flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${canGoNext ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/15 hover:shadow-blue-500/25' : 'bg-white/[0.04] text-gray-600 cursor-not-allowed border border-white/[0.05]'}`}>
                  {currentStep === 'configure' ? 'Generate Skill' : 'Continue'}<ArrowRight className="w-3.5 h-3.5" />
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
  );
}
