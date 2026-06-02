import { useEffect, useState } from "react";
import { Mail, MessageCircle, ExternalLink } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { Label } from "@hub/components/ui/label";
import { Textarea } from "@hub/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";

export type ShareChannel = "email" | "whatsapp";

/** Format a JS Date as DD-MM-YYYY (numeric, dashes). */
function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ShareChannel;
  salespersons: string[];
  asOfDate: string;
}

function defaultSubject(name: string, asOfDate: string) {
  const d = new Date(asOfDate);
  const stamp = isNaN(d.getTime())
    ? asOfDate
    : ddmmyyyy(d);
  return `Receivables Risk Report — ${name} — as of ${stamp}`;
}

function defaultBody(name: string, asOfDate: string) {
  const d = new Date(asOfDate);
  const stamp = isNaN(d.getTime())
    ? asOfDate
    : ddmmyyyy(d);
  return (
    `Hi ${name},\n\n` +
    `Please find attached the receivables risk report for your customer portfolio, as of ${stamp}.\n\n` +
    `The report includes:\n` +
    `  • A summary pivot by risk category\n` +
    `  • A customer-wise breakdown with outstanding, overdue and aging buckets\n\n` +
    `Please review and share your action plan for the Critical / High risk accounts.\n\n` +
    `Thanks,\nOrange Receivables Team`
  );
}

export function SharePromptDialog({
  open, onOpenChange, channel, salespersons, asOfDate,
}: Props) {
  const [selected, setSelected] = useState<string>(salespersons[0] ?? "");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (open) {
      const first = salespersons[0] ?? "";
      setSelected(first);
      setRecipient("");
      setSubject(defaultSubject(first, asOfDate));
      setBody(defaultBody(first, asOfDate));
    }
  }, [open, salespersons, asOfDate]);

  useEffect(() => {
    if (!selected) return;
    setSubject(defaultSubject(selected, asOfDate));
    setBody(defaultBody(selected, asOfDate));
  }, [selected, asOfDate]);

  const isEmail = channel === "email";
  const Icon = isEmail ? Mail : MessageCircle;

  const openShareLink = () => {
    if (isEmail) {
      const to = encodeURIComponent(recipient.trim());
      const s  = encodeURIComponent(subject);
      const b  = encodeURIComponent(body);
      window.location.href = `mailto:${to}?subject=${s}&body=${b}`;
    } else {
      const text = `*${subject}*\n\n${body}`;
      const phone = recipient.trim().replace(/[^\d+]/g, "");
      const url = phone
        ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-card max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            {isEmail ? "Send via Email" : "Share via WhatsApp"}
          </DialogTitle>
          <DialogDescription>
            {isEmail
              ? "Opens your email client with the subject and body pre-filled. Attach the downloaded report before sending."
              : "Opens WhatsApp with the message pre-filled. You'll need to attach the downloaded report from your device."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Salesperson</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="rounded-input">
                <SelectValue placeholder="Choose a salesperson" />
              </SelectTrigger>
              <SelectContent>
                {salespersons.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              {isEmail ? "Recipient email (optional)" : "Recipient WhatsApp number (optional, with country code)"}
            </Label>
            <Input
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder={isEmail ? "name@example.com" : "e.g. +919876543210"}
              className="rounded-input text-sm"
            />
          </div>

          {isEmail && (
            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="rounded-input text-sm"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">{isEmail ? "Message body" : "Message"}</Label>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
              className="rounded-input text-sm font-mono text-[12px] leading-relaxed"
            />
          </div>

          <div className="rounded-input border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <strong>Attach the file:</strong> the Excel report was saved to your downloads folder.
            Attach it to {isEmail ? "the email" : "the WhatsApp chat"} before sending.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-button" onClick={openShareLink} disabled={!selected}>
            <ExternalLink className="h-4 w-4 mr-2" />
            {isEmail ? "Open email draft" : "Open WhatsApp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
