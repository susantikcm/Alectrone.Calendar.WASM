// Landing-page scene engine for Alectrone.Calendar.Web.
// Implements the Marketing Motion Design handbook (docs-content/Developers/
// MarketingPageMotionDesign.md) with web platform primitives, adapted from
// the production engine in Alectrone.AppComponents/AppShell/AppHomepage.razor.js
// for a document-scrolled static-SSR page:
//   T3  trip-wires : IntersectionObserver flips .active; enter and reset use
//                    SEPARATE wires (enter deep in view, reset at the edge)
//                    so a small back-scroll never restarts a visible scene.
//   T2  pin+scrub  : sticky stage inside a tall section; progress published
//                    as --p for CSS to consume.
//   T5  fill       : statement headlines fill via --fill.
//   T12 pose morph : [data-pose] runways flip .pose2 at 60% progress going
//                    down and 20% going up; the 0.2..0.6 dead zone is the
//                    hysteresis that keeps the pose from ever flickering.
//   T13 exits      : scenes gain .past (dim) once they leave the top of the
//                    viewport; removed with a hysteresis gap.
//   T14 departure  : the hero publishes --exit; CSS moves content and
//                    backdrop at different speeds.
//   T18 rail       : the chapter spine tracks the section at mid-viewport
//                    and appears only after the hero (both with hysteresis).
//   T1  parallax   : pointer parallax on depth-graded hero layers, gated
//                    until the entrance choreography has finished.
//   nav            : the mobile nav toggle flips .nav-open on the root
//                    (base CSS keeps the nav in flow, so JS-off and
//                    reduced-motion visitors never need this wiring).
//   strips         : [data-hstrip] surfaces are native overflow-x
//                    scrollers; wheel input (deltaX, deltaY, Shift+wheel,
//                    deltaMode-normalized) is routed into scrollLeft with
//                    boundary release, so the page is never trapped and no
//                    wheel is a dead input over the strip. Edge state is
//                    published as .at-start / .at-end.
// Progressive enhancement contract: base CSS renders the composed final
// pose; this engine adds .has-motion before arming anything, then only
// flips state classes, custom properties, aria-expanded on the nav toggle,
// and scrollLeft on the strips. It never inserts, moves, or removes nodes.

let ctx = null;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function formatCount(el, value) {
    const suffix = el.dataset.countSuffix || '';
    const decimals = parseInt(el.dataset.countDecimals || '0', 10) || 0;
    const text = decimals > 0
        ? value.toFixed(decimals)
        : Math.round(value).toLocaleString('en-US');
    el.textContent = text + suffix;
}

function startCounters(scope) {
    if (!ctx) return;
    scope.querySelectorAll('[data-count-to]').forEach(el => {
        if (ctx.counters.get(el) === 'run') return;
        ctx.counters.set(el, 'run');
        const target = parseFloat(el.dataset.countTo) || 0;
        const duration = 1500;
        const t0 = performance.now();
        const tick = now => {
            if (!ctx || ctx.counters.get(el) !== 'run') return;
            const t = clamp((now - t0) / duration, 0, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            formatCount(el, target * eased);
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

function resetCounters(scope) {
    if (!ctx) return;
    scope.querySelectorAll('[data-count-to]').forEach(el => {
        ctx.counters.set(el, 'idle');
        el.textContent = '0';
    });
}

// T21 colorway lab: cw-1/cw-2 classes on the section (absence = the iris
// act). Swatch clicks are wired in BOTH the full-motion and reduced paths
// (the handbook's click-only variant); scroll commitment happens in the
// pins loop. A click holds until scroll commits a DIFFERENT act than the
// one under the pointer when the click landed.
function wireColorwayLab(root) {
    const lab = root.querySelector('[data-cwlab]');
    if (!lab) return null;
    const swatches = Array.from(lab.querySelectorAll('[data-cw-swatch]'));
    const state = { active: 0, held: -1, heldAt: -1, lastAct: 0, count: swatches.length };
    state.set = i => {
        for (let k = 1; k < swatches.length; k++) lab.classList.toggle('cw-' + k, k === i);
        swatches.forEach((b, k) => b.setAttribute('aria-pressed', k === i ? 'true' : 'false'));
        state.active = i;
    };
    swatches.forEach((b, k) => {
        const onClick = () => {
            state.set(k);
            state.held = k;
            state.heldAt = state.lastAct;
        };
        b.addEventListener('click', onClick);
        ctx.listeners.push([b, 'click', onClick]);
    });
    return state;
}

// ── Local-time calendar localization ────────────────────────────────────────
// The #views strip mocks are server-rendered calendar-true against the server
// clock; this re-derives every [data-td*] slot from the VISITOR's own Date, so
// the preview always shows their local day / date / month / year. It is the one
// place the engine writes textContent, and only ever on the aria-hidden
// decorative mock nodes: it never inserts, moves, or removes a node, so the
// progressive-enhancement contract holds (JS-off keeps the server pose).
const TD_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TD_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TD_MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
// Kept in lockstep with the server (_monthDotDays / _dotPalette in LandingPage.razor).
const TD_DOT_DAYS = [3, 8, 15, 24];
const TD_PALETTE = ['hsl(268, 60%, 58%)', 'hsl(220, 70%, 58%)', 'hsl(160, 60%, 45%)', 'hsl(38, 80%, 55%)'];

function tdText(root, selector, value) {
    const el = root.querySelector(selector);
    if (el) el.textContent = value;
}

function sameYMD(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function localizeToday(root) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mondayBack = (now.getDay() + 6) % 7;

    // Day view: header + glowing now-line (07:00-21:00 window).
    tdText(root, '[data-td="day-dow"]', TD_DOW[now.getDay()]);
    tdText(root, '[data-td="day-num"]', String(now.getDate()));
    tdText(root, '[data-td="day-mon"]', TD_MON[now.getMonth()]);
    const nowPct = clamp((now.getHours() + now.getMinutes() / 60 - 7) / 14, 0, 1) * 100;
    root.querySelectorAll('[data-td-nowline]').forEach(el =>
        el.style.setProperty('--t', nowPct.toFixed(1)));

    // Week / work-week columns: this week's Monday-start run of days.
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - mondayBack);
    root.querySelectorAll('[data-td-col]').forEach(col => {
        const off = parseInt(col.getAttribute('data-td-col'), 10) || 0;
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + off);
        const dEl = col.querySelector('[data-td-coldow]');
        if (dEl) dEl.textContent = TD_DOW[d.getDay()];
        const nEl = col.querySelector('[data-td-colday]');
        if (nEl) nEl.textContent = String(d.getDate());
        col.classList.toggle('lv-col--today', sameYMD(d, today));
    });

    // Month grid: Monday-start 6x7 over the current month.
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(1 - ((firstOfMonth.getDay() + 6) % 7));
    root.querySelectorAll('[data-td-cell]').forEach(cell => {
        const off = parseInt(cell.getAttribute('data-td-cell'), 10) || 0;
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + off);
        const nEl = cell.querySelector('[data-td-cellnum]');
        if (nEl) nEl.textContent = String(d.getDate());
        const outMonth = d.getMonth() !== today.getMonth();
        const dotIdx = TD_DOT_DAYS.indexOf(d.getDate());
        const ev = !outMonth && dotIdx >= 0;
        cell.classList.toggle('lv-cell--out', outMonth);
        cell.classList.toggle('lv-cell--today', sameYMD(d, today));
        cell.classList.toggle('lv-cell--ev', ev);
        if (ev) cell.style.setProperty('--c', TD_PALETTE[dotIdx % TD_PALETTE.length]);
        else cell.style.removeProperty('--c');
    });
    tdText(root, '[data-td="month-label"]', TD_MON_LONG[now.getMonth()] + ' ' + now.getFullYear());

    // Year: light the current month card, mark today's cell inside it, stamp
    // the year. Each mini is a real month grid; only the current month carries
    // a lit today dot, so the mark always sits in the highlighted card.
    root.querySelectorAll('[data-td-mini]').forEach(el => {
        const isNow = parseInt(el.getAttribute('data-td-mini'), 10) === now.getMonth();
        el.classList.toggle('lv-mini--now', isNow);
        el.querySelectorAll('.lv-md--today').forEach(c => c.classList.remove('lv-md--today'));
        if (isNow) {
            const cell = el.querySelector(`[data-td-yday="${now.getDate()}"]`);
            if (cell) cell.classList.add('lv-md--today');
        }
    });
    tdText(root, '[data-td="year"]', String(now.getFullYear()));

    // Agenda: relative day labels (0 = Today, 1 = Tomorrow, else weekday) plus
    // the absolute date beside each heading.
    root.querySelectorAll('[data-td-rel]').forEach(row => {
        const off = parseInt(row.getAttribute('data-td-rel'), 10) || 0;
        const d = new Date(today);
        d.setDate(today.getDate() + off);
        const label = off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : TD_DOW[d.getDay()];
        const lbl = row.querySelector('[data-td-rellabel]');
        if (lbl) lbl.textContent = label;
        const dt = row.querySelector('[data-td-reldate]');
        if (dt) dt.textContent = TD_MON[d.getMonth()] + ' ' + d.getDate();
    });

    // Timeline: dated header + a "now" line across the 9a-5p axis window.
    tdText(root, '[data-td="tl-date"]',
        TD_DOW[today.getDay()] + ' ' + today.getDate() + ' ' + TD_MON[today.getMonth()]);
    const tlNow = clamp((now.getHours() + now.getMinutes() / 60 - 9) / 8, 0, 1) * 100;
    root.querySelectorAll('[data-td-tlnow]').forEach(el =>
        el.style.setProperty('--x', tlNow.toFixed(1)));
}

export function init(rootId) {
    destroy();
    const root = document.getElementById(rootId);
    if (!root) return;

    // Refine the decorative calendar mocks to the visitor's local clock. Runs
    // before the reduced-motion return so every visitor sees local dates.
    localizeToday(root);

    ctx = { root, observers: [], listeners: [], cleanups: [], raf: 0, counters: new Map(), entranceDone: false };

    const scenes = Array.from(root.querySelectorAll('[data-scene]'));
    const pins = Array.from(root.querySelectorAll('[data-pin]'));
    const poses = Array.from(root.querySelectorAll('[data-pose]'));
    const fills = Array.from(root.querySelectorAll('[data-fill]'));
    const hero = root.querySelector('[data-hero]');
    const header = root.querySelector('.landing__header');
    const chapters = Array.from(root.querySelectorAll('[data-chapter]'));
    const railLinks = Array.from(root.querySelectorAll('[data-rail]'));
    const viewfocus = Array.from(root.querySelectorAll('[data-viewfocus]'));

    // Reduced motion: the base CSS already renders every scene in its final
    // pose; render final counter values, keep the colorway swatches live
    // (click-only variant), and stop. No observers, no scrub, no parallax,
    // no .has-motion.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        root.classList.add('is-reduced');
        root.querySelectorAll('[data-count-to]').forEach(el =>
            formatCount(el, parseFloat(el.dataset.countTo) || 0));
        ctx.cw = wireColorwayLab(root);
        return;
    }

    ctx.cw = wireColorwayLab(root);

    // Arm the choreography: only now do pre-entry poses hide anything.
    root.classList.add('has-motion');

    // ── T3: trip-wire scenes, enter and reset on separate wires ─────────
    // Enter fires when the scene is 22% into the viewport; reset fires only
    // when it has fallen back below ~2% of the bottom edge. The 20% gap is
    // trip-wire hysteresis (the OriginOS two-wire discipline).
    const enterIo = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (e.isIntersecting) {
                e.target.classList.add('active');
                startCounters(e.target);
            }
        }
    }, { rootMargin: '0px 0px -22% 0px', threshold: 0 });
    const resetIo = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (!e.isIntersecting && e.boundingClientRect.top > 0) {
                e.target.classList.remove('active');
                resetCounters(e.target);
            }
        }
    }, { rootMargin: '0px 0px -2% 0px', threshold: 0 });
    scenes.forEach(s => { enterIo.observe(s); resetIo.observe(s); });
    ctx.observers.push(enterIo, resetIo);

    // ── Per-frame scroll pass: pins, poses, fills, exits, hero, rail ────
    const onScroll = () => {
        if (!ctx || ctx.raf) return;
        ctx.raf = requestAnimationFrame(() => {
            if (!ctx) return;
            ctx.raf = 0;
            const vh = window.innerHeight;
            const y = window.scrollY;

            // T2: pinned scenes. Counter start/reset thresholds are
            // separated (0.55 / 0.08): hysteresis again. A pin that holds a
            // horizontal strip is a film runway: page-scroll progress maps
            // onto the strip's travel, so the page "stops" while the strip
            // plays and the wheel is never intercepted for vertical input.
            for (const pin of pins) {
                const r = pin.getBoundingClientRect();
                const total = pin.offsetHeight - vh;
                const p = total > 0 ? clamp(-r.top / total, 0, 1) : 1;
                pin.style.setProperty('--p', p.toFixed(4));
                if (p >= 0.55) startCounters(pin);
                else if (p <= 0.08) resetCounters(pin);
                if (total > 0) {
                    const filmStrip = pin.querySelector('[data-hstrip]');
                    if (filmStrip) {
                        const stripMax = filmStrip.scrollWidth - filmStrip.clientWidth;
                        if (stripMax > 0) filmStrip.scrollLeft = p * stripMax;
                    }
                }

                // T21 acts, generalized to N colorways: the runway divides
                // into N equal bands; each commits only inside its central
                // 64% (the outer margins are the dead zones). A click-held
                // choice releases only when scroll commits a different act
                // than the one it was held at.
                if (ctx.cw && total > 0 && pin.hasAttribute('data-cwlab')) {
                    const n = ctx.cw.count;
                    const band = Math.min(n - 1, Math.floor(p * n));
                    const local = p * n - band;
                    const act = (local >= 0.18 && local <= 0.82) ? band : -1;
                    if (act >= 0) {
                        ctx.cw.lastAct = act;
                        if (ctx.cw.held >= 0 && act !== ctx.cw.heldAt) ctx.cw.held = -1;
                        if (ctx.cw.held < 0 && ctx.cw.active !== act) ctx.cw.set(act);
                    }
                }
            }

            // T12: pose runways. --p scrubs the light; the pose class flips
            // only at 0.6 (down) / 0.2 (up). Between the two thresholds
            // nothing happens: the dead zone holds the last pose.
            for (const pose of poses) {
                const r = pose.getBoundingClientRect();
                const total = pose.offsetHeight - vh;
                const p = total > 0 ? clamp(-r.top / total, 0, 1) : 1;
                pose.style.setProperty('--p', p.toFixed(4));
                if (p > 0.6) pose.classList.add('pose2');
                else if (p <= 0.2) pose.classList.remove('pose2');
            }

            // T5: statement gradient fills.
            for (const el of fills) {
                const rel = el.getBoundingClientRect().top / vh;
                el.style.setProperty('--fill', clamp((0.85 - rel) / 0.5, 0, 1).toFixed(4));
            }

            // Scroll focus steal: [data-viewfocus] elements get --vp, their
            // journey through the viewport (0 entering below, 0.5 centered,
            // 1 leaving above); CSS shapes the emphasis curve from it.
            for (const el of viewfocus) {
                const r = el.getBoundingClientRect();
                el.style.setProperty('--vp',
                    clamp((vh - r.top) / (vh + r.height), 0, 1).toFixed(4));
            }

            // T13: departure grammar. A scene that has left through the top
            // dims (.past). Add below 18%, remove above 30% of the viewport:
            // hysteresis so the boundary never jitters.
            for (const scene of scenes) {
                const bottomRel = scene.getBoundingClientRect().bottom / vh;
                if (bottomRel < 0.18) scene.classList.add('past');
                else if (bottomRel > 0.30) scene.classList.remove('past');
            }

            // T14: hero multi-speed departure (content ~3x the backdrop).
            if (hero) {
                const exit = clamp(y / Math.max(hero.offsetHeight, 1), 0, 1);
                hero.style.setProperty('--exit', exit.toFixed(4));
            }

            // T11: header elevation with hysteresis (24px down / 4px up).
            if (header) {
                if (y > 24) header.classList.add('is-scrolled');
                else if (y < 4) header.classList.remove('is-scrolled');
            }

            // T18: chapter spine. Visible after ~55% of a viewport of scroll,
            // hidden again below 35%; active chapter = section at 45% line.
            if (y > vh * 0.55) root.classList.add('has-rail');
            else if (y < vh * 0.35) root.classList.remove('has-rail');

            let current = '';
            const line = vh * 0.45;
            for (const c of chapters) {
                const r = c.getBoundingClientRect();
                if (r.top <= line && r.bottom > line) { current = c.dataset.chapter; break; }
            }
            if (root.dataset.chapter !== current) {
                root.dataset.chapter = current;
                for (const l of railLinks) l.classList.toggle('active', l.dataset.rail === current);
            }

            // Teleport guard: an instant jump (Home key, scrollbar drag,
            // anchor nav) can skip the observers' crossing events, so any
            // scene sitting fully below the viewport is force-reset here.
            for (const scene of scenes) {
                if (scene.classList.contains('active') &&
                    scene.getBoundingClientRect().top >= vh) {
                    scene.classList.remove('active');
                    resetCounters(scene);
                }
            }
        });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    ctx.listeners.push([window, 'scroll', onScroll], [window, 'resize', onScroll]);
    onScroll();

    // Rail links scroll to their chapter.
    for (const link of railLinks) {
        const onClick = () => {
            const target = chapters.find(c => c.dataset.chapter === link.dataset.rail);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        link.addEventListener('click', onClick);
        ctx.listeners.push([link, 'click', onClick]);
    }

    // The Product nav item jumps straight to the schedule scene's committed
    // wide calendar (pose 2), so "Product" shows the product itself, not the
    // runway's opening solo-week pose. "See it move" and the chapter rail still
    // land at the top to play the morph from the start. On mobile / reduced
    // motion the week is not a runway, so the native #schedule anchor is left
    // to do its job (and the panel-close handler below still runs).
    const productLink = root.querySelector('.landing__nav a[href="#schedule"]');
    const scheduleScene = root.querySelector('#schedule');
    if (productLink && scheduleScene) {
        const onProduct = ev => {
            const total = scheduleScene.offsetHeight - window.innerHeight;
            if (total <= 0) return; // in flow (mobile / reduced): native anchor
            ev.preventDefault();
            const top = scheduleScene.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: top + total * 0.72, behavior: 'smooth' });
        };
        productLink.addEventListener('click', onProduct);
        ctx.listeners.push([productLink, 'click', onProduct]);
    }

    // ── Mobile nav: toggle-driven panel. Base CSS keeps the nav in flow,
    // so this wiring is motion-path only; JS-off and reduced-motion
    // visitors use the always-visible row instead. ──────────────────────
    const navToggle = root.querySelector('.landing__nav-toggle');
    if (navToggle) {
        const setNav = open => {
            root.classList.toggle('nav-open', open);
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        const onToggle = () => setNav(!root.classList.contains('nav-open'));
        navToggle.addEventListener('click', onToggle);
        ctx.listeners.push([navToggle, 'click', onToggle]);

        for (const link of Array.from(root.querySelectorAll('.landing__nav a'))) {
            const onNavLink = () => setNav(false);
            link.addEventListener('click', onNavLink);
            ctx.listeners.push([link, 'click', onNavLink]);
        }

        const onNavKey = ev => { if (ev.key === 'Escape') setNav(false); };
        document.addEventListener('keydown', onNavKey);
        ctx.listeners.push([document, 'keydown', onNavKey]);
    }

    // ── Horizontal film strips ([data-hstrip]) ──────────────────────────
    // Native overflow-x scrollers; this wiring only routes wheel input so
    // no wheel is ever dead over the strip. There is no API to enumerate
    // side-wheel hardware: a nonzero deltaX IS the side wheel / trackpad
    // pan. deltaY maps the plain wheel; Shift+wheel that arrives as deltaY
    // is honored; deltaMode is normalized (1 = lines, 2 = pages). At the
    // strip's ends the event is released untouched (no preventDefault) so
    // the page keeps its normal vertical scroll: never trap the user.
    // Keyboard (the strip is tabindex=0), touch pan, and the visible
    // scrollbar are native behaviors and stay native.
    for (const strip of Array.from(root.querySelectorAll('[data-hstrip]'))) {
        // Pinned-film mode: when the strip sits inside an active pin runway,
        // the scroll pass drives its position, so vertical wheel input must
        // stay native (the pin converts it) and sideways intent (deltaX,
        // Shift+wheel, arrow keys) is translated into page scroll at the
        // runway-to-strip ratio.
        const pinTravel = () => {
            const pin = strip.closest('[data-pin]');
            return pin ? pin.offsetHeight - window.innerHeight : 0;
        };
        const onWheel = ev => {
            const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? strip.clientWidth : 1;
            const dx = ev.deltaX * unit;
            const dy = ev.deltaY * unit;
            let delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
            if (ev.shiftKey && ev.deltaX === 0) delta = dy;
            if (delta === 0) return;
            const max = strip.scrollWidth - strip.clientWidth;
            if (max <= 0) return;
            const travel = pinTravel();
            if (travel > 0) {
                const sideways = Math.abs(dx) > Math.abs(dy) || (ev.shiftKey && ev.deltaX === 0);
                if (!sideways) return; // vertical wheel: native scroll, the pin plays the film
                if ((delta < 0 && strip.scrollLeft <= 1) ||
                    (delta > 0 && strip.scrollLeft >= max - 1)) {
                    return; // film edges: the tilt rests, vertical scroll proceeds
                }
                ev.preventDefault();
                window.scrollBy(0, delta * (travel / max));
                return;
            }
            if ((delta < 0 && strip.scrollLeft <= 1) ||
                (delta > 0 && strip.scrollLeft >= max - 1)) {
                return; // boundary release: the page scrolls on
            }
            ev.preventDefault();
            // Snap must never fight the wheel: proximity snapping swallows
            // notch-sized deltas (measured twice: six 120px notches, zero
            // net movement, including with an idle-timeout re-enable that
            // yanked every settled notch back). Once wheel input drives
            // the strip, snapping stands down for good; touch and the
            // scrollbar keep snap until a wheel is used.
            strip.classList.add('wheeling');
            strip.scrollLeft += delta;
        };
        strip.addEventListener('wheel', onWheel, { passive: false });
        ctx.listeners.push([strip, 'wheel', onWheel]);

        // Keyboard parity in pinned-film mode: arrows on the focused strip
        // advance the film through the same page-scroll conversion.
        const onKey = ev => {
            if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
            const travel = pinTravel();
            if (travel <= 0) return; // native scroller handles the arrows
            const max = strip.scrollWidth - strip.clientWidth;
            if (max <= 0) return;
            ev.preventDefault();
            window.scrollBy(0, (ev.key === 'ArrowRight' ? 120 : -120) * (travel / max));
        };
        strip.addEventListener('keydown', onKey);
        ctx.listeners.push([strip, 'keydown', onKey]);

        // Edge state for the CSS fades (and anything else that wants it).
        const onEdge = () => {
            const max = strip.scrollWidth - strip.clientWidth;
            strip.classList.toggle('at-start', strip.scrollLeft <= 1);
            strip.classList.toggle('at-end', strip.scrollLeft >= max - 1);
        };
        strip.addEventListener('scroll', onEdge, { passive: true });
        window.addEventListener('resize', onEdge);
        ctx.listeners.push([strip, 'scroll', onEdge], [window, 'resize', onEdge]);
        onEdge();
    }

    // ── T1: gated pointer parallax on the hero ─────────────────────────
    if (hero && window.matchMedia('(pointer: fine)').matches) {
        // Entrance choreography is pure CSS; unlock parallax after it rests.
        window.setTimeout(() => { if (ctx) ctx.entranceDone = true; }, 1800);

        const layers = Array.from(hero.querySelectorAll('[data-depth]'));
        let busy = false;
        const onMove = ev => {
            if (!ctx || !ctx.entranceDone || busy) return;
            busy = true;
            requestAnimationFrame(() => {
                busy = false;
                if (!ctx) return;
                const rect = hero.getBoundingClientRect();
                const nx = (ev.clientX - rect.left) / rect.width - 0.5;
                const ny = (ev.clientY - rect.top) / rect.height - 0.5;
                for (const layer of layers) {
                    const d = parseFloat(layer.dataset.depth) || 0;
                    layer.style.transform =
                        'translate3d(' + (nx * d).toFixed(1) + 'px, ' + (ny * d * 0.6).toFixed(1) + 'px, 0)';
                }
            });
        };
        const onLeave = () => layers.forEach(l => { l.style.transform = 'translate3d(0, 0, 0)'; });
        hero.addEventListener('mousemove', onMove);
        hero.addEventListener('mouseleave', onLeave);
        ctx.listeners.push([hero, 'mousemove', onMove], [hero, 'mouseleave', onLeave]);
    }
}

export function destroy() {
    if (!ctx) return;
    ctx.observers.forEach(o => o.disconnect());
    ctx.listeners.forEach(([target, evt, fn]) => target.removeEventListener(evt, fn));
    ctx.cleanups.forEach(fn => fn());
    if (ctx.raf) cancelAnimationFrame(ctx.raf);
    ctx.counters.clear();
    ctx = null;
}
