/**
 * Session moved to the portal core (core/platform/session). Re-exported here so
 * existing Task Management imports (`from "./mock/session"`) keep resolving.
 * The provider now wraps the whole app, so it is no longer mounted inside the
 * Task Management app itself.
 */
export { SessionProvider, MockSessionProvider, useSession, ALL_ROLES } from "@/core/platform/session";
