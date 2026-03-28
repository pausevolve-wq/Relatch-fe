import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import * as pdfjsLib from "pdfjs-dist";

// ─── TYPES ───────────────────────────────────────────────────────────
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

// ─── ICONS (inline SVGs to remove lucide dependency issues) ──────────
// Using lucide-react icons
import {
  Upload, FolderKanban, Settings, Sparkles, ArrowRight, ArrowLeft,
  ChevronRight, Zap, FileText, Shield, X, Image, Code, Database,
  Globe, AlertCircle, CheckCircle2, Brain, BookOpen, ListChecks, FileCode,
  Layers, ChevronDown, MessageSquare, Download, Copy, Check, Package, Info
} from 'lucide-react';

// ─── UTILITIES ───────────────────────────────────────────────────────

let idCounter = 0;
const generateId = () => `file_${Date.now()}_${++idCounter}`;

const ACCEPTED_TYPES: Record<string, string[]> = {
  'Text': ['.txt', '.md', '.csv', '.log'],
  'Documents': ['.pdf', '.doc', '.docx'],
  'Web': ['.html', '.htm', '.xml'],
  'Data': ['.json', '.yaml', '.yml', '.toml'],
  'Code': ['.js', '.ts', '.py', '.rb', '.go', '.rs'],
};

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

function isLikelyAppAssetText(text: string): boolean {
  const sample = text.substring(0, 1200).toLowerCase();
  return (
    sample.includes('<!doctype html') ||
    sample.includes('<script type="module"') ||
    sample.includes('__vite__') ||
    sample.includes('webpack') ||
    sample.includes('sourceMappingURL'.toLowerCase()) ||
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

async function extractPdfText(file: File): Promise<ExtractedTextResult> {
  const warnings: string[] = [];
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as { str?: string }[])
        .map((item) => item.str || '')
        .join(' ');
      fullText += `\n${pageText}`;
    }
    return { type: 'pdf', text: fullText, warnings };
  } catch {
    warnings.push('PDF parsing failed, using fallback.');
    return { type: 'pdf', text: '', warnings };
  }
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
    warnings.push('DOCX parser failed; using plain-text fallback.');
    try {
      const fallbackBuffer = await readAsArrayBuffer(file);
      const fallback = stripArtifacts(decodeArrayBuffer(fallbackBuffer, 'latin1'));
      return { type: 'docx', text: fallback, warnings };
    } catch {
      return { type: 'docx', text: '', warnings };
    }
  }
  const fallbackBuffer = await readAsArrayBuffer(file);
  const fallback = stripArtifacts(decodeArrayBuffer(fallbackBuffer, 'latin1'));
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

async function enrichWithAI(rawText: string, category: string, fileName: string): Promise<string> {
  const response = await fetch('https://claudly-proxy.vercel.app/api/enrich', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rawText, category, fileName }),
});
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `API error ${response.status}`);
  }
  const data = await response.json();
  if (!data.enriched) throw new Error('No content returned from AI enrichment');
  return data.enriched;
}

async function parseFile(file: File): Promise<UploadedFile> {
  const traceId = `ingest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    name: file.name,
    type: file.type || 'unknown',
    size: file.size,
    lastModified: file.lastModified,
  });
  const precheck = validateInputFile(file);
  if (!precheck.ok) throw new Error(precheck.reason || 'Invalid file');
  const type = detectFileType(file);
  console.info(`[INGEST ${traceId}] routed_type`, { routedType: type });
  const extracted = await extractText(file, type);
  const bufferSize = file.size;
  if (bufferSize <= 0) throw new Error('Invalid buffer size (0 bytes).');
  if (type === 'pdf' && !(file.type || '').toLowerCase().includes('pdf') && getFileExtension(file.name) !== '.pdf') {
    throw new Error('File is not a valid PDF MIME/extension for PDF pipeline.');
  }
  if ((type === 'pdf' || type === 'docx' || type === 'txt') && isLikelyAppAssetText(extracted.text)) {
    throw new Error('Detected app HTML/JS bundle content instead of a user document.');
  }
  console.info(`[INGEST ${traceId}] extracted_preview`, {
    preview: extracted.text.substring(0, 500),
    extractedLength: extracted.text.length,
    warnings: extracted.warnings,
  });
  const category = inferCategory(file, extracted.text);
  let content: string;
  try {
    content = await enrichWithAI(extracted.text, category, file.name);
  } catch (err) {
    throw new Error(`AI enrichment failed for ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
  const extractionWarning = extracted.warnings.length ? extracted.warnings.join(' ') : undefined;
  console.info(`[INGEST ${traceId}] success`, {
    outputLength: content.length,
    category,
  });
  return { id: generateId(), name: file.name, type: file.type || type, size: file.size, content, category, parsedAt: new Date(), extractionWarning };
}

// ─── SKILL GENERATOR ────────────────────────────────────────────────

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

// ─── ANIMATED SECTION (reveal on scroll) ─────────────────────────────

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

// ─── STEP 1: FILE UPLOAD ─────────────────────────────────────────────

function FileUploadZone({ files, onFilesAdded, onRemoveFile, onSampleLoad }: { files: UploadedFile[]; onFilesAdded: (f: UploadedFile[]) => void; onRemoveFile: (id: string) => void; onSampleLoad: () => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    setIsProcessing(true); setError(null);
    const parsed: UploadedFile[] = [];
    for (const file of Array.from(fileList)) {
      console.info('[UPLOAD] received_file', {
        name: file.name,
        type: file.type || 'unknown',
        size: file.size,
        lastModified: file.lastModified,
      });
      const validation = validateInputFile(file);
      if (!validation.ok) {
        setError(`Rejected ${file.name}: ${validation.reason}`);
        continue;
      }
      try {
        parsed.push(await parseFile(file));
      } catch (err) {
        setError(`Failed to parse ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    if (parsed.length > 0) onFilesAdded(parsed);
    setIsProcessing(false);
  }, [onFilesAdded]);

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
          className={`relative rounded-2xl p-10 text-center transition-all duration-500 cursor-pointer group overflow-hidden ${isDragging ? 'border-2 border-blue-500 bg-blue-500/[0.06] scale-[1.01]' : 'border-2 border-dashed border-white/[0.08] hover:border-white/[0.15] bg-white/[0.015]'}`}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.04] via-transparent to-blue-600/[0.02]" />
          </div>
          <input id="file-input" type="file" multiple accept=".txt,.md,.pdf,.doc,.docx,.html,.htm,.xml,.json,.yaml,.yml,.csv,.toml,.js,.ts,.py,.rb,.go,.rs,.log" className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          <div className="relative z-10">
            <div className={`w-14 h-14 mx-auto mb-5 rounded-2xl flex items-center justify-center transition-all duration-500 ${isDragging ? 'bg-blue-500/20 scale-110 rotate-6' : 'bg-white/[0.04] border border-white/[0.06] group-hover:bg-white/[0.06]'}`}>
              <Upload className={`w-6 h-6 transition-all duration-300 ${isDragging ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-300'}`} />
            </div>
            <h3 className="text-base font-semibold text-white mb-1.5">{isProcessing ? 'Processing...' : isDragging ? 'Drop to upload' : 'Drop files or click to browse'}</h3>
            <p className="text-sm text-gray-500 mb-5">Drop your docs, notes, or examples - Turn your data into structured skill files instantly</p>
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
              Try a sample file
            </button>
          </div>
          {isProcessing && (
            <div className="absolute inset-0 rounded-2xl bg-[#050a12]/90 flex items-center justify-center backdrop-blur-sm">
              <div className="flex items-center gap-3 text-blue-400">
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Parsing files...</span>
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

// ─── STEP 2: FILE ORGANIZER ──────────────────────────────────────────

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
                      {label}
                      <span className="text-[10px] text-gray-600">?</span>
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

// ─── STEP 3: SKILL CONFIGURATOR ─────────────────────────────────────

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
            <div><h3 className="text-sm font-semibold text-white">Name your skill</h3><p className="text-[11px] text-gray-500">This becomes the filename - keep it short and descriptive</p></div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Skill Name <span className="text-red-400">*</span></label>
              <input type="text" value={config.skillName} onChange={(e) => updateField('skillName', e.target.value)} placeholder="e.g., My Personal Assistant" className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/40 transition-all text-sm outline-none" />
              <p className="mt-2 text-[11px] text-gray-500">This becomes your skill&apos;s filename - e.g., my-copywriting-skill.md</p>
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
            <div><h3 className="text-sm font-semibold text-white">Anything else Claude should know?</h3><p className="text-[11px] text-gray-500">Add rules, preferences, or context you did not upload as a file</p></div>
          </div>
          <textarea value={config.customNotes} onChange={(e) => updateField('customNotes', e.target.value)} placeholder={"Add any additional context, rules, or notes you want Claude to follow...\n\nExamples:\n• Always respond in a casual, friendly tone\n• Use bullet points for lists\n• When I ask about code, prefer TypeScript\n• Reference my company name 'Acme Corp' in formal docs"} rows={5} className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder-gray-600 focus:ring-2 focus:ring-violet-500/25 focus:border-violet-500/40 transition-all resize-none text-sm leading-relaxed outline-none" />
          <p className="mt-2 text-[11px] text-gray-600">These notes will be placed as high-priority custom instructions at the top of the generated skill file.</p>
        </div>
      </AnimatedSection>

      <AnimatedSection delay={200}>
        <div className="p-6 rounded-2xl bg-white/[0.025] border border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white mb-1">Category Settings</h3>
          <p className="text-[11px] text-gray-500 mb-5">Toggle sections and choose how strongly Claude should use each one</p>
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

// ─── STEP 4: SKILL OUTPUT ────────────────────────────────────────────

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
    'Creating your skill file...',
    'Adding final touches to your skill file...',
  ];

  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      setLoadingMsgIndex(i => (i + 1) % LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  useEffect(() => {
    let cancelled = false;
    async function generate() {
      setIsGenerating(true);
      setGenerationError(null);
      setLoadingMsgIndex(0);
      try {
        const slug = toSkillSlug(config.skillName);
        const results: GeneratedSkill[] = files
          .filter(f => config.categories[f.category]?.enabled)
          .map(f => ({
            filename: `${slug}-${f.category}.md`,
            content: f.content,
            category: f.category,
            tokenEstimate: estimateTokens(f.content),
          }));
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
  const sectionSummary = useMemo(() => {
    return PRIORITY_ORDER.map((category) => ({
      category,
      label: config.categories[category].label,
      count: files.filter((f) => config.categories[category]?.enabled && f.category === category).length,
    })).filter((entry) => entry.count > 0);
  }, [files, config]);

  const handleCopy = async (content: string, id: string) => {
    try { await navigator.clipboard.writeText(content); } catch {
      const ta = document.createElement('textarea'); ta.value = content; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(id); setTimeout(() => setCopied(null), 2500);
  };

  const handleDownloadSingle = (skill: GeneratedSkill) => {
    const blob = new Blob([skill.content], { type: 'text/markdown' });
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
    e.preventDefault();
    setWaitlistError(null);
    if (!FORMSPREE_ENDPOINT) {
      setWaitlistError('Waitlist is not configured yet. Add VITE_FORMSPREE_ENDPOINT in your .env file.');
      return;
    }
    const email = waitlistEmail.trim();
    if (!email) {
      setWaitlistError('Please enter your email.');
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      setWaitlistError('Please enter a valid email address.');
      return;
    }
    try {
      setWaitlistSubmitting(true);
      const formBody = new URLSearchParams();
      formBody.set('email', email);
      formBody.set('source', 'relatch-step4');
      formBody.set('generatedFiles', (generatedFiles || []).map((file) => file.filename).join(', '));
      formBody.set('timestamp', new Date().toISOString());
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: formBody.toString(),
      });
      if (!response.ok) {
        throw new Error('Request failed');
      }
      setWaitlistSuccess(true);
      setWaitlistEmail('');
    } catch {
      setWaitlistError('Could not submit right now. Please try again.');
    } finally {
      setWaitlistSubmitting(false);
    }
  };

  const renderMarkdownPreview = (content: string) => {
    const lines = content.split('\n');
    let inFrontmatter = false;
    let frontmatterDone = false;
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
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{generationError}</span>
          </div>
        </AnimatedSection>
      )}

      {!isGenerating && generatedFiles && (<>
      <AnimatedSection>
        <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
          <h4 className="text-sm font-semibold text-white mb-1">Try the full Relatch app</h4>
          <p className="text-[11px] text-gray-500 mb-3">Like this? Join the waitlist for early access to the full experience.</p>
          {waitlistSuccess ? (
            <div className="rounded-lg px-3 py-2 text-sm bg-emerald-500/[0.1] border border-emerald-500/20 text-emerald-300">
              Thanks, you&apos;re on the waitlist. We&apos;ll reach out soon.
            </div>
          ) : (
            <form onSubmit={handleWaitlistSubmit} className="space-y-2.5">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="flex-1 px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/40 transition-all outline-none"
                />
                <button
                  type="submit"
                  disabled={waitlistSubmitting}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${waitlistSubmitting ? 'bg-white/[0.04] text-gray-600 cursor-not-allowed border border-white/[0.05]' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                >
                  {waitlistSubmitting ? 'Joining...' : 'Join waitlist'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500">We&apos;ll only email product updates and early access.</p>
              {waitlistError && (
                <p className="text-[11px] text-red-300">{waitlistError}</p>
              )}
            </form>
          )}
        </div>
      </AnimatedSection>

      <AnimatedSection>
        <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-500/[0.08] via-blue-500/[0.04] to-transparent border border-blue-500/15 animate-glow">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0 animate-float"><Zap className="w-5 h-5 text-blue-400" /></div>
            <div>
              <h3 className="text-base font-semibold text-white">Your skill is ready</h3>
              <p className="text-xs text-gray-400 mt-0.5">Your Claude-optimized <code className="text-blue-400 bg-blue-500/10 px-1 rounded text-[11px] font-mono">.md</code> skill file is ready to drag & drop into Claude</p>
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
          <h4 className="text-sm font-medium text-white mb-2">What&apos;s inside</h4>
          <div className="flex flex-wrap gap-2">
            {sectionSummary.map((item) => (
              <span key={item.category} className="px-2.5 py-1 rounded-lg text-xs bg-white/[0.04] border border-white/[0.08] text-gray-300">
                {item.count} {item.label.toLowerCase()}
              </span>
            ))}
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
            <div className="p-5 max-h-[450px] overflow-y-auto skill-preview bg-[#050a12]">
              {renderMarkdownPreview(generatedFiles[activeFile].content)}
            </div>
          </div>
        </AnimatedSection>
      )}

      <AnimatedSection delay={300}>
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Package className="w-4 h-4 text-gray-400" />
              <div><h4 className="text-sm font-medium text-white">Paste into Claude directly</h4><p className="text-[11px] text-gray-500">Use this if you want to paste into Claude&apos;s Custom Instructions box instead of uploading a file.</p></div>
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
              <p className="text-xs font-medium text-blue-300 mb-1">Claude-Optimized Format</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                This file includes proper YAML frontmatter, lowercase-hyphenated naming (<code className="text-blue-400 bg-blue-500/10 px-1 rounded font-mono">{generatedFiles[0]?.filename}</code>), structured sections with directives, and priority ordering — all optimized for Claude's skill parsing.
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
              { step: '1', text: 'Download the generated .md file(s) above' },
              { step: '2', text: 'Open claude.ai and go to your Project settings' },
              { step: '3', text: 'Drag & drop the .md file into Project Knowledge or paste into Custom Instructions' },
              { step: '4', text: 'Start chatting - Claude will now use your personalized skill!' },
            ].map(item => (
              <div key={item.step} className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-md bg-blue-500/15 text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{item.step}</span>
                <p className="text-sm text-gray-400 flex items-center gap-1">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </AnimatedSection>
      </>)}
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────

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
  const handleAddSample = useCallback(() => setFiles(prev => [...prev, makeSampleUploadedFile()]), []);
  const handleRemoveFile = useCallback((id: string) => setFiles(prev => prev.filter(f => f.id !== id)), []);
  const handleUpdateCategory = useCallback((fileId: string, category: FileCategory) => setFiles(prev => prev.map(f => f.id === fileId ? { ...f, category } : f)), []);

  const goNext = () => { if (stepIndex < STEPS.length - 1) setCurrentStep(STEPS[stepIndex + 1].key); };
  const goPrev = () => { if (stepIndex > 0) setCurrentStep(STEPS[stepIndex - 1].key); };

  return (
    <div className="min-h-screen bg-[#050a12] relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-blue-600/[0.06] via-blue-500/[0.02] to-transparent rounded-full blur-[100px]" />
        <div className="absolute top-[40%] right-[-10%] w-[400px] h-[400px] bg-gradient-to-l from-blue-600/[0.03] to-transparent rounded-full blur-[80px]" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[500px] h-[300px] bg-gradient-to-tr from-blue-500/[0.025] to-transparent rounded-full blur-[80px]" />
      </div>
      <div className="fixed inset-0 pointer-events-none opacity-[0.012]" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`, backgroundSize: '64px 64px' }} />

      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-white/[0.05]">
          <div className="max-w-5xl mx-auto px-6 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/15"><Zap className="w-4 h-4 text-white" /></div>
              <div><h1 className="text-sm font-bold text-white tracking-tight leading-none">Relatch</h1><p className="text-[10px] text-gray-500 leading-none mt-0.5">Relatch your data to Claude</p></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.025] border border-white/[0.05]"><Shield className="w-3 h-3 text-emerald-400" /><span className="text-[10px] text-gray-400 font-medium">Your files never leave your browser</span></div>
            </div>
          </div>
        </header>

        {/* Hero — only on upload step with no files */}
        {currentStep === 'upload' && files.length === 0 && (
          <div className="max-w-5xl mx-auto px-6 pt-14 pb-6 text-center">
            <AnimatedSection>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/[0.08] border border-blue-500/15 text-blue-400 text-[11px] font-medium mb-5">
                <Sparkles className="w-3 h-3" />No GitHub. No code. Just your data.
              </div>
            </AnimatedSection>
            <AnimatedSection delay={100}>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-3 leading-tight tracking-tight">
                Build Claude Skills<br /><span className="bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 bg-clip-text text-transparent">From Your Own Data</span>
              </h2>
            </AnimatedSection>
            <AnimatedSection delay={200}>
              <p className="text-gray-400 max-w-lg mx-auto text-sm leading-relaxed mb-8">Upload your files, organize them into categories, and generate perfectly structured Claude skill files — ready to drag & drop.</p>
            </AnimatedSection>
            <AnimatedSection delay={300}>
              <div className="flex flex-wrap justify-center gap-3 mb-10">
                {[
                  { icon: <FileText className="w-3.5 h-3.5" />, label: 'PDF, TXT, MD' },
                  { icon: <FolderKanban className="w-3.5 h-3.5" />, label: 'JSON, YAML, CSV' },
                  { icon: <Upload className="w-3.5 h-3.5" />, label: 'HTML, XML' },
                  { icon: <Sparkles className="w-3.5 h-3.5" />, label: 'Code, Images' },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.025] border border-white/[0.05] text-xs text-gray-400">
                    <span className="text-blue-400">{item.icon}</span>{item.label}
                  </div>
                ))}
              </div>
            </AnimatedSection>
          </div>
        )}

        {/* Stepper */}
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

          {/* Main Content */}
          <div className="max-w-3xl mx-auto">
            <div key={currentStep}>
              {currentStep === 'upload' && <FileUploadZone files={files} onFilesAdded={handleFilesAdded} onRemoveFile={handleRemoveFile} onSampleLoad={handleAddSample} />}
              {currentStep === 'organize' && <FileOrganizer files={files} onUpdateCategory={handleUpdateCategory} />}
              {currentStep === 'configure' && <SkillConfigurator config={config} files={files} onUpdateConfig={setConfig} />}
              {currentStep === 'generate' && <SkillOutput files={files} config={config} />}
            </div>

            {/* Navigation */}
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

        {/* Footer */}
        <footer className="border-t border-white/[0.03]">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
            <p className="text-[11px] text-gray-600">Your files stay on your device - nothing is uploaded to any server</p>
            <p className="text-[11px] text-gray-700">Relatch v1.0</p>
          </div>
        </footer>
      </div>
    </div>
  );
}



