// "Your account": Clerk's own account settings (UserProfile) in a pop-up over the app, opened from the
// sidebar. What it lists comes from the Clerk instance, not from this file. In production that is
// name and photo, email addresses, Google and GitHub sign-in, password, signed-in devices and deleting
// the account (read from clerk.relatch.online on 2026-10-15). The colours come from clerkAppearance,
// set once on the ClerkProvider.
import { UserProfile } from '@clerk/react';
import { XIcon } from '@phosphor-icons/react';
import { Modal } from './Modal';

export function AccountDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Your account" onClose={onClose} className="w-auto max-w-full">
      <button aria-label="Close" onClick={onClose} className="absolute -top-11 right-0 grid size-9 place-items-center rounded-full text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"><XIcon size={17} /></button>
      <UserProfile routing="hash" />
    </Modal>
  );
}
