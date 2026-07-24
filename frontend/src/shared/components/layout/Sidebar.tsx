import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import Logo from "@/shared/components/ui/Logo";
import { cn } from "@/shared/lib/cn";
import type { NavItem } from "./types";

/**
 * Dark application sidebar (matches the landing dashboard mock's .side rail).
 *
 * Three things it does beyond listing links, all persisted per browser:
 *
 *  - COLLAPSIBLE GROUPS. Items carrying `group` fold under a clickable heading,
 *    collapsed by default. Items without one render flat with `section` dividers,
 *    exactly as before — every app except the home screen is untouched.
 *  - RESIZE. Drag the right edge. Double-click the handle resets to the default.
 *  - RAIL MODE. Collapse to icons only; hovering an icon opens a flyout with the
 *    real menu, so nothing becomes unreachable.
 *
 * The flyout is positioned `fixed` from the button's measured rect rather than
 * absolutely inside the nav. It has to be: the nav scrolls (`overflow-y-auto`),
 * and a scroll container clips absolutely-positioned children on BOTH axes — you
 * cannot have `overflow-y: auto` with `overflow-x: visible`.
 */

const OPEN_KEY = "orangeone.nav.open";
const WIDTH_KEY = "orangeone.nav.width";
const RAIL_KEY = "orangeone.nav.rail";

/**
 * 280, not the old 248: two levels of nesting plus names like "Purchase Office
 * Supplies" truncated to "Purchase Office S…" at the old width, which made two
 * sibling entries visually identical. Users can still drag it narrower.
 */
export const SIDEBAR_DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;
const RAIL_WIDTH = 64;

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — all of this is convenience, never load-bearing */
  }
};

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

interface SubGroup {
  label: string;
  items: NavItem[];
}
interface Group {
  label: string;
  icon: NavItem["groupIcon"];
  direct: NavItem[];
  subs: SubGroup[];
}
type Node = { kind: "item"; item: NavItem } | { kind: "group"; group: Group };

/** Flat array → ordered tree, preserving first-appearance order of each group. */
function buildNodes(items: NavItem[]): Node[] {
  const nodes: Node[] = [];
  const groupByLabel = new Map<string, Group>();

  for (const item of items) {
    if (!item.group) {
      nodes.push({ kind: "item", item });
      continue;
    }
    let group = groupByLabel.get(item.group);
    if (!group) {
      group = { label: item.group, icon: item.groupIcon, direct: [], subs: [] };
      groupByLabel.set(item.group, group);
      nodes.push({ kind: "group", group });
    }
    if (!group.icon && item.groupIcon) group.icon = item.groupIcon;
    if (!item.subGroup) {
      group.direct.push(item);
      continue;
    }
    let sub = group.subs.find((s) => s.label === item.subGroup);
    if (!sub) {
      sub = { label: item.subGroup, items: [] };
      group.subs.push(sub);
    }
    sub.items.push(item);
  }
  return nodes;
}

const isActivePath = (pathname: string, to: string) => pathname === to || pathname.startsWith(to + "/");
const leavesOf = (g: Group) => [...g.direct, ...g.subs.flatMap((s) => s.items)];

export default function Sidebar({
  nav,
  role,
  logoTo = "/home",
  onNavigate,
  variant = "docked",
}: {
  nav: NavItem[];
  role: string;
  logoTo?: string;
  onNavigate?: () => void;
  /** The mobile drawer is a fixed-width overlay: no resize, no rail. */
  variant?: "docked" | "drawer";
}) {
  const items = nav.filter((i) => !i.roles || i.roles.includes(role));
  const nodes = useMemo(() => buildNodes(items), [items]);
  const { pathname } = useLocation();
  const docked = variant === "docked";

  const [open, setOpen] = useState<Set<string>>(() => new Set(readJson<string[]>(OPEN_KEY, [])));
  const [width, setWidth] = useState<number>(() => clampWidth(readJson<number>(WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH)));
  const [rail, setRail] = useState<boolean>(() => docked && readJson<boolean>(RAIL_KEY, false));

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeJson(OPEN_KEY, [...next]);
      return next;
    });

  const setRailPersisted = (v: boolean) => {
    setRail(v);
    writeJson(RAIL_KEY, v);
  };

  // ---- drag-to-resize -------------------------------------------------------
  const dragging = useRef(false);
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!docked || rail) return;
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [docked, rail]
  );

  useEffect(() => {
    if (!docked) return;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(clampWidth(e.clientX));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        writeJson(WIDTH_KEY, w);
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [docked]);

  // ---- rail hover flyout ----------------------------------------------------
  const [flyout, setFlyout] = useState<{ key: string; top: number; node: Node } | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const openFlyout = (key: string, el: HTMLElement, node: Node) => {
    window.clearTimeout(closeTimer.current);
    setFlyout({ key, top: el.getBoundingClientRect().top, node });
  };
  // Delayed so the pointer can travel the gap between the rail and the panel.
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlyout(null), 180);
  };
  const keepOpen = () => window.clearTimeout(closeTimer.current);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!rail) setFlyout(null);
  }, [rail]);

  const containsActive = (g: Group) => leavesOf(g).some((i) => isActivePath(pathname, i.to));
  const effectiveWidth = docked ? (rail ? RAIL_WIDTH : width) : SIDEBAR_DEFAULT_WIDTH;

  return (
    <div className="relative h-full shrink-0" style={{ width: effectiveWidth }}>
      <div className="flex h-full w-full flex-col bg-sidebar text-white overflow-hidden">
        <div className={cn("h-[68px] flex items-center border-b border-white/10", rail ? "px-0 justify-center" : "px-5")}>
          {rail ? (
            <button
              type="button"
              onClick={() => setRailPersisted(false)}
              title="Expand menu"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <MenuIcon />
            </button>
          ) : (
            <>
              <Logo variant="dark" height={30} to={logoTo} />
              {docked && (
                <button
                  type="button"
                  onClick={() => setRailPersisted(true)}
                  title="Collapse to icons"
                  className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <CollapseIcon />
                </button>
              )}
            </>
          )}
        </div>

        <nav className={cn("flex-1 overflow-y-auto py-4 space-y-0.5", rail ? "px-2" : "px-3")}>
          {/* Keyed by to+index, NOT by `to` alone: an app may legitimately list the
              same destination twice (Sampling shows one shared step under both of
              its branch headings), and a duplicate React key silently drops a row. */}
          {nodes.map((node, idx) =>
            node.kind === "item" ? (
              rail ? (
                <RailButton
                  key={`${node.item.to}#${idx}`}
                  icon={node.item.icon}
                  active={isActivePath(pathname, node.item.to)}
                  to={node.item.to}
                  onNavigate={onNavigate}
                  onEnter={(el) => openFlyout(node.item.to, el, node)}
                  onLeave={scheduleClose}
                />
              ) : (
                <div key={`${node.item.to}#${idx}`}>
                  {node.item.section && <SectionLabel label={node.item.section} first={idx === 0} />}
                  <Row item={node.item} onNavigate={onNavigate} />
                </div>
              )
            ) : rail ? (
              <RailButton
                key={node.group.label}
                icon={node.group.icon ?? <FolderIcon />}
                active={containsActive(node.group)}
                onEnter={(el) => openFlyout(node.group.label, el, node)}
                onLeave={scheduleClose}
              />
            ) : (
              <GroupBlock
                key={node.group.label}
                group={node.group}
                isOpen={open.has(node.group.label) || containsActive(node.group)}
                openSubs={open}
                onToggle={toggle}
                onNavigate={onNavigate}
                pathname={pathname}
              />
            )
          )}
        </nav>

        {!rail && (
          <div className="px-5 py-4 border-t border-white/10 text-[11px] text-white/40">© 2026 Orange O Tec</div>
        )}
      </div>

      {/* Drag handle — sits over the seam, widening its hit area without shifting layout. */}
      {docked && !rail && (
        <div
          onMouseDown={onDragStart}
          onDoubleClick={() => {
            setWidth(SIDEBAR_DEFAULT_WIDTH);
            writeJson(WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH);
          }}
          title="Drag to resize · double-click to reset"
          className="absolute top-0 right-0 h-full w-1.5 translate-x-1/2 cursor-col-resize z-20 group/resize"
        >
          <div className="mx-auto h-full w-px bg-transparent group-hover/resize:bg-orange/70 transition-colors" />
        </div>
      )}

      {rail && flyout && (
        <Flyout
          top={flyout.top}
          left={RAIL_WIDTH}
          node={flyout.node}
          onNavigate={onNavigate}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
        />
      )}

    </div>
  );
}

/** The hover panel that keeps the menu reachable while the rail is collapsed. */
function Flyout({
  top,
  left,
  node,
  onNavigate,
  onMouseEnter,
  onMouseLeave,
}: {
  top: number;
  left: number;
  node: Node;
  onNavigate?: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  // Nudged up if it would run off the bottom; never above the viewport.
  const maxTop = typeof window !== "undefined" ? window.innerHeight - 120 : top;
  const style = { top: Math.max(8, Math.min(top, maxTop)), left: left + 6 };

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={style}
      className="fixed z-[60] min-w-[220px] max-w-[280px] max-h-[70vh] overflow-y-auto rounded-xl bg-sidebar border border-white/10 shadow-2xl py-2 px-2"
    >
      {node.kind === "item" ? (
        <Row item={node.item} onNavigate={onNavigate} />
      ) : (
        <>
          <p className="px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            {node.group.label}
          </p>
          <div className="space-y-0.5">
            {node.group.direct.map((item) => (
              <Row key={item.to} item={item} onNavigate={onNavigate} />
            ))}
            {node.group.subs.map((sub) => (
              <div key={sub.label} className="pt-1.5">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                  {sub.label}
                </p>
                {sub.items.map((item) => (
                  <Row key={item.to} item={item} indent onNavigate={onNavigate} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RailButton({
  icon,
  active,
  to,
  onNavigate,
  onEnter,
  onLeave,
}: {
  icon: React.ReactNode;
  active: boolean;
  to?: string;
  onNavigate?: () => void;
  onEnter: (el: HTMLElement) => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cls = cn(
    "relative w-full h-10 rounded-xl flex items-center justify-center transition-colors [&>svg]:w-[19px] [&>svg]:h-[19px]",
    active ? "bg-orange text-white shadow-cta" : "text-[#aebbd4] hover:bg-white/[0.08] hover:text-white"
  );
  return (
    <div
      ref={ref}
      onMouseEnter={() => ref.current && onEnter(ref.current)}
      onMouseLeave={onLeave}
      className="py-0.5"
    >
      {to ? (
        <NavLink to={to} end={to.split("/").length <= 2} onClick={onNavigate} className={cls}>
          {icon}
        </NavLink>
      ) : (
        // No count badge in rail mode on purpose: floated over a 40px cell it read
        // as a stray digit rather than a count, and the hover flyout already shows
        // the group's contents in full.
        <div className={cls}>{icon}</div>
      )}
    </div>
  );
}

function SectionLabel({ label, first }: { label: string; first?: boolean }) {
  return (
    <p
      className={cn(
        "px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-wider text-white/35",
        first && "pt-1"
      )}
    >
      {label}
    </p>
  );
}

function GroupBlock({
  group,
  isOpen,
  openSubs,
  onToggle,
  onNavigate,
  pathname,
}: {
  group: Group;
  isOpen: boolean;
  openSubs: Set<string>;
  onToggle: (key: string) => void;
  onNavigate?: () => void;
  pathname: string;
}) {
  const count = leavesOf(group).length;
  return (
    <div className="pt-1.5 first:pt-0">
      {/* Sized to match the link rows, not the tiny `section` dividers. These
          headings ARE the navigation now — they hold every app in the portal — so
          styling them as passive labels made the rail read as if it were empty. */}
      <button
        type="button"
        onClick={() => onToggle(group.label)}
        aria-expanded={isOpen}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-colors",
          isOpen ? "text-white" : "text-white/80 hover:text-white hover:bg-white/[0.06]"
        )}
      >
        <Chevron open={isOpen} />
        <span className="flex-1 text-left truncate">{group.label}</span>
        {!isOpen && count > 0 && (
          <span className="text-[11px] font-semibold text-white/40 tabular-nums">{count}</span>
        )}
      </button>

      {isOpen && (
        <div className="mt-0.5 space-y-0.5">
          {group.direct.map((item) => (
            <Row key={item.to} item={item} indent onNavigate={onNavigate} />
          ))}

          {group.subs.map((sub) => {
            const key = `${group.label}/${sub.label}`;
            const subOpen = openSubs.has(key) || sub.items.some((i) => isActivePath(pathname, i.to));
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => onToggle(key)}
                  aria-expanded={subOpen}
                  className={cn(
                    // w-[calc(100%-0.5rem)] not w-full: the ml-2 would otherwise push it past the rail edge.
                    "w-[calc(100%-0.5rem)] flex items-center gap-2 rounded-lg ml-2 pl-3 pr-2 py-2 text-[12.5px] font-semibold transition-colors",
                    subOpen ? "text-white/85" : "text-white/65 hover:text-white hover:bg-white/[0.06]"
                  )}
                >
                  <Chevron open={subOpen} small />
                  <span className="flex-1 text-left truncate">{sub.label}</span>
                  {!subOpen && (
                    <span className="text-[11px] font-semibold text-white/35 tabular-nums">{sub.items.length}</span>
                  )}
                </button>
                {subOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {sub.items.map((item) => (
                      <Row key={item.to} item={item} indent deep onNavigate={onNavigate} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({
  item,
  indent,
  deep,
  onNavigate,
}: {
  item: NavItem;
  indent?: boolean;
  deep?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.to.split("/").length <= 2}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-xl py-2.5 text-[13.5px] font-medium transition-colors",
          // Indent tracks nesting depth; the hairline gives a child row something
          // to hang off so a long list doesn't read as one flat column.
          deep ? "ml-4 pl-3 pr-2 border-l border-white/10" : indent ? "ml-2 pl-3 pr-2 border-l border-white/10" : "px-3",
          isActive ? "bg-orange text-white shadow-cta" : "text-[#aebbd4] hover:bg-white/[0.06] hover:text-white"
        )
      }
    >
      <span className="[&>svg]:w-[18px] [&>svg]:h-[18px] shrink-0">{item.icon}</span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="text-[10px] font-bold bg-white/15 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
          {item.badge}
        </span>
      ) : null}
    </NavLink>
  );
}

function Chevron({ open, small }: { open: boolean; small?: boolean }) {
  const s = small ? 12 : 14;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const CollapseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);
