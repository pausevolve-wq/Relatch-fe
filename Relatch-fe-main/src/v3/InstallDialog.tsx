// "How to install", as a pop-up. It is opened from the sidebar (and by Download, which is step one of
// installing), not built into the skill preview, so the preview stays just the skill. The person picks
// Claude or Codex here and the walkthrough for that one plays.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CaretDownIcon, XIcon } from '@phosphor-icons/react';
import { TargetToggle } from './Start';
import { SetupScene } from './SetupScene';
import { AgentScene } from './AgentScene';
import { AGENT_INSTALLS, downloadPlan, skillListing } from './skillExport';
import type { Part, Plan } from './JobStage';
import { toSkillSlug } from '@/engine/core';

import type { Target } from './skillExport';

// `name` is the skill the steps are written for; without one they use a stand-in. `plan` is the download
// it came from (one .md or a ZIP); `parts` its files, so the other agent's download can be worked out too.
export function InstallDialog({ target, name, parts, plan, onClose }: { target: Target; name: string; parts?: Part[]; plan?: Plan; onClose: () => void }) {
  const [agent, setAgent] = useState<Target>(target);
  const panel = useRef<HTMLDivElement>(null);
  const shown = name.trim() || 'your-skill';
  const files = (parts ?? []).filter((p) => p.status === 'done').map((p) => ({ name: p.name, content: p.content }));
  const download = agent === target && plan ? plan : downloadPlan(agent, shown, files.length ? files : [{ name: shown, content: '' }]);
  // The line the agents' skill menus show for it: its first document's description.
  const listing = files.length ? skillListing(files[0].content, download.folders[0] || toSkillSlug(shown)) : { title: 'Your Skill', about: 'Follows the rules from your document' };

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!panel.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // A phone gets the bottom sheet's slide up (the sign-up sheet's entrance); bigger screens the blur-in
    if (window.matchMedia('(max-width: 639px)').matches) {
      panel.current.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 420, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      return;
    }
    panel.current.animate([
      { opacity: 0, transform: 'translateY(18px) scale(0.985)', filter: 'blur(10px)' },
      { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
    ], { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, []);

  return (
    // Phones (2026-11-06, Manas: the mobile sizing was off): a sheet from the bottom, full width, scrolling
    // inside, like the sign-up sheet. It was a centred card that never shrank below the switch's width
    // (a grid item's min-width is its content), so it ran off every phone screen: 383px wide at 390, 344
    // and 280. min-w-0 lets it fit; sm and up stay the centred pop-up exactly as before.
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-md sm:grid sm:place-items-center sm:overflow-y-auto sm:p-4 scroll-thin" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Closed by a press that starts on the backdrop (as Modal and the sign-up sheet): a click would also
          fire when a text selection begun in the panel ends outside it */}
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="install-h" className="relative w-full min-w-0 max-w-[860px] border border-line-2 bg-ink-1 p-5 shadow-[0_40px_120px_rgb(0_0_0/0.7)] scroll-thin max-sm:max-h-[92dvh] max-sm:overflow-y-auto max-sm:overflow-x-hidden max-sm:rounded-t-[28px] max-sm:border-b-0 max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] max-[360px]:px-4 sm:rounded-[28px] sm:p-8">
        <button aria-label="Close" onClick={onClose} className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"><XIcon size={17} /></button>

        <h2 id="install-h" className="pr-10 text-[22px] font-semibold tracking-[-0.03em] text-fg">How to install</h2>
        <p className="mt-1 text-[14.5px] text-fg-2">{agent === 'agents' ? "About a minute. Drop it into your agent's chat and ask it to install it." : 'About a minute. Pick where the skill is going and watch where it goes.'}</p>

        <div className="mt-5"><TargetToggle target={agent} onChange={setAgent} /></div>

        {/* Keyed: the walkthrough picks its scene when it mounts. An Agents skill has no one app to walk
            through: it lists where each agent reads skills, the same table as its README.
            2026-11-03: now one chat walkthrough for every agent (AgentScene), with that table folded
            underneath for an agent that cannot install from its chat. */}
        {agent === 'agents'
          ? <>
              <div data-ph-mask className="mt-6 ph-sensitive"><AgentScene key={agent} file={download.file} skill={download.folders[0] || toSkillSlug(shown) || 'your-skill'} title={listing.title} real={!!name.trim()} /></div>
              <AgentsSetup folder={download.folders[0] || toSkillSlug(shown) || 'your-skill'} file={download.file} />
            </>
          : <div data-ph-mask className="mt-6 ph-sensitive"><SetupScene key={agent} target={agent} slug={toSkillSlug(shown) || 'your-skill'} name={shown} real={!!name.trim()} title={listing.title} about={listing.about} file={download.file} folders={download.folders} /></div>}
      </div>
    </div>
  );
}

// Where an Agents download goes, agent by agent (AGENT_INSTALLS, from each agent's own docs). Text in
// backticks is a path or a command, shown as code.
// Since 2026-11-03 folded under the chat walkthrough, for an agent that cannot install from its chat.
function AgentsSetup({ folder, file }: { folder: string; file: string }) {
  const code = (t: string) => t.split('`').map((p, i) => (i % 2 ? <code key={i} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12.5px] text-fg">{p}</code> : p));
  return (
    <details data-ph-mask className="ph-sensitive group mt-6 rounded-2xl border border-line bg-ink-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[14px] text-fg sm:px-5 [&::-webkit-details-marker]:hidden">Or install it by hand<CaretDownIcon size={14} className="shrink-0 text-fg-2 transition-transform duration-300 group-open:rotate-180" /></summary>
      <div className="border-t border-line px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5">
      <p className="text-[14.5px] text-fg">{code(`Unzip ${file}, then put the \`${folder}\` folder where your agent reads skills:`)}</p>
      <dl className="mt-4 divide-y divide-line">
        {AGENT_INSTALLS.map(([who, how]) => (
          <div key={who} className="grid gap-1 py-3 sm:grid-cols-[130px_1fr] sm:gap-4">
            <dt className="text-[14px] font-medium text-fg">{who}</dt>
            <dd className="text-[14px] leading-relaxed text-fg-2">{code(how.replace(/the \{folder\} folder/g, 'the folder').replace(/\{folder\}/g, folder))}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[13px] text-fg-2">Then ask for something the skill covers: the agent loads it by itself when a request matches its description. The README in the ZIP has these steps too, and a few requests to test it with.</p>
      </div>
    </details>
  );
}
