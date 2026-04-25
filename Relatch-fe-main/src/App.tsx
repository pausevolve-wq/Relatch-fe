import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import * as pdfjsLib from "pdfjs-dist";
import {
  Upload, FolderKanban, Settings, Sparkles, ArrowRight, ArrowLeft,
  ChevronRight, Zap, FileText, Shield, X, Image, Code, Database,
  Globe, AlertCircle, CheckCircle2, Brain, BookOpen, ListChecks, FileCode,
  Layers, ChevronDown, MessageSquare, Download, Copy, Check, Package, Info
} from 'lucide-react';

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

function detectEnhancementSignals(text: string) {
  const sample = text.toLowerCase();

  const hasNumbers = /\d/.test(sample);
  const hasSteps = /(step|process|workflow|first|then|next)/.test(sample);
  const hasStructuredHints = /(:|-|\*)/.test(sample);
  const hasTechnical = /(function|return|class|api|json|code)/.test(sample);
  const hasComparison = /(vs|compare|difference|better|worse)/.test(sample);

  const length = text.length;

  return {
    allowTables: hasComparison || (hasNumbers && hasSteps && length > 900),
    allowCodeBlocks: hasTechnical && length > 500,
    allowFlow: hasSteps && length > 400,
  };
}

function detectComplexity(text: string): 'light' | 'medium' | 'heavy' {
  const length = text.length;
  const tokens = estimateTokens(text);

  if (tokens > 4000 || length > 15000) return 'heavy';
  if (tokens > 1500 || length > 6000) return 'medium';
  return 'light';
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
  },
  {
    id: 'brand_voice',
    label: 'brand voice & content strategy',
    role: 'a brand voice and content strategist',
    outputType: 'brand copy, messaging frameworks, and content',
    frame: 'maintain a consistent, distinctive brand voice across all touchpoints',
    keywords: /\b(brand.?voice|tone.?of.?voice|brand.?guideline|messaging.?pillar|tagline|brand.?persona|style.?guide|visual.?identity|brand.?positioning|brand.?manifesto|brand.?story|typography|color.?palette|logo.?usage)\b/i,
  },
  {
    id: 'software_engineering',
    label: 'software engineering',
    role: 'a senior software engineer',
    outputType: 'code, architecture decisions, and technical documentation',
    frame: 'write clean, maintainable, production-ready code',
    keywords: /\b(function|async.?await|interface|component|props|useState|useEffect|endpoint|refactor|deploy|ci.?cd|unit.?test|lint|compile|algorithm|big.?o|typescript|javascript|python|react|node|kubernetes|docker|microservice)\b/i,
  },
  {
    id: 'growth_marketing',
    label: 'growth marketing & performance',
    role: 'a growth-focused performance marketer',
    outputType: 'growth strategies, paid campaigns, and conversion systems',
    frame: 'drive measurable growth through data-informed marketing decisions',
    keywords: /\b(acquisition|retention|churn.?rate|ltv|cac|roas|a.?b.?test|landing.?page|paid.?ads|ppc|cpc|cpm|attribution|cohort|activation|referral.?program|viral.?loop|growth.?lever|north.?star.?metric|activation.?rate)\b/i,
  },
  {
    id: 'product_design',
    label: 'product design & UX',
    role: 'a product designer and UX specialist',
    outputType: 'design decisions, UX flows, and interface copy',
    frame: 'create intuitive, accessible user experiences grounded in research',
    keywords: /\b(wireframe|prototype|usability.?test|heuristic|user.?journey|figma|sketch|affordance|interaction.?design|friction|empty.?state|microcopy|onboarding.?flow|accessibility|wcag|design.?system|component.?library|modal|tooltip)\b/i,
  },
  {
    id: 'education',
    label: 'education & instructional design',
    role: 'an instructional designer and educator',
    outputType: 'curricula, lesson plans, and learning materials',
    frame: 'design learning experiences that produce measurable skill change',
    keywords: /\b(learning.?objective|curriculum|lesson.?plan|instructional|assessment|rubric|scaffold|pedagogy|student.?engagement|course.?design|syllabus|bloom.?taxonomy|formative|summative|differentiat|learning.?outcome|e.?learning)\b/i,
  },
  {
    id: 'legal',
    label: 'legal & compliance',
    role: 'a legal professional',
    outputType: 'contracts, policies, and compliance documentation',
    frame: 'draft precise, enforceable language that protects all parties',
    keywords: /\b(clause|liability|indemnif|jurisdiction|termination|breach.?of|obligations|warranties|representation|consideration|contract|statute|regulation|compliance|gdpr|hipaa|counsel|attorney|whereas|hereinafter|pursuant)\b/i,
  },
  {
    id: 'finance',
    label: 'finance & financial analysis',
    role: 'a financial analyst',
    outputType: 'financial models, analysis, and investment recommendations',
    frame: 'produce rigorous financial analysis that supports sound decisions',
    keywords: /\b(revenue|ebitda|gross.?margin|forecast|budget.?variance|roi|irr|npv|cash.?flow|balance.?sheet|income.?statement|equity|valuation|cap.?table|runway|burn.?rate|mrr|arr|unit.?economics|waterfall)\b/i,
  },
  {
    id: 'seo',
    label: 'SEO & search strategy',
    role: 'an SEO strategist',
    outputType: 'SEO strategies, content briefs, and optimized copy',
    frame: 'create content and strategies that earn search visibility and organic traffic',
    keywords: /\b(keyword.?research|search.?ranking|backlink|serp|meta.?description|title.?tag|canonical|crawl.?budget|index|schema.?markup|anchor.?text|domain.?authority|search.?intent|topical.?authority|content.?cluster|featured.?snippet|core.?web.?vital)\b/i,
  },
  {
    id: 'hr_people',
    label: 'HR & people operations',
    role: 'an HR and people operations specialist',
    outputType: 'HR policies, job descriptions, and people communications',
    frame: 'build people systems that attract, develop, and retain talent',
    keywords: /\b(onboarding|performance.?review|compensation.?band|benefits|pto|termination|employee.?handbook|headcount|talent.?acquisition|leveling|pip|career.?ladder|comp|total.?rewards|people.?ops|culture.?add|hiring.?manager|offer.?letter)\b/i,
  },
  {
    id: 'data_science',
    label: 'data science & machine learning',
    role: 'a data scientist and ML engineer',
    outputType: 'models, analyses, and data-driven recommendations',
    frame: 'extract signal from data and build systems that learn and improve',
    keywords: /\b(dataframe|pandas|numpy|sklearn|train.?test|accuracy|precision.?recall|feature.?engineering|regression|neural.?network|embedding|inference|dataset|etl|sql.?query|data.?warehouse|feature.?store|model.?drift|overfitting)\b/i,
  },
  {
    id: 'product_management',
    label: 'product management',
    role: 'a product manager',
    outputType: 'PRDs, roadmaps, and product strategy documents',
    frame: 'define and ship products that solve real user problems at scale',
    keywords: /\b(product.?requirement|user.?story|acceptance.?criteria|sprint.?planning|epic|product.?backlog|roadmap.?item|north.?star|success.?metric|discovery|product.?hypothesis|go.?to.?market|launch.?plan|prd|feature.?flag|experiment)\b/i,
  },
  {
    id: 'pr_communications',
    label: 'PR & communications',
    role: 'a communications and PR strategist',
    outputType: 'press releases, media pitches, and communications plans',
    frame: 'shape narratives and manage communications that build reputation',
    keywords: /\b(press.?release|media.?pitch|spokesperson|embargo|lede|inverted.?pyramid|boilerplate|wire.?service|newswire|journalist|media.?coverage|talking.?point|crisis.?comms|on.?the.?record|off.?the.?record|media.?list)\b/i,
  },
  {
    id: 'consulting',
    label: 'management consulting',
    role: 'a management consultant',
    outputType: 'frameworks, decks, and strategic recommendations',
    frame: 'structure ambiguous problems and deliver clear, actionable recommendations',
    keywords: /\b(mece|issue.?tree|so.?what|pyramid.?principle|workstream|deliverable|engagement.?manager|hypothesis.?driven|executive.?summary|straw.?man|benchmarking|best.?practice|operating.?model|change.?management|transformation)\b/i,
  },
  {
    id: 'security',
    label: 'cybersecurity',
    role: 'a cybersecurity specialist',
    outputType: 'security assessments, policies, and technical documentation',
    frame: 'identify, assess, and mitigate security risks systematically',
    keywords: /\b(vulnerability|cve|exploit|penetration.?test|pen.?test|firewall|encryption|ssl|tls|oauth|authentication|authorization|owasp|threat.?model|attack.?vector|incident.?response|soc|siem|zero.?trust|hardening|red.?team)\b/i,
  },
  {
    id: 'social_media',
    label: 'social media & community',
    role: 'a social media strategist and content creator',
    outputType: 'social content, captions, and community strategies',
    frame: 'create social content that builds community and drives engagement',
    keywords: /\b(instagram|tiktok|linkedin.?post|twitter|youtube|hashtag|caption|reel|carousel|content.?calendar|ugc|creator.?economy|influencer|viral.?content|community.?management|engagement.?rate)\b/i,
  },
  {
    id: 'healthcare',
    label: 'healthcare & clinical',
    role: 'a healthcare professional',
    outputType: 'clinical documentation, patient communications, and protocols',
    frame: 'communicate clinical information clearly, accurately, and compassionately',
    keywords: /\b(patient|diagnosis|treatment.?protocol|medication|dosage|symptom|clinical.?trial|contraindication|prognosis|evidence.?based|ehr|icd.?code|cpt.?code|hipaa|care.?plan|referral|triage|differential|comorbidity)\b/i,
  },
  {
    id: 'academic_research',
    label: 'academic research & writing',
    role: 'an academic researcher and writer',
    outputType: 'research papers, literature reviews, and academic analyses',
    frame: 'produce rigorous, well-cited academic work that advances knowledge',
    keywords: /\b(hypothesis|research.?methodology|sample.?size|statistical.?significance|p.?value|literature.?review|peer.?review|citation|abstract|dissertation|thesis|empirical|independent.?variable|control.?group|replication|apa|mla|chicago)\b/i,
  },
  {
    id: 'real_estate',
    label: 'real estate',
    role: 'a real estate professional',
    outputType: 'listings, client communications, and property analyses',
    frame: 'communicate property value and guide clients through complex transactions',
    keywords: /\b(listing|property|mortgage|appraisal|comparable|comps|escrow|title.?deed|zoning|commission|closing.?cost|inspection|mls|cap.?rate|noi|lease.?agreement|tenant|landlord|arv|cash.?on.?cash)\b/i,
  },
  {
    id: 'creative_writing',
    label: 'creative writing & storytelling',
    role: 'a creative writer and storyteller',
    outputType: 'stories, scripts, copy, and narrative content',
    frame: 'craft narratives that move people and stay with them',
    keywords: /\b(protagonist|antagonist|plot.?arc|dialogue|scene.?setting|chapter|theme|motif|narrative.?structure|prose.?style|stanza|verse|character.?development|conflict|resolution|pacing|show.?don.?t.?tell|point.?of.?view|unreliable.?narrator)\b/i,
  },
] as const;

function detectSkillDomain(fileName: string, text: string) {
  const combined = (fileName + ' ' + text).toLowerCase();

  const scores = SKILL_DOMAINS.map(d => {
  const regex = new RegExp(d.keywords.source, 'gi');
  const matches = combined.match(regex);
  return {
    domain: d,
    score: matches ? matches.length : 0,
  };
})
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) return null;

  const top = scores[0];
  const second = scores[1];

  if (top.score >= 2) return top.domain;

  if (top.score === 1 && !second) return top.domain;

  if (top.score === 1 && second && second.score === 1) return null;

  return null;
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

async function enrichWithAI(rawText: string, category: string, fileName: string): Promise<string> {
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
        domainFrame: detectedDomain?.frame || 'communicate effectively'
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
  const content = await enrichWithAI(extracted.text, category, file.name);
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
              Train claude to behave exactly the way you want — up to 3 files
            </p>
            <p className="text-sm text-gray-500 mb-5">Brand guidelines, meeting notes, writing samples, style docs — anything that shows how you want claude to behave</p>
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
                <span className="text-xs text-gray-500">Complex PDFs may take a few extra seconds</span>
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
          <textarea value={config.customNotes} onChange={(e) => updateField('customNotes', e.target.value)} placeholder={"Anything you'd tell a new assistant on their first day...\n\nExamples:\n• Always write in a direct, casual tone — no corporate fluff\n• I work in TypeScript, always default to that\n• My company is called Acme — never say \"your company\"\n• Keep responses short unless I explicitly ask for detail"} rows={5} className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-violet-500/25 focus:border-violet-500/40 transition-all resize-none text-sm leading-relaxed outline-none" />
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

                const safeSkillName = config.skillName ? config.skillName.replace(/"/g, '') : "My Custom Skill";

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
            const signals = detectEnhancementSignals(f.content);
const complexity = detectComplexity(f.content);

let enhancedContent = f.content;

if (complexity !== 'light') {
  const hasCreateSection = enhancedContent.includes('## How to Create');
  const hasThinkSection = enhancedContent.includes('## How to Think');

  let createInsert = '';
  let thinkInsert = '';

  function injectIntoSection(content: string, section: string, block: string) {
  if (!content.includes(section)) return content;

  const parts = content.split(section);
  if (parts.length < 2) return content;

  const before = parts[0];
  const after = parts.slice(1).join(section);

  return `${before}${section}\n\n${block}\n${after}`;
}

if (complexity !== 'light') {
  if (signals.allowTables && !enhancedContent.includes('### Structured View')) {
    enhancedContent = injectIntoSection(
      enhancedContent,
      '## How to Create',
      `### Structured View
| Element | Description |
|--------|-------------|
| Input | Derived from source |
| Output | Pattern-aligned result |`
    );
  }

  if (signals.allowCodeBlocks && !enhancedContent.includes('### Code Pattern')) {
    enhancedContent = injectIntoSection(
      enhancedContent,
      '## How to Create',
      `### Code Pattern
\`\`\`
function pattern() {
  return "structured output";
}
\`\`\``
    );
  }

  if (signals.allowFlow && !enhancedContent.includes('### Execution Flow')) {
    enhancedContent = injectIntoSection(
      enhancedContent,
      '## How to Think',
      `### Execution Flow
1. Identify intent
2. Apply pattern
3. Structure output
4. Refine precision`
    );
  }
}

const finalContent = injectCustomNotes(enhancedContent, config.customNotes ?? '');
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
          if (line.startsWith('```')) return null;
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

export default function App() {
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
      Make Claude work like you
    </p>
  </div>
</div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.025] border border-white/[0.05]"><Shield className="w-3 h-3 text-emerald-400" /><span className="text-[10px] text-gray-400 font-medium">Files processed locally — never uploaded</span></div>
            </div>
          </div>
        </header>
        {currentStep === 'upload' && files.length === 0 && (
          <div className="max-w-5xl mx-auto px-6 pt-14 pb-6 text-center">
            <AnimatedSection>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/[0.08] border border-blue-500/15 text-blue-400 text-[11px] font-medium mb-5">
                <Sparkles className="w-3 h-3" />Your files. Your rules. Claude follows both.
              </div>
            </AnimatedSection>
            <AnimatedSection delay={100}>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-3 leading-tight tracking-tight">
                Turn Your Work Into<br /><span className="bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 bg-clip-text text-transparent">Claude&apos;s Memory</span>
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={200}>
              <p className="text-gray-400 max-w-lg mx-auto text-sm leading-relaxed mb-8">Drop any document — notes, guidelines, examples, PDFs and get a structured skill file that makes Claude work exactly like you do. Ready in under a minute.</p>
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
            <p className="text-[11px] text-gray-700">Relatch v1.1</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
