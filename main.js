/* ============================================================================
   Main app — board, the three categories, goals, tasks, timer, reminders.
   Everything is stored in this browser's localStorage. With cloud-config.js
   filled in, you sign in first and the same data is kept in your account
   (sync.js), so it follows you to every device.

   Data shape:
     goals: [{ id, category, title, description, target,
               shorts: [{ id, title, description, target,
                          tasks: [{ id, title, description,
                                    schedule | null,        (see schedule.js)
                                    reminder: { enabled, before },
                                    timer: { enabled, minutes, dot } }] }] }]
     done:  { 'taskId|YYYY-MM-DD': true,          scheduled task, ticked that day
              'taskId|once': 'YYYY-MM-DD' }       unscheduled task, day it was ticked
     fired: { 'taskId|YYYY-MM-DD': true }         reminders already shown (this device only)
     updated, owner, dirty                        sync bookkeeping: time of the last edit,
                                                  whose account this copy belongs to,
                                                  and whether it still has to be uploaded
   ============================================================================ */

(function () {
  'use strict';

  const KEY = 'dot.life.v1';
  const CATS = [
    { id: 'physical',     name: 'Physical' },
    { id: 'spiritual',    name: 'Spiritual' },
    { id: 'intellectual', name: 'Intellectual' },
  ];

  const $ = id => document.getElementById(id);
  const view = $('view');

  let state = load();
  let boardDate = Schedule.today();
  let sel = null;               // { taskId, date } — task open in the detail panel

  /* --- helpers ------------------------------------------------------------ */

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      n.append(c.nodeType ? c : String(c));
    }
    return n;
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.goals)) {
        return { goals: s.goals, done: s.done || {}, fired: s.fired || {}, updated: s.updated || 0, owner: s.owner || null, dirty: !!s.dirty };
      }
    } catch (e) { /* corrupt or blocked storage — start empty */ }
    return blank();
  }

  function blank() { return { goals: [], done: {}, fired: {}, updated: 0, owner: null, dirty: false }; }

  /* Write to this device only. */
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast({ title: 'Could not save', body: 'Your browser blocked storage, so changes will be lost on refresh.' }); }
  }

  /* An edit: write it here, then send it to your account. */
  function save() {
    state.updated = Date.now();
    state.dirty = true;
    persist();
    queueSync();
  }

  function entries() {
    const out = [];
    for (const goal of state.goals)
      for (const short of goal.shorts)
        for (const task of short.tasks) out.push({ goal, short, task });
    return out;
  }

  function findTask(id) { return entries().find(e => e.task.id === id); }
  function catOf(id) { return CATS.find(c => c.id === id) || CATS[0]; }

  function longDate(s) {
    return Schedule.parse(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function relDay(s) {
    const d = Schedule.diffDays(Schedule.today(), s);
    if (d === 0) return 'Today';
    if (d === 1) return 'Tomorrow';
    if (d === -1) return 'Yesterday';
    return d > 0 ? 'In ' + d + ' days' : -d + ' days ago';
  }

  /* --- done state ---------------------------------------------------------- */

  function isDone(task, date) {
    return task.schedule ? !!state.done[task.id + '|' + date] : !!state.done[task.id + '|once'];
  }

  function setDone(task, date, on) {
    const key = task.id + '|' + (task.schedule ? date : 'once');
    if (on) state.done[key] = task.schedule ? true : date;
    else delete state.done[key];
    save();
  }

  function forget(taskIds) {
    for (const key of Object.keys(state.done)) if (taskIds.includes(key.split('|')[0])) delete state.done[key];
    for (const key of Object.keys(state.fired)) if (taskIds.includes(key.split('|')[0])) delete state.fired[key];
  }

  /* --- what is on a given day ---------------------------------------------- */

  function timeKey(t) { return t.schedule ? (t.schedule.time || '99:98') : '99:99'; }

  function dayEntries(date) {
    return entries().filter(e => {
      if (e.task.schedule) return Schedule.occursOn(e.task.schedule, date);
      const doneOn = state.done[e.task.id + '|once'];      // unscheduled: stays until ticked
      return !doneOn || doneOn === date;
    }).sort((a, b) => timeKey(a.task).localeCompare(timeKey(b.task)));
  }

  /* --- routing -------------------------------------------------------------- */

  function route() {
    const r = location.hash.slice(1);
    return r === 'about' || CATS.some(c => c.id === r) ? r : 'board';
  }

  function render() {
    if (locked()) { view.replaceChildren(); return; }
    const r = route();
    for (const a of document.querySelectorAll('#top a[data-route]')) a.classList.toggle('active', a.dataset.route === r);
    if (r === 'board') renderBoard();
    else if (r === 'about') {
      view.replaceChildren($('about-content').content.cloneNode(true));   // text lives in index.html
      const acc = view.querySelector('[data-account]');
      if (acc && signedIn()) {
        acc.hidden = false;
        acc.querySelector('[data-email]').textContent = Cloud.user().email || '';
      }
    }
    else renderCategory(catOf(r));
  }

  /* --- small shared pieces --------------------------------------------------- */

  function tick(task, date) {
    const on = isDone(task, date);
    return h('button', {
      type: 'button', class: 'tick' + (on ? ' on' : ''),
      'aria-pressed': on ? 'true' : 'false',
      'aria-label': (on ? 'Mark not done: ' : 'Mark done: ') + task.title,
      onclick: () => { setDone(task, date, !on); render(); },
    }, on ? '✓' : '');
  }

  function badges(task) {
    const out = [];
    const s = task.schedule;
    if (s && s.repeat && s.repeat !== 'none') out.push('Repeats');
    if (task.timer && task.timer.enabled) out.push(task.timer.minutes + ' min timer');
    if (task.reminder && task.reminder.enabled) out.push('Reminder');
    return out.length ? h('div', { class: 'badges' }, out.map(b => h('span', { class: 'badge' }, b))) : null;
  }

  /* --- board ------------------------------------------------------------------ */

  function renderBoard() {
    const list = dayEntries(boardDate);
    const go = d => { boardDate = d; sel = null; render(); };

    const head = h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, relDay(boardDate)),
        h('h1', null, longDate(boardDate))),
      h('div', { class: 'datenav' },
        h('button', { type: 'button', 'aria-label': 'Previous day', onclick: () => go(Schedule.addDays(boardDate, -1)) }, '‹'),
        h('button', { type: 'button', onclick: () => go(Schedule.today()) }, 'Today'),
        h('button', { type: 'button', 'aria-label': 'Next day', onclick: () => go(Schedule.addDays(boardDate, 1)) }, '›'),
        h('input', { type: 'date', value: boardDate, 'aria-label': 'Jump to date', onchange: e => { if (e.target.value) go(e.target.value); } })));

    const intro = state.goals.length ? null : h('div', { class: 'empty' },
      h('p', null, 'Nothing here yet. Pick a category at the top, add a long-term goal, break it into short-term goals, then add the tasks that get you there.'),
      h('p', null, 'Tasks you put on the calendar show up on this board on the right days.'),
      h('div', { class: 'row' },
        CATS.map(c => h('button', { type: 'button', onclick: () => { location.hash = c.id; } }, 'Go to ' + c.name)),
        h('button', { type: 'button', class: 'ghost', onclick: addExample }, 'Add an example goal')));

    const found = sel && findTask(sel.taskId);
    if (!found) sel = null;

    const board = h('div', { class: 'board' + (found ? ' has-detail' : '') },
      h('div', { class: 'cols' }, CATS.map(c => column(c, list.filter(e => e.goal.category === c.id)))),
      found && detail(found, sel.date));

    view.replaceChildren(...[head, intro, board].filter(Boolean));
  }

  function column(cat, list) {
    const goals = state.goals.filter(g => g.category === cat.id);
    const shorts = goals.reduce((n, g) => n + g.shorts.length, 0);
    const done = list.filter(e => isDone(e.task, boardDate)).length;

    return h('section', { class: 'col cat-' + cat.id },
      h('div', { class: 'col-head' },
        h('h2', null, h('a', { href: '#' + cat.id }, cat.name)),
        h('span', { class: 'col-count' }, list.length ? done + ' of ' + list.length + ' done' : '')),
      h('div', { class: 'bar' }, h('i', { style: 'width:' + (list.length ? Math.round(done / list.length * 100) : 0) + '%' })),
      h('p', { class: 'col-sub' },
        goals.length + ' long-term ' + (goals.length === 1 ? 'goal' : 'goals') + ' · ' + shorts + ' short-term'),
      list.length
        ? h('ul', { class: 'tasks' }, list.map(e => card(e)))
        : h('p', { class: 'col-empty' }, 'Nothing planned for this day.'));
  }

  function card(e) {
    const t = e.task;
    const selected = sel && sel.taskId === t.id;
    const when = t.schedule ? (t.schedule.time || 'Any time') : 'No date';
    return h('li', { class: 'card' + (isDone(t, boardDate) ? ' done' : '') + (selected ? ' selected' : '') },
      tick(t, boardDate),
      h('button', {
        type: 'button', class: 'card-main',
        onclick: () => {
          sel = selected ? null : { taskId: t.id, date: boardDate };
          render();
          // on a narrow screen the details sit above the columns — bring them into view
          const d = sel && view.querySelector('.detail');
          if (d && window.matchMedia('(max-width: 980px)').matches) d.scrollIntoView({ block: 'start', behavior: 'smooth' });
        },
      },
        h('div', { class: 'card-title' }, t.title),
        h('div', { class: 'card-meta' }, when + ' · ' + e.short.title),
        badges(t)));
  }

  function detail(e, date) {
    const t = e.task;
    const cat = catOf(e.goal.category);
    const done = isDone(t, date);
    const rem = t.reminder && t.reminder.enabled
      ? (t.reminder.before ? t.reminder.before + ' min before' : 'At the start time')
      : 'Off';

    return h('aside', { class: 'detail cat-' + cat.id, 'aria-label': 'Task details' },
      h('div', { class: 'detail-head' },
        h('div', null,
          h('span', { class: 'chip' }, cat.name),
          h('h2', null, t.title),
          h('p', { class: 'path' }, e.goal.title + ' › ' + e.short.title)),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Close details', onclick: () => { sel = null; render(); } }, '×')),
      t.description && h('p', { class: 'desc' }, t.description),
      h('dl', null,
        h('dt', null, 'When'), h('dd', null, Schedule.describe(t.schedule)),
        h('dt', null, 'Reminder'), h('dd', null, rem),
        h('dt', null, 'Timer'), h('dd', null, t.timer && t.timer.enabled
          ? t.timer.minutes + ' min' + (t.timer.dot ? ', with the breathing dot' : '')
          : 'Off')),
      h('div', { class: 'detail-btns' },
        t.timer && t.timer.enabled && h('button', { type: 'button', class: 'primary', onclick: () => openTimer(e, date) }, 'Open timer'),
        h('button', { type: 'button', onclick: () => { setDone(t, date, !done); render(); } }, done ? 'Mark not done' : 'Mark done'),
        h('button', { type: 'button', class: 'ghost', onclick: () => openTaskDialog(e.goal, e.short, t) }, 'Edit')));
  }

  function addExample() {
    const today = Schedule.today();
    state.goals.push({
      id: uid(), category: 'spiritual', title: 'A calmer mind', target: '',
      description: 'Example goal — edit or delete it from the Spiritual page.',
      shorts: [{
        id: uid(), title: 'Breathe every morning for a month', description: '', target: Schedule.addDays(today, 30),
        tasks: [{
          id: uid(), title: 'Deep breathing', description: 'Sit upright, follow the dot: in for 4, hold, out for 8.',
          schedule: { start: today, time: '07:00', repeat: 'daily', interval: 1, weekdays: [], end: 'until', until: Schedule.addDays(today, 30), count: 10 },
          reminder: { enabled: true, before: 10 },
          timer: { enabled: true, minutes: 15, dot: true },
        }],
      }],
    });
    save();
    render();
  }

  /* --- category page ------------------------------------------------------------ */

  function renderCategory(cat) {
    const goals = state.goals.filter(g => g.category === cat.id);
    const today = Schedule.today();

    const head = h('div', { class: 'page-head cat-' + cat.id },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Goals and tasks'),
        h('h1', null, cat.name)),
      h('div', { class: 'head-btns' },
        cat.id === 'spiritual' && h('button', { type: 'button', onclick: openDot }, h('span', { class: 'brand-dot' }), 'Breathing dot'),
        h('button', { type: 'button', class: 'primary', onclick: () => openGoalDialog({ kind: 'goal', cat }) }, '+ Long-term goal')));

    const empty = goals.length ? null : h('div', { class: 'empty' },
      h('p', null, 'No ' + cat.name.toLowerCase() + ' goals yet.'),
      h('p', null, 'Start with a long-term goal, add short-term goals inside it, then the tasks for each one.'));

    const list = goals.map(goal => h('article', { class: 'goal cat-' + cat.id },
      h('div', { class: 'goal-head' },
        h('div', null,
          h('p', { class: 'level' }, 'Long-term goal'),
          h('h2', null, goal.title),
          goal.target && h('p', { class: 'target' }, 'Target: ' + Schedule.niceDate(goal.target)),
          goal.description && h('p', { class: 'goal-desc' }, goal.description)),
        h('button', { type: 'button', class: 'small ghost', onclick: () => openGoalDialog({ kind: 'goal', cat, goal }) }, 'Edit')),

      goal.shorts.map(short => h('section', { class: 'short' },
        h('div', { class: 'short-head' },
          h('div', null,
            h('p', { class: 'level' }, 'Short-term goal'),
            h('h3', null, short.title),
            short.target && h('p', { class: 'target' }, 'Target: ' + Schedule.niceDate(short.target)),
            short.description && h('p', { class: 'goal-desc' }, short.description)),
          h('button', { type: 'button', class: 'small ghost', onclick: () => openGoalDialog({ kind: 'short', cat, goal, short }) }, 'Edit')),

        short.tasks.length ? h('ul', { class: 'rows' }, short.tasks.map(task => {
          // unscheduled tasks are ticked here; scheduled ones are ticked per day on the board
          const once = !task.schedule;
          return h('li', { class: 'row-task' + (once && isDone(task, today) ? ' done' : '') },
            once ? tick(task, today) : null,
            h('button', { type: 'button', class: 'card-main', onclick: () => openTaskDialog(goal, short, task) },
              h('div', { class: 'card-title' }, task.title),
              h('div', { class: 'card-meta' }, Schedule.describe(task.schedule)),
              badges(task)));
        })) : null,

        h('button', { type: 'button', class: 'small add', onclick: () => openTaskDialog(goal, short, null) }, '+ Task'))),

      h('button', { type: 'button', class: 'small add', onclick: () => openGoalDialog({ kind: 'short', cat, goal }) }, '+ Short-term goal')));

    view.replaceChildren(...[head, empty, ...list].filter(Boolean));
  }

  /* --- goal dialog (long-term and short-term share it) ---------------------------- */

  let gctx = null;

  function openGoalDialog(ctx) {
    gctx = ctx;
    const item = ctx.kind === 'goal' ? ctx.goal : ctx.short;
    const name = ctx.kind === 'goal' ? 'long-term goal' : 'short-term goal';
    $('goal-heading').textContent = (item ? 'Edit ' : 'New ') + name;
    $('g-title').value = item ? item.title : '';
    $('g-desc').value = item ? item.description || '' : '';
    $('g-target').value = item ? item.target || '' : '';
    $('g-delete').hidden = !item;
    $('goal-dialog').showModal();
  }

  $('goal-form').addEventListener('submit', e => {
    e.preventDefault();
    const title = $('g-title').value.trim();
    if (!title) return;
    const fields = { title, description: $('g-desc').value.trim(), target: $('g-target').value };
    if (gctx.kind === 'goal') {
      if (gctx.goal) Object.assign(gctx.goal, fields);
      else state.goals.push(Object.assign({ id: uid(), category: gctx.cat.id, shorts: [] }, fields));
    } else {
      if (gctx.short) Object.assign(gctx.short, fields);
      else gctx.goal.shorts.push(Object.assign({ id: uid(), tasks: [] }, fields));
    }
    save();
    $('goal-dialog').close();
    render();
  });

  $('g-delete').addEventListener('click', () => {
    if (gctx.kind === 'goal') {
      const n = gctx.goal.shorts.length;
      if (!confirm('Delete "' + gctx.goal.title + '"' + (n ? ' and everything inside it?' : '?'))) return;
      forget(gctx.goal.shorts.flatMap(s => s.tasks.map(t => t.id)));
      state.goals = state.goals.filter(g => g !== gctx.goal);
    } else {
      const n = gctx.short.tasks.length;
      if (!confirm('Delete "' + gctx.short.title + '"' + (n ? ' and its ' + n + (n === 1 ? ' task?' : ' tasks?') : '?'))) return;
      forget(gctx.short.tasks.map(t => t.id));
      gctx.goal.shorts = gctx.goal.shorts.filter(s => s !== gctx.short);
    }
    save();
    $('goal-dialog').close();
    render();
  });

  $('g-cancel').addEventListener('click', () => $('goal-dialog').close());

  /* --- task dialog ------------------------------------------------------------------ */

  let tctx = null;
  const UNITS = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)' };
  const dayBoxes = Array.from(document.querySelectorAll('#t-weekdays input'));

  function openTaskDialog(goal, short, task) {
    tctx = { goal, short, task };
    const s = task && task.schedule;
    $('task-heading').textContent = task ? 'Edit task' : 'New task';
    $('task-path').textContent = goal.title + ' › ' + short.title;
    $('t-title').value = task ? task.title : '';
    $('t-desc').value = task ? task.description || '' : '';

    $('t-sched').checked = !!s;
    $('t-start').value = s ? s.start : Schedule.today();
    $('t-time').value = s ? s.time || '' : '';
    $('t-repeat').value = s ? s.repeat || 'none' : 'none';
    $('t-interval').value = s ? s.interval || 1 : 1;
    for (const b of dayBoxes) b.checked = !!(s && s.weekdays && s.weekdays.includes(+b.value));
    $('t-end').value = s ? s.end || 'never' : 'never';
    $('t-until').value = s ? s.until || '' : '';
    $('t-count').value = s ? s.count || 10 : 10;

    $('t-rem').checked = !!(task && task.reminder && task.reminder.enabled);
    $('t-before').value = String(task && task.reminder ? task.reminder.before || 0 : 10);

    $('t-timer').checked = !!(task && task.timer && task.timer.enabled);
    $('t-minutes').value = task && task.timer ? task.timer.minutes || 15 : 15;
    $('t-dot').checked = !!(task && task.timer && task.timer.dot);

    $('t-delete').hidden = !task;
    $('task-error').hidden = true;
    syncTaskForm();
    $('task-dialog').showModal();
  }

  /* Show only the fields that apply to the current choices. */
  function syncTaskForm() {
    const sched = $('t-sched').checked;
    const repeat = $('t-repeat').value;
    const repeats = repeat !== 'none';
    $('sched-fields').hidden = !sched;
    $('interval-field').hidden = !repeats;
    $('t-unit').textContent = UNITS[repeat] || '';
    $('weekdays-field').hidden = repeat !== 'weekly';
    $('end-fields').hidden = !repeats;
    $('until-field').hidden = $('t-end').value !== 'until';
    $('count-field').hidden = $('t-end').value !== 'count';

    if (repeat === 'weekly' && !dayBoxes.some(b => b.checked) && $('t-start').value) {
      const wd = Schedule.parse($('t-start').value).getDay();
      for (const b of dayBoxes) b.checked = +b.value === wd;
    }

    const canRemind = sched && !!$('t-time').value;
    $('t-rem').disabled = !canRemind;
    if (!canRemind) $('t-rem').checked = false;
    $('rem-hint').hidden = canRemind;
    $('rem-fields').hidden = !$('t-rem').checked;

    $('timer-fields').hidden = !$('t-timer').checked;
  }

  $('task-form').addEventListener('input', syncTaskForm);
  $('task-form').addEventListener('change', syncTaskForm);

  function taskError(msg) {
    $('task-error').textContent = msg;
    $('task-error').hidden = false;
  }

  $('task-form').addEventListener('submit', e => {
    e.preventDefault();
    const title = $('t-title').value.trim();
    if (!title) return;

    let schedule = null;
    if ($('t-sched').checked) {
      const start = $('t-start').value;
      const repeat = $('t-repeat').value;
      const end = repeat === 'none' ? 'never' : $('t-end').value;
      const until = $('t-until').value;
      if (!start) return taskError('Pick the day this task starts on.');
      if (end === 'until' && !until) return taskError('Pick the last day, or set Ends to Never.');
      if (end === 'until' && until < start) return taskError('The last day is before the start day.');
      schedule = {
        start, time: $('t-time').value, repeat,
        interval: Math.max(1, parseInt($('t-interval').value, 10) || 1),
        weekdays: repeat === 'weekly' ? dayBoxes.filter(b => b.checked).map(b => +b.value) : [],
        end, until,
        count: Math.max(1, parseInt($('t-count').value, 10) || 1),
      };
    }

    const fields = {
      title,
      description: $('t-desc').value.trim(),
      schedule,
      reminder: { enabled: $('t-rem').checked && !!(schedule && schedule.time), before: parseInt($('t-before').value, 10) || 0 },
      timer: {
        enabled: $('t-timer').checked,
        minutes: Math.min(600, Math.max(1, parseInt($('t-minutes').value, 10) || 15)),
        dot: $('t-dot').checked,
      },
    };

    if (tctx.task) {
      const wasScheduled = !!tctx.task.schedule;
      Object.assign(tctx.task, fields);
      if (wasScheduled !== !!schedule) forget([tctx.task.id]);   // ticks mean something different now
      else for (const k of Object.keys(state.fired)) if (k.split('|')[0] === tctx.task.id) delete state.fired[k];
    } else {
      tctx.short.tasks.push(Object.assign({ id: uid() }, fields));
    }

    if (fields.reminder.enabled && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (err) { /* in-page reminders still work */ }
    }

    save();
    $('task-dialog').close();
    render();
  });

  $('t-delete').addEventListener('click', () => {
    if (!confirm('Delete "' + tctx.task.title + '"?')) return;
    forget([tctx.task.id]);
    tctx.short.tasks = tctx.short.tasks.filter(t => t !== tctx.task);
    save();
    $('task-dialog').close();
    render();
  });

  $('t-cancel').addEventListener('click', () => $('task-dialog').close());

  /* --- timer ------------------------------------------------------------------------- */

  const T = { entry: null, date: null, total: 0, left: 0, endAt: 0, running: false, finished: false, iv: null };
  let actx = null;

  function audio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
    return actx;
  }

  function chime(times) {
    const a = audio();
    if (!a) return;
    for (let i = 0; i < times; i++) {
      const o = a.createOscillator(), g = a.createGain();
      const t = a.currentTime + i * 0.9;
      o.type = 'sine';
      o.frequency.value = 528;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      o.connect(g);
      g.connect(a.destination);
      o.start(t);
      o.stop(t + 0.85);
    }
  }

  function openTimer(e, date) {
    const cat = catOf(e.goal.category);
    const dot = !!e.task.timer.dot;
    stopTimer();
    T.entry = e;
    T.date = date;
    T.total = T.left = (e.task.timer.minutes || 15) * 60;
    T.finished = false;

    $('timer-cat').textContent = cat.name;
    $('timer-title').textContent = e.task.title;
    $('timer-sub').textContent = e.short.title;
    $('timer-min').value = e.task.timer.minutes || 15;
    $('timer').className = 'cat-' + cat.id + (dot ? ' with-dot' : '');

    // the dot is its own untouched page, loaded fresh each time
    $('timer-dot').hidden = !dot;
    if (dot) $('timer-dot').src = 'dot.html';
    else $('timer-dot').removeAttribute('src');

    $('timer').hidden = false;
    paintTimer();
    $('timer-toggle').focus();
  }

  /* The dot on its own, no task and no countdown (opened from the Spiritual page). */
  function openDot() {
    stopTimer();
    T.entry = null;
    T.finished = false;
    $('timer-cat').textContent = 'Spiritual';
    $('timer-title').textContent = 'Breathing dot';
    $('timer-sub').textContent = 'Breathe with it. Its own settings are in the three dots, bottom right.';
    $('timer').className = 'cat-spiritual with-dot dot-only';
    $('timer-dot').hidden = false;
    $('timer-dot').src = 'dot.html';
    $('timer').hidden = false;
    $('timer-close').focus();
  }

  function stopTimer() {
    clearInterval(T.iv);
    T.iv = null;
    T.running = false;
  }

  function paintTimer() {
    const s = Math.ceil(T.left);
    $('timer-clock').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    $('timer-toggle').textContent = T.running ? 'Pause' : (T.left < T.total ? 'Resume' : 'Start');
    $('timer-toggle').hidden = T.finished;
    $('timer-done').hidden = !T.finished;
    $('timer-min').disabled = T.running;
    $('timer').classList.toggle('finished', T.finished);
  }

  function tickTimer() {
    T.left = Math.max(0, (T.endAt - Date.now()) / 1000);
    if (T.left <= 0) {
      stopTimer();
      T.finished = true;
      chime(3);
    }
    paintTimer();
  }

  function toggleTimer() {
    if (T.finished) return;
    if (T.running) {
      stopTimer();
    } else {
      audio();                                  // unlock sound while we have a click
      T.endAt = Date.now() + T.left * 1000;     // wall clock, so a sleeping tab can't drift
      T.running = true;
      T.iv = setInterval(tickTimer, 200);
    }
    paintTimer();
  }

  function closeTimer() {
    if (T.running && !confirm('The timer is still running. Close it?')) return;
    stopTimer();
    $('timer').hidden = true;
    $('timer-dot').removeAttribute('src');
    $('timer-dot').hidden = true;
    T.entry = null;
    render();
  }

  $('timer-toggle').addEventListener('click', toggleTimer);
  $('timer-close').addEventListener('click', closeTimer);

  $('timer-reset').addEventListener('click', () => {
    stopTimer();
    T.left = T.total;
    T.finished = false;
    paintTimer();
  });

  $('timer-min').addEventListener('input', () => {
    if (T.running) return;
    const m = Math.min(600, Math.max(1, parseInt($('timer-min').value, 10) || 1));
    T.total = T.left = m * 60;
    T.finished = false;
    paintTimer();
  });

  $('timer-done').addEventListener('click', () => {
    if (T.entry) setDone(T.entry.task, T.date, true);
    closeTimer();
  });

  document.addEventListener('keydown', e => {
    if ($('timer').hidden) return;
    if (e.key === 'Escape') closeTimer();
  });

  /* --- reminders ------------------------------------------------------------------- */
  /* Only fire while this page is open in a tab: there is no server behind it. */

  function toast(opts) {
    const box = h('div', { class: 'toast ' + (opts.cls || ''), role: 'status' },
      h('b', null, opts.title),
      opts.body && h('span', { class: 'muted' }, opts.body),
      h('div', { class: 'row' },
        opts.action && h('button', { type: 'button', class: 'small primary', onclick: () => { box.remove(); opts.action.run(); } }, opts.action.label),
        h('button', { type: 'button', class: 'small ghost', onclick: () => box.remove() }, 'Dismiss')));
    $('toasts').append(box);
  }

  function checkReminders() {
    if (locked()) return;
    const today = Schedule.today();
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    let changed = false;

    for (const key of Object.keys(state.fired)) {
      if (key.split('|')[1] !== today) { delete state.fired[key]; changed = true; }
    }

    for (const e of entries()) {
      const t = e.task, s = t.schedule;
      if (!s || !s.time || !t.reminder || !t.reminder.enabled) continue;
      const key = t.id + '|' + today;
      if (state.fired[key] || isDone(t, today) || !Schedule.occursOn(s, today)) continue;
      const p = s.time.split(':').map(Number);
      const at = p[0] * 60 + p[1];
      // from the reminder time until half an hour past the start; older than that is just noise
      if (mins < at - (t.reminder.before || 0) || mins > at + 30) continue;

      state.fired[key] = true;
      changed = true;
      const body = (mins < at ? 'Starts at ' : 'Was due at ') + s.time + ' · ' + e.short.title;
      toast({
        title: t.title, body, cls: 'cat-' + e.goal.category,
        action: { label: 'Open', run: () => { boardDate = today; sel = { taskId: t.id, date: today }; location.hash = 'board'; render(); } },
      });
      chime(1);
      notify(t.title, body);
    }
    if (changed) persist();
  }

  /* Phones only allow notifications through the service worker; desktops allow both. */
  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const viaPage = () => { try { new Notification(title, { body }); } catch (err) { /* the toast is enough */ } };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready
        .then(reg => reg.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png' }))
        .catch(viaPage);
    } else {
      viaPage();
    }
  }

  /* --- backup: move your data between devices -------------------------------------- */

  function exportData() {
    const data = { app: 'sva', version: 1, saved: new Date().toISOString(), goals: state.goals, done: state.done };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: 'sva-backup-' + Schedule.today() + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* Keep only what looks like our data; anything malformed is dropped, not trusted. */
  function cleanGoals(list) {
    const str = v => (typeof v === 'string' ? v : '');
    return list.filter(g => g && typeof g === 'object' && str(g.title)).map(g => ({
      id: str(g.id) || uid(),
      category: CATS.some(c => c.id === g.category) ? g.category : 'physical',
      title: str(g.title), description: str(g.description), target: str(g.target),
      shorts: (Array.isArray(g.shorts) ? g.shorts : []).filter(s => s && typeof s === 'object' && str(s.title)).map(s => ({
        id: str(s.id) || uid(),
        title: str(s.title), description: str(s.description), target: str(s.target),
        tasks: (Array.isArray(s.tasks) ? s.tasks : []).filter(t => t && typeof t === 'object' && str(t.title)).map(t => ({
          id: str(t.id) || uid(),
          title: str(t.title), description: str(t.description),
          schedule: t.schedule && typeof t.schedule === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(t.schedule.start) ? t.schedule : null,
          reminder: { enabled: !!(t.reminder && t.reminder.enabled), before: parseInt(t.reminder && t.reminder.before, 10) || 0 },
          timer: {
            enabled: !!(t.timer && t.timer.enabled),
            minutes: Math.min(600, Math.max(1, parseInt(t.timer && t.timer.minutes, 10) || 15)),
            dot: !!(t.timer && t.timer.dot),
          },
        })),
      })),
    }));
  }

  function cleanDone(d) { return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; }

  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.goals)) throw new Error('not a backup');
    } catch (err) {
      toast({ title: 'Could not load that file', body: 'It is not a Sva backup.' });
      return;
    }
    if (state.goals.length && !confirm('Replace everything in Sva with the backup?')) return;
    const goals = cleanGoals(data.goals);
    state = Object.assign(blank(), { goals, done: cleanDone(data.done), owner: state.owner });
    sel = null;
    save();
    render();
    toast({ title: 'Backup loaded', body: goals.length + (goals.length === 1 ? ' long-term goal' : ' long-term goals') + ' restored.' });
  });

  view.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'export') exportData();
    else if (b.dataset.act === 'import') $('import-file').click();
    else if (b.dataset.act === 'signout') signOut();
  });

  /* --- account + sync ----------------------------------------------------------------
     One copy of { goals, done } lives in your account. The newest edit wins: every
     edit is stamped with the time, and whichever side has the later stamp replaces
     the other. Edits made without signal are sent the next time Sva is online. */

  function signedIn() { return Cloud.enabled && !!Cloud.user(); }
  function locked() { return Cloud.enabled && !Cloud.user(); }

  let syncTimer = null;
  let syncChain = Promise.resolve();
  let setupWarned = false;

  function setSync(text) { $('sync-state').textContent = text; }

  function queueSync() {
    if (!signedIn()) return;
    setSync('Saving…');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 1500);
  }

  function sync() {
    clearTimeout(syncTimer);
    syncChain = syncChain.then(syncNow);       // one at a time, in order
    return syncChain;
  }

  async function syncNow() {
    if (!signedIn()) return;
    const uid = Cloud.user().uid;
    try {
      const got = await Cloud.pull();
      if (!signedIn() || Cloud.user().uid !== uid) return;
      const remote = got && Array.isArray(got.goals)
        ? { goals: cleanGoals(got.goals), done: cleanDone(got.done), updated: Number(got.updated) || 0 }
        : null;
      const editing = !!document.querySelector('dialog[open]');     // don't swap data under an open form
      let changed = false;

      if (state.owner && state.owner !== uid) { state = blank(); changed = true; }   // someone else's leftovers

      if (state.owner !== uid) {
        // First sync on this device: what was already here is added to the account, nothing is dropped.
        if (remote) {
          if (editing) return;
          const have = new Set(remote.goals.map(g => g.id));
          const extra = state.goals.filter(g => !have.has(g.id));
          state.goals = remote.goals.concat(extra);
          state.done = Object.assign({}, state.done, remote.done);
          state.updated = extra.length ? Date.now() : remote.updated;
          state.dirty = extra.length > 0;
          changed = true;
        } else {
          state.updated = state.updated || Date.now();
          state.dirty = true;
        }
        state.owner = uid;
      } else if (remote && remote.updated > state.updated) {
        if (editing) return;
        state.goals = remote.goals;
        state.done = remote.done;
        state.updated = remote.updated;
        state.dirty = false;
        changed = true;
      } else if (!remote || remote.updated < state.updated) {
        state.dirty = true;
      }

      persist();
      if (changed) render();

      if (state.dirty) {
        const sent = state.updated;
        await Cloud.push({ goals: state.goals, done: state.done, updated: sent });
        if (state.updated === sent) { state.dirty = false; persist(); }
      }
      setSync(state.dirty ? 'Saving…' : 'Saved');
    } catch (e) {
      if (e.code === 'signed-out') { lock('Your session ended. Please sign in again.'); return; }
      setSync(e.code === 'offline' ? 'Offline' : 'Not saved');
      if (e.code === 'setup' && !setupWarned) {
        setupWarned = true;
        toast({ title: 'Could not reach your account data', body: 'The database or its rules are not set up yet in Firebase. Changes are kept on this device for now.' });
      }
    }
  }

  function lock(message) {
    setSync('');
    document.body.classList.add('locked');
    view.replaceChildren();
    $('login-error').textContent = message || '';
    $('login-error').hidden = !message;
    $('login').hidden = false;
    $('l-email').focus();
  }

  const LOGIN_ERRORS = {
    wrong: 'That email and password do not match.',
    'too-many': 'Too many attempts. Wait a few minutes and try again.',
    offline: 'No connection. You need to be online to sign in.',
    setup: 'Sign-in is not set up yet in Firebase (check cloud-config.js and that Email/Password is enabled).',
  };

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('login-submit');
    btn.disabled = true;
    $('login-error').hidden = true;
    try {
      await Cloud.signIn($('l-email').value.trim(), $('l-pass').value);
      $('l-pass').value = '';
      $('login').hidden = true;
      document.body.classList.remove('locked');
      setSync('Syncing…');
      render();
      sync();
    } catch (err) {
      $('login-error').textContent = LOGIN_ERRORS[err.code] || 'Could not sign in. Try again.';
      $('login-error').hidden = false;
    }
    btn.disabled = false;
  });

  async function signOut() {
    if (state.dirty) {
      await sync();
      if (!signedIn()) return;
      if (state.dirty && !confirm('Some changes have not reached your account yet. Sign out anyway and lose them?')) return;
    }
    Cloud.signOut();
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing to clear */ }   // leave nothing behind on this device
    state = blank();
    sel = null;
    lock();
  }

  // leaving the page sends what is pending; coming back fetches what changed elsewhere
  document.addEventListener('visibilitychange', () => { if (signedIn()) sync(); });
  window.addEventListener('online', () => { if (signedIn()) sync(); });
  setInterval(() => { if (signedIn() && !document.hidden) sync(); }, 60000);

  /* Installable + offline, when served over https (GitHub Pages) or localhost. */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* app works without it */ });
  }

  /* --- go ---------------------------------------------------------------------------- */

  window.addEventListener('hashchange', render);
  if (locked()) {
    lock();
  } else {
    render();
    if (signedIn()) { setSync('Syncing…'); sync(); }
  }
  checkReminders();
  setInterval(checkReminders, 15000);
})();
