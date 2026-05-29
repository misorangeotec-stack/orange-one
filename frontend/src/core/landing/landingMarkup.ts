/**
 * Orange One landing markup — ported verbatim from the original static index.html
 * (body content only; scripts live in Landing.tsx as a React effect).
 * Interactive entry points carry data-nav attributes so Landing.tsx can wire them
 * to client-side routes without editing this markup.
 */
export const LANDING_HTML = `
<!-- ============ NAV ============ -->
<header class="nav">
  <div class="wrap nav-inner reveal d1">
    <a class="brand" href="#" aria-label="Orange — Orang O Tec">
      <img class="logo-img" src="/assets/Orang_O_Tec_logo.jpg" alt="Orange — Orang O Tec" />
    </a>
    <button class="hamburger" id="hamb" aria-label="Toggle menu" aria-expanded="false" aria-controls="navc">
      <span></span><span></span><span></span>
    </button>
    <div class="nav-collapse" id="navc">
      <div class="nav-divider"></div>
      <nav class="menu">
        <a href="#" class="active">Orange One</a>
        <a href="#apps">Applications <span class="caret">▼</span></a>
        <a href="#">Dashboards</a>
        <a href="#">Workflows</a>
        <a href="#">Reports</a>
      </nav>
      <button class="btn-outline" data-nav="/login">Open Workspace
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
    </div>
  </div>
</header>

<!-- ============ HERO ============ -->
<section class="wrap hero">
  <div class="hero-copy">
    <span class="badge reveal d1">Welcome to Orange One</span>
    <h1 class="title reveal d2">One Platform.<br>Every <span class="o">Workflow.</span></h1>
    <p class="lede reveal d3">Manage operations, approvals, tasks and business insights from a single unified platform built for Orange O Tec.</p>
    <div class="cta-row reveal d4">
      <button class="btn primary" data-nav="/login">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        Explore Applications
      </button>
      <button class="btn ghost" data-nav="/login">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3" height="6"/><rect x="11" y="7" width="3" height="10"/><rect x="16" y="13" width="3" height="4"/></svg>
        View Dashboards
      </button>
    </div>
  </div>

  <div class="dash-wrap reveal d3">
    <div class="ring r1" data-parallax="0.06"></div>
    <div class="ring r2" data-parallax="-0.04"></div>
    <svg class="dots" viewBox="0 0 150 112" data-parallax="0.1"><defs><pattern id="dg" width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="2.2" cy="2.2" r="2.2" fill="#C3D2E8"/></pattern></defs><rect width="150" height="112" fill="url(#dg)"/></svg>
    <div class="dash">
      <div class="side">
        <div class="s-logo">
          <svg width="16" height="16" viewBox="0 0 64 64"><path d="M12 38a20 20 0 0 0 40 0Z" fill="none" stroke="#fff" stroke-width="3.4"/><path d="M18 33c5-9 15-13 24-8" stroke="#FF6A1F" stroke-width="4.5" stroke-linecap="round" fill="none"/></svg>
        </div>
        <div class="s-ic active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg></div>
        <div class="s-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div>
        <div class="s-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.5a2 2 0 0 0 2 1.5h8.6a2 2 0 0 0 2-1.6L23 7H6"/></svg></div>
        <div class="s-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16 14c3 0 5 2 5 5"/></svg></div>
        <div class="s-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z"/></svg></div>
      </div>
      <div class="panel">
        <div class="dash-top">
          <h3>Dashboard Overview</h3>
          <div class="greet">Good Morning, Admin
            <span class="bell"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></span>
            <span class="ava">A</span>
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat">
            <div class="lbl">Tasks Due</div>
            <div class="row"><div class="num">32</div><div class="pic ic-o"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg></div></div>
            <div class="delta">↑ 12% vs last week</div>
          </div>
          <div class="stat">
            <div class="lbl">Pending Approvals</div>
            <div class="row"><div class="num">18</div><div class="pic ic-b"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg></div></div>
            <div class="delta">↑ 7% vs last week</div>
          </div>
          <div class="stat">
            <div class="lbl">Purchase Requests</div>
            <div class="row"><div class="num">24</div><div class="pic ic-g"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v4h8V3"/><path d="M9 13l2 2 4-4"/></svg></div></div>
            <div class="delta">↑ 9% vs last week</div>
          </div>
          <div class="stat">
            <div class="lbl">Open Workflows</div>
            <div class="row"><div class="num">15</div><div class="pic ic-p"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h6v6H4zM14 11h6v6h-6z"/><path d="M10 9h4"/></svg></div></div>
            <div class="delta">↑ 5% vs last week</div>
          </div>
        </div>

        <div class="row2">
          <div class="box">
            <h4>Workflow Status</h4>
            <div class="wf">
              <div class="donut">
                <svg width="96" height="96" viewBox="0 0 42 42">
                  <circle cx="21" cy="21" r="15.9" fill="none" stroke="#EEF2F8" stroke-width="6"/>
                  <circle class="seg s1" style="--v:47 53" cx="21" cy="21" r="15.9" fill="none" stroke="#2EC4B6" stroke-width="6" stroke-linecap="round" stroke-dashoffset="25"/>
                  <circle class="seg s2" style="--v:29 71" cx="21" cy="21" r="15.9" fill="none" stroke="#3B82F6" stroke-width="6" stroke-linecap="round" stroke-dashoffset="-22"/>
                  <circle class="seg s3" style="--v:15 85" cx="21" cy="21" r="15.9" fill="none" stroke="#F8B62B" stroke-width="6" stroke-linecap="round" stroke-dashoffset="-51"/>
                  <circle class="seg s4" style="--v:9 91" cx="21" cy="21" r="15.9" fill="none" stroke="#FF6A1F" stroke-width="6" stroke-linecap="round" stroke-dashoffset="-66"/>
                </svg>
                <div class="center"><b>68</b><span>Total</span></div>
              </div>
              <div class="legend">
                <div class="li"><span class="dot" style="background:#2EC4B6"></span>Completed <b>32</b><span class="pc">(47%)</span></div>
                <div class="li"><span class="dot" style="background:#3B82F6"></span>In Progress <b>20</b><span class="pc">(29%)</span></div>
                <div class="li"><span class="dot" style="background:#F8B62B"></span>Pending <b>10</b><span class="pc">(15%)</span></div>
                <div class="li"><span class="dot" style="background:#FF6A1F"></span>On Hold <b>6</b><span class="pc">(9%)</span></div>
              </div>
            </div>
          </div>
          <div class="box">
            <div class="hh"><h4 style="margin:0">Key Financial Overview</h4><span class="pill-sel">This Month ▾</span></div>
            <div class="fin-grid">
              <div class="fin">
                <div class="ft">Receivables</div>
                <div class="fv">₹ 2.45 Cr</div>
                <div class="fd">↑ 6.6% vs last month</div>
                <svg viewBox="0 0 120 30" preserveAspectRatio="none"><defs><linearGradient id="go" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6A1F" stop-opacity=".28"/><stop offset="1" stop-color="#FF6A1F" stop-opacity="0"/></linearGradient></defs><path class="area" d="M0 24 L15 20 L30 22 L45 14 L60 17 L75 9 L90 12 L105 5 L120 8 L120 30 L0 30Z" fill="url(#go)"/><path class="line" pathLength="100" d="M0 24 L15 20 L30 22 L45 14 L60 17 L75 9 L90 12 L105 5 L120 8" fill="none" stroke="#FF6A1F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div class="fin">
                <div class="ft">Customer Outstanding</div>
                <div class="fv">₹ 3.18 Cr</div>
                <div class="fd">↑ 6.3% vs last month</div>
                <svg viewBox="0 0 120 30" preserveAspectRatio="none"><defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B82F6" stop-opacity=".26"/><stop offset="1" stop-color="#3B82F6" stop-opacity="0"/></linearGradient></defs><path class="area" d="M0 22 L15 24 L30 17 L45 19 L60 12 L75 15 L90 8 L105 11 L120 5 L120 30 L0 30Z" fill="url(#gb)"/><path class="line" pathLength="100" d="M0 22 L15 24 L30 17 L45 19 L60 12 L75 15 L90 8 L105 11 L120 5" fill="none" stroke="#3B82F6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </div>
          </div>
        </div>

        <div class="row3">
          <div class="box act">
            <h4>Recent Activities</h4>
            <div class="ai"><svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>Purchase request PR-2024-089 has been approved<span class="t">2 mins ago</span></div>
            <div class="ai"><svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Workflow WF-2024-156 moved to next stage<span class="t">15 mins ago</span></div>
            <div class="ai"><svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>New task assigned: Vendor Evaluation<span class="t">1 hour ago</span></div>
          </div>
          <div class="box">
            <h4>Quick Access</h4>
            <div class="qa-grid">
              <div class="qa"><div class="qi ic-b"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6"/></svg></div><span>Task<br>Management</span></div>
              <div class="qa"><div class="qi ic-o"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2 3h3l2.4 12.5a2 2 0 0 0 2 1.5h8.6a2 2 0 0 0 2-1.6L23 7H6"/></svg></div><span>Purchase<br>Workflow</span></div>
              <div class="qa"><div class="qi ic-p"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3.5-6 7-6s7 2 7 6"/></svg></div><span>Vendor<br>Management</span></div>
              <div class="qa"><div class="qi ic-o"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v14H4z"/><path d="M8 10l3 3 5-6"/></svg></div><span>Approvals<br>Center</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ============ STATS BAR ============ -->
<section class="wrap">
  <div class="stats-bar reveal d4">
    <div class="sb">
      <span class="sb-ic"><svg viewBox="0 0 48 48" fill="none" stroke="#0B1B40" stroke-width="2"><circle cx="24" cy="15" r="7"/><path d="M11 40c0-7 6-12 13-12s13 5 13 12"/><path d="M17 39l3-3 4 3 4-3 3 3" stroke="#FF6A1F"/></svg></span>
      <div><div class="n">15+</div><div class="l">Years of Experience</div></div>
    </div>
    <div class="sb">
      <span class="sb-ic"><svg viewBox="0 0 48 48" fill="none" stroke="#0B1B40" stroke-width="2"><path d="M24 6l3 4 5-1 1 5 4 3-3 4 1 5-5 1-3 4-4-3-4 3-3-4-5-1 1-5-3-4 4-3 1-5 5 1z"/><path d="M19 24l4 4 7-8" stroke="#FF6A1F"/></svg></span>
      <div><div class="n">600+</div><div class="l">Successful Installations</div></div>
    </div>
    <div class="sb">
      <span class="sb-ic"><svg viewBox="0 0 48 48" fill="none" stroke="#0B1B40" stroke-width="2"><circle cx="24" cy="16" r="5"/><circle cx="12" cy="19" r="4"/><circle cx="36" cy="19" r="4"/><path d="M14 38c0-6 4-10 10-10s10 4 10 10"/><path d="M4 38c0-4 2-7 6-8M44 38c0-4-2-7-6-8" stroke="#FF6A1F"/></svg></span>
      <div><div class="n">140+</div><div class="l">Team Strength</div></div>
    </div>
    <div class="sb">
      <span class="sb-ic"><svg viewBox="0 0 48 48" fill="none" stroke="#0B1B40" stroke-width="2"><circle cx="24" cy="15" r="7"/><path d="M11 40c0-7 6-12 13-12s13 5 13 12"/><path d="M31 9a8 8 0 0 1 0 12" stroke="#FF6A1F"/><path d="M17 9a8 8 0 0 0 0 12" stroke="#FF6A1F"/></svg></span>
      <div><div class="n">75+</div><div class="l">Service Engineers</div></div>
    </div>
  </div>
</section>

<!-- ============ SECTION 2 : OPERATIONAL APPS ============ -->
<section class="apps" id="apps">
  <div class="deco-arc"></div>
  <svg class="deco-dots" viewBox="0 0 90 120"><defs><pattern id="dg2" width="15" height="15" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#CBD7EA"/></pattern></defs><rect width="90" height="120" fill="url(#dg2)"/></svg>
  <div class="wrap apps-inner">
    <div class="eyebrow reveal d1"><span class="num">02</span><span class="sep"></span><span class="lab">Applications</span></div>
    <h2 class="reveal d2">Operational Apps Built for <span class="o">Orange</span></h2>
    <p class="sub reveal d3">Digitized workflows that streamline daily operations across departments.</p>

    <div class="apps-grid">
      <article class="app-card is-active reveal d2" data-nav="/login">
        <div class="app-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3.5h6v1"/><path d="M8.5 12l2.1 2.1L15.5 9.5" stroke="#FF6A1F"/></svg></div>
        <h3>Task Management</h3>
        <p>Track assignments, priorities, and team progress.</p>
        <div class="app-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
      </article>
      <article class="app-card reveal d3">
        <div class="app-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2 3h3l2.4 12.5a2 2 0 0 0 2 1.5h8.6a2 2 0 0 0 2-1.6L23 7H6"/></svg></div>
        <h3>Purchase Requests</h3>
        <p>Raise and manage procurement requests seamlessly.</p>
        <div class="app-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
      </article>
      <article class="app-card reveal d4">
        <div class="app-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/><circle cx="12" cy="14" r="3.1" stroke="#FF6A1F"/><path d="M10.7 14l1 1 1.7-1.9" stroke="#FF6A1F"/></svg></div>
        <h3>Purchase Approvals</h3>
        <p>Review, approve, and track purchasing decisions.</p>
        <div class="app-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
      </article>
      <article class="app-card reveal d5">
        <div class="app-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.1"/><path d="M4 19c0-3.3 2.7-5.4 6-5.4"/><circle cx="17.6" cy="15.6" r="2" stroke="#FF6A1F"/><path d="M17.6 12.9v-1.1M17.6 19.4v-1.1M20.2 15.6h1.1M13.9 15.6h1.1" stroke="#FF6A1F"/></svg></div>
        <h3>Vendor Management</h3>
        <p>Maintain supplier information and performance records.</p>
        <div class="app-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
      </article>
      <article class="app-card reveal d2">
        <div class="app-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg></div>
        <h3>Inventory Workflow</h3>
        <p>Monitor stock movement and inventory operations.</p>
        <div class="app-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
      </article>
      <article class="app-card reveal d3">
        <div class="app-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6.2a3.8 3.8 0 0 0-5 5L4.5 16.7 7.3 19.5 12.8 14a3.8 3.8 0 0 0 5-5l-2.3 2.3-2-.6-.6-2z" stroke="#FF6A1F"/><path d="M5 19l-1.2 1.2"/></svg></div>
        <h3>Service Management</h3>
        <p>Manage service requests and field operations.</p>
        <div class="app-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
      </article>
      <article class="app-card reveal d4">
        <div class="app-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5"/><circle cx="17.6" cy="9" r="2.3" stroke="#FF6A1F"/><path d="M16 14c3.1 0 5 2 5 5" stroke="#FF6A1F"/></svg></div>
        <h3>HR Requests</h3>
        <p>Handle employee requests and internal approvals.</p>
        <div class="app-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
      </article>
      <article class="app-card reveal d5">
        <div class="app-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/><path d="M9 12.5h6M9 15.5h6M9 9.5h3"/></svg></div>
        <h3>Document Approvals</h3>
        <p>Digitize review cycles and approval workflows.</p>
        <div class="app-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></div>
      </article>
    </div>

    <div class="stats-bar compact reveal d4">
      <div class="sb">
        <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
        <div><div class="n">8</div><div class="l">Active Applications</div></div>
      </div>
      <div class="sb">
        <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16 14c3 0 5 2 5 5"/></svg></span>
        <div><div class="n">100+</div><div class="l">Daily Users</div></div>
      </div>
      <div class="sb">
        <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="12" r="2.3"/><circle cx="18" cy="6" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M8 11l8-4M8 13l8 4"/></svg></span>
        <div><div class="n">25+</div><div class="l">Automated Workflows</div></div>
      </div>
      <div class="sb">
        <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15.5h6"/></svg></span>
        <div><div class="n">1000+</div><div class="l">Approval Requests Processed</div></div>
      </div>
    </div>
  </div>
</section>

<!-- ============ FOOTER ============ -->
<footer class="footer">
  <div class="wrap foot-grid stagger">
    <div class="foot-brand" style="--i:0">
      <div class="brand-dark">
        <img src="/assets/orange-one-logo-dark.png" alt="Orange One — Orange O Tec" style="height:42px;width:auto;display:block" />
      </div>
      <p>One unified platform to manage operations, approvals, tasks and business insights — built for Orange O Tec.</p>
      <div class="socials">
        <a href="#" aria-label="LinkedIn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5A2.5 2.5 0 1 1 0 3.5a2.5 2.5 0 0 1 4.98 0zM0 8h5v16H0zM7.5 8h4.8v2.2h.07c.67-1.2 2.3-2.5 4.73-2.5 5.06 0 6 3.3 6 7.6V24h-5v-7.1c0-1.7 0-3.9-2.37-3.9-2.38 0-2.74 1.85-2.74 3.77V24h-5z"/></svg></a>
        <a href="#" aria-label="X"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.3 8.3L23 22h-6.7l-5.2-6.8L5.1 22H2l7.8-8.9L1.4 2h6.8l4.7 6.2zM17.8 20h1.7L7.3 3.9H5.5z"/></svg></a>
        <a href="#" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.7.23 2.7.23v2.9h-1.5c-1.5 0-2 .93-2 1.9V12h3.3l-.53 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/></svg></a>
        <a href="#" aria-label="YouTube"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 3.9 12 3.9 12 3.9s-7.5 0-9.4.5A3 3 0 0 0 .5 6.5 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.5zM9.6 15.6V8.4l6.3 3.6z"/></svg></a>
      </div>
    </div>

    <div class="foot-col" style="--i:1">
      <h5>Platform</h5>
      <a href="#">Orange One</a>
      <a href="#apps">Applications</a>
      <a href="#">Dashboards</a>
      <a href="#">Workflows</a>
      <a href="#">Reports</a>
    </div>

    <div class="foot-col" style="--i:2">
      <h5>Modules</h5>
      <a href="#" data-nav="/login">Task Management</a>
      <a href="#">Purchase Workflow</a>
      <a href="#">Vendor Management</a>
      <a href="#">Approvals Center</a>
      <a href="#">HR Requests</a>
    </div>

    <div class="foot-col" style="--i:3">
      <h5>Get in touch</h5>
      <a class="ic-line" href="mailto:hello@orangeotec.com"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>hello@orangeotec.com</a>
      <a class="ic-line" href="tel:+912212345678"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/></svg>+91 22 1234 5678</a>
      <div class="ic-line"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Mumbai, Maharashtra, India</div>
      <button class="btn-outline foot-cta" data-nav="/login">Open Workspace
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </button>
    </div>
  </div>

  <div class="foot-bottom">
    <div class="wrap foot-bottom-inner">
      <span>© 2026 Orange O Tec. All rights reserved.</span>
      <div class="legal">
        <a href="#">Privacy Policy</a>
        <a href="#">Terms of Service</a>
        <a href="#">Cookie Settings</a>
      </div>
    </div>
  </div>
</footer>
`;
