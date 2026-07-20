/**
 * Platform directory seed — the real users + departments of the Orange One
 * workspace, shaped like the Supabase `profiles` / `departments` tables (+ the
 * denormalised role/hodIds/moduleAccess read-model). Stage B replaces these
 * arrays with live queries (same shapes). `moduleAccess` lists granted portal
 * app ids; admins bypass it and see every app.
 */
import type { Department, Profile } from "./types";

// ---- departments (real) ----
export const departments: Department[] = [
  { id: "d1", name: "Management" },
  { id: "d2", name: "Accounting & Finance" },
  { id: "d3", name: "Administration" },
  { id: "d4", name: "AI & tech" },
  { id: "d5", name: "Research & Development" },
];

// ---- profiles (real users; roles assigned for a representative demo) ----
export const profiles: Profile[] = [
  { id: "u1", name: "Yash Agarwal", email: "yash@orangeotec.com", designation: "CAIO", avatarColor: "orange", departmentId: "d4", role: "admin", hodIds: [], moduleAccess: ["task-management"], phone: null, receivablesSalespersons: [], receivablesHiddenMenus: [], receivablesAllowPipeline: false, lastActiveAt: null },
  { id: "u2", name: "Aayush Rathi", email: "aayush@orangeotec.com", designation: "Director", avatarColor: "navy", departmentId: "d1", role: "admin", hodIds: [], moduleAccess: ["task-management"], phone: null, receivablesSalespersons: [], receivablesHiddenMenus: [], receivablesAllowPipeline: false, lastActiveAt: null },
  { id: "u3", name: "Karan Toshniwal", email: "karan@orangeotec.com", designation: "Director", avatarColor: "blue", departmentId: "d1", role: "hod", hodIds: [], moduleAccess: ["task-management"], phone: null, receivablesSalespersons: [], receivablesHiddenMenus: [], receivablesAllowPipeline: false, lastActiveAt: null },
  { id: "u4", name: "Ritesh Tulsyan", email: "ritesh@orangeotec.com", designation: "CFA", avatarColor: "teal", departmentId: "d2", role: "hod", hodIds: [], moduleAccess: ["task-management"], phone: null, receivablesSalespersons: [], receivablesHiddenMenus: [], receivablesAllowPipeline: false, lastActiveAt: null },
  { id: "u5", name: "Dimple", email: "dimple@orangeotec.com", designation: "Senior Manager", avatarColor: "violet", departmentId: "d3", role: "sub_hod", hodIds: ["u3"], moduleAccess: ["task-management"], phone: null, receivablesSalespersons: [], receivablesHiddenMenus: [], receivablesAllowPipeline: false, lastActiveAt: null },
  { id: "u6", name: "Aayushi Shah", email: "ea1@orangeotec.com", designation: "Executive Assistant", avatarColor: "rose", departmentId: "d3", role: "employee", hodIds: ["u3", "u5"], moduleAccess: ["task-management"], phone: null, receivablesSalespersons: [], receivablesHiddenMenus: [], receivablesAllowPipeline: false, lastActiveAt: null },
  { id: "u7", name: "Vivek Boid", email: "vivek.boid@orangeotec.com", designation: "Head - Plant", avatarColor: "green", departmentId: "d5", role: "employee", hodIds: ["u2"], moduleAccess: ["task-management"], phone: null, receivablesSalespersons: [], receivablesHiddenMenus: [], receivablesAllowPipeline: false, lastActiveAt: null },
  { id: "u8", name: "Master Admin", email: "master@taskflow.app", designation: "Master Admin", avatarColor: "navy", departmentId: "d1", role: "admin", hodIds: [], moduleAccess: ["task-management"], phone: null, receivablesSalespersons: [], receivablesHiddenMenus: [], receivablesAllowPipeline: false, lastActiveAt: null },
];

export const profileById = (id: string | null) => profiles.find((p) => p.id === id) ?? null;
export const departmentById = (id: string | null) => departments.find((dep) => dep.id === id) ?? null;
