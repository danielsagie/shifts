/**
 * Shifts - Frontend Logic
 * Handles tab switching, API calls, and DOM rendering.
 */

// ============================
// State
// ============================
let currentTab = 'setup';
let calendarInfo = null;
let workersData = [];
let warningsData = [];
let scheduleData = null;
let editingWorker = null; // null = adding new, string = editing existing name
let swapMode = false;
let swapSelection = []; // [{day, originalIndex}]
let filterWorkers = new Set();
let currentEditSlot = null; // { day, slotIndex }
let currentEditDay = null;

// Worker sheet draft
let draftPref = new Set();
let draftCant = new Set();
let paintMode = 'pref';
let strokeMode = null;

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ============================
// Helpers
// ============================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;

function nameHue(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
}

function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

function avatar(name) {
    return `<span class="avatar" style="--h:${nameHue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

function scheduleMonth() {
    return (scheduleData && scheduleData.month) || calendarInfo?.month;
}

function weekdayOf(year, month, day) {
    return new Date(year, month - 1, day).getDay(); // 0 = Sun
}

// ============================
// Initialization
// ============================
document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderScheduleVisibility();
    loadSetupTab();
});

async function loadSetupTab() {
    await Promise.all([
        loadCalendarInfo(),
        loadWorkers(),
        loadWarnings(),
    ]);
}

function bindEvents() {
    document.addEventListener('click', onActionClick);

    $$('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    $('#team-search').addEventListener('input', renderWorkers);
    $('#replace-search').addEventListener('input', renderReplaceList);
    $('#import-file').addEventListener('change', importSchedule);

    // Close menu on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.menu-anchor')) closeMenu();
    });

    // Close overlays by tapping the dimmed background
    $$('.sheet-overlay').forEach(ov => ov.addEventListener('click', (e) => {
        if (e.target === ov && ov.id !== 'confirm-overlay') closeSheet(ov);
    }));

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!$('#more-menu').hidden) return closeMenu(true);
        const open = $$('.sheet-overlay:not([hidden])').pop();
        if (open && open.id === 'confirm-overlay') return $('#confirm-cancel').click();
        if (open) return closeSheet(open);
        if (swapMode) toggleSwapMode();
    });

    // Steppers
    document.addEventListener('click', (e) => {
        const step = e.target.closest('.stepper-btn');
        if (!step) return;
        const input = step.parentElement.querySelector('input');
        const min = input.min === '' ? -Infinity : Number(input.min);
        const max = input.max === '' ? Infinity : Number(input.max);
        const next = (parseInt(input.value) || 0) + Number(step.dataset.step);
        input.value = Math.min(max, Math.max(min, next));
    });

    // Worker sheet: auto limit switch
    $('#modal-limit-auto').addEventListener('change', syncLimitControls);

    // Paint mode
    $('#paint-mode').addEventListener('click', (e) => {
        const b = e.target.closest('[data-paint]');
        if (!b) return;
        paintMode = b.dataset.paint;
        $$('#paint-mode [data-paint]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    });

    bindDayPicker();
}

function onActionClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const { action, name, day, idx } = el.dataset;

    if (el.closest('.menu')) closeMenu();

    switch (action) {
        case 'prev-month': return changeMonth(-1);
        case 'next-month': return changeMonth(1);
        case 'generate': return generateSchedule();
        case 'generate-preferred': return generatePreferredSchedule();
        case 'toggle-menu': return toggleMenu();
        case 'import': return $('#import-file').click();
        case 'export': return exportSchedule();
        case 'reload': return resetForm();
        case 'add-worker': return openWorkerSheet(null);
        case 'edit-worker': return openWorkerSheet(name);
        case 'save-worker': return saveWorker();
        case 'delete-worker': return deleteWorker();
        case 'close-sheet': return closeSheet(el.closest('.sheet-overlay'));
        case 'toggle-swap': return toggleSwapMode();
        case 'clear-filter': filterWorkers.clear(); return renderSchedule();
        case 'filter': return toggleFilter(name);
        case 'shift': return handleShiftClick(day, Number(idx));
        case 'edit-day': return openEditDayModal(day);
        case 'save-day': return saveDayRequirements();
        case 'reset-day': return resetDayToDefault();
        case 'replace': return replaceWorker(name);
    }
}

// ============================
// Tab Switching
// ============================
function switchTab(tab) {
    currentTab = tab;
    $$('.tab').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.tab === tab)));
    $$('.page').forEach(page => page.classList.toggle('active', page.id === `tab-${tab}`));
    window.scrollTo({ top: 0, behavior: 'instant' });
}

// ============================
// API Helpers
// ============================
async function api(endpoint, options = {}) {
    const res = await fetch(`/api${endpoint}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
}

// ============================
// Menu, sheets, toasts, alerts
// ============================
function toggleMenu() {
    const menu = $('#more-menu');
    const btn = $('[data-action="toggle-menu"]');
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) $$('.menu-item', menu).find(item => item.offsetParent !== null)?.focus();
}

function closeMenu(restoreFocus = false) {
    const menu = $('#more-menu');
    if (menu.hidden) return;
    menu.hidden = true;
    const btn = $('[data-action="toggle-menu"]');
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) btn.focus();
}

let lastFocus = null;

function openSheet(id, focusSel) {
    lastFocus = document.activeElement;
    const ov = document.getElementById(id);
    ov.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
        const target = focusSel ? $(focusSel, ov) : ov.querySelector('input, button');
        target?.focus({ preventScroll: true });
    });
}

function closeSheet(ov) {
    if (typeof ov === 'string') ov = document.getElementById(ov);
    if (!ov || ov.hidden) return;
    ov.hidden = true;
    if (!$$('.sheet-overlay:not([hidden])').length) document.body.style.overflow = '';
    if (ov.id === 'modal-overlay') editingWorker = null;
    if (ov.id === 'replace-modal-overlay') currentEditSlot = null;
    if (ov.id === 'edit-day-modal-overlay') currentEditDay = null;
    lastFocus?.focus?.({ preventScroll: true });
}

let toastTimer = null;
function toast(message, kind = '') {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast glass ${kind}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

function confirmDialog({ title, message = '', ok = 'OK', destructive = false }) {
    return new Promise(resolve => {
        const ov = $('#confirm-overlay');
        $('#confirm-title').textContent = title;
        $('#confirm-message').textContent = message;
        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');
        okBtn.textContent = ok;
        okBtn.classList.toggle('destructive', destructive);
        const prevFocus = document.activeElement;
        ov.hidden = false;
        cancelBtn.focus();

        const done = (value) => {
            ov.hidden = true;
            okBtn.onclick = cancelBtn.onclick = null;
            prevFocus?.focus?.({ preventScroll: true });
            resolve(value);
        };
        okBtn.onclick = () => done(true);
        cancelBtn.onclick = () => done(false);
    });
}

// ============================
// Calendar Info
// ============================
async function loadCalendarInfo() {
    calendarInfo = await api('/calendar-info');
    $('#month-title').textContent = `${calendarInfo.month_name} ${calendarInfo.year}`;
    document.title = `Shifts · ${calendarInfo.month_name} ${calendarInfo.year}`;

    $('#team-size').textContent = calendarInfo.team_size;
    $('#total-shifts').textContent = calendarInfo.total_shifts;
    $('#total-asked').textContent = calendarInfo.total_asked;

    const balance = calendarInfo.total_asked - calendarInfo.total_shifts;
    const balanceEl = $('#shift-balance');
    balanceEl.textContent = balance > 0 ? `+${balance}` : balance < 0 ? `\u2212${-balance}` : '0';
    balanceEl.parentElement.classList.toggle('is-good', balance >= 0);
    balanceEl.parentElement.classList.toggle('is-bad', balance < 0);
    $('#shift-balance-label').textContent = balance < 0
        ? `Short by ${-balance} shift${balance === -1 ? '' : 's'}`
        : balance === 0 ? 'Exactly covered' : 'Spare capacity';
}

async function changeMonth(delta) {
    if (!calendarInfo) return;
    let month = calendarInfo.month + delta;
    let year = calendarInfo.year;
    if (month < 1) { month = 12; year--; }
    if (month > 12) { month = 1; year++; }

    await api('/calendar-info', { method: 'PUT', body: JSON.stringify({ month, year }) });
    const hadSchedule = !!scheduleData;
    clearSchedule();
    await loadSetupTab();
    if (hadSchedule) toast('Month changed. Generate a new schedule for it.');
}

// ============================
// Workers
// ============================
async function loadWorkers() {
    workersData = await api('/workers');
    renderWorkers();

    const pref = workersData.reduce((s, w) => s + w.can_work.length, 0);
    const cant = workersData.reduce((s, w) => s + w.cant_work.length, 0);
    $('#rules-badge').textContent = `${pref} preferred days and ${cant} unavailable days across the team`;
}

function renderWorkers() {
    const grid = $('#workers-grid');
    const q = $('#team-search').value.trim().toLowerCase();
    const days = calendarInfo?.days_in_month || 31;
    const list = workersData.filter(w => !q || w.name.toLowerCase().includes(q));

    if (!workersData.length) {
        grid.innerHTML = `<p class="empty-inline">No one on the team yet. Add the first person to get started.</p>`;
        return;
    }
    if (!list.length) {
        grid.innerHTML = `<p class="empty-inline">No one matches “${esc(q)}”.</p>`;
        return;
    }

    grid.innerHTML = list.map(w => {
        const pref = new Set(w.can_work);
        const cant = new Set(w.cant_work);
        let strip = '';
        for (let d = 1; d <= days; d++) {
            const cls = pref.has(d) ? 'p' : cant.has(d) ? 'c' : '';
            strip += `<i class="${cls}"></i>`;
        }
        const auto = w.limit_raw === null;
        const meta = [
            `${w.can_work.length} preferred`,
            `${w.cant_work.length} can't work`,
        ].join(' · ');

        return `
            <button class="worker-card" data-action="edit-worker" data-name="${esc(w.name)}" aria-label="Edit ${esc(w.name)}: ${meta}, target ${w.limit}${auto ? ' (automatic)' : ''}">
                <span class="worker-top">
                    ${avatar(w.name)}
                    <span class="worker-id">
                        <span class="worker-name">${esc(w.name)}</span>
                        <span class="worker-meta">${meta}</span>
                    </span>
                    <span class="worker-target ${auto ? 'auto' : ''}">
                        <strong>${w.limit}</strong>
                        <span>${auto ? 'Auto' : 'Target'}</span>
                    </span>
                </span>
                <span class="month-strip" style="--days:${days}" aria-hidden="true">${strip}</span>
                <span class="month-strip-scale" aria-hidden="true"><span>1</span><span>${Math.ceil(days / 2)}</span><span>${days}</span></span>
            </button>
        `;
    }).join('');
}

// ============================
// Warnings
// ============================
async function loadWarnings() {
    warningsData = await api('/warnings');
    renderHealth();
}

function issueRow(w) {
    const hasDay = w.day !== undefined && w.day !== null;
    const wd = hasDay && calendarInfo ? WEEKDAYS_SHORT[weekdayOf(calendarInfo.year, calendarInfo.month, w.day)] : '';
    const dayBox = hasDay
        ? `<span class="issue-day">${w.day}<small>${wd}</small></span>`
        : `<span class="issue-day">${icon('warn')}</span>`;
    const label = w.label || (w.type === 'critical' ? 'CRITICAL' : 'WARNING');
    const peopleLabel = w.label === 'UNDERSTAFFED' ? 'Unavailable' : 'Requested by';
    const pretty = label.charAt(0) + label.slice(1).toLowerCase();
    return `
        <div class="issue ${w.type}">
            ${dayBox}
            <div>
                <div class="issue-title"><span class="issue-tag">${esc(pretty)}</span>${esc(w.message)}</div>
                ${w.workers && w.workers.length ? `<div class="issue-people">${peopleLabel}: ${esc(w.workers.join(', '))}</div>` : ''}
            </div>
        </div>
    `;
}

function renderHealth() {
    const critical = warningsData.filter(w => w.type === 'critical');
    const warn = warningsData.filter(w => w.type !== 'critical');
    const status = $('#health-status');
    const title = $('#health-title');
    const sub = $('#health-sub');
    const body = $('#health-body');

    status.classList.remove('health-ok', 'health-bad', 'health-warn');

    if (!warningsData.length) {
        status.classList.add('health-ok');
        title.innerHTML = `${icon('check')} Month looks good`;
        sub.textContent = 'Every day can be staffed and no day is over-requested.';
        body.innerHTML = '';
        return;
    }

    if (critical.length) {
        status.classList.add('health-bad');
        title.innerHTML = `${icon('warn')} ${critical.length} problem${critical.length === 1 ? '' : 's'} to fix before generating`;
    } else {
        status.classList.add('health-warn');
        title.innerHTML = `${icon('warn')} ${warn.length} high-demand day${warn.length === 1 ? '' : 's'}`;
    }
    sub.textContent = warn.length
        ? `On ${warn.length} day${warn.length === 1 ? '' : 's'}, more people prefer to work than there are slots, so some requests can't be granted.`
        : '';

    body.innerHTML = `
        ${critical.length ? `<div class="issue-list">${critical.map(issueRow).join('')}</div>` : ''}
        ${warn.length ? `
            <details class="disclosure" ${critical.length ? '' : 'open'}>
                <summary><span>High-demand days (${warn.length})</span>${icon('chev-down')}</summary>
                <div class="issue-list">${warn.map(issueRow).join('')}</div>
            </details>` : ''}
    `;
}

// ============================
// Worker sheet
// ============================
function openWorkerSheet(name) {
    const worker = name ? workersData.find(w => w.name === name) : null;
    if (name && !worker) return;

    editingWorker = worker ? worker.name : null;
    $('#modal-title').textContent = worker ? worker.name : 'New Person';
    $('#modal-name').value = worker ? worker.name : '';
    $('#modal-delete-btn').hidden = !worker;

    const auto = !worker || worker.limit_raw === null;
    $('#modal-limit-auto').checked = auto;
    $('#modal-limit').value = worker ? (worker.limit_raw ?? worker.limit) : '';
    $('#modal-limit').dataset.autoValue = worker ? worker.limit : '';
    syncLimitControls();

    draftPref = new Set(worker ? worker.can_work : []);
    draftCant = new Set(worker ? worker.cant_work : []);
    paintMode = 'pref';
    $$('#paint-mode [data-paint]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.paint === 'pref')));
    renderDayPicker();

    openSheet('modal-overlay', worker ? null : '#modal-name');
}

function syncLimitControls() {
    const auto = $('#modal-limit-auto').checked;
    const input = $('#modal-limit');
    $('#limit-stepper').classList.toggle('is-disabled', auto);
    input.disabled = auto;
    if (auto) {
        input.value = input.dataset.autoValue || '';
        $('#limit-help').textContent = 'Automatic, based on the month';
    } else {
        if (input.value === '') input.value = input.dataset.autoValue || 4;
        $('#limit-help').textContent = 'Fixed number of shifts this month';
    }
}

function renderDayPicker() {
    const picker = $('#day-picker');
    const days = calendarInfo.days_in_month;
    const offset = weekdayOf(calendarInfo.year, calendarInfo.month, 1);

    let html = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="dp-head" aria-hidden="true">${d}</span>`).join('');
    for (let i = 0; i < offset; i++) html += '<span></span>';
    for (let d = 1; d <= days; d++) {
        html += `<button type="button" class="day-btn ${dayState(d)}" data-day="${d}" aria-label="${dayAria(d)}">${d}</button>`;
    }
    picker.innerHTML = html;
    renderAvailCount();
}

function dayState(d) {
    return draftPref.has(d) ? 'pref' : draftCant.has(d) ? 'cant' : '';
}

function dayAria(d) {
    const s = dayState(d);
    return `Day ${d}${s === 'pref' ? ', preferred' : s === 'cant' ? ", can't work" : ', available'}`;
}

function paintDay(d, mode) {
    draftPref.delete(d);
    draftCant.delete(d);
    if (mode === 'pref') draftPref.add(d);
    if (mode === 'cant') draftCant.add(d);
    const btn = $(`#day-picker .day-btn[data-day="${d}"]`);
    if (btn) {
        btn.className = `day-btn ${dayState(d)}`;
        btn.setAttribute('aria-label', dayAria(d));
    }
    renderAvailCount();
}

function strokeModeFor(d) {
    // Painting a day that already has the active state clears it, so a tap toggles
    return dayState(d) === paintMode ? 'clear' : paintMode;
}

function bindDayPicker() {
    const picker = $('#day-picker');
    let painting = false;

    picker.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('.day-btn');
        if (!btn) return;
        e.preventDefault();
        painting = true;
        const d = Number(btn.dataset.day);
        strokeMode = strokeModeFor(d);
        paintDay(d, strokeMode);
    });

    picker.addEventListener('pointermove', (e) => {
        if (!painting) return;
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.day-btn');
        if (el && picker.contains(el)) {
            const d = Number(el.dataset.day);
            if (dayState(d) !== (strokeMode === 'clear' ? '' : strokeMode)) paintDay(d, strokeMode);
        }
    });

    window.addEventListener('pointerup', () => { painting = false; });
    window.addEventListener('pointercancel', () => { painting = false; });

    // Keyboard activation (pointer taps are handled on pointerdown)
    picker.addEventListener('click', (e) => {
        const btn = e.target.closest('.day-btn');
        if (!btn || e.detail !== 0) return;
        const d = Number(btn.dataset.day);
        paintDay(d, strokeModeFor(d));
    });
}

function renderAvailCount() {
    $('#avail-count').innerHTML = `
        <span><i class="dot dot-pref"></i>${draftPref.size} preferred</span>
        <span><i class="dot dot-cant"></i>${draftCant.size} can't work</span>
        <span><i class="dot"></i>${calendarInfo.days_in_month - draftPref.size - draftCant.size} available</span>
    `;
}

async function saveWorker() {
    const nameInput = $('#modal-name');
    const name = nameInput.value.trim();
    if (!name) {
        toast('Add a name first.', 'bad');
        nameInput.focus();
        return;
    }
    const clash = workersData.some(w => w.name.toLowerCase() === name.toLowerCase() && w.name !== editingWorker);
    if (clash) {
        toast(`${name} is already on the team.`, 'bad');
        nameInput.focus();
        return;
    }

    const auto = $('#modal-limit-auto').checked;
    const limitVal = parseInt($('#modal-limit').value);
    const body = {
        name,
        limit: auto || isNaN(limitVal) ? null : limitVal,
        cant_work: [...draftCant].sort((a, b) => a - b),
        can_work: [...draftPref].sort((a, b) => a - b),
    };

    const btn = $('#modal-save-btn');
    btn.disabled = true;
    try {
        if (editingWorker) {
            await api(`/workers/${encodeURIComponent(editingWorker)}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
            await api('/workers', { method: 'POST', body: JSON.stringify(body) });
        }
        const wasEditing = editingWorker;
        closeSheet('modal-overlay');
        await loadSetupTab();
        toast(wasEditing ? `Saved ${name}` : `Added ${name} to the team`);
    } catch (err) {
        toast(`Couldn't save: ${err.message}`, 'bad');
    } finally {
        btn.disabled = false;
    }
}

async function deleteWorker() {
    const name = editingWorker;
    if (!name) return;
    const ok = await confirmDialog({
        title: `Remove ${name}?`,
        message: 'Their availability for this month will be deleted.',
        ok: 'Remove',
        destructive: true,
    });
    if (!ok) return;
    await api(`/workers/${encodeURIComponent(name)}`, { method: 'DELETE' });
    filterWorkers.delete(name);
    closeSheet('modal-overlay');
    await loadSetupTab();
    toast(`Removed ${name}`);
}

async function resetForm() {
    const ok = await confirmDialog({
        title: 'Reload team data?',
        message: 'This reloads everyone from workers.json and clears the current schedule.',
        ok: 'Reload',
    });
    if (!ok) return;
    clearSchedule();
    await loadSetupTab();
    switchTab('setup');
    toast('Team data reloaded');
}

// ============================
// Generate Schedule
// ============================
function setBusy(busy, action) {
    $$('[data-action="generate"], [data-action="generate-preferred"]').forEach(btn => {
        btn.disabled = busy;
        if (busy && btn.dataset.action === action && !btn.closest('.menu')) {
            btn.dataset.html = btn.innerHTML;
            btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>Generating…</span>`;
        } else if (!busy && btn.dataset.html) {
            btn.innerHTML = btn.dataset.html;
            delete btn.dataset.html;
        }
    });
}

async function runGeneration(endpoint, action, label) {
    setBusy(true, action);
    try {
        scheduleData = await api(endpoint, { method: 'POST' });
        scheduleData.month = calendarInfo.month;
        swapMode = false;
        swapSelection = [];
        const names = new Set(scheduleData.analysis.map(a => a.name));
        filterWorkers = new Set([...filterWorkers].filter(n => names.has(n)));
        renderSchedule();
        renderAnalysis();
        switchTab('schedule');
        const { required, unfilled } = coverage();
        toast(unfilled > 0 ? `${label}, ${unfilled} of ${required} shifts still open` : `${label}, every shift is covered`);
    } catch (err) {
        toast(`Couldn't generate the schedule: ${err.message}`, 'bad');
    } finally {
        setBusy(false, action);
    }
}

function generatePreferredSchedule() {
    return runGeneration('/generate-preferred', 'generate-preferred', 'Draft built from preferences');
}

function generateSchedule() {
    return runGeneration('/generate', 'generate', 'Schedule generated');
}

function clearSchedule() {
    scheduleData = null;
    swapMode = false;
    swapSelection = [];
    filterWorkers.clear();
    renderScheduleVisibility();
    renderSwapUI();
    $('#analysis-total').textContent = '0';
    $('#analysis-fairness').textContent = '–';
    $('#analysis-tbody').innerHTML = '<tr><td colspan="7" class="empty-state">Generate a schedule to see the analysis.</td></tr>';
}

function renderScheduleVisibility() {
    $('#schedule-empty').hidden = !!scheduleData;
    $('#schedule-content').hidden = !scheduleData;
}

function coverage() {
    let required = 0;
    let covered = 0;
    for (const day of Object.values(scheduleData.schedule)) {
        required += day.shifts_needed || 0;
        covered += day.slots.filter(s => s.worker && s.dept !== 'EXTRA').length;
    }
    return { required, covered, unfilled: Math.max(0, required - covered) };
}

// ============================
// Render Schedule Calendar
// ============================
function renderSchedule() {
    renderScheduleVisibility();
    if (!scheduleData) return;

    const data = scheduleData;
    const month = scheduleMonth();
    $('#schedule-title').textContent = `${data.month_name} ${data.year}`;

    const { required, covered, unfilled } = coverage();
    $('#schedule-subtitle-container').innerHTML = `
        <span class="pill">Needed <strong>${required}</strong></span>
        <span class="pill">Covered <strong>${covered}</strong></span>
        <span class="pill ${unfilled === 0 ? 'good' : 'bad'}">${unfilled === 0 ? `${icon('check')} All covered` : `Open <strong>${unfilled}</strong>`}</span>
    `;

    const grid = $('#calendar-grid');
    let html = WEEKDAYS_SHORT.map(d => `<div class="cal-header" aria-hidden="true">${d}</div>`).join('');

    // Python: 0=Mon...6=Sun. Grid starts on Sunday.
    const first = data.schedule['1'];
    const gridOffset = first && first.weekday !== undefined
        ? (first.weekday + 1) % 7
        : weekdayOf(data.year, month, 1);
    for (let i = 0; i < gridOffset; i++) html += '<div class="cal-cell empty" aria-hidden="true"></div>';

    const now = new Date();
    const isThisMonth = now.getFullYear() === data.year && now.getMonth() + 1 === month;

    for (let d = 1; d <= data.days_in_month; d++) {
        const dayData = data.schedule[String(d)];
        const slots = dayData.slots;

        // The generator only returns filled slots; add open ones so short days can be filled in place
        const counted = slots.filter(s => s.dept !== 'EXTRA').length;
        const fallbackTime = slots.length ? slots[slots.length - 1].time : '';
        for (let i = counted; i < dayData.shifts_needed; i++) {
            slots.push({ worker: null, dept: 'DEP', time: fallbackTime, is_preferred: false });
        }

        const timeGroups = {};
        slots.forEach((slot, index) => {
            if (slot.dept === 'EXTRA' && !slot.worker) return;
            (timeGroups[slot.time] ||= []).push({ ...slot, originalIndex: index });
        });

        let hasFilteredWorker = false;
        let slotsHtml = '';
        for (const [time, timeSlots] of Object.entries(timeGroups)) {
            const chips = timeSlots.map(s => {
                let cls = 'normal';
                if (!s.worker) cls = 'empty-slot';
                else if (s.dept === 'EXTRA') cls = 'extra-slot';
                else if (s.dept === 'ER') cls = 'er';
                else if (s.is_preferred) cls = 'preferred';

                if (swapMode) {
                    const isSelected = swapSelection.some(sel => sel.day === String(d) && sel.originalIndex === s.originalIndex);
                    if (swapSelection.length === 1 && !isSelected) {
                        cls += canSwap(swapSelection[0], String(d), s) ? ' swap-candidate' : ' swap-blocked';
                    } else if (swapSelection.length === 0) {
                        cls += ' swap-candidate';
                    }
                    if (isSelected) cls += ' selected-swap';
                }

                if (filterWorkers.size > 0) {
                    if (s.worker && filterWorkers.has(s.worker)) {
                        cls += ' filtered-highlight';
                        hasFilteredWorker = true;
                    } else {
                        cls += ' dimmed';
                    }
                }

                const label = s.worker ? esc(s.worker) : '+ Assign';
                const deptText = s.dept === 'ER' ? ', ER' : s.dept === 'EXTRA' ? ', extra' : '';
                const aria = s.worker
                    ? `${s.worker}${deptText}, day ${d} ${time}${s.is_preferred ? ', preferred day' : ''}`
                    : `Open slot${deptText}, day ${d} ${time}. Assign someone`;

                return `<button class="cal-worker-chip ${cls}" data-action="shift" data-day="${d}" data-idx="${s.originalIndex}" aria-label="${esc(aria)}">${label}${s.dept === 'ER' && s.worker ? '<span class="er-tag">ER</span>' : ''}</button>`;
            }).join('');

            slotsHtml += `
                <div class="cal-slot">
                    <div class="cal-slot-time">${esc(time)}</div>
                    <div class="cal-chips">${chips}</div>
                </div>
            `;
        }

        const active = slots.filter(s => s.worker).length;
        const needed = dayData.shifts_needed;
        const status = active > needed ? 'over' : active < needed ? 'under' : 'perfect';
        dayData.demand_status = status;

        let cellClass = 'cal-cell';
        if (swapMode) cellClass += ' swap-active';
        if (hasFilteredWorker) cellClass += ' day-highlight';
        if (status === 'over') cellClass += ' cell-overbooked';
        else if (status === 'under') cellClass += ' cell-underbooked';
        else cellClass += ' cell-perfect';
        if (isThisMonth && now.getDate() === d) cellClass += ' is-today';

        const wd = WEEKDAYS_SHORT[weekdayOf(data.year, month, d)];
        const statusText = status === 'over' ? 'overbooked' : status === 'under' ? 'short' : 'fully staffed';

        html += `
            <div class="${cellClass}">
                <button class="cal-day-num" data-action="edit-day" data-day="${d}" aria-label="${wd} ${d}: ${active} of ${needed} staffed, ${statusText}. Change staffing" title="Change staffing for day ${d}">
                    <b>${d}</b><span class="cal-weekday">${wd}</span><span class="cal-count">${active}/${needed}</span>
                </button>
                ${slotsHtml}
            </div>
        `;
    }

    grid.innerHTML = html;

    renderShiftTotals();
    renderFairnessSummary();
    renderSwapUI();
}

function canSwap(source, targetDay, targetSlot) {
    const sourceName = scheduleData.schedule[source.day].slots[source.originalIndex].worker;
    const sourceWorker = sourceName ? workersData.find(w => w.name === sourceName) : null;
    const targetWorker = targetSlot.worker ? workersData.find(w => w.name === targetSlot.worker) : null;
    const sourceOk = !sourceWorker || !sourceWorker.cant_work.includes(parseInt(targetDay));
    const targetOk = !targetWorker || !targetWorker.cant_work.includes(parseInt(source.day));
    return sourceOk && targetOk;
}

function renderShiftTotals() {
    const list = $('#shift-totals-list');
    const sorted = [...scheduleData.analysis].sort((a, b) => b.got - a.got || a.name.localeCompare(b.name));

    list.innerHTML = sorted.map(w => {
        const active = filterWorkers.has(w.name);
        const pct = w.target ? Math.min(100, Math.round((w.got / w.target) * 100)) : 100;
        return `
            <button class="shift-total-item ${active ? 'active-filter' : ''}" data-action="filter" data-name="${esc(w.name)}" aria-pressed="${active}" aria-label="${esc(w.name)}: ${w.got} of ${w.target} shifts${w.er ? `, ${w.er} ER` : ''}">
                ${avatar(w.name)}
                <span>
                    <span class="shift-total-name">${esc(w.name)}</span>
                    <span class="shift-total-bar"><i class="${w.got > w.target ? 'over' : ''}" style="width:${pct}%"></i></span>
                </span>
                <span class="shift-total-counts">
                    ${w.er > 0 ? `<span class="shift-total-er">ER ${w.er}</span>` : ''}
                    <span class="shift-total-count">${w.got}</span><span class="shift-total-of">/${w.target}</span>
                </span>
            </button>
        `;
    }).join('');

    $('#clear-filter').hidden = filterWorkers.size === 0;
}

function renderFairnessSummary() {
    const data = scheduleData;
    const targets = data.analysis.map(a => a.target);
    const targetMin = Math.min(...targets);
    const targetMax = Math.max(...targets);
    const rangeOk = (data.fairness_max - data.fairness_min) <= 3;

    $('#fairness-summary').innerHTML = `
        <div class="fairness-row">
            <span class="fairness-label">Targets</span>
            <span class="fairness-value">${targetMin}\u2013${targetMax} shifts</span>
        </div>
        <div class="fairness-row">
            <span class="fairness-label">Actually assigned</span>
            <span class="fairness-value" style="color:${rangeOk ? 'var(--green)' : 'var(--red)'}">${data.fairness_min}\u2013${data.fairness_max} shifts</span>
        </div>
        ${rangeOk
            ? `<div class="note good">${icon('check')} Shifts are spread fairly.</div>`
            : `<div class="note bad">${icon('warn')} Some people got far more shifts than others.</div>`}
    `;
}

// ============================
// Render Analysis
// ============================
function renderAnalysis() {
    if (!scheduleData) return;
    const data = scheduleData;

    $('#analysis-total').textContent = data.total_assigned;
    $('#analysis-fairness').textContent = `${data.fairness_min}\u2013${data.fairness_max}`;

    $('#analysis-tbody').innerHTML = data.analysis.map(w => {
        const matchedSet = new Set(w.matched);
        const requestedHtml = w.requested.length
            ? w.requested.map(d => `<span class="analysis-day ${matchedSet.has(d) ? 'matched' : ''}" title="${matchedSet.has(d) ? 'Granted' : 'Not granted'}">${d}</span>`).join('')
            : '<span class="field-help">None</span>';
        const resultHtml = w.result.map(d => `<span class="analysis-day ${w.requested.includes(d) ? 'matched' : ''}">${d}</span>`).join('');
        const violationsHtml = w.cant_work_violations.length
            ? w.cant_work_violations.map(d => `<span class="analysis-day violation" title="Assigned on a day they can't work">${d}</span>`).join('')
            : `<span class="ok-text">${icon('check')} None</span>`;
        const gotCls = w.got < w.target ? 'short' : w.got > w.target ? 'over' : 'ok';

        return `
            <tr>
                <td class="analysis-name">${avatar(w.name)}${esc(w.name)}</td>
                <td class="analysis-shifts"><span class="got ${gotCls}">${w.got}</span><span class="separator">/</span><span>${w.target}</span></td>
                <td>${w.er}</td>
                <td>
                    <div class="pref-bar-container">
                        <div class="pref-bar"><div class="pref-bar-fill" style="width:${Math.max(w.preference_match, 4)}%"></div></div>
                        <span class="pref-percent">${w.preference_match}%</span>
                    </div>
                </td>
                <td><div class="analysis-days">${requestedHtml}</div></td>
                <td><div class="analysis-days">${resultHtml}</div></td>
                <td><div class="analysis-days">${violationsHtml}</div></td>
            </tr>
        `;
    }).join('');
}

// ============================
// Interactive Features
// ============================
function toggleFilter(name) {
    if (filterWorkers.has(name)) filterWorkers.delete(name);
    else filterWorkers.add(name);
    renderSchedule();
}

function toggleSwapMode() {
    if (!scheduleData) return;
    swapMode = !swapMode;
    swapSelection = [];
    renderSchedule();
}

function renderSwapUI() {
    const btn = $('#btn-swap-mode');
    btn.setAttribute('aria-pressed', String(swapMode));
    btn.querySelector('span').textContent = swapMode ? 'Swapping…' : 'Swap Shifts';
    $('#swap-banner').hidden = !swapMode;
    $('#swap-banner-text').textContent = swapSelection.length === 0
        ? 'Pick the first shift to swap.'
        : "Now pick the shift to trade with. Faded names can't work that day.";
}

function handleShiftClick(day, slotIndex) {
    if (!swapMode) return openReplaceModal(day, slotIndex);

    const existingIdx = swapSelection.findIndex(s => s.day === day && s.originalIndex === slotIndex);
    if (existingIdx >= 0) {
        swapSelection.splice(existingIdx, 1);
    } else {
        if (swapSelection.length >= 2) swapSelection.shift();
        swapSelection.push({ day, originalIndex: slotIndex });
    }
    renderSchedule();
    if (swapSelection.length === 2) setTimeout(executeSwap, 120);
}

async function executeSwap() {
    if (swapSelection.length !== 2) return;
    const [sel1, sel2] = swapSelection;
    const slot1 = scheduleData.schedule[sel1.day].slots[sel1.originalIndex];
    const slot2 = scheduleData.schedule[sel2.day].slots[sel2.originalIndex];
    const worker1Name = slot1.worker;
    const worker2Name = slot2.worker;

    if (!worker1Name && !worker2Name) {
        swapSelection = [];
        renderSchedule();
        return;
    }

    const day1Int = parseInt(sel1.day);
    const day2Int = parseInt(sel2.day);
    const worker1 = worker1Name ? workersData.find(w => w.name === worker1Name) : null;
    const worker2 = worker2Name ? workersData.find(w => w.name === worker2Name) : null;

    const warnings = [];
    if (worker1 && worker1.cant_work.includes(day2Int)) warnings.push(`${worker1Name} can't work on day ${day2Int}.`);
    if (worker2 && worker2.cant_work.includes(day1Int)) warnings.push(`${worker2Name} can't work on day ${day1Int}.`);

    if (warnings.length) {
        const ok = await confirmDialog({ title: 'Swap anyway?', message: warnings.join('\n'), ok: 'Swap' });
        if (!ok) {
            swapSelection = [];
            renderSchedule();
            return;
        }
    }

    slot1.worker = worker2Name || null;
    slot2.worker = worker1Name || null;
    slot1.is_preferred = slot1.worker ? !!workersData.find(w => w.name === slot1.worker)?.can_work.includes(day1Int) : false;
    slot2.is_preferred = slot2.worker ? !!workersData.find(w => w.name === slot2.worker)?.can_work.includes(day2Int) : false;

    swapSelection = [];
    await analyzeSchedule();
    renderSchedule();
    toast(`Swapped day ${day1Int} and day ${day2Int}`);
}

// --- Replace ---
function openReplaceModal(day, slotIndex) {
    currentEditSlot = { day, slotIndex };
    const slot = scheduleData.schedule[day].slots[slotIndex];
    const wd = WEEKDAYS_SHORT[weekdayOf(scheduleData.year, scheduleMonth(), parseInt(day))];
    const dept = slot.dept === 'ER' ? 'ER' : slot.dept === 'EXTRA' ? 'Extra' : 'Regular';
    $('#replace-title').textContent = `${wd} ${day} · ${slot.time}`;
    $('#replace-sub').textContent = slot.worker
        ? `${dept} shift, currently ${slot.worker}. Pick who should take it.`
        : `Open ${dept.toLowerCase()} shift. Pick who should take it.`;
    $('#replace-search').value = '';
    renderReplaceList();
    openSheet('replace-modal-overlay', '#replace-search');
}

function renderReplaceList() {
    if (!currentEditSlot) return;
    const { day, slotIndex } = currentEditSlot;
    const dayInt = parseInt(day);
    const currentWorkerName = scheduleData.schedule[day].slots[slotIndex].worker;
    const activeOnDay = scheduleData.schedule[day].slots.map(s => s.worker).filter(Boolean);
    const q = $('#replace-search').value.trim().toLowerCase();

    const statsMap = {};
    scheduleData.analysis.forEach(s => { statsMap[s.name] = s; });

    const candidates = workersData
        .filter(w => w.name !== currentWorkerName && !activeOnDay.includes(w.name))
        .filter(w => !q || w.name.toLowerCase().includes(q))
        .sort((a, b) => {
            const aCant = a.cant_work.includes(dayInt);
            const bCant = b.cant_work.includes(dayInt);
            if (aCant !== bCant) return aCant ? 1 : -1;
            const aPref = a.can_work.includes(dayInt);
            const bPref = b.can_work.includes(dayInt);
            if (aPref !== bPref) return aPref ? -1 : 1;
            const aNeed = (statsMap[a.name]?.target ?? a.limit) - (statsMap[a.name]?.got ?? 0);
            const bNeed = (statsMap[b.name]?.target ?? b.limit) - (statsMap[b.name]?.got ?? 0);
            return bNeed - aNeed;
        });

    const removeHtml = currentWorkerName && !q ? `
        <button class="select-item remove" data-action="replace" data-name="">
            <span class="avatar" aria-hidden="true">${icon('close')}</span>
            <span><span class="select-name">Remove ${esc(currentWorkerName)}</span><span class="select-meta">Leave this slot open</span></span>
            <span class="select-cta" style="color:var(--red)">Remove</span>
        </button>` : '';

    const rows = candidates.map(w => {
        const isPref = w.can_work.includes(dayInt);
        const isCant = w.cant_work.includes(dayInt);
        const stat = statsMap[w.name] || { got: 0, er: 0, target: w.limit };
        const remaining = stat.target - stat.got;
        const need = remaining > 0 ? `needs ${remaining} more` : remaining === 0 ? 'at target' : `${-remaining} over target`;
        return `
            <button class="select-item ${isCant ? 'is-cant' : ''}" data-action="replace" data-name="${esc(w.name)}">
                ${avatar(w.name)}
                <span>
                    <span class="select-name">${esc(w.name)}
                        ${isPref ? '<span class="tag tag-pref">Prefers this day</span>' : ''}
                        ${isCant ? '<span class="tag tag-cant">Can\'t work</span>' : ''}
                    </span>
                    <span class="select-meta">${stat.got}/${stat.target} shifts · ${need}${stat.er ? ` · ${stat.er} ER` : ''}</span>
                </span>
                <span class="select-cta">Assign</span>
            </button>
        `;
    }).join('');

    $('#replace-list').innerHTML = removeHtml + (rows || `<p class="empty-inline">${q ? 'No one matches.' : 'Everyone is already working this day.'}</p>`);
}

async function replaceWorker(newWorkerName) {
    if (!currentEditSlot) return;
    const { day, slotIndex } = currentEditSlot;
    const slot = scheduleData.schedule[day].slots[slotIndex];
    const dayInt = parseInt(day);
    const worker = newWorkerName ? workersData.find(w => w.name === newWorkerName) : null;

    if (worker && worker.cant_work.includes(dayInt)) {
        const ok = await confirmDialog({
            title: `Assign ${newWorkerName}?`,
            message: `${newWorkerName} marked day ${dayInt} as a day they can't work.`,
            ok: 'Assign',
        });
        if (!ok) return;
    }

    slot.worker = newWorkerName || null;
    slot.is_preferred = worker ? worker.can_work.includes(dayInt) : false;

    closeSheet('replace-modal-overlay');
    await analyzeSchedule();
    renderSchedule();
    toast(newWorkerName ? `${newWorkerName} assigned to day ${dayInt}` : `Day ${dayInt} slot cleared`);
}

async function analyzeSchedule() {
    try {
        const stats = await api('/analyze', {
            method: 'POST',
            body: JSON.stringify({ schedule: scheduleData.schedule }),
        });
        Object.assign(scheduleData, {
            analysis: stats.analysis,
            total_assigned: stats.total_assigned,
            total_required: stats.total_required,
            total_covered: stats.total_covered,
            total_remaining: stats.total_remaining,
            total_er: stats.total_er,
            fairness_min: stats.fairness_min,
            fairness_max: stats.fairness_max,
        });
        renderAnalysis();
    } catch (err) {
        console.error('Failed to analyze schedule:', err);
        toast("Couldn't refresh the stats.", 'bad');
    }
}

// --- Day requirements ---
function openEditDayModal(day) {
    currentEditDay = day;
    const wd = WEEKDAYS_SHORT[weekdayOf(scheduleData.year, scheduleMonth(), parseInt(day))];
    $('#edit-day-modal-title').textContent = `${wd} ${day} Staffing`;
    const slots = scheduleData.schedule[String(day)].slots;
    $('#modal-day-dep').value = slots.filter(s => s.dept === 'DEP').length;
    $('#modal-day-er').value = slots.filter(s => s.dept === 'ER').length;
    openSheet('edit-day-modal-overlay', '#modal-day-dep');
}

function closeEditDayModal() {
    closeSheet('edit-day-modal-overlay');
}

async function saveDayRequirements() {
    if (!currentEditDay) return;
    const dep = Math.max(0, parseInt($('#modal-day-dep').value) || 0);
    const er = Math.max(0, parseInt($('#modal-day-er').value) || 0);
    await api(`/custom-shifts/${currentEditDay}`, { method: 'PUT', body: JSON.stringify({ DEP: dep, ER: er }) });
    closeEditDayModal();
    await generatePreferredSchedule();
}

async function resetDayToDefault() {
    if (!currentEditDay) return;
    await api(`/custom-shifts/${currentEditDay}`, { method: 'DELETE' });
    closeEditDayModal();
    await generatePreferredSchedule();
}

// --- Import/Export ---
function exportSchedule() {
    if (!scheduleData || !scheduleData.schedule) {
        toast('Generate a schedule before exporting.', 'bad');
        return;
    }
    const exportData = {
        month: scheduleMonth(),
        year: scheduleData.year || calendarInfo.year,
        schedule: scheduleData.schedule,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule_${exportData.year}_${exportData.month}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Schedule exported');
}

function importSchedule(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!importedData.schedule) {
                toast("That file doesn't contain a schedule.", 'bad');
                return;
            }
            scheduleData = importedData;
            if (scheduleData.month && scheduleData.year) {
                await api('/calendar-info', {
                    method: 'PUT',
                    body: JSON.stringify({ month: scheduleData.month, year: scheduleData.year }),
                });
                await loadSetupTab();
                const monthDate = new Date(scheduleData.year, scheduleData.month - 1);
                scheduleData.month_name = monthDate.toLocaleString('en', { month: 'long' });
                scheduleData.days_in_month = new Date(scheduleData.year, scheduleData.month, 0).getDate();
            }
            await analyzeSchedule();
            swapMode = false;
            swapSelection = [];
            renderSchedule();
            switchTab('schedule');
            toast(`Imported ${scheduleData.month_name || ''} ${scheduleData.year || ''} schedule`.replace(/\s+/g, ' '));
        } catch (err) {
            console.error(err);
            toast(`Couldn't read that file: ${err.message}`, 'bad');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}
