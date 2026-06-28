(() => {
  'use strict';

  const ENDPOINT = 'https://czaxtwbmborxwzaboqxl.supabase.co/functions/v1/acquisition-tasks';
  const WORKSPACE_ID = 'acq-task-execution-workspace';
  const RIYADH_TZ = 'Asia/Riyadh';
  const state = { data: null, loading: null, filter: 'today', error: '' };

  const arr = value => Array.isArray(value) ? value : [];
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const text = (value, fallback = '') => String(value ?? '').trim() || fallback;
  const slug = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const escapeHtml = value => text(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const safeUrl = value => /^https:\/\//i.test(text(value)) ? text(value) : '#';

  const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: RIYADH_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  function formatDue(value) {
    if (!value) return 'No due date';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'No due date' : dateFormatter.format(date);
  }

  function metricValue(metric, key) {
    return num(metric?.[key] ?? metric?.[key.replace(/[A-Z]/g, match => `_${match.toLowerCase()}`)]);
  }

  function currentContext() {
    const hash = location.hash.replace(/^#/, '') || 'team';
    const isRep = hash.startsWith('rep/');
    const repSlug = isRep ? hash.slice(4) : '';
    const metrics = isRep
      ? arr(state.data?.byRep).find(item => slug(item.display_name || item.displayName) === repSlug || slug(item.person_key || item.personKey) === repSlug)
      : state.data?.summary;
    const personKey = isRep ? text(metrics?.person_key || metrics?.personKey) : 'team';
    const rows = arr(state.data?.rows).filter(row => !isRep || text(row.personKey) === personKey);
    return {
      isRep,
      metrics: metrics || {},
      rows,
      title: isRep ? `${text(metrics?.display_name || metrics?.displayName, 'Rep')} Task Execution` : 'Team Task Execution',
      subtitle: isRep ? 'Today’s workload, overdue follow-ups and completion discipline' : 'Live workload and follow-up discipline across the acquisition team',
    };
  }

  function filterRows(rows, filter) {
    const predicates = {
      today: row => row.isDueToday && !row.isCompleted,
      overdue: row => row.isOverdue,
      completed: row => row.isDueToday && row.isCompleted,
      upcoming: row => row.isUpcoming7d,
      high: row => row.isHighPriority,
      open: row => !row.isCompleted,
    };
    return rows.filter(predicates[filter] || predicates.today).sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return new Date(a.dueAt || '2999-12-31') - new Date(b.dueAt || '2999-12-31');
    });
  }

  const filterLabels = {
    today: 'Due today',
    overdue: 'Overdue',
    completed: 'Completed today',
    upcoming: 'Next 7 days',
    high: 'High priority',
    open: 'All open',
  };

  function priorityTone(priority) {
    const value = text(priority, 'NONE').toUpperCase();
    return value === 'HIGH' ? 'danger' : value === 'MEDIUM' ? 'warning' : 'neutral';
  }

  function taskStatus(row) {
    if (row.isCompleted) return { label: 'Completed', tone: 'success' };
    if (row.isOverdue) return { label: `${num(row.daysOverdue)}d overdue`, tone: 'danger' };
    if (row.isDueToday) return { label: 'Due today', tone: 'warning' };
    return { label: 'Upcoming', tone: 'info' };
  }

  function taskRow(row, includeOwner = false) {
    const status = taskStatus(row);
    const taskUrl = safeUrl(row.taskUrl);
    const relatedUrl = safeUrl(row.relatedUrl);
    const relatedName = text(row.relatedName, 'No linked CRM record');
    const owner = includeOwner ? `<span class="task-owner">${escapeHtml(row.ownerName)}</span>` : '';
    const related = relatedUrl !== '#'
      ? `<a class="task-related" href="${escapeHtml(relatedUrl)}" target="_blank" rel="noopener">${escapeHtml(relatedName)} ↗</a>`
      : `<span class="task-related muted">${escapeHtml(relatedName)}</span>`;
    return `<tr>
      <td><div class="task-name"><a href="${escapeHtml(taskUrl)}" target="_blank" rel="noopener">${escapeHtml(row.subject || 'Follow-up task')} ↗</a><small>${related}${owner}</small></div></td>
      <td><span class="task-chip type">${escapeHtml(row.taskType || 'TODO')}</span></td>
      <td><span class="task-chip ${priorityTone(row.priority)}">${escapeHtml(row.priority || 'NONE')}</span></td>
      <td>${escapeHtml(formatDue(row.dueAt))}</td>
      <td><span class="task-chip ${status.tone}">${escapeHtml(status.label)}</span></td>
    </tr>`;
  }

  function metricButton(filter, value, label, note, tone) {
    return `<button class="task-kpi ${tone} ${state.filter === filter ? 'active' : ''}" data-task-filter="${filter}">
      <strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small>
    </button>`;
  }

  function repScoreboard() {
    const reps = arr(state.data?.byRep);
    if (!reps.length) return '';
    return `<div class="task-scoreboard">
      <div class="task-subhead"><div><h4>Task load by rep</h4><p>Click a rep to open their execution workspace</p></div></div>
      <div class="task-score-table"><table><thead><tr><th>Rep</th><th>Today open</th><th>Completed today</th><th>Overdue</th><th>Next 7d</th><th>MTD rate</th></tr></thead><tbody>
      ${reps.map(rep => `<tr data-rep-link="${escapeHtml(slug(rep.display_name))}"><td><button>${escapeHtml(rep.display_name)}</button></td><td>${metricValue(rep, 'dueTodayOpen')}</td><td>${metricValue(rep, 'completedToday')}</td><td class="${metricValue(rep, 'overdueOpen') ? 'bad' : ''}">${metricValue(rep, 'overdueOpen')}</td><td>${metricValue(rep, 'upcoming7d')}</td><td><span class="task-rate">${metricValue(rep, 'completionRateMtd')}%</span></td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  }

  function workspaceHtml(context) {
    const m = context.metrics;
    const rows = filterRows(context.rows, state.filter);
    const todayTotal = metricValue(m, 'dueTodayTotal');
    const todayRate = metricValue(m, 'completionRateToday');
    const mtdRate = metricValue(m, 'completionRateMtd');
    return `<section id="${WORKSPACE_ID}" class="card task-workspace-card">
      <div class="task-workspace-head"><div><i>✓</i><span><h3>${escapeHtml(context.title)}</h3><p>${escapeHtml(context.subtitle)}</p></span></div><span class="task-live"><b></b> Live tasks</span></div>
      <div class="task-kpis">
        ${metricButton('today', metricValue(m, 'dueTodayOpen'), 'Due today', `${metricValue(m, 'completedToday')} completed of ${todayTotal}`, 'blue')}
        ${metricButton('overdue', metricValue(m, 'overdueOpen'), 'Overdue', 'Open tasks past due date', 'red')}
        ${metricButton('completed', metricValue(m, 'completedToday'), 'Completed today', `${todayRate}% of today’s schedule`, 'green')}
        ${metricButton('upcoming', metricValue(m, 'upcoming7d'), 'Next 7 days', 'Upcoming open workload', 'purple')}
        ${metricButton('high', metricValue(m, 'highPriorityOpen'), 'High priority', 'Open and marked HIGH', 'amber')}
        ${metricButton('open', metricValue(m, 'openTotal'), 'All open', `${mtdRate}% MTD completion`, 'slate')}
      </div>
      <div class="task-toolbar"><div class="task-tabs">${Object.keys(filterLabels).map(key => `<button class="${state.filter === key ? 'active' : ''}" data-task-filter="${key}">${filterLabels[key]}</button>`).join('')}</div><button class="task-view-all" data-task-view-all>View all ${rows.length}</button></div>
      <div class="task-table-wrap"><table class="task-table"><thead><tr><th>Task & CRM record</th><th>Type</th><th>Priority</th><th>Due date</th><th>Status</th></tr></thead><tbody>
        ${rows.slice(0, 8).map(row => taskRow(row, !context.isRep)).join('') || `<tr><td colspan="5"><div class="task-empty">✓ No ${escapeHtml(filterLabels[state.filter].toLowerCase())} tasks.</div></td></tr>`}
      </tbody></table></div>
      ${context.isRep ? '' : repScoreboard()}
      <div class="task-footnote">Today and MTD completion rates use the task due date and current HubSpot status. Data refreshes through the n8n → Supabase sync.</div>
    </section>`;
  }

  function closeModal() {
    document.querySelector('.task-modal-bg')?.remove();
  }

  function openModal(context) {
    closeModal();
    const rows = filterRows(context.rows, state.filter);
    const modal = document.createElement('div');
    modal.className = 'task-modal-bg';
    modal.innerHTML = `<div class="task-modal"><div class="task-modal-head"><div><h2>${escapeHtml(filterLabels[state.filter])} · ${escapeHtml(context.isRep ? context.metrics.display_name : 'Team')}</h2><p>${rows.length} matching task${rows.length === 1 ? '' : 's'}</p></div><button data-task-close>×</button></div><div class="task-modal-body">
      ${rows.length ? rows.map(row => `<article class="task-modal-row"><div><a href="${escapeHtml(safeUrl(row.taskUrl))}" target="_blank" rel="noopener">${escapeHtml(row.subject || 'Follow-up task')} ↗</a><p>${escapeHtml(text(row.body, 'No task notes'))}</p><small>${escapeHtml(row.ownerName)} · ${escapeHtml(text(row.relatedName, 'No linked CRM record'))}</small></div><aside><span class="task-chip ${priorityTone(row.priority)}">${escapeHtml(row.priority || 'NONE')}</span><b>${escapeHtml(formatDue(row.dueAt))}</b><span class="task-chip ${taskStatus(row).tone}">${escapeHtml(taskStatus(row).label)}</span></aside></article>`).join('') : '<div class="task-empty">No matching tasks.</div>'}
    </div></div>`;
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-task-close]')) closeModal();
    });
    document.body.appendChild(modal);
  }

  function bind(section, context) {
    section.querySelectorAll('[data-task-filter]').forEach(button => button.addEventListener('click', () => {
      state.filter = button.dataset.taskFilter;
      render(true);
    }));
    section.querySelector('[data-task-view-all]')?.addEventListener('click', () => openModal(context));
    section.querySelectorAll('[data-rep-link]').forEach(row => row.addEventListener('click', () => {
      location.hash = `rep/${row.dataset.repLink}`;
    }));
  }

  function render(force = false) {
    if (!state.data) return;
    const host = document.querySelector('.team-page, .rep-page');
    if (!host) return;
    const context = currentContext();
    let section = document.getElementById(WORKSPACE_ID);
    if (section && !force && section.dataset.context === `${location.hash}|${state.filter}`) return;
    if (section) section.remove();
    section = document.createElement('div');
    section.innerHTML = workspaceHtml(context);
    section = section.firstElementChild;
    section.dataset.context = `${location.hash}|${state.filter}`;
    const period = host.querySelector('.period-section');
    if (period) period.insertAdjacentElement('afterend', section);
    else host.prepend(section);
    bind(section, context);
  }

  async function load() {
    if (state.loading) return state.loading;
    state.loading = fetch(ENDPOINT, { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) throw new Error(`Task endpoint returned HTTP ${response.status}`);
        const data = await response.json();
        if (!data || data.error) throw new Error(data?.error || 'Invalid task payload');
        state.data = data;
        state.error = '';
        render(true);
        return data;
      })
      .catch(error => {
        state.error = error.message || String(error);
        console.error('Talentera task workspace failed:', error);
      })
      .finally(() => { state.loading = null; });
    return state.loading;
  }

  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => render(), 80);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => {
    state.filter = 'today';
    setTimeout(() => render(true), 80);
  });
  window.addEventListener('talentera-dashboard-updated', () => load());
  window.addEventListener('keydown', event => event.key === 'Escape' && closeModal());

  load();
})();