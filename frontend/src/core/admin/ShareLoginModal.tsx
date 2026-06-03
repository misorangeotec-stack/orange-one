import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";

/**
 * "Share login details" — generates a ready-to-send onboarding message for a
 * user (login link + email username + password) that an admin can copy and send.
 *
 * The password is the user's mobile number (the workspace policy: the mobile
 * doubles as the initial login password — see `phone-as-password`). It is NEVER
 * stored, so we can't read it back from the directory; the admin confirms/enters
 * it here and it's used only to fill the message text. `defaultPassword` pre-fills
 * it from the mobile we just saved on the create/edit form for convenience.
 */
export default function ShareLoginModal({
  open,
  onClose,
  name,
  email,
  defaultPassword,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  email: string;
  defaultPassword: string;
}) {
  const [password, setPassword] = useState(defaultPassword);
  const [copied, setCopied] = useState(false);

  // Re-seed the password each time the modal opens for a (possibly) different user.
  useEffect(() => {
    if (open) {
      setPassword(defaultPassword);
      setCopied(false);
    }
  }, [open, defaultPassword]);

  // The production sign-in URL on the main domain — kept fixed (not derived from
  // window.location) so the message is correct even when shared from a preview
  // deployment or localhost.
  const loginLink = "https://www.orangeonehub.com/login";
  const usernameLine = email.trim() || "(set an email on the user to use as the username)";

  const message =
    `Here are your Orange One login details.\n\n` +
    `Login link: ${loginLink}\n` +
    `Username (email): ${usernameLine}\n` +
    `Password: ${password || "(enter the user's mobile number)"}\n\n` +
    `You can change your password anytime from My Account → Change password.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context / permissions). The message
      // textarea is selectable (click → it selects all), so the admin can copy
      // it manually — nothing more to do here.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share login details"
      subtitle={`Enter ${name || "the user"}'s current password (usually their mobile number) to generate a ready-to-send message.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={copy}>
            {copied ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                Copied
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                Copy message
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldLabel label="Password" hint="not stored — used only to fill the message below">
          <TextInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="e.g. 9876543210"
            inputMode="tel"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </FieldLabel>
        <p className="text-[11.5px] text-grey-2 -mt-2">
          If you don't know it, use “Reset password” (re-save the user) to re-pin it to their mobile number.
        </p>

        <FieldLabel label="Message">
          <textarea
            readOnly
            value={message}
            rows={8}
            onFocus={(e) => e.target.select()}
            className="w-full rounded-xl border border-line bg-page/60 px-3.5 py-3 text-[13px] leading-relaxed text-navy font-mono resize-y focus:outline-none focus:ring-2 focus:ring-orange/20 focus:border-orange/40"
          />
        </FieldLabel>
      </div>
    </Modal>
  );
}
