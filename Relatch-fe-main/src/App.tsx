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
    keywords: /\b(instagram|tiktok|linkedin.?post|twitter|youtube|hashtag|caption|reel|story|carousel|content.?calendar|ugc|creator.?economy|influencer|viral.?content|community.?management|engagement.?rate)\b/i,
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
  const scores = SKILL_DOMAINS.map(d => ({
    domain: d,
    score: (combined.match(new RegExp(d.keywords.source, 'gi')) || []).length,
  })).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  return scores[0]?.domain ?? null;
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
    const response = await fetch(ENRICH_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, category, fileName }),
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
const FORMSPREE_ENDPOINT = ((
