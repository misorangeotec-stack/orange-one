import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";

/**
 * "Share login details" — generates a ready-to-send onboarding message for a
 * user (login link + email username + password) that an admin can copy and send.
 *
 * For STAFF the password is the user's mobile number (the workspace policy: the
 * mobile doubles as the initial login password — see `phone-as-password`). It is
 * NEVER stored, so we can't read it back from the directory; the admin
 * confirms/enters it here and it's used only to fill the message text.
 * `defaultPassword` pre-fills it from the mobile we just saved on the create/edit
 * form for convenience.
 *
 * ⚠ AN EXTERNAL (CUSTOMER) ACCOUNT NEEDS DIFFERENT WORDS, and getting them wrong
 *   here is worse than anywhere else on this screen — this text is COPIED AND SENT,
 *   so a wrong sentence is delivered to another company over our name. Three of them
 *   were wrong for a customer:
 *
 *     - "change your password from My Account → Change password" — `/account` is the
 *       staff screen, and an external login is redirected off it. Their password
 *       screen is the Password tab in the Order Desk.
 *     - "usually their mobile number" / the tel-shaped placeholder — a customer's
 *       password is a real password and their mobile is usually not on file at all.
 *     - "use Reset password (re-save the user) to re-pin it to their mobile number"
 *       — that re-pin is now refused for external accounts, so following the
 *       instruction does nothing at all and leaves the admin with no idea why.
 */
export default function ShareLoginModal({
  open,
  onClose,
  name,
  email,
  defaultPassword,
  isExternal = false,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  email: string;
  defaultPassword: string;
  /** A customer, not staff — changes every sentence below that names a screen. */
  isExternal?: boolean;
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
      subtitle={
        isExternal
          ? `Enter the password you set for ${name || "this customer"} to generate a ready-to-send message.`
          : `Enter ${name || "the user"}'s current password (usually their mobile number) to generate a ready-to-send message.`
      }
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
            placeholder={isExternal ? "the password you set for them" : "e.g. 9876543210"}
            inputMode={isExternal ? "text" : "tel"}
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </FieldLabel>
        <p className="text-[11.5px] text-grey-2 -mt-2">
          {isExternal
            ? "If you don’t know it, edit this customer and set a new password — saving their record does NOT reset it."
            : "If you don’t know it, use “Reset password” (re-save the user) to re-pin it to their mobile number."}
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
