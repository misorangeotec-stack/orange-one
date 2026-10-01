/**
 * KB-1 · What HR sees. The question log, and the notes they can put on a section.
 *
 * TWO GATES, deliberately different (migration 20260928090057):
 *   READ  (view or edit) → kb_manager_questions. Compiling what staff asked.
 *   WRITE (edit only)    → kb_answer_question, kb_set_section_note. Changing what every
 *                          future answer says.
 * Both are re-checked in the database, so the route guard in App.tsx is a courtesy.
 *
 * 🔴 THE LOG CARRIES NO NAME unless the asker pressed "Send this question to HR". That is
 * not a gap to fill in later: the handbook covers harassment, grievance, maternity, PIP and
 * notice period, and a named log would record a resignation signal or a pregnancy
 * disclosure without consent. `asked_by_name` is populated ONLY on the rows where somebody
 * chose to be reachable. Do not add a way to join the rest back to a person.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";

export const KB_QK = ["knowledge-base"] as const;

export interface LoggedQuestion {
  id: string;
  askedAt: string;
  question: string;
  answer: string | null;
  covered: boolean;
  rating: number | null;
  citedSectionIds: string[];
  sentToHr: boolean;
  sentToHrAt: string | null;
  /** Null for every question nobody handed to HR, which is nearly all of them. */
  askedByName: string | null;
  hrAnswer: string | null;
  hrAnsweredAt: string | null;
}

interface RawQuestion {
  id: string;
  asked_at: string;
  question: string;
  answer: string | null;
  covered: boolean;
  rating: number | null;
  cited_section_ids: string[] | null;
  sent_to_hr: boolean;
  sent_to_hr_at: string | null;
  asked_by_name: string | null;
  hr_answer: string | null;
  hr_answered_at: string | null;
}

export function useLoggedQuestions() {
  return useQuery({
    queryKey: [...KB_QK, "questions"],
    staleTime: 30_000,
    queryFn: async (): Promise<LoggedQuestion[]> => {
      const { data, error } = await supabase.rpc("kb_manager_questions", { p_limit: 1000 });
      if (error) throw new Error(error.message);
      const rows = (Array.isArray(data) ? data : []) as unknown as RawQuestion[];
      return rows.map((r) => ({
        id: r.id,
        askedAt: r.asked_at,
        question: r.question,
        answer: r.answer,
        covered: r.covered,
        rating: r.rating,
        citedSectionIds: r.cited_section_ids ?? [],
        sentToHr: r.sent_to_hr,
        sentToHrAt: r.sent_to_hr_at,
        askedByName: r.asked_by_name,
        hrAnswer: r.hr_answer,
        hrAnsweredAt: r.hr_answered_at,
      }));
    },
  });
}

export function useAnswerQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      const { error } = await supabase.rpc("kb_answer_question", { p_id: id, p_answer: answer });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KB_QK }),
  });
}

/**
 * Put a note on a section, or clear it. This is how the Chapter 32 travel warnings come off
 * the day the Directors sign: a row edit, not a deploy. The ingest carries notes forward by
 * anchor on the next re-publish, so a note outlives a new version of the handbook.
 */
export function useSetSectionNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sectionId, note }: { sectionId: string; note: string }) => {
      const { error } = await supabase.rpc("kb_set_section_note", {
        p_section_id: sectionId,
        p_note: note,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      // Both this screen AND the reader pane, which caches the handbook for an hour and
      // would otherwise keep showing the old note to everyone who already had it open.
      qc.invalidateQueries({ queryKey: KB_QK });
      qc.invalidateQueries({ queryKey: ["knowledge-base", "handbook"] });
    },
  });
}

/** Every published version, newest first. What "Publish" shows. */
export function useHandbookVersions() {
  return useQuery({
    queryKey: [...KB_QK, "versions"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kb_documents")
        .select("id, title, version, source_filename, published_at, is_current")
        .order("version", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
