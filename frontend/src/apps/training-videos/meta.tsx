import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import TrainingVideosApp from "./TrainingVideosApp";

/**
 * Manifest for TRAINING VIDEOS — the training recordings, each one a OneDrive / SharePoint
 * link that opens in a new tab. The portal stores the link only; the video stays on OneDrive.
 *
 * Per-user granted like every other module; admins see it without a grant. 'view' watches,
 * 'edit' adds, changes and removes the links (enforced again by RLS on training_videos).
 */
export const trainingVideosApp: AppManifest = {
  id: "training-videos",
  name: appName("training-videos"),
  description: "Every training video in one place — each opens from OneDrive / SharePoint. Editors keep the links up to date.",
  basePath: appBasePath("training-videos"),
  status: "live",
  category: appCategory("training-videos"),
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="m10 8 5 3-5 3Z" stroke="#FF6A1F" />
    </svg>
  ),
  Component: TrainingVideosApp,
};
