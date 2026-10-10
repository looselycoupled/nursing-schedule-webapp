/* Nursing Schedule — timeline interaction & feeding math.
 *
 * The timeline is a vertical scroll container with CSS scroll-snap. A thin
 * "selector" bar is fixed at the visual center. Whatever minute lines up
 * with that center is the "last feeding" time. Next feed markers and the
 * summary card recompute on every scroll frame.
 */
(() => {
    'use strict';

    const config = window.__APP_CONFIG__ || {
        intervals: [120, 150, 180],
        defaultInterval: 150,
        defaultCount: 3,
    };

    // Name of the iOS Shortcut the user installs once. The Shortcut takes a
    // number (minutes) as input and calls "Start Timer". See the in-app
    // setup instructions for the full recipe.
    const SHORTCUT_NAME = 'Start Feeding Timer';

    // iOS / iPadOS detection. iPadOS 13+ reports as Mac; the touch-points
    // check disambiguates.
    const IS_IOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);

    // Timeline geometry (must match CSS --px-per-minute).
    // 1px/min keeps ~6 hours in view on a typical phone so feed #1 is always
    // visible on the track for any of the 2h / 2.5h / 3h presets.
    const PX_PER_MINUTE = 1;
    const HISTORY_HOURS = 2;   // allow scrolling this far back from "now"
    const FUTURE_HOURS = 48;   // and this far forward
    const HISTORY_MINUTES = HISTORY_HOURS * 60;
    const TOTAL_MINUTES = (HISTORY_HOURS + FUTURE_HOURS) * 60;
    const SNAP_MINUTES = 5;
    const TRACK_HEIGHT_PX = TOTAL_MINUTES * PX_PER_MINUTE;
    const MS_PER_DAY = 86_400_000;

    const $ = (sel) => document.querySelector(sel);

    const timelineEl = $('#timeline');
    const trackEl = $('#track');
    const selectedLabelEl = $('#selectedTime');
    const feedListEl = $('#feedList');
    const copyBtn = $('#copyBtn');
    const nowBtn = $('#nowBtn');
    const intervalBtns = Array.from(document.querySelectorAll('.intervals__btn'));

    // baseDate = top of the hour HISTORY_HOURS before "now". Anchoring to a
    // whole hour keeps tick labels aligned on the :00 grid. Timeline spans
    // baseDate .. baseDate + (HISTORY_HOURS + FUTURE_HOURS).
    const baseDate = (() => {
        const d = new Date();
        d.setMinutes(0, 0, 0);
        d.setHours(d.getHours() - HISTORY_HOURS);
        return d;
    })();

    const state = {
        intervalMinutes: config.defaultInterval,
        selectedMinutes: 0,
        feedCount: config.defaultCount,
    };

    // ---------- helpers ---------------------------------------------------

    const clampMinutes = (m) => Math.max(0, Math.min(TOTAL_MINUTES, m));

    const minutesToDate = (minutes) =>
        new Date(baseDate.getTime() + minutes * 60_000);

    const minutesSinceBase = (date) =>
        Math.round((date.getTime() - baseDate.getTime()) / 60_000);

    const formatTime = (date) =>
        date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const dayOffsetFromToday = (date) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return Math.round((d.getTime() - today.getTime()) / MS_PER_DAY);
    };

    const formatTimeWithDay = (date) => {
        const diff = dayOffsetFromToday(date);
        const t = formatTime(date);
        if (diff === 0) return t;
        if (diff === 1) return `Tomorrow, ${t}`;
        if (diff === -1) return `Yesterday, ${t}`;
        return `${date.toLocaleDateString([], { weekday: 'short' })}, ${t}`;
    };

    const formatRelative = (date) => {
        const diffMs = date.getTime() - Date.now();
        const future = diffMs >= 0;
        const totalMin = Math.round(Math.abs(diffMs) / 60_000);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        let rel;
        if (h === 0) rel = `${m}m`;
        else if (m === 0) rel = `${h}h`;
        else rel = `${h}h ${m}m`;
        return future ? `in ${rel}` : `${rel} ago`;
    };

    const minutesUntil = (date) =>
        Math.round((date.getTime() - Date.now()) / 60_000);

    // Use the x-callback-url form so Shortcuts returns to Safari after the
    // timer is started, instead of leaving the user stranded in the
    // Shortcuts app.
    const buildTimerUrl = (minutes) => {
        const back = encodeURIComponent(window.location.href);
        return (
            `shortcuts://x-callback-url/run-shortcut` +
            `?name=${encodeURIComponent(SHORTCUT_NAME)}` +
            `&input=text&text=${encodeURIComponent(String(minutes))}` +
            `&x-success=${back}` +
            `&x-cancel=${back}` +
            `&x-error=${back}`
        );
    };

    // ---------- building the timeline track -------------------------------

    function buildTrack() {
        trackEl.style.height = `${TRACK_HEIGHT_PX}px`;
        const frag = document.createDocumentFragment();

        for (let m = 0; m <= TOTAL_MINUTES; m += SNAP_MINUTES) {
            const tick = document.createElement('div');
            tick.className = 'tick';
            tick.style.top = `${m * PX_PER_MINUTE}px`;

            const d = minutesToDate(m);
            const isHour = d.getMinutes() === 0;
            const isDayStart = isHour && d.getHours() === 0;

            if (isHour) {
                tick.classList.add('tick--hour');
                if (isDayStart) tick.classList.add('tick--day');
                const label = document.createElement('span');
                label.className = 'tick__label';
                if (isDayStart) {
                    const offset = dayOffsetFromToday(d);
                    const dayName =
                        offset === 0 ? 'Today'
                        : offset === 1 ? 'Tomorrow'
                        : offset === -1 ? 'Yesterday'
                        : d.toLocaleDateString([], { weekday: 'short' });
                    label.textContent = `${dayName} · 12 AM`;
                } else {
                    label.textContent = formatTime(d);
                }
                tick.appendChild(label);
            } else {
                tick.classList.add('tick--5min');
            }

            frag.appendChild(tick);
        }

        trackEl.appendChild(frag);
    }

    // ---------- live "now" line -------------------------------------------

    let nowLineEl = null;

    function ensureNowLine() {
        if (nowLineEl) return nowLineEl;
        nowLineEl = document.createElement('div');
        nowLineEl.className = 'now-line';
        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'now-line__label';
        label.textContent = 'Now';
        label.setAttribute('aria-label', 'Jump to now');
        label.addEventListener('click', () => {
            scrollToMinutes(minutesSinceBase(new Date()));
        });
        nowLineEl.appendChild(label);
        trackEl.appendChild(nowLineEl);
        return nowLineEl;
    }

    function updateNowLine({ initial = false } = {}) {
        const el = ensureNowLine();
        const nowMin = (Date.now() - baseDate.getTime()) / 60_000;
        if (nowMin < 0 || nowMin > TOTAL_MINUTES) {
            el.style.display = 'none';
            return;
        }
        el.style.display = '';
        // Skip the 1s position transition on first paint so the line doesn't
        // animate in from the top of the track.
        if (initial) {
            el.style.transition = 'none';
            el.style.top = `${nowMin * PX_PER_MINUTE}px`;
            void el.offsetHeight; // force reflow
            el.style.transition = '';
        } else {
            el.style.top = `${nowMin * PX_PER_MINUTE}px`;
        }
    }

    // ---------- rendering --------------------------------------------------

    function renderFeedMarkers() {
        trackEl.querySelectorAll('.marker').forEach((n) => n.remove());
        const frag = document.createDocumentFragment();
        for (let i = 1; i <= state.feedCount; i++) {
            const feedMin = state.selectedMinutes + state.intervalMinutes * i;
            if (feedMin < 0 || feedMin > TOTAL_MINUTES) continue;
            const marker = document.createElement('div');
            marker.className = 'marker';
            marker.style.top = `${feedMin * PX_PER_MINUTE}px`;
            marker.textContent = `#${i} · ${formatTime(minutesToDate(feedMin))}`;
            frag.appendChild(marker);
        }
        trackEl.appendChild(frag);
    }

    function renderSummary() {
        selectedLabelEl.textContent = formatTime(minutesToDate(state.selectedMinutes));

        feedListEl.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (let i = 1; i <= state.feedCount; i++) {
            const d = minutesToDate(state.selectedMinutes + state.intervalMinutes * i);
            const li = document.createElement('li');
            li.className = 'feeds__item';

            const idx = document.createElement('span');
            idx.className = 'feeds__index';
            idx.textContent = String(i);

            const time = document.createElement('span');
            time.className = 'feeds__time';
            time.textContent = formatTimeWithDay(d);

            const rel = document.createElement('span');
            rel.className = 'feeds__relative';
            rel.textContent = formatRelative(d);

            li.append(idx, time, rel);

            // Only show the timer button on iOS where shortcuts:// links work,
            // and only for feeds that are still in the future.
            if (IS_IOS) {
                const mins = minutesUntil(d);
                if (mins > 0) {
                    const timerLink = document.createElement('a');
                    timerLink.className = 'feeds__timer';
                    timerLink.href = buildTimerUrl(mins);
                    timerLink.setAttribute(
                        'aria-label',
                        `Start iOS timer for ${mins} minutes`
                    );
                    timerLink.title = `Start ${mins}-minute iOS timer`;
                    timerLink.textContent = '\u23F2\uFE0F'; // ⏲️
                    li.appendChild(timerLink);
                }
            }

            frag.appendChild(li);
        }
        feedListEl.appendChild(frag);
    }

    function render() {
        renderFeedMarkers();
        renderSummary();
    }

    // ---------- scroll → selected minute ----------------------------------

    function onScroll() {
        // Because top spacer = timeline viewport / 2, the vertical center of
        // the viewport expressed in track coordinates simply equals scrollTop.
        const rawMin = timelineEl.scrollTop / PX_PER_MINUTE;
        const snapped = Math.round(rawMin / SNAP_MINUTES) * SNAP_MINUTES;
        const next = clampMinutes(snapped);
        if (next !== state.selectedMinutes) {
            state.selectedMinutes = next;
            render();
        }
    }

    function scrollToMinutes(minutes, smooth = true) {
        timelineEl.scrollTo({
            top: clampMinutes(minutes) * PX_PER_MINUTE,
            behavior: smooth ? 'smooth' : 'auto',
        });
    }

    // ---------- interval presets ------------------------------------------

    function setIntervalMinutes(minutes) {
        state.intervalMinutes = minutes;
        intervalBtns.forEach((btn) => {
            btn.classList.toggle(
                'intervals__btn--active',
                Number(btn.dataset.minutes) === minutes
            );
        });
        render();
    }

    // ---------- copy to clipboard -----------------------------------------

    async function copyTimes() {
        const lines = [];
        for (let i = 1; i <= state.feedCount; i++) {
            const d = minutesToDate(state.selectedMinutes + state.intervalMinutes * i);
            lines.push(`${i}. ${formatTimeWithDay(d)}`);
        }
        const intervalLabel =
            state.intervalMinutes % 60 === 0
                ? `${state.intervalMinutes / 60}h`
                : `${Math.floor(state.intervalMinutes / 60)}h ${state.intervalMinutes % 60}m`;
        const header = `Next feedings (every ${intervalLabel}):`;
        const text = `${header}\n${lines.join('\n')}`;

        const flash = (label, ok = true) => {
            copyBtn.textContent = label;
            copyBtn.classList.toggle('summary__copy--done', ok);
            setTimeout(() => {
                copyBtn.textContent = 'Copy';
                copyBtn.classList.remove('summary__copy--done');
            }, 1500);
        };

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                flash('Copied!');
                return;
            }
            throw new Error('Clipboard API unavailable');
        } catch {
            // Fallback for non-secure contexts (e.g. plain http://).
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'absolute';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch { /* ignored */ }
            document.body.removeChild(ta);
            flash(ok ? 'Copied!' : 'Copy failed', ok);
        }
    }

    // ---------- init ------------------------------------------------------

    function init() {
        buildTrack();

        intervalBtns.forEach((btn) => {
            btn.addEventListener('click', () =>
                setIntervalMinutes(Number(btn.dataset.minutes))
            );
        });

        copyBtn.addEventListener('click', copyTimes);
        nowBtn.addEventListener('click', () =>
            scrollToMinutes(minutesSinceBase(new Date()))
        );

        // Reveal the iOS Shortcut setup instructions only on iOS — no need
        // to clutter the UI for other platforms.
        if (IS_IOS) {
            const setupEl = document.getElementById('setupTimer');
            if (setupEl) setupEl.hidden = false;
        }

        // rAF-throttled scroll handler
        let ticking = false;
        timelineEl.addEventListener(
            'scroll',
            () => {
                if (ticking) return;
                ticking = true;
                requestAnimationFrame(() => {
                    onScroll();
                    ticking = false;
                });
            },
            { passive: true }
        );

        // Keep the "now" line and relative labels fresh even when the user
        // hasn't interacted. 15s is granular enough for ~0.5px of movement
        // per tick, which the CSS `top` transition smooths out.
        setInterval(() => {
            updateNowLine();
            renderSummary();
        }, 15_000);

        // Initial scroll — center on "now", snapped to 5-minute increments.
        const nowMin = minutesSinceBase(new Date());
        const snappedNow = clampMinutes(Math.round(nowMin / SNAP_MINUTES) * SNAP_MINUTES);
        // Wait for layout so scrollTop actually takes effect.
        requestAnimationFrame(() => {
            timelineEl.scrollTop = snappedNow * PX_PER_MINUTE;
            state.selectedMinutes = snappedNow;
            render();
            updateNowLine({ initial: true });
        });
    }

    init();
})();
