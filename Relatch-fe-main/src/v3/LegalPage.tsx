// The Privacy policy and Terms of service, as pages of the app (like Contact: no sidebar, one way back),
// opened from the help menu. They used to link out to relatch.online, whose pages wear the old design.
//
// The text is the landing's privacy.html and terms.html as they stand in relatchlp#28 (the version that
// goes live with skill history), so keep the two in step if either changes. Where this app differs, the
// app is described as it is:
// - Terms 3: the landing says "no usage limits"; the app has a daily limit (relatch lib/usage-limits.js,
//   DAY_LIMIT 5), so that is said instead.
// - Privacy 2.3 and 4: the contact form is in the app too, and the app keeps its own settings in the
//   browser.
// The landing's links to its other pages become the in-app pages; its "Legal notices" page has no
// in-app copy, so it is not linked.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { CONTACT_EMAIL } from './ContactPage';
import { cn } from '@/lib/utils';

export type LegalDoc = 'privacy' | 'terms';
const TITLES: Record<LegalDoc, string> = { privacy: 'Privacy policy', terms: 'Terms of service' };
const UPDATED = 'November 2026';

const ring = 'focus-visible:outline-2 focus-visible:outline-white/60';
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const link = 'text-fg underline decoration-white/25 underline-offset-4 transition-colors hover:decoration-white/70';

const H2 = ({ children }: { children: ReactNode }) => <h3 className="mt-11 text-[19px] font-semibold tracking-[-0.02em] text-fg first:mt-0">{children}</h3>;
const H3 = ({ children }: { children: ReactNode }) => <h4 className="mt-7 text-[15.5px] font-medium tracking-[-0.01em] text-fg">{children}</h4>;
const P = ({ children }: { children: ReactNode }) => <p className="mt-3 text-[15px] leading-[1.7] text-fg-2">{children}</p>;
const Ul = ({ children }: { children: ReactNode }) => <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-[1.7] text-fg-2 marker:text-fg-3">{children}</ul>;
const Ext = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer" className={cn(link, ring)}>{children}</a>;
const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`} className={cn(link, ring)}>{CONTACT_EMAIL}</a>;
const App = () => <Ext href="https://app.relatch.online/">app.relatch.online</Ext>;

function Privacy() {
  return (
    <>
      <H2>1. Overview</H2>
      <P>Relatch is a document intelligence tool. This Privacy Policy explains what data we collect, why we collect it, and how we handle it. We have built Relatch with a minimal data footprint by design. Authenticated users can upload documents which are processed to generate structured outputs intended for use as AI context. We aim to keep our data handling lightweight, reasonable, and transparent.</P>
      <P>By using Relatch at <App />, you agree to the practices described in this policy.</P>

      <H2>2. What We Collect</H2>
      <H3>2.1 Analytics and Behavioural Data</H3>
      <P>Relatch uses the following third-party analytics tools to understand how users interact with the product. This data is aggregated and does not personally identify you.</P>
      <Ul>
        <li><span className="text-fg">Google Analytics</span> — collects page views, session duration, device type, and general geographic region.</li>
        <li><span className="text-fg">PostHog</span> — records anonymised heatmaps, session replays, and product analytics events to help us identify usability issues and improve the product. PostHog may capture mouse movements, clicks, and page interactions but does not capture passwords or payment information.</li>
        <li><span className="text-fg">Google Tag Manager</span> — manages and deploys the analytics tags listed above. It does not independently collect data.</li>
      </Ul>
      <P>You can opt out of Google Analytics by installing the <Ext href="https://tools.google.com/dlpage/gaoptout">Google Analytics Opt-out Browser Add-on</Ext>. You can opt out of PostHog by disabling cookies in your browser settings.</P>

      <H3>2.2 Account Information</H3>
      <P>You can try Relatch once without an account (see 2.5). For regular use you need an account. Authentication and session management are handled by Clerk. You can sign in using Google OAuth or GitHub OAuth, or create an account with your email address and a password. When you sign in through Google or GitHub, Relatch receives a basic identity profile (such as your name, email address, and provider user ID) so that we can associate your session with your account; we do not receive your OAuth password. When you use email, we send a one-time code to that address to confirm it is yours (and, if you choose, to log you in). Your password is handled and stored by Clerk; Relatch never sees or stores it.</P>
      <P>We use this account information solely to authenticate you, scope your uploads and outputs to your account, and provide essential account-related communication. We do not sell or rent account data.</P>

      <H3>2.3 Waitlist, Feedback and Contact Submissions</H3>
      <P>Relatch uses WebForms to handle feedback and contact submissions in the app, and SplitForms holds the sign-ups from our earlier waitlist. WebForms stores submissions on servers in Germany (EU) and may pass a message to an automated spam classifier before delivering it to us. If you choose to submit your email address, a message or feedback through one of these forms, that submission is delivered to us via the service named above and used solely to follow up with you about Relatch and to improve it. Leaving an email with feedback is optional. We will not send marketing emails unrelated to Relatch. You can request removal of your email at any time by contacting us.</P>

      <H3>2.4 Uploaded Documents</H3>
      <P>Documents you upload (PDF, CSV, XML, DOCX, scanned images, and similar formats) are processed client-side where possible. When server-side processing is required, your content is transmitted to third-party AI and OCR providers solely for extraction and enrichment. We do not retain your uploaded files on our servers beyond what is reasonably needed to deliver the resulting output.</P>
      <P>We have opted out, wherever a provider makes such a setting available, of allowing your uploaded content to be used to train or improve their AI models. For the AI providers in our pipeline, including Google's Gemini API, we apply the same opt-out posture within the account-level controls those platforms make available to us — but because your content is ultimately processed on each provider's own infrastructure, it remains subject to that provider's own terms of service, technical safeguards, and any changes they make to them, which are outside our direct control. You are responsible for the content you upload, and we encourage you to review the individual privacy policies of the third-party services listed in Section 5.</P>

      <H3>2.5 Trying Relatch Without an Account, and Abuse Prevention</H3>
      <P>If you try Relatch without signing in, your browser first runs Cloudflare Turnstile, a check that tells people apart from automated programs. Turnstile processes signals such as your IP address, your browser's User-Agent and TLS fingerprint, and the website it runs on. Cloudflare may also set strictly necessary bot-detection cookies as part of the check (see Cloudflare's <Ext href="https://www.cloudflare.com/turnstile-privacy-policy/">Turnstile Privacy Addendum</Ext>). Clerk uses the same Turnstile check to protect sign-up. Once the check passes, we issue a short-lived trial token that expires after 10 minutes. To stop automated abuse, we count how many trial tokens each IP address requests; that count is kept for one hour. If Cloudflare cannot be reached, each IP address can receive one trial token a day instead, and that count is kept for two days. We also keep a daily total of free tries, with no personal information, for two days.</P>
      <P>A free try without an account shows a preview of your skill: its first sections in full and the titles of the rest. The complete skill is kept with Upstash for 24 hours so that you can unlock it by creating a free account or logging in, and is deleted after that; it is not linked to your name or email address. When you unlock it, we record against your account ID when you unlocked it, whether you signed up or logged in, which button you pressed, the target agent and the number of skill files. That record is kept for 90 days. A marker that your account has used its one free unlock, and daily totals of unlocks with no personal information, are kept for up to 400 days. While a free skill is waiting to be unlocked, the app keeps a reference to it in your browser's session storage, which is cleared when you close the tab.</P>
      <P>For signed-in users we keep daily and weekly usage counters tied to your account ID, which expire within 8 days. These records are stored with Upstash (Redis, AWS us-east-1, USA).</P>
      <P>We also keep security logs with Axiom: for requests to our service they record the time, the outcome, your IP address and, if you are signed in, your account ID. They never contain your documents, their text or their file names. Security logs are kept for 30 days and are used only to detect abuse and keep the service running.</P>

      <H3>2.6 Your Skill History</H3>
      <P>If you are signed in, Relatch saves the skills you generate so that you can open, download and reuse them later. For each skill we store the generated skill files, the skill's name (which you choose, and which by default is based on your document's file name), the target agent (Claude, Codex or Agents), when it was created, how long it took, and its size. We keep your 30 most recent skills.</P>
      <P>We never store the documents you upload, the text extracted from them, or their file names. A skill you generate without an account is not added to a history: its full text is held for 24 hours only so that you can unlock it (see 2.5), and once you unlock it, it is saved to your history like any other skill.</P>
      <P>Skill history is stored in a database run by Neon (a Databricks company) in AWS us-east-1, USA. It stays there until you delete a skill, clear your history, or delete your account. To protect against data loss we keep encrypted nightly backups for 30 days, so a deleted skill can remain in a backup for up to 30 days before it is gone completely. A copy of your recent history is also kept in your browser's local storage so the history list loads quickly; clearing your browser data removes it.</P>

      <H2>3. How Your Documents Are Processed</H2>
      <P>Relatch uses a multi-stage processing pipeline to extract and enrich content from your documents.</P>
      <H3>3.1 Text Extraction</H3>
      <Ul>
        <li>For standard digital PDFs and documents, Relatch uses a built-in PDF.js parser to extract text directly in your browser — no server call is made for these documents.</li>
        <li>For scanned or image-based content that requires optical character recognition, Relatch calls LlamaParse (by LlamaIndex) first. If LlamaParse is unavailable, or its text looks incomplete for the document, the document is also sent to Datalab (capped per signed-in user per day, and by a site-wide daily limit for use without an account). LlamaIndex states that it does not use customer data for model training by default and that files uploaded for parsing are deleted after at most 48 hours.</li>
      </Ul>
      <H3>3.2 AI Enrichment</H3>
      <P>After extraction, the text is sent to an AI model for enrichment and skill file generation:</P>
      <Ul>
        <li>Before enrichment, Relatch sends parts of the extracted text, together with the file name and the category you assigned, to TypeSafe's Jev model, accessed through OpenRouter: an excerpt of up to about 24,000 characters, and short passages (up to about 400 characters each) taken from across the whole document. Jev classifies the document (for example, whether it is a procedure, a policy, or personal writing) and identifies which parts are the document's main content rather than page furniture such as navigation menus, footers or sign-up prompts, so Relatch can decide how to structure your skill file and which parts of your document to use. It returns only these classifications and does not generate any text from your document. OpenRouter lists this model endpoint as zero data retention. If this step is unavailable, Relatch skips it and generates your skill file as usual.</li>
        <li>For most documents, Relatch uses Google's Gemini API as the primary enrichment model. If this model fails, times out, or does not meet our internal quality threshold, Relatch automatically retries the request through a second, independent AI provider — OpenRouter, routed specifically to Groq's infrastructure — so a single provider outage does not block your generation.</li>
        <li>For documents that Relatch identifies as complex (for example, long, dense or highly technical material), or when a draft from the primary model fails our internal quality check, Relatch may send the text instead to open-weight models developed by DeepSeek and Z.ai (GLM), accessed through OpenRouter. Relatch requests these models only from hosting providers that OpenRouter lists as zero data retention. If these models are unavailable, Relatch falls back to Google's Gemini API.</li>
        <li>If none of these AI models is available, Relatch activates a fallback protocol that uses strict internal templates and domain knowledge rules to produce a best-effort output without any external AI call.</li>
      </Ul>
      <P>Your document content may be transmitted to OpenRouter and TypeSafe for document classification and main-content detection; to Google (Gemini API) for enrichment; to OpenRouter and Groq on fallback; and, for complex documents or a draft that fails our quality check, to OpenRouter and the zero-data-retention hosting provider it selects for the DeepSeek or GLM models. Please review <Ext href="https://policies.google.com/privacy">Google's Privacy Policy</Ext>, <Ext href="https://openrouter.ai/privacy">OpenRouter's Privacy Policy</Ext>, <Ext href="https://typesafe.ai/legal/privacy-policy">TypeSafe's Privacy Policy</Ext>, and <Ext href="https://groq.com/privacy-policy">Groq's Privacy Policy</Ext> for details.</P>
      <H3>3.3 Smart Analyzer</H3>
      <P>Before any extraction or enrichment begins, Relatch's smart analyzer scans your upload for corrupted files, unsupported formats, and irrelevant document types. Files that do not pass this check are discarded immediately and never transmitted to any external service.</P>

      <H2>4. Cookies and Session Storage</H2>
      <P>Relatch uses cookies and similar browser storage for two purposes: (a) analytics, placed by Google Analytics and PostHog as described above; and (b) authentication, where Clerk uses cookies and session storage to keep you signed in and to maintain your session securely. If you are signed in, Relatch also keeps a copy of your recent skill history in your browser's local storage (see 2.6). During the free try and at sign-up, Cloudflare Turnstile runs in your browser and may set strictly necessary bot-detection cookies, and while a free skill is waiting to be unlocked the app keeps a reference to it in your browser's session storage (see 2.5). The app also keeps your settings in your browser's local storage, such as the agent you picked and whether the background moves; they are not sent to our servers. Authentication storage is essential to keeping accounts functional. Analytics cookies are non-essential and you can manage or disable them through your browser settings.</P>

      <H2>5. Third-Party Services</H2>
      <P>The following third-party services may process your data as part of using Relatch:</P>
      <Ul>
        <li>Clerk (authentication and session management, including email sign-in codes and password storage)</li>
        <li>Google OAuth (sign-in)</li>
        <li>GitHub OAuth (sign-in)</li>
        <li>Cloudflare Turnstile — bot protection on the free try and at sign-up</li>
        <li>Google Analytics</li>
        <li>Google Tag Manager</li>
        <li>PostHog</li>
        <li>Gemini API (Google) — AI enrichment</li>
        <li>LlamaParse (LlamaIndex) — primary OCR</li>
        <li>Datalab — secondary OCR fallback</li>
        <li>OpenRouter / Groq — AI enrichment fallback</li>
        <li>TypeSafe Jev (via OpenRouter) — document classification and main-content detection before enrichment</li>
        <li>DeepSeek and GLM (Z.ai) models (via OpenRouter, zero-data-retention hosts only) — enrichment for complex documents</li>
        <li>WebForms (feedback and contact forms, hosted in Germany)</li>
        <li>SplitForms (earlier waitlist sign-ups)</li>
        <li>Vercel (hosting and edge delivery)</li>
        <li>Neon (a Databricks company) — skill history database for signed-in users</li>
        <li>Upstash — trial tokens, abuse prevention, usage limits, and free skills waiting to be unlocked</li>
        <li>Axiom — security logs</li>
      </Ul>
      <P>Each of these services operates under its own privacy policy. We encourage you to review them independently.</P>

      <H2>6. Data Retention</H2>
      <P>We retain account information for as long as your account is active. Uploaded documents are not kept beyond what is reasonably needed to deliver the resulting output. Your skill history is kept until you delete it or your account, and deleted skills can remain in our encrypted backups for up to 30 days (see 2.6). Trial tokens expire after 10 minutes, IP-based abuse counters after one hour (two days for the fallback used when Cloudflare cannot be reached), usage counters within 8 days, and security logs after 30 days (see 2.5). A free skill waiting to be unlocked is deleted after 24 hours; unlock records are kept for 90 days, and the one-free-unlock marker and daily unlock totals for up to 400 days (see 2.5). Analytics data is retained by Google Analytics and PostHog under their respective retention policies. Feedback and contact-form submissions are retained by WebForms for up to 30 days, or until you request removal, whichever is sooner; the copy delivered to our inbox is kept only as long as we need it to follow up with you. Waitlist sign-ups are kept by SplitForms until you request removal.</P>

      <H2>7. Your Rights</H2>
      <P>You can delete any saved skill, or clear your whole skill history, directly in the app at any time. Deleting your account also deletes your skill history. You can also request deletion of your account, your waitlist email, or any contact submission at any time by emailing us at <Mail />. We will action reasonable requests within a reasonable timeframe.</P>

      <H2>8. Children</H2>
      <P>Relatch does not target children and does not knowingly collect personal information from minors. If you believe a minor has submitted their email address via the waitlist form, contact us and we will remove it promptly.</P>

      <H2>9. Governing Law</H2>
      <P>This Privacy Policy is governed by the laws of India. Any disputes arising in connection with this policy shall be subject to the jurisdiction of the competent courts in India.</P>

      <H2>10. Changes to This Policy</H2>
      <P>We may update this Privacy Policy as Relatch evolves. When we do, we will update the date at the top of this page. Continued use of Relatch after any changes constitutes acceptance of the updated policy.</P>
    </>
  );
}

function Terms() {
  return (
    <>
      <H2>1. Acceptance of Terms</H2>
      <P>By accessing or using Relatch at <App />, you agree to be bound by these Terms of Service. If you do not agree, do not use Relatch. These terms apply to all users of the service.</P>

      <H2>2. Description of Service</H2>
      <P>Relatch is a document intelligence tool. Authenticated users can upload files including PDFs, CSVs, XML files, DOCX files, scanned documents, and similar formats. Relatch may process those uploads to extract their content, enrich it using AI models, and produce structured AI context outputs (such as skill files) intended for use with AI coding and reasoning agents.</P>
      <P>Relatch is currently in active development. Features, availability, and processing pipelines may change without prior notice. We do not guarantee uninterrupted availability of the service.</P>
      <H3>2.1 Accounts and Authentication</H3>
      <P>You can try Relatch once without an account: the free try shows a preview of your skill, and creating a free account unlocks the whole skill. For regular use you need a Relatch account. Authentication is provided through Clerk, and you can sign in using Google OAuth or GitHub OAuth, or with your email address and a password. Your use of those third-party authentication providers is also governed by their respective terms and privacy policies. You are responsible for maintaining the confidentiality of any credentials used to access your account and for any activity that occurs under it.</P>

      <H2>3. Free Access</H2>
      <P>Relatch is free to use. There are no subscription fees or paid tiers at this time. Free use has a daily limit on the number of skills you can generate, which the app shows you. We reserve the right to introduce pricing in the future. If we do, we will notify waitlist subscribers and provide adequate notice before any free tier is modified.</P>

      <H2>4. Acceptable Use and User Content</H2>
      <P>You are solely responsible for any content, files, or documents you upload to Relatch. You agree not to use Relatch to:</P>
      <Ul>
        <li>Upload illegal content or content that violates applicable laws in your jurisdiction or in India.</li>
        <li>Upload content that you do not have the right to process or share, including copyrighted material you do not own or have permission to use.</li>
        <li>Upload documents containing malware, exploits, or other malicious code.</li>
        <li>Upload content that is harmful, abusive, harassing, defamatory, hateful, or otherwise objectionable.</li>
        <li>Attempt to reverse engineer, scrape, or extract the underlying processing logic, AI prompts, or internal templates of Relatch.</li>
        <li>Deliberately upload corrupted, falsified, or misleading documents with the intent to produce deceptive outputs.</li>
        <li>Resell, sublicense, or commercially exploit Relatch's outputs without attribution or permission.</li>
      </Ul>
      <P>We may suspend or terminate accounts that abuse or misuse the service, violate these terms, or upload content that falls into any of the categories above. Where reasonable, we will try to give notice, but we may act immediately when needed to protect Relatch, other users, or third parties.</P>

      <H2>5. Document Processing and AI Models</H2>
      <P>Relatch processes uploaded documents through a multi-stage pipeline. Text extraction is performed using a PDF.js parser for standard documents, or, for scanned and image-based content, OCR by LlamaParse (by LlamaIndex), with Datalab as the fallback provider. Before enrichment, TypeSafe's Jev model, accessed through OpenRouter, classifies the document and identifies its main content. Enrichment is performed using Google's Gemini API, with OpenRouter (routed to Groq's infrastructure) as an independent fallback provider. For complex documents, or when a draft fails Relatch's internal quality check, Relatch may instead use open-weight models developed by DeepSeek and Z.ai (GLM), accessed through OpenRouter on zero-data-retention hosting providers only. A fallback protocol using internal templates is activated if all AI enrichment providers are unavailable.</P>
      <P>Relatch includes a smart analyzer that screens uploads before processing begins. Corrupted files, unsupported formats, and documents that do not pass the analyzer's checks are discarded automatically and never transmitted to any external service.</P>
      <P>Relatch makes no guarantee that outputs generated by the AI enrichment pipeline are accurate, complete, or suitable for any particular purpose. You are responsible for reviewing all outputs before use.</P>

      <H2>6. Intellectual Property</H2>
      <H3>6.1 Your Content</H3>
      <P>You retain full ownership of any documents you upload to Relatch. By uploading a document, you grant Relatch a limited, temporary licence to process that document solely for the purpose of generating your requested output. This licence ends when your session ends.</P>
      <H3>6.2 Generated Outputs</H3>
      <P>The structured skill files and outputs generated by Relatch from your documents are yours to use. Relatch does not claim ownership over outputs derived from your content.</P>
      <H3>6.3 Relatch's Property</H3>
      <P>The Relatch name, logo, interface design, processing logic, internal templates, domain knowledge rules, and all related intellectual property remain the exclusive property of the Relatch team. Nothing in these terms grants you any rights to these assets.</P>

      <H2>7. Third-Party Services</H2>
      <P>Relatch integrates with third-party services including Clerk (authentication), Google OAuth and GitHub OAuth (sign-in), Google's Gemini API, LlamaParse (LlamaIndex), Datalab, OpenRouter and Groq (AI enrichment fallback), TypeSafe Jev via OpenRouter (document classification), DeepSeek and GLM (Z.ai) models via OpenRouter (enrichment for complex documents), WebForms (feedback and contact forms), SplitForms (waitlist), Google Analytics, Google Tag Manager, PostHog, and Vercel (hosting). Your use of Relatch is subject to the terms and privacy policies of these services where applicable. Relatch is not responsible for the availability, accuracy, or conduct of any third-party service.</P>

      <H2>8. Disclaimers</H2>
      <P>Relatch is provided on an "as is" and "as available" basis without warranties of any kind, express or implied. We do not warrant that Relatch will be uninterrupted, error-free, or that outputs will meet your requirements or expectations.</P>
      <P>AI-generated outputs can be incomplete, incorrect, or contextually inappropriate. You bear full responsibility for how you use any output produced by Relatch.</P>

      <H2>9. Limitation of Liability</H2>
      <P>To the fullest extent permitted by applicable law, Relatch and its developers shall not be liable for any direct, indirect, incidental, consequential, or special damages arising from your use of the service, including but not limited to loss of data, loss of business, or damages resulting from reliance on AI-generated outputs.</P>

      <H2>10. Availability and Changes</H2>
      <P>Relatch is under active development. We may modify, suspend, or discontinue any part of the service at any time without notice. We are not liable to you or any third party for any modification, suspension, or discontinuation of the service.</P>

      <H2>11. Waitlist and Communications</H2>
      <P>If you submit your email address through the Relatch waitlist form, you consent to receiving a notification when Relatch launches at full scale. You will not receive unsolicited marketing. You can request removal from the waitlist at any time by emailing <Mail />.</P>

      <H2>12. Governing Law and Jurisdiction</H2>
      <P>These Terms of Service are governed by the laws of India. Any disputes arising from or in connection with these terms shall be subject to the exclusive jurisdiction of the competent courts in India.</P>

      <H2>13. Changes to These Terms</H2>
      <P>We may update these Terms of Service as Relatch evolves. When we do, we will update the date at the top of this page. Your continued use of Relatch after any update constitutes acceptance of the revised terms.</P>
    </>
  );
}

export function LegalPage({ doc, onBack, backLabel, onOpen }: { doc: LegalDoc; onBack: () => void; backLabel: string; onOpen: (p: LegalDoc | 'contact') => void }) {
  const body = useRef<HTMLDivElement>(null);
  const other: LegalDoc = doc === 'privacy' ? 'terms' : 'privacy';

  // The text arrives softly, like the Contact form, and again when the other document is opened from here.
  // 2026-11-03 (Manas: "a bit static"): the whole page no longer arrives as one block. Each heading,
  // paragraph and list resolves out of a blur as it scrolls into view - the same motion as the skill's
  // reasoning steps (Thinking.tsx: opacity, 8px rise, 6px blur, 0.55 s expo.out, 0.18 s apart), so blocks
  // that come into view together still read in order. Under it, a light parallax: the title drifts up and
  // fades as the page scrolls, and section headings drift a few pixels against their text. The reveal
  // owns `transform` and the parallax owns the separate CSS `translate` property, so they never fight.
  useLayoutEffect(() => {
    const root = body.current;
    if (!root || calm()) return;
    const hero = root.querySelector<HTMLElement>('[data-hero]');
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-hero] > *, article > *, [data-also]')];
    const heads = [...root.querySelectorAll<HTMLElement>('article > h3')];
    const ctx = gsap.context(() => {
      gsap.set(blocks, { opacity: 0, y: 8, filter: 'blur(6px)' });
    }, root);
    const seen = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      // Everything that came into view in this frame, in reading order.
      const batch = entries.filter((e) => e.isIntersecting && !seen.has(e.target)).map((e) => e.target as HTMLElement).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      if (!batch.length) return;
      batch.forEach((el) => { seen.add(el); io.unobserve(el); });
      // The steps' 0.18 s spacing, squeezed when many blocks arrive at once (a long scroll), so the last
      // of a batch starts within half a second instead of leaving the screen half empty.
      ctx.add(() => gsap.to(batch, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.55, ease: 'expo.out', stagger: Math.min(0.18, 0.5 / batch.length), clearProps: 'filter' }));
    }, { rootMargin: '0px 0px -6% 0px' });
    blocks.forEach((el) => io.observe(el));

    let raf = 0;
    const drift = () => {
      raf = 0;
      const vh = window.innerHeight;
      // A fast fling or End can jump a block from below the screen to above it without it ever being in
      // view, so the observer never reports it and it would stay invisible on the way back up. Anything
      // still hidden that is already above the screen is simply shown (it is off-screen: no motion needed).
      if (seen.size < blocks.length) {
        for (const el of blocks) {
          if (seen.has(el) || el.getBoundingClientRect().bottom > 0) continue;
          seen.add(el); io.unobserve(el);
          ctx.add(() => gsap.set(el, { opacity: 1, y: 0, clearProps: 'filter' }));
        }
      }
      if (hero) {
        const y = Math.min(window.scrollY, 400);
        hero.style.translate = `0 ${(-y * 0.28).toFixed(1)}px`;
        hero.style.opacity = String(Math.max(0.25, 1 - y / 420));
      }
      // A heading at the middle of the screen sits where it belongs; above it, it has drifted up a little
      // ahead of its text, below it, a little behind. At most 14px either way.
      for (const h of heads) {
        const r = h.getBoundingClientRect();
        if (r.bottom < -40 || r.top > vh + 40) continue;
        const off = (r.top + r.height / 2 - vh / 2) / vh;
        h.style.translate = `0 ${Math.max(-14, Math.min(14, off * 18)).toFixed(1)}px`;
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(drift); };
    drift();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      ctx.revert();
      for (const el of [hero, ...heads]) if (el) { el.style.translate = ''; el.style.opacity = ''; }
    };
  }, [doc]);

  return (
    <div className="relative min-h-dvh">
      <header className="chrome-x sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ink/75 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button onClick={onBack} aria-label={backLabel} title={backLabel} className={cn('-ml-2 grid size-9 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg', ring)}><ArrowLeftIcon size={18} /></button>
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{TITLES[doc]}</h1>
      </header>

      <main className="mx-auto w-full max-w-[680px] px-4 pb-28 pt-10 sm:px-6 sm:pt-12">
        <div ref={body}>
          <div data-hero>
            <h2 className="text-[clamp(28px,4vw,36px)] font-semibold tracking-[-0.035em] text-fg">{TITLES[doc]}</h2>
            <p className="mt-2 text-[14px] text-fg-3">Last updated: {UPDATED}</p>
          </div>
          <article className="mt-10 [overflow-wrap:anywhere]">
            {doc === 'privacy' ? <Privacy /> : <Terms />}
            <H2>{doc === 'privacy' ? '11' : '14'}. Contact</H2>
            <P>For any {doc === 'privacy' ? 'privacy-related questions' : 'questions regarding these terms'}, contact us at <Mail />, or <button type="button" onClick={() => onOpen('contact')} className={cn(link, ring)}>send us a message</button>.</P>
          </article>
          <button data-also type="button" onClick={() => { window.scrollTo({ top: 0 }); onOpen(other); }} className={cn('group mt-14 flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-white/[0.02] px-5 py-4 text-left transition-colors hover:border-line-2 hover:bg-white/[0.04]', ring)}>
            <span>
              <span className="block text-[12.5px] text-fg-3">Also read</span>
              <span className="mt-0.5 block text-[15px] font-medium text-fg">{TITLES[other]}</span>
            </span>
            <ArrowRightIcon size={18} className="shrink-0 text-fg-2 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
          </button>
        </div>
      </main>
    </div>
  );
}
