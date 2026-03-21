/**
 * ShiftMaster AI - Frontend Logic
 * Handles tab switching, API calls, and DOM rendering.
 */

// ============================
// State
// ============================
let currentTab = 'setup';
let calendarInfo = null;
let workersData = [];
let scheduleData = null;
let editingWorker = null; // null = adding new, string = editing existing name
let swapMode = false;
let swapSelection = []; // [{day, slotIndex}]
let filterWorkers = new Set(); // Set of strings (names)

// ============================
// Initialization
// ============================
document.addEventListener('DOMContentLoaded', () => {
    loadSetupTab();
});

async function loadSetupTab() {
    await Promise.all([
        loadCalendarInfo(),
        loadWorkers(),
        loadWarnings(),
    ]);
}

// ============================
// Tab Switching
// ============================
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tab}`);
    });
}

// ============================
// API Helpers
// ============================
async function api(endpoint, options = {}) {
    const res = await fetch(`/api${endpoint}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    return res.json();
}

// ============================
// Calendar Info
// ============================
async function loadCalendarInfo() {
    calendarInfo = await api('/calendar-info');
    document.getElementById('month-select').value = calendarInfo.month;
    document.getElementById('year-input').value = calendarInfo.year;
    // Team Size icon: \uD83D\uDC65
    document.getElementById('team-size').textContent = `\uD83D\uDC65 ${calendarInfo.team_size}`;
    document.getElementById('total-shifts').textContent = calendarInfo.total_shifts;
    document.getElementById('total-asked').textContent = calendarInfo.total_asked;

    const balance = calendarInfo.total_asked - calendarInfo.total_shifts;
    const balanceEl = document.getElementById('shift-balance');
    balanceEl.textContent = balance >= 0 ? `+${balance}` : balance;
    balanceEl.style.color = balance >= 0 ? 'var(--green)' : 'var(--red)';

    // Add event listeners to save changes
    document.getElementById('month-select').addEventListener('change', async (e) => {
        await api('/calendar-info', {
            method: 'PUT',
            body: JSON.stringify({ month: parseInt(e.target.value) }),
        });
        await loadSetupTab(); // Reload to update stats
    });

    document.getElementById('year-input').addEventListener('change', async (e) => {
        await api('/calendar-info', {
            method: 'PUT',
            body: JSON.stringify({ year: parseInt(e.target.value) }),
        });
        await loadSetupTab(); // Reload to update stats
    });
}

// ============================
// Workers
// ============================
async function loadWorkers() {
    workersData = await api('/workers');
    renderWorkers();

    // Update rules badge
    const totalRules = workersData.reduce((sum, w) =>
        sum + w.cant_work.length + w.can_work.length, 0);
    document.getElementById('rules-badge').textContent = `${totalRules} custom rules set`;
}

function renderWorkers() {
    const grid = document.getElementById('workers-grid');
    grid.innerHTML = workersData.map(w => {
        const cantWorkChips = renderDayChips(w.cant_work, 'cant-work', 8);
        const canWorkChips = renderDayChips(w.can_work, 'can-work', 8);
        const targetLabel = w.limit_raw === null
            ? `<span class="worker-target auto">TARGET: AUTO</span>`
            : `<span class="worker-target">TARGET: ${w.limit}</span>`;

        // Calendar icon: \uD83D\uDCC5
        // Edit icon: \u270F\uFE0F
        // Delete icon: \uD83D\uDDD1\uFE0F
        return `
            <div class="worker-card">
                <div class="worker-header">
                    <span class="worker-name">${w.name}</span>
                    <div style="display:flex;align-items:center;gap:6px;">
                        ${targetLabel}
                        <div class="worker-actions">
                            <button onclick="editWorker('${w.name}')" title="Edit">\u270F\uFE0F</button>
                            <button class="delete" onclick="deleteWorker('${w.name}')" title="Delete">\uD83D\uDDD1\uFE0F</button>
                        </div>
                    </div>
                </div>
                <div class="worker-meta">\uD83D\uDCC5 ${w.rest_days_count} days off</div>
                ${w.cant_work.length > 0 ? `
                    <div class="days-section-label">Can't Work</div>
                    <div class="worker-days">${cantWorkChips}</div>
                ` : ''}
                ${w.can_work.length > 0 ? `
                    <div class="days-section-label">Preferred</div>
                    <div class="worker-days">${canWorkChips}</div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function renderDayChips(days, cssClass, maxShow) {
    if (days.length === 0) return '';
    const shown = days.slice(0, maxShow);
    const overflow = days.length - maxShow;
    let html = shown.map(d => `<span class="day-chip ${cssClass}">${d}</span>`).join('');
    if (overflow > 0) {
        html += `<span class="day-chip overflow">+${overflow}</span>`;
    }
    return html;
}

// ============================
// Warnings
// ============================
async function loadWarnings() {
    const warnings = await api('/warnings');
    const container = document.getElementById('alerts-container');

    // Check mark: \u2705
    if (warnings.length === 0) {
        container.innerHTML = '<p class="no-alerts no-alerts-ok">\u2705 All checks passed. No scheduling issues detected.</p>';
        return;
    }

    container.innerHTML = warnings.map(w => `
        <div class="alert-card ${w.type}">
            <span class="alert-day">Day ${w.day || '\u2014'}</span>
            <span class="alert-label">${w.label || w.type.toUpperCase()}</span>
            <div class="alert-message">${w.message}</div>
            ${w.workers ? `<div class="alert-workers">${w.workers.join(', ')}</div>` : ''}
        </div>
    `).join('');
}

// ============================
// Worker CRUD
// ============================
function showAddWorkerModal() {
    const nameInput = document.getElementById('new-worker-name');
    editingWorker = null;
    document.getElementById('modal-title').textContent = 'Add Worker';
    document.getElementById('modal-name').value = nameInput.value || '';
    document.getElementById('modal-limit').value = '';
    document.getElementById('modal-cant-work').value = '';
    document.getElementById('modal-can-work').value = '';
    document.getElementById('modal-overlay').style.display = 'flex';
    nameInput.value = '';
}

function editWorker(name) {
    const worker = workersData.find(w => w.name === name);
    if (!worker) return;

    editingWorker = name;
    document.getElementById('modal-title').textContent = `Edit ${name}`;
    document.getElementById('modal-name').value = worker.name;
    document.getElementById('modal-limit').value = worker.limit_raw !== null ? worker.limit_raw : '';
    document.getElementById('modal-cant-work').value = worker.cant_work.join(', ');
    document.getElementById('modal-can-work').value = worker.can_work.join(', ');
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    editingWorker = null;
}

function parseDays(str) {
    if (!str.trim()) return [];
    return str.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
}

async function saveWorker() {
    const name = document.getElementById('modal-name').value.trim();
    if (!name) return alert('Name is required');

    const limitVal = document.getElementById('modal-limit').value.trim();
    const limit = limitVal === '' ? null : parseInt(limitVal);
    const cant_work = parseDays(document.getElementById('modal-cant-work').value);
    const can_work = parseDays(document.getElementById('modal-can-work').value);

    const body = { name, limit, cant_work, can_work };

    if (editingWorker) {
        await api(`/workers/${encodeURIComponent(editingWorker)}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        });
    } else {
        await api('/workers', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }

    closeModal();
    await loadSetupTab();
}

async function deleteWorker(name) {
    if (!confirm(`Delete ${name}?`)) return;
    await api(`/workers/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await loadSetupTab();
}

function resetForm() {
    if (!confirm('Reload data from workers.json?')) return;
    loadSetupTab();
    scheduleData = null;
    switchTab('setup');
}

// ============================
// Generate Schedule
// ============================
async function generatePreferredSchedule() {
    const btn = document.querySelector('.btn-preferred');
    const origText = btn.textContent;
    btn.innerHTML = '<span class="loading-spinner"></span> Generating...';
    btn.disabled = true;

    try {
        scheduleData = await api('/generate-preferred', { method: 'POST' });
        renderSchedule();
        renderAnalysis();
        switchTab('schedule');
    } catch (err) {
        alert('Error generating schedule: ' + err.message);
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
}

async function generateSchedule() {
    const btn = document.querySelector('.btn-generate');
    const origText = btn.textContent;
    btn.innerHTML = '<span class="loading-spinner"></span> Generating...';
    btn.disabled = true;

    try {
        scheduleData = await api('/generate', { method: 'POST' });
        renderSchedule();
        renderAnalysis();
        switchTab('schedule');
    } catch (err) {
        alert('Error generating schedule: ' + err.message);
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
}

// ============================
// Render Schedule Calendar
// ============================
function renderSchedule() {
    if (!scheduleData) return;

    const data = scheduleData;
    document.getElementById('schedule-title').textContent = `${data.month_name} ${data.year} Schedule`;
    
    // Update Header Badges
    const subtitleContainer = document.getElementById('schedule-subtitle-container');
    if (subtitleContainer && data.total_required !== undefined) {
        subtitleContainer.innerHTML = `
            <span class="stat-badge">Target: <strong>${data.total_required}</strong></span>
            <span class="stat-badge">Covered: <strong>${data.total_covered}</strong></span>
            <span class="stat-badge" style="color: ${data.total_remaining === 0 ? 'var(--green)' : 'var(--red)'}">Unfilled: <strong>${data.total_remaining}</strong></span>
        `;
    } else {
        const legacySub = document.getElementById('schedule-subtitle');
        if (legacySub) legacySub.textContent = `Total Shifts: ${data.total_assigned}`;
    }

    const grid = document.getElementById('calendar-grid');

    // Header row: SUN MON TUE WED THU FRI SAT
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    let html = dayNames.map(d => `<div class="cal-header">${d}</div>`).join('');

    // Figure out which weekday the 1st falls on
    // Python: 0=Mon...6=Sun. We want Sun=0...Sat=6 for the grid.
    const firstDay = data.schedule['1'].weekday;
    // Convert Python weekday (0=Mon) to grid position (0=Sun)
    const gridOffset = (firstDay + 1) % 7;

    // Add empty cells before day 1
    for (let i = 0; i < gridOffset; i++) {
        html += '<div class="cal-cell empty"></div>';
    }

    // Add day cells
    for (let d = 1; d <= data.days_in_month; d++) {
        const dayData = data.schedule[String(d)];
        const slots = dayData.slots;
        const hasER = slots.some(s => s.dept === 'ER');

        // Group slots by time for layout, but we need flat index for interaction
        // So we'll map original slots to HTML and keep track of indices

        // Helper to find slot index in the original dayData.slots array
        // We need to render them in time groups but keep the click handler pointing to the correct data source

        // Group by time
        const timeGroups = {};
        slots.forEach((slot, index) => {
            if (slot.dept === 'EXTRA' && !slot.worker) return; // Hide empty EXTRA slots
            if (!timeGroups[slot.time]) timeGroups[slot.time] = [];
            timeGroups[slot.time].push({ ...slot, originalIndex: index });
        });

        let hasFilteredWorker = false;
        let slotsHtml = '';
        for (const [time, timeSlots] of Object.entries(timeGroups)) {
            const chips = timeSlots.map(s => {
                let cls = 'normal';
                let label = s.worker;
                if (!s.worker) {
                    cls = 'empty-slot';
                    label = `+ Add`;
                } else if (s.dept === 'EXTRA') {
                    cls = 'extra-slot';
                } else if (s.dept === 'ER') {
                    cls = 'er';
                } else if (s.is_preferred) {
                    cls = 'preferred';
                }

                // Swap Mode Logic
                let isSelected = false;
                let isValidSwapTarget = true;

                if (swapMode) {
                    isSelected = swapSelection.some(sel => sel.day === String(d) && sel.originalIndex === s.originalIndex);

                    if (swapSelection.length === 1) {
                        // We have one selected. Check if THIS slot is a valid target for the selected one.
                        const source = swapSelection[0];
                        // Don't dim the source itself
                        if (!(source.day === String(d) && source.originalIndex === s.originalIndex)) {
                            const sourceWorkerName = scheduleData.schedule[source.day].slots[source.originalIndex].worker;
                            const targetWorkerName = s.worker;

                            const sourceWorker = sourceWorkerName ? workersData.find(w => w.name === sourceWorkerName) : null;
                            const targetWorker = targetWorkerName ? workersData.find(w => w.name === targetWorkerName) : null;

                            const sourceDayInt = parseInt(source.day);
                            const targetDayInt = parseInt(d);

                            // Check mutual availability
                            let sourceOk = true;
                            if (sourceWorker) sourceOk = !sourceWorker.cant_work.includes(targetDayInt);
                            
                            let targetOk = true;
                            if (targetWorker) targetOk = !targetWorker.cant_work.includes(sourceDayInt);

                            if (!sourceOk || !targetOk) {
                                isValidSwapTarget = false;
                                cls += ' swap-blocked';
                            } else {
                                cls += ' swap-candidate';
                            }
                        }
                    } else if (swapSelection.length === 0) {
                        // No one selected yet, everyone is a candidate
                        cls += ' swap-candidate';
                    }

                    if (isSelected) cls += ' selected-swap';
                }

                // Interaction classes
                if (filterWorkers.size > 0) {
                    if (!filterWorkers.has(s.worker)) {
                        cls += ' dimmed';
                    } else {
                        cls += ' filtered-highlight';
                        hasFilteredWorker = true;
                    }
                }

                // Add click handler
                // If it's a blocked swap target, we can still allow clicking to show the warning (or prevent it).
                // User asked to "show only the persons that can be shifted". 
                // So maybe we shouldn't allow clicking invalid ones, or at least visually dim them hard.

                return `<span class="cal-worker-chip ${cls}" 
                              onclick="handleShiftClick('${d}', ${s.originalIndex})">
                            ${label}${s.dept === 'ER' ? ' (ER)' : ''}
                        </span>`;
            }).join('');

            slotsHtml += `
                <div class="cal-slot">
                    <div class="cal-slot-time">${time}</div>
                    ${chips}
                </div>
            `;
        }

        let cellClass = 'cal-cell';
        if (swapMode) cellClass += ' swap-active';
        if (hasFilteredWorker) cellClass += ' day-highlight';
        
        // Dynamically calculate demand status based on current valid assignments
        const activeWorkersCount = slots.filter(s => s.worker).length;
        const needed = dayData.shifts_needed;
        
        let dynamic_status = 'perfect';
        if (activeWorkersCount > needed) {
            dynamic_status = 'over';
        } else if (activeWorkersCount < needed) {
            dynamic_status = 'under';
        }
        
        // Update dayData so modifications are tracked locally
        dayData.demand_status = dynamic_status;
        
        if (dynamic_status === 'over') {
            cellClass += ' cell-overbooked';
        } else if (dynamic_status === 'under') {
            cellClass += ' cell-underbooked';
        } else if (dynamic_status === 'perfect') {
            cellClass += ' cell-perfect';
        }

        html += `
            <div class="${cellClass}">
                <div class="cal-day-num ${hasER ? 'has-er' : ''}" onclick="openEditDayModal('${d}')" title="Edit requirements for this day">${d} <span class="edit-day-icon">✏️</span></div>
                ${slotsHtml}
            </div>
        `;
    }

    grid.innerHTML = html;

    // Render sidebar
    renderShiftTotals();
    renderFairnessSummary();
}

function renderShiftTotals() {
    const list = document.getElementById('shift-totals-list');
    const data = scheduleData;

    // Sort by total shifts descending
    const sorted = [...data.analysis].sort((a, b) => b.got - a.got);

    list.innerHTML = sorted.map(w => {
        const erBadge = w.er > 0 ? `<span class="shift-total-er">ER: ${w.er}</span>` : '';
        const isActive = filterWorkers.has(w.name);

        return `
            <div class="shift-total-item ${isActive ? 'active-filter' : ''}" onclick="toggleFilter('${w.name}')">
                <span class="shift-total-name">${w.name}</span>
                <div class="shift-total-counts">
                    ${erBadge}
                    <span class="shift-total-count">${w.got}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderFairnessSummary() {
    const container = document.getElementById('fairness-summary');
    const data = scheduleData;

    // Calculate target range
    const targets = data.analysis.map(a => a.target);
    const targetMin = Math.min(...targets);
    const targetMax = Math.max(...targets);

    const rangeOk = (data.fairness_max - data.fairness_min) <= 3;

    // Check mark: \u2705
    // Warning: \u26A0\uFE0F
    // En-dash: \u2013

    container.innerHTML = `
        <div class="fairness-row">
            <span class="fairness-label">Target Range</span>
            <span class="fairness-value">${targetMin} \u2013 ${targetMax}</span>
        </div>
        <div class="fairness-row">
            <span class="fairness-label">Actual Range</span>
            <span class="fairness-value" style="color: ${rangeOk ? 'var(--green)' : 'var(--red)'}">${data.fairness_min} \u2013 ${data.fairness_max}</span>
        </div>
        ${rangeOk
            ? '<div class="fairness-ok">\u2705 Fair distribution achieved.</div>'
            : '<div class="fairness-warning">\u26A0\uFE0F Outside ideal average.</div>'
        }
    `;
}

// ============================
// Render Analysis
// ============================
function renderAnalysis() {
    if (!scheduleData) return;
    const data = scheduleData;

    document.getElementById('analysis-total').textContent = data.total_assigned;
    document.getElementById('analysis-fairness').textContent = `${data.fairness_min} \u2013 ${data.fairness_max}`;

    const tbody = document.getElementById('analysis-tbody');

    tbody.innerHTML = data.analysis.map(w => {
        const matchedSet = new Set(w.matched);
        const resultSet = new Set(w.result);

        // Requested days column
        const requestedHtml = w.requested.map(d => {
            const isMatched = matchedSet.has(d);
            return `<span class="analysis-day ${isMatched ? 'matched' : 'requested'}">${d}</span>`;
        }).join('');

        // Result days column
        const resultHtml = w.result.map(d => {
            const isRequested = w.requested.includes(d);
            return `<span class="analysis-day ${isRequested ? 'matched check' : 'requested'}">${d}</span>`;
        }).join('');

        // Preference bar
        const barWidth = Math.max(w.preference_match, 5);

        // Violations column
        // Warning: \u26A0\uFE0F, Check: \u2713
        const violationsHtml = w.cant_work_violations.length > 0
            ? w.cant_work_violations.map(d => `<span class="analysis-day violation">\u26A0\uFE0F ${d}</span>`).join('')
            : '<span style="color: var(--green)">\u2713 None</span>';

        return `
            <tr>
                <td class="analysis-name">${w.name}</td>
                <td class="analysis-shifts">
                    <span class="got">${w.got}</span>
                    <span class="separator">/</span>
                    <span>${w.target}</span>
                </td>
                <td>${w.er}</td>
                <td>
                    <div class="pref-bar-container">
                        <div class="pref-bar"><div class="pref-bar-fill" style="width:${barWidth}%"></div></div>
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

// --- Filter ---
function toggleFilter(name) {
    if (filterWorkers.has(name)) {
        filterWorkers.delete(name);
    } else {
        filterWorkers.add(name);
    }
    renderSchedule(); // Re-render to apply dimmed classes
    renderShiftTotals(); // Re-render to show active state in sidebar
}

// --- Swap Logic ---
function toggleSwapMode() {
    swapMode = !swapMode;
    swapSelection = [];
    document.getElementById('btn-swap-mode').classList.toggle('active', swapMode);
    renderSchedule();
}

function handleShiftClick(day, slotIndex) {
    try {
        if (window && window.event) window.event.stopPropagation();
    } catch(e) {}

    if (swapMode) {
        // Toggle selection
        const existingIdx = swapSelection.findIndex(s => s.day === day && s.originalIndex === slotIndex);

        if (existingIdx >= 0) {
            // Deselect
            swapSelection.splice(existingIdx, 1);
        } else {
            // Select
            if (swapSelection.length >= 2) {
                // Remove first if already have 2 (shouldn't happen often if we auto-swap)
                swapSelection.shift();
            }
            swapSelection.push({ day, originalIndex: slotIndex });
        }

        renderSchedule();

        if (swapSelection.length === 2) {
            // Execution swap with small delay to let render update selected state
            setTimeout(() => executeSwap(), 100);
        }
    } else {
        // Edit Mode: Open replace modal
        openReplaceModal(day, slotIndex);
    }
}

async function executeSwap() {
    if (swapSelection.length !== 2) return;

    const [sel1, sel2] = swapSelection;
    const day1 = sel1.day;
    const idx1 = sel1.originalIndex;
    const day2 = sel2.day;
    const idx2 = sel2.originalIndex;

    // Get workers
    const worker1Name = scheduleData.schedule[day1].slots[idx1].worker;
    const worker2Name = scheduleData.schedule[day2].slots[idx2].worker;
    
    if (!worker1Name && !worker2Name) {
        swapSelection = [];
        renderSchedule();
        return;
    }

    // Validation: Check if workers can work on new dates
    const worker1 = worker1Name ? workersData.find(w => w.name === worker1Name) : null;
    const worker2 = worker2Name ? workersData.find(w => w.name === worker2Name) : null;

    const day1Int = parseInt(day1);
    const day2Int = parseInt(day2);

    const warnings = [];
    if (worker1 && worker1.cant_work.includes(day2Int)) {
        warnings.push(`${worker1Name} cannot work on day ${day2Int}`);
    }
    if (worker2 && worker2.cant_work.includes(day1Int)) {
        warnings.push(`${worker2Name} cannot work on day ${day1Int}`);
    }

    if (warnings.length > 0) {
        if (!confirm(`Warning:\n${warnings.join('\n')}\n\nProceed with swap?`)) {
            swapSelection = [];
            renderSchedule();
            return;
        }
    }

    // Execute Swap in local data
    const slot1 = scheduleData.schedule[day1].slots[idx1];
    const slot2 = scheduleData.schedule[day2].slots[idx2];

    // Swap names
    const tempWorker = slot1.worker;
    slot1.worker = slot2.worker || null;
    slot2.worker = tempWorker || null;
    
    // Also update `is_preferred` based on swapped worker
    if (slot1.worker) {
        const w = workersData.find(w => w.name === slot1.worker);
        slot1.is_preferred = w ? w.can_work.includes(day1Int) : false;
    } else {
        slot1.is_preferred = false;
    }
    
    if (slot2.worker) {
        const w = workersData.find(w => w.name === slot2.worker);
        slot2.is_preferred = w ? w.can_work.includes(day2Int) : false;
    } else {
        slot2.is_preferred = false;
    }

    // Reset selection & Recalculate stats
    swapSelection = [];
    await analyzeSchedule();
    renderSchedule();
}

// --- Edit (Replace) Logic ---
let currentEditSlot = null; // { day, slotIndex }

function openReplaceModal(day, slotIndex) {
    currentEditSlot = { day, slotIndex };
    const currentWorkerName = scheduleData.schedule[day].slots[slotIndex].worker;
    const dayInt = parseInt(day);

    // Filter available workers
    // 1. Not currently working this day (unless it's the person themselves)
    const activeWorkersOnDay = scheduleData.schedule[day].slots.map(s => s.worker).filter(Boolean);

    const candidates = workersData.filter(w => {
        if (currentWorkerName && w.name === currentWorkerName) return false; // Don't show current
        if (activeWorkersOnDay.includes(w.name)) return false; // Already working
        return true;
    });

    // Sort by:
    // 1. Can work (preferred)
    // 2. Least assigned (furthest from limit)
    const currentStats = scheduleData.analysis;
    const statsMap = {};
    currentStats.forEach(s => statsMap[s.name] = s);

    candidates.sort((a, b) => {
        // Priority 1: Available (not cant_work)
        const aCant = a.cant_work.includes(dayInt);
        const bCant = b.cant_work.includes(dayInt);
        if (aCant !== bCant) return aCant ? 1 : -1; // cant_work goes last

        // Priority 2: Preferred (can_work)
        const aPref = a.can_work.includes(dayInt);
        const bPref = b.can_work.includes(dayInt);
        if (aPref !== bPref) return aPref ? -1 : 1; // preferred goes first

        // Priority 3: Shifts needed (Target - Got)
        const aStat = statsMap[a.name] || { limit: a.limit, got: 0 };
        const bStat = statsMap[b.name] || { limit: b.limit, got: 0 };
        const aNeed = (aStat.limit || a.limit) - aStat.got;
        const bNeed = (bStat.limit || b.limit) - bStat.got;
        return bNeed - aNeed; // Higher need first
    });

    // Render list
    const list = document.getElementById('replace-list');
    
    let removeHtml = '';
    if (currentWorkerName) {
        removeHtml = `
            <div class="worker-select-item remove-item" style="border-left: 3px solid var(--red); background: var(--bg-input);">
                <div class="worker-select-info">
                    <span class="worker-select-name" style="color:var(--red)">Remove Assignment</span>
                    <div class="worker-select-meta">Leave this slot empty</div>
                </div>
                <button class="btn-select" style="border-color:var(--red); color:var(--red)" onclick="replaceWorker('')">Remove</button>
            </div>
        `;
    }

    list.innerHTML = removeHtml + candidates.map(w => {
        const isPref = w.can_work.includes(dayInt);
        const isCant = w.cant_work.includes(dayInt);
        const stat = statsMap[w.name] || { got: 0, er: 0 };

        let statusHtml = '';
        if (isPref) statusHtml = '<span style="color:var(--green)">Preferred</span>';
        if (isCant) statusHtml = '<span style="color:var(--red)">Can\'t Work</span>';

        return `
            <div class="worker-select-item">
                <div class="worker-select-info">
                    <span class="worker-select-name">${w.name} ${statusHtml}</span>
                    <div class="worker-select-meta">
                        <span>${stat.got}/${w.limit} shifts</span>
                        <span>${stat.er} ER</span>
                    </div>
                </div>
                <button class="btn-select" onclick="replaceWorker('${w.name}')">Select</button>
            </div>
        `;
    }).join('');

    document.getElementById('replace-modal-overlay').style.display = 'flex';
}

function closeReplaceModal() {
    document.getElementById('replace-modal-overlay').style.display = 'none';
    currentEditSlot = null;
}

async function replaceWorker(newWorkerName) {
    if (!currentEditSlot) return;

    const { day, slotIndex } = currentEditSlot;

    // Update data
    scheduleData.schedule[day].slots[slotIndex].worker = newWorkerName || null;

    // Check preference status update for the new worker
    if (newWorkerName) {
        const worker = workersData.find(w => w.name === newWorkerName);
        const dayInt = parseInt(day);
        const isPreferred = worker ? worker.can_work.includes(dayInt) : false;
        scheduleData.schedule[day].slots[slotIndex].is_preferred = isPreferred;
    } else {
        scheduleData.schedule[day].slots[slotIndex].is_preferred = false;
    }

    closeReplaceModal();
    await analyzeSchedule();
    renderSchedule();
}

async function analyzeSchedule() {
    // Send updated schedule structure to backend to recalculate stats
    try {
        const stats = await api('/analyze', {
            method: 'POST',
            body: JSON.stringify({ schedule: scheduleData.schedule })
        });

        // Merge stats back into scheduleData
        scheduleData.analysis = stats.analysis;
        scheduleData.total_assigned = stats.total_assigned;
        scheduleData.total_required = stats.total_required;
        scheduleData.total_covered = stats.total_covered;
        scheduleData.total_remaining = stats.total_remaining;
        scheduleData.total_er = stats.total_er;
        scheduleData.fairness_min = stats.fairness_min;
        scheduleData.fairness_max = stats.fairness_max;

        // Update header stats
        const subtitleContainer = document.getElementById('schedule-subtitle-container');
        if (subtitleContainer && stats.total_required !== undefined) {
            subtitleContainer.innerHTML = `
                <span class="stat-badge">Target: <strong>${stats.total_required}</strong></span>
                <span class="stat-badge">Covered: <strong>${stats.total_covered}</strong></span>
                <span class="stat-badge" style="color: ${stats.total_remaining === 0 ? 'var(--green)' : 'var(--red)'}">Unfilled: <strong>${stats.total_remaining}</strong></span>
            `;
        } else {
            document.getElementById('schedule-subtitle').textContent = `Total Shifts: ${stats.total_assigned}`;
        }
        
        renderAnalysis();
        renderShiftTotals();
    } catch (err) {
        console.error("Failed to analyze schedule:", err);
    }
}

// --- Edit Day Requirements Logic ---
let currentEditDay = null;

function openEditDayModal(day) {
    try {
        if (window && window.event) window.event.stopPropagation();
    } catch(e) {}
    currentEditDay = day;
    document.getElementById('edit-day-modal-title').textContent = `Requirements for Day ${day}`;
    
    // Count current DEP and ER requirements from slots array
    // Since slots might include EXTRA, we just count non-EXTRA
    const slots = scheduleData.schedule[String(day)].slots;
    const regularSlots = slots.filter(s => s.dept === 'DEP').length;
    const erSlots = slots.filter(s => s.dept === 'ER').length;
    
    document.getElementById('modal-day-dep').value = regularSlots;
    document.getElementById('modal-day-er').value = erSlots;
    
    document.getElementById('edit-day-modal-overlay').style.display = 'flex';
}

function closeEditDayModal() {
    document.getElementById('edit-day-modal-overlay').style.display = 'none';
    currentEditDay = null;
}

async function saveDayRequirements() {
    if (!currentEditDay) return;
    const dep = parseInt(document.getElementById('modal-day-dep').value) || 0;
    const er = parseInt(document.getElementById('modal-day-er').value) || 0;
    
    await api(`/custom-shifts/${currentEditDay}`, {
        method: 'PUT',
        body: JSON.stringify({ DEP: dep, ER: er })
    });
    
    closeEditDayModal();
    // Refresh schedule data
    await generatePreferredSchedule(); 
}

async function resetDayToDefault() {
    if (!currentEditDay) return;
    
    await api(`/custom-shifts/${currentEditDay}`, {
        method: 'DELETE'
    });
    
    closeEditDayModal();
    // Refresh schedule data
    await generatePreferredSchedule();
}

// --- Import/Export Logic ---
function exportSchedule() {
    if (!scheduleData || !scheduleData.schedule) {
        alert("No schedule has been generated yet!");
        return;
    }
    
    const exportData = {
        month: scheduleData.month || parseInt(document.getElementById('month-select').value),
        year: scheduleData.year || parseInt(document.getElementById('year-input').value),
        schedule: scheduleData.schedule
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `schedule_${exportData.year}_${exportData.month}.json`);
    document.body.appendChild(downloadAnchorNode); 
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function importSchedule(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!importedData.schedule) {
                alert("Invalid schedule file!");
                return;
            }
            
            // Set local state
            scheduleData = importedData;
            // Ensure month_name is available for UI rendering
            if (scheduleData.month && scheduleData.year) {
                // Sync the imported month and year to the backend so stats are correct
                await api('/calendar-info', {
                    method: 'PUT',
                    body: JSON.stringify({ month: scheduleData.month, year: scheduleData.year }),
                });
                await loadCalendarInfo(); // Update the UI in Setup tab
                
                const monthDate = new Date(scheduleData.year, scheduleData.month - 1);
                scheduleData.month_name = monthDate.toLocaleString('default', { month: 'long' });
                scheduleData.days_in_month = new Date(scheduleData.year, scheduleData.month, 0).getDate();
            }
            // Re-sync with backend to get fresh analysis with current workers.json
            await analyzeSchedule();
            // Reset swap mode state
            swapMode = false;
            swapSelection = [];
            // Re-render schedule to reflect new data visually
            renderSchedule();
            // Switch tab to schedule view
            switchTab('schedule');
            
        } catch (err) {
            console.error(err);
            alert("Error parsing JSON file: " + err);
        }
    };
    reader.readAsText(file);
    // Reset so same file can be chosen again
    event.target.value = '';
}
