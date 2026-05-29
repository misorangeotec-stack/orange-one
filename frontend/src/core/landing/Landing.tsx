import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { LANDING_HTML } from "./landingMarkup";

/**
 * Public Orange One landing page. The original hand-built markup is injected as HTML
 * (so it stays pixel-faithful) and the motion engine runs as an effect scoped to this
 * container. Elements carrying `data-nav` are wired to client-side routes.
 */
export default function Landing() {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cleanups: Array<() => void> = [];
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hasIO = "IntersectionObserver" in window;

    // ---- client-side navigation for data-nav elements ----
    root.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
      const handler = (e: Event) => {
        e.preventDefault();
        navigate(el.getAttribute("data-nav")!);
      };
      el.addEventListener("click", handler);
      cleanups.push(() => el.removeEventListener("click", handler));
    });

    // ---- mobile nav (hamburger) ----
    const hamb = root.querySelector<HTMLElement>("#hamb");
    const navc = root.querySelector<HTMLElement>("#navc");
    if (hamb && navc) {
      const toggle = () => {
        const open = navc.classList.toggle("open");
        hamb.classList.toggle("active", open);
        hamb.setAttribute("aria-expanded", String(open));
      };
      hamb.addEventListener("click", toggle);
      cleanups.push(() => hamb.removeEventListener("click", toggle));
      navc.querySelectorAll("a, .btn-outline").forEach((el) => {
        const close = () => {
          navc.classList.remove("open");
          hamb.classList.remove("active");
          hamb.setAttribute("aria-expanded", "false");
        };
        el.addEventListener("click", close);
        cleanups.push(() => el.removeEventListener("click", close));
      });
    }

    const revealEls = root.querySelectorAll(".reveal, .stagger");
    const dash = root.querySelector(".dash");

    if (reduce || !hasIO) {
      revealEls.forEach((el) => el.classList.add("in"));
      dash?.classList.add("in");
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
          });
        },
        { threshold: 0.14, rootMargin: "0px 0px -7% 0px" }
      );
      revealEls.forEach((el) => io.observe(el));
      cleanups.push(() => io.disconnect());

      if (dash) {
        const dio = new IntersectionObserver(
          (entries) => {
            entries.forEach((e) => {
              if (e.isIntersecting) {
                e.target.classList.add("in");
                dio.unobserve(e.target);
              }
            });
          },
          { threshold: 0.3 }
        );
        dio.observe(dash);
        cleanups.push(() => dio.disconnect());
      }

      // ---- count-up numbers ----
      const animateCount = (el: Element) => {
        const node = el as HTMLElement;
        const raw = node.getAttribute("data-raw") || node.textContent || "";
        node.setAttribute("data-raw", raw);
        const m = raw.match(/^(\D*?)([\d.,]+)(.*)$/);
        if (!m) return;
        const [, prefix, numStr, suffix] = m;
        const decimals = (numStr.split(".")[1] || "").length;
        const hasComma = /,/.test(numStr);
        const target = parseFloat(numStr.replace(/,/g, ""));
        if (isNaN(target)) return;
        const dur = 1300;
        let start: number | null = null;
        const fmt = (v: number) => {
          let s = decimals ? v.toFixed(decimals) : Math.round(v).toString();
          if (hasComma) s = Number(s).toLocaleString("en-IN");
          return prefix + s + suffix;
        };
        const step = (ts: number) => {
          if (start === null) start = ts;
          const p = Math.min((ts - start) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          node.textContent = fmt(target * eased);
          if (p < 1) requestAnimationFrame(step);
          else node.textContent = fmt(target);
        };
        node.textContent = fmt(0);
        requestAnimationFrame(step);
      };
      const counters = root.querySelectorAll(".stat .num, .donut .center b, .fin .fv, .sb .n");
      const cio = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              animateCount(e.target);
              cio.unobserve(e.target);
            }
          });
        },
        { threshold: 0.6 }
      );
      counters.forEach((el) => cio.observe(el));
      cleanups.push(() => cio.disconnect());

      // ---- dashboard mouse tilt (fine pointers) ----
      if (window.matchMedia("(pointer:fine)").matches) {
        const wrap = root.querySelector<HTMLElement>(".dash-wrap");
        const card = root.querySelector<HTMLElement>(".dash");
        if (wrap && card) {
          let raf: number | null = null;
          let tx = 0;
          let ty = 0;
          const apply = () => {
            card.style.transform = `rotateX(${tx.toFixed(2)}deg) rotateY(${ty.toFixed(2)}deg)`;
            raf = null;
          };
          const move = (ev: MouseEvent) => {
            const r = wrap.getBoundingClientRect();
            tx = ((ev.clientY - r.top) / r.height - 0.5) * -4.5;
            ty = ((ev.clientX - r.left) / r.width - 0.5) * 6;
            if (!raf) raf = requestAnimationFrame(apply);
          };
          const leave = () => {
            tx = 0;
            ty = 0;
            if (!raf) raf = requestAnimationFrame(apply);
          };
          wrap.addEventListener("mousemove", move);
          wrap.addEventListener("mouseleave", leave);
          cleanups.push(() => {
            wrap.removeEventListener("mousemove", move);
            wrap.removeEventListener("mouseleave", leave);
          });
        }
      }

      // ---- parallax decorations ----
      const plx = root.querySelectorAll<HTMLElement>("[data-parallax]");
      if (plx.length) {
        let ticking = false;
        const onScroll = () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            const vh = window.innerHeight;
            plx.forEach((el) => {
              const r = el.getBoundingClientRect();
              const off = r.top + r.height / 2 - vh / 2;
              const sp = parseFloat(el.getAttribute("data-parallax") || "0");
              el.style.transform = `translate3d(0,${(off * sp).toFixed(1)}px,0)`;
            });
            ticking = false;
          });
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        cleanups.push(() => window.removeEventListener("scroll", onScroll));
      }
    }

    return () => cleanups.forEach((fn) => fn());
  }, [navigate]);

  return <div className="lp" ref={ref} dangerouslySetInnerHTML={{ __html: LANDING_HTML }} />;
}
