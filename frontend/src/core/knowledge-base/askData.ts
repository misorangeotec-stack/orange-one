/**
 * KB-1 · Asking the handbook a question, from the browser's side.
 *
 * The browser sends the QUESTION and the thread, and nothing else. `ask-handbook` reads the
 * handbook server-side under this user's own JWT, builds the prompt and calls the model, so
 * the key never ships and the browser never chooses what the model reads.
 *
 * 🔴 THE QUESTION IS LOGGED WITHOUT A NAME. Nothing here sends who is asking, and the
 * database will not accept a name either (kb_questions has a constraint). The ONLY way a
 * name is ever attached is `sendToHr`, which is the person choosing to be reachable so HR
 * can reply. This matters because the handbook covers harassment, grievance, maternity,
 * PIP and notice period: a named log would be a resignation signal and a pregnancy
 * disclosure recorded without consent, and would stop people using it for exactly the
 * policies they most need to look up privately.
 *
 * The `token` the answer carries is that consent handle. It is a random uuid, held only by
 * this browser, and it is what proves "this was my question" when rating or sending to HR.
 * It is never shown to a manager.
 */
import { supabase } from "@/core/platform/supabase";

export interface AskCitation {
  id: string;
  anchor: string;
  pathText: string;
  /** HR's note where the handbook contradicts itself. Shown with the citation. */
  note: string | null;
}

export interface AskAnswer {
  answer: string;
  covered: boolean;
  token: string | null;
  sections: AskCitation[];
}

export type ChatTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; answer?: AskAnswer; failed?: boolean };

/**
 * `functions.invoke` reports any non-2xx as a generic "Edge Function returned a non-2xx
 * status code" and hides the real body on `error.context`. Without unwrapping it, every
 * refusal and every rate-limit message would reach the reader as that one useless sentence.
 * (Same unwrapping as collectionPlanApi.invokePlan.)
 */
export async function askHandbook(question: string, thread: ChatTurn[]): Promise<AskAnswer> {
  const { data, error } = await supabase.functions.invoke("ask-handbook", {
    body: {
      question,
      thread: thread.map((t) => ({ role: t.role, content: t.content })),
    },
  });

  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) detail = String(parsed.error);
      } catch {
        /* body was not JSON, keep the generic message */
      }
    }
    throw new Error(detail);
  }

  const body = (data ?? {}) as Partial<AskAnswer> & { error?: string };
  if (body.error) throw new Error(body.error);

  return {
    answer: typeof body.answer === "string" ? body.answer : "",
    covered: body.covered === true,
    token: typeof body.token === "string" ? body.token : null,
    sections: Array.isArray(body.sections) ? body.sections : [],
  };
}

/** 👍 / 👎. First rating wins, and only within a day. Silent on failure: it is feedback. */
export async function rateAnswer(token: string, rating: 1 | -1): Promise<void> {
  const { error } = await supabase.rpc("kb_rate_answer", { p_token: token, p_rating: rating });
  if (error) throw new Error(error.message);
}

/** The one place a name is attached, and only because the reader pressed the button. */
export async function sendToHr(token: string): Promise<void> {
  const { error } = await supabase.rpc("kb_send_to_hr", { p_token: token });
  if (error) throw new Error(error.message);
}

/**
 * What the empty box offers, so nobody faces a blank prompt. Drawn from the chapters that
 * actually exist, and phrased the way somebody would type them rather than the way the
 * handbook titles them.
 */
export const SUGGESTED_QUESTIONS = [
  "How many paid leaves do I get in a year?",
  "What is my notice period if I resign?",
  "How many sick leaves are there?",
  "Am I eligible for a loan from the company?",
  "Do I get my mobile bill reimbursed?",
  "How much leave do I get for my marriage?",
];
