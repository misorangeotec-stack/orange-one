import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { knowledgeBaseNav, B } from "./nav";
import Questions from "./pages/Questions";
import Sections from "./pages/Sections";
import Published from "./pages/Published";

/** Wires the portal session into the shared AppShell, as every app does. */
function KnowledgeBaseLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={knowledgeBaseNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

/**
 * Root of the Knowledge Base module (KB-1) — HR's side of it.
 *
 * ⚠ THIS IS NOT WHERE STAFF ASK. Asking is the floating Ask HR bubble, on every screen, and
 * reading the handbook is /handbook/read. Neither needs this module or any grant at all.
 * What the grant buys is the screens in here: what people asked, the notes that change what
 * every answer says, and which version is live.
 *
 * Gated upstream by <RequireModule appId="knowledge-base"> in App.tsx (admins bypass), and
 * again in the database: reading the question log asks can_read_knowledge_base (view or
 * edit), and both writes ask can_manage_knowledge_base (edit only). The route guard is a
 * courtesy, not the lock.
 */
export default function KnowledgeBaseApp() {
  return (
    <Routes>
      <Route element={<KnowledgeBaseLayout />}>
        <Route index element={<Questions />} />
        <Route path="notes" element={<Sections />} />
        <Route path="published" element={<Published />} />
        <Route path="*" element={<Navigate to={B} replace />} />
      </Route>
    </Routes>
  );
}
