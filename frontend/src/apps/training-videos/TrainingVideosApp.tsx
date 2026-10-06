/**
 * TRAINING VIDEOS — the app shell. The shared AppShell (left menu, header, breadcrumb) and
 * one page: the video library.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import VideoLibrary from "./pages/VideoLibrary";

const B = appBasePath("training-videos");

const NAV: NavItem[] = [
  {
    label: "All videos",
    to: `${B}/library`,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="14" rx="2" />
        <path d="m10 8 5 3-5 3Z" />
      </svg>
    ),
  },
];

function TrainingVideosLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={NAV}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

export default function TrainingVideosApp() {
  return (
    <Routes>
      <Route element={<TrainingVideosLayout />}>
        <Route index element={<Navigate to="library" replace />} />
        <Route path="library" element={<VideoLibrary />} />
        <Route path="*" element={<Navigate to="library" replace />} />
      </Route>
    </Routes>
  );
}
