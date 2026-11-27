/* ============================================================================
   Main app — board, the three categories, goals, tasks, timer, reminders.
   Everything is stored in this browser's localStorage. With cloud-config.js
   filled in, you sign in first and the same data is kept in your account
   (sync.js), so it follows you to every device.

   Two modes share this file: the goals board, and Sankalpa mode (search for
   "Sankalpa mode" below; its picture is drawn by yarn.js).

   Data shape:
     goals: [{ id, category, title, description, target,
               shorts: [{ id, title, description, target,
                          tasks: [{ id, title, description,
                                    nature: '' | area id,   ('' = same as its goal)
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
    { id: 'shareerik', name: 'Shareerik' },
    { id: 'adhyaatmik', name: 'Adhyaatmik' },
    { id: 'maansik', name: 'Maansik' },
  ];

  /* The areas used to be called this. Goals saved under the old names are moved
     to the new ones wherever data is read: this device, the account, a backup. */
  const OLD_CATS = { physical: 'shareerik', spiritual: 'adhyaatmik', intellectual: 'maansik' };
  const hasOldCats = goals => goals.some(g => g && Object.prototype.hasOwnProperty.call(OLD_CATS, g.category));
  function catId(c) {
    if (Object.prototype.hasOwnProperty.call(OLD_CATS, c)) return OLD_CATS[c];
    return CATS.some(x => x.id === c) ? c : 'shareerik';
  }

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
        const renamed = hasOldCats(s.goals);
        for (const g of s.goals) if (g) g.category = catId(g.category);
        // renamed here: stamp it as an edit so the account gets the new names too
        return {
          goals: s.goals, done: s.done || {}, fired: s.fired || {},
          sankalpas: cleanSankalpas(s.sankalpas), yarn: cleanYarn(s.yarn),
          updated: renamed ? Date.now() : s.updated || 0, owner: s.owner || null, dirty: renamed || !!s.dirty,
        };
      }
    } catch (e) { /* corrupt or blocked storage — start empty */ }
    return blank();
  }

  function blank() {
    return { goals: [], done: {}, fired: {}, sankalpas: [], yarn: { total: 1000, offset: 0, lotus: '', petals: '' }, updated: 0, owner: null, dirty: false };
  }

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

  /* A task belongs to its goal, but the kind of activity it is can differ: breathing
     practice (Adhyaatmik) for a Shareerik goal. Unless set, it is the goal's area. */
  function natureOf(e) { return CATS.some(c => c.id === e.task.nature) ? e.task.nature : e.goal.category; }
  function isGuest(e) { return natureOf(e) !== e.goal.category; }

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
      if (closedBy(e, date)) return false;                 // its goal was marked complete before this day
      if (e.task.schedule) return Schedule.occursOn(e.task.schedule, date);
      const doneOn = state.done[e.task.id + '|once'];      // unscheduled: stays until ticked
      return !doneOn || doneOn === date;
    }).sort((a, b) => timeKey(a.task).localeCompare(timeKey(b.task)));
  }

  /* --- what is over, and so lives on the History page ----------------------------
     Nothing is stored for this; it is read off the calendar and the ticks each time.
       a task with no date   once it was ticked on an earlier day (today's tick can
                             still be undone where it is)
       a task with a date    once its last day has passed (never, if it repeats for ever)
       a short-term goal     it has tasks and all of them are over
       a long-term goal      it has short-term goals and all of them are over
     Give a finished goal something new to do and it is back on its area's page.

     A goal can also be marked complete by hand ("Mark complete" on its area page).
     That is stored, as completed: 'YYYY-MM-DD' on the goal. From the next day its tasks
     are off the Board, send no reminders and are not counted as missed; "Bring it back"
     on the History page undoes it. */

  /* The day the goal this task serves was marked complete ('' if it was not). */
  function closedOn(e) {
    const a = e.goal.completed || '', b = e.short.completed || '';
    return a && b ? (a < b ? a : b) : a || b;
  }
  function closedBy(e, date) { const c = closedOn(e); return !!c && date > c; }

  const lastDayCache = new Map();

  /* The last day a schedule falls on; '' if it never ends. */
  function lastDay(s) {
    if (!s.repeat || s.repeat === 'none') return s.start;
    if (s.end === 'until' && s.until) return s.until;
    if (s.end !== 'count') return '';
    const key = JSON.stringify(s);
    if (!lastDayCache.has(key)) {
      const max = Math.max(1, parseInt(s.count, 10) || 1);
      let seen = 0, last = s.start;
      for (let d = s.start, i = 0; seen < max && i < 20000; d = Schedule.addDays(d, 1), i++) {
        if (Schedule.occursOn(Object.assign({}, s, { end: 'never' }), d)) { seen++; last = d; }
      }
      lastDayCache.set(key, last);
    }
    return lastDayCache.get(key);
  }

  function taskOver(task, today) {
    if (!task.schedule) {
      const on = state.done[task.id + '|once'];
      return typeof on === 'string' ? on < today : false;
    }
    if (!task.schedule.start) return false;
    const last = lastDay(task.schedule);
    return !!last && last < today;
  }
  function shortOver(short, today) { return !!short.completed || (short.tasks.length > 0 && short.tasks.every(t => taskOver(t, today))); }
  function goalOver(goal, today) { return !!goal.completed || (goal.shorts.length > 0 && goal.shorts.every(s => shortOver(s, today))); }

  async function markComplete(item, kind) {
    const sure = await ask('Mark "' + item.title + '" complete?',
      'It moves to History with everything inside it. From tomorrow its tasks no longer show on the Board. You can bring it back from History.',
      'Mark complete', 'Not yet');
    if (!sure) return;
    item.completed = Schedule.today();
    save();
    render();
    toast({ title: kind + ' complete', body: item.title + ' is in History now.' });
  }

  /* --- routing -------------------------------------------------------------- */

  function route() {
    const r = location.hash.slice(1);
    if (mode === 'sankalpa') return r === 'about' || r === 'history' ? r : 'sankalpa';
    return r === 'about' || r === 'progress' || r === 'history' || CATS.some(c => c.id === r) ? r : 'board';
  }

  function render() {
    if (locked()) { view.replaceChildren(); return; }
    const r = route();
    for (const a of document.querySelectorAll('#top a[data-route]')) a.classList.toggle('active', a.dataset.route === r);
    $('signout').hidden = !signedIn();           // only when there is an account to sign out of
    if (signedIn()) $('signout').title = 'Signed in as ' + (Cloud.user().email || '');
    syncYarn();
    if (r === 'sankalpa') renderSankalpas();
    else if (r === 'board') renderBoard();
    else if (r === 'progress') renderProgress();
    else if (r === 'history') renderHistory();
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

  /* tag: an area to name in front (the task's nature, or the area of the goal it serves) */
  function badges(task, tag) {
    const out = [];
    const s = task.schedule;
    if (tag) out.push(h('span', { class: 'badge nature cat-' + tag.id }, tag.name));
    if (s && s.repeat && s.repeat !== 'none') out.push('Repeats');
    if (task.timer && task.timer.enabled) out.push(task.timer.minutes + ' min timer');
    if (task.reminder && task.reminder.enabled) out.push('Reminder');
    return out.length ? h('div', { class: 'badges' }, out.map(b => (b.nodeType ? b : h('span', { class: 'badge' }, b)))) : null;
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
      h('div', { class: 'cols' }, CATS.map(c => column(c, list.filter(e => natureOf(e) === c.id)))),
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
        h('div', { class: 'card-meta' }, when + ' · ' + e.short.title + (isGuest(e) ? ' · for a ' + catOf(e.goal.category).name + ' goal' : '')),
        badges(t)));
  }

  function detail(e, date) {
    const t = e.task;
    const cat = catOf(natureOf(e));
    const done = isDone(t, date);
    const rem = t.reminder && t.reminder.enabled
      ? (t.reminder.before ? t.reminder.before + ' min before' : 'At the start time')
      : 'Off';

    return h('aside', { class: 'detail cat-' + cat.id, 'aria-label': 'Task details' },
      h('div', { class: 'detail-head' },
        h('div', null,
          h('span', { class: 'chip' }, cat.name),
          h('h2', null, t.title),
          h('p', { class: 'path' }, (isGuest(e) ? catOf(e.goal.category).name + ' › ' : '') + e.goal.title + ' › ' + e.short.title)),
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
      id: uid(), category: 'adhyaatmik', title: 'A calmer mind', target: '',
      description: 'Example goal — edit or delete it from the Adhyaatmik page.',
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

  /* Which long-term and short-term goals are folded shut. Remembered on this device only. */
  const FOLD_KEY = 'sva.folded';
  let folded = new Set();
  try { folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY)) || []); } catch (e) { /* start with everything open */ }

  function toggleFold(goal) {
    if (!folded.delete(goal.id)) folded.add(goal.id);
    const live = new Set(state.goals.flatMap(g => [g.id].concat(g.shorts.map(s => s.id))));
    for (const id of folded) if (!live.has(id)) folded.delete(id);       // forget deleted goals
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch (e) { /* just not remembered */ }
    render();
  }

  /* --- move things by dragging ------------------------------------------------------
     A long-term goal: drag it onto Shareerik / Adhyaatmik / Maansik in the top bar.
     A short-term goal: drag it onto another long-term goal on the same page.
     (Touch screens, or a goal in another area: the same moves are the "Area" and
     "Inside" choices in the Edit form.) */

  let dragGoal = null;
  let dragShort = null;          // { short, from } — from is the long-term goal it sits in

  function endDrag() {
    dragGoal = null;
    dragShort = null;
    document.body.classList.remove('dragging-goal', 'dragging-short');
    for (const n of document.querySelectorAll('#nav a.drop, .goal.drop, .goal.dragging, .goal.drag-home, .short.dragging')) {
      n.classList.remove('drop', 'dragging', 'drag-home');
    }
  }

  function moveShort(short, from, to) {
    if (from === to || !to) return;
    from.shorts = from.shorts.filter(s => s !== short);
    to.shorts.push(short);
    save();
    render();
    toast({ title: 'Moved into ' + to.title, body: short.title, cls: 'cat-' + to.category });
  }

  function moveGoal(goal, cat) {
    if (goal.category === cat.id) return;
    goal.category = cat.id;
    save();
    render();
    toast({ title: 'Moved to ' + cat.name, body: goal.title, cls: 'cat-' + cat.id, action: { label: 'Open', run: () => { location.hash = cat.id; } } });
  }

  for (const a of document.querySelectorAll('#nav a[data-route]')) {
    const cat = CATS.find(c => c.id === a.dataset.route);
    if (!cat) continue;
    a.addEventListener('dragover', e => {
      if (!dragGoal || dragGoal.category === cat.id) return;       // not a goal, or already here
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      a.classList.add('drop');
    });
    a.addEventListener('dragleave', () => a.classList.remove('drop'));
    a.addEventListener('drop', e => {
      if (!dragGoal) return;
      e.preventDefault();
      const goal = dragGoal;
      endDrag();
      moveGoal(goal, cat);
    });
  }

  function renderCategory(cat) {
    const today = Schedule.today();
    const mine = state.goals.filter(g => g.category === cat.id);
    const goals = mine.filter(g => !goalOver(g, today));          // finished ones are on the History page
    const past = mine.length - goals.length;

    const head = h('div', { class: 'page-head cat-' + cat.id },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Goals and tasks'),
        h('h1', null, cat.name)),
      h('div', { class: 'head-btns' },
        cat.id === 'adhyaatmik' && h('button', { type: 'button', onclick: openDot }, h('span', { class: 'brand-dot' }), 'Breathing dot'),
        h('button', { type: 'button', class: 'primary', onclick: () => openGoalDialog({ kind: 'goal', cat }) }, '+ Long-term goal')));

    // tasks of this nature that serve goals in the other areas
    const guests = entries().filter(e => isGuest(e) && natureOf(e) === cat.id && !closedOn(e) && !taskOver(e.task, today));

    const empty = goals.length || guests.length ? null : h('div', { class: 'empty' },
      h('p', null, past ? 'Nothing running here now. Your finished ' + cat.name + ' goals are on the History page.' : 'No ' + cat.name.toLowerCase() + ' goals yet.'),
      h('p', null, 'Start with a long-term goal, add short-term goals inside it, then the tasks for each one.'));

    const list = goals.map(goal => {
      const shut = folded.has(goal.id);
      const shorts = goal.shorts.filter(s => !shortOver(s, today));
      const live = s => s.tasks.filter(t => !taskOver(t, today));
      const nTasks = shorts.reduce((n, s) => n + live(s).length, 0);
      return h('article', {
        class: 'goal cat-' + cat.id + (shut ? ' folded' : ''), draggable: 'true',
        ondragstart: e => {
          dragGoal = goal;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', goal.title);
          document.body.classList.add('dragging-goal');
          e.currentTarget.classList.add('dragging');
        },
        ondragend: endDrag,
        // a short-term goal being dragged can be dropped here
        ondragover: e => {
          if (!dragShort || dragShort.from === goal) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          e.currentTarget.classList.add('drop');
        },
        ondragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop'); },
        ondrop: e => {
          if (!dragShort) return;
          e.preventDefault();
          const d = dragShort;
          endDrag();
          moveShort(d.short, d.from, goal);
        },
      },
      h('div', { class: 'goal-head' },
        h('button', {
          type: 'button', class: 'fold', 'aria-expanded': shut ? 'false' : 'true',
          'aria-label': (shut ? 'Show ' : 'Hide ') + 'what is inside ' + goal.title,
          onclick: () => toggleFold(goal),
        }, shut ? '▸' : '▾'),
        h('div', { class: 'goal-title', onclick: () => toggleFold(goal) },
          h('p', { class: 'level' }, 'Long-term goal'),
          h('h2', null, goal.title),
          goal.target && h('p', { class: 'target' }, 'Target: ' + Schedule.niceDate(goal.target)),
          shut
            ? h('p', { class: 'target' }, shorts.length + (shorts.length === 1 ? ' short-term goal' : ' short-term goals') + ' · ' + nTasks + (nTasks === 1 ? ' task' : ' tasks'))
            : goal.description && h('p', { class: 'goal-desc' }, goal.description)),
        h('div', { class: 'head-acts' },
          h('button', { type: 'button', class: 'small ghost', onclick: () => markComplete(goal, 'Long-term goal') }, 'Mark complete'),
          h('button', { type: 'button', class: 'small ghost', onclick: () => openGoalDialog({ kind: 'goal', cat, goal }) }, 'Edit'))),

      !shut && shorts.map(short => {
        const sShut = folded.has(short.id);
        const tasks = live(short);
        return h('section', {
          class: 'short' + (sShut ? ' folded' : ''), draggable: 'true',
          ondragstart: e => {
            e.stopPropagation();                    // this is the short-term goal moving, not its parent
            dragShort = { short, from: goal };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', short.title);
            document.body.classList.add('dragging-short');
            e.currentTarget.classList.add('dragging');
            e.currentTarget.closest('.goal').classList.add('drag-home');
          },
          ondragend: e => { e.stopPropagation(); endDrag(); },
        },
        h('div', { class: 'short-head' },
          h('button', {
            type: 'button', class: 'fold', 'aria-expanded': sShut ? 'false' : 'true',
            'aria-label': (sShut ? 'Show ' : 'Hide ') + 'the tasks in ' + short.title,
            onclick: () => toggleFold(short),
          }, sShut ? '▸' : '▾'),
          h('div', { class: 'goal-title', onclick: () => toggleFold(short) },
            h('p', { class: 'level' }, 'Short-term goal'),
            h('h3', null, short.title),
            short.target && h('p', { class: 'target' }, 'Target: ' + Schedule.niceDate(short.target)),
            sShut
              ? h('p', { class: 'target' }, tasks.length + (tasks.length === 1 ? ' task' : ' tasks'))
              : short.description && h('p', { class: 'goal-desc' }, short.description)),
          h('div', { class: 'head-acts' },
            h('button', { type: 'button', class: 'small ghost', onclick: () => markComplete(short, 'Short-term goal') }, 'Mark complete'),
            h('button', { type: 'button', class: 'small ghost', onclick: () => openGoalDialog({ kind: 'short', cat, goal, short }) }, 'Edit'))),

        !sShut && tasks.length ? h('ul', { class: 'rows' }, tasks.map(task => {
          // unscheduled tasks are ticked here; scheduled ones are ticked per day on the board
          const once = !task.schedule;
          return h('li', { class: 'row-task' + (once && isDone(task, today) ? ' done' : '') },
            once ? tick(task, today) : null,
            h('button', { type: 'button', class: 'card-main', onclick: () => openTaskDialog(goal, short, task) },
              h('div', { class: 'card-title' }, task.title),
              h('div', { class: 'card-meta' }, Schedule.describe(task.schedule)),
              badges(task, isGuest({ goal, task }) && catOf(task.nature))));
        })) : null,

        !sShut && h('button', { type: 'button', class: 'small add', onclick: () => openTaskDialog(goal, short, null) }, '+ Task'));
      }),

      !shut && h('button', { type: 'button', class: 'small add', onclick: () => openGoalDialog({ kind: 'short', cat, goal }) }, '+ Short-term goal'));
    });

    const others = guests.length ? h('article', { class: 'goal guests cat-' + cat.id },
      h('div', { class: 'goal-head' },
        h('div', null,
          h('p', { class: 'level' }, 'From goals in other areas'),
          h('h2', null, cat.name + ' tasks for other goals'),
          h('p', { class: 'goal-desc' }, 'These are ' + cat.name + ' in nature but belong to a goal somewhere else. They show in the ' + cat.name + ' column on the Board.'))),
      h('ul', { class: 'rows' }, guests.map(e => {
        const once = !e.task.schedule;
        return h('li', { class: 'row-task' + (once && isDone(e.task, today) ? ' done' : '') },
          once ? tick(e.task, today) : null,
          h('button', { type: 'button', class: 'card-main', onclick: () => openTaskDialog(e.goal, e.short, e.task) },
            h('div', { class: 'card-title' }, e.task.title),
            h('div', { class: 'card-meta' }, Schedule.describe(e.task.schedule) + ' · ' + e.goal.title + ' › ' + e.short.title),
            badges(e.task, catOf(e.goal.category))));
      }))) : null;

    view.replaceChildren(...[head, empty, ...list, others].filter(Boolean));
  }

  /* --- history -------------------------------------------------------------------
     Where finished things go, so the main pages only show what is still running.
     Goals mode: finished long-term goals, short-term goals and tasks (see taskOver).
     Sankalpa mode: completed sankalpas, and broken ones you have since taken again. */

  function renderHistory() {
    if (mode === 'sankalpa') { renderSkHistory(); return; }
    const today = Schedule.today();
    const ticks = task => Object.keys(state.done).filter(k => k.split('|')[0] === task.id).length;
    const taskMeta = task => {
      if (!task.schedule) return 'Done on ' + Schedule.niceDate(state.done[task.id + '|once']);
      const n = ticks(task);
      if (!task.schedule.repeat || task.schedule.repeat === 'none') return (n ? 'Done on ' : 'Not ticked · was on ') + Schedule.niceDate(task.schedule.start);
      return Schedule.describe(task.schedule) + ' · ticked ' + n + (n === 1 ? ' time' : ' times');
    };
    const row = (cat, level, title, meta, buttons) => h('li', { class: 'row-task hist cat-' + cat },
      h('div', { class: 'card-main' },
        h('p', { class: 'level' }, level + ' · ' + catOf(cat).name),
        h('div', { class: 'card-title' }, title),
        h('div', { class: 'card-meta' }, meta)),
      h('div', { class: 'hist-btns' }, buttons));
    const btn = (label, fn) => h('button', { type: 'button', class: 'small ghost', onclick: fn }, label);
    const back = item => btn('Bring it back', () => { item.completed = ''; save(); render(); });
    const marked = item => 'Marked complete on ' + Schedule.niceDate(item.completed);

    const longs = [], shorts = [], tasks = [];
    for (const goal of state.goals) {
      const cat = catOf(goal.category);
      if (goalOver(goal, today)) {
        const n = goal.shorts.reduce((a, s) => a + s.tasks.length, 0);
        longs.push(row(cat.id, 'Long-term goal', goal.title,
          goal.shorts.length + (goal.shorts.length === 1 ? ' short-term goal' : ' short-term goals') + ' · ' + n + (n === 1 ? ' task' : ' tasks') + (goal.completed ? ' · ' + marked(goal) : ', all finished'),
          [goal.completed ? back(goal) : btn('Continue it', () => openGoalDialog({ kind: 'short', cat, goal })), btn('Edit', () => openGoalDialog({ kind: 'goal', cat, goal }))]));
        continue;
      }
      for (const short of goal.shorts) {
        if (shortOver(short, today)) {
          shorts.push(row(cat.id, 'Short-term goal', short.title,
            goal.title + ' · ' + short.tasks.length + (short.tasks.length === 1 ? ' task' : ' tasks') + (short.completed ? ' · ' + marked(short) : ', all finished'),
            [short.completed ? back(short) : btn('Continue it', () => openTaskDialog(goal, short, null)), btn('Edit', () => openGoalDialog({ kind: 'short', cat, goal, short }))]));
          continue;
        }
        for (const task of short.tasks) {
          if (!taskOver(task, today)) continue;
          tasks.push(row(natureOf({ goal, task }), 'Task', task.title, taskMeta(task) + ' · ' + goal.title + ' › ' + short.title,
            [!task.schedule && btn('Not done after all', () => { setDone(task, today, false); render(); }), btn('Edit', () => openTaskDialog(goal, short, task))]));
        }
      }
    }

    const head = h('div', { class: 'page-head' },
      h('div', null, h('p', { class: 'eyebrow' }, 'What is finished'), h('h1', null, 'History')));
    const block = (title, list) => (list.length ? h('section', { class: 'sk-block' },
      h('h2', null, title, h('span', { class: 'col-count' }, ' ' + list.length)),
      h('ul', { class: 'rows' }, list)) : null);
    const empty = longs.length || shorts.length || tasks.length ? null : h('div', { class: 'empty' },
      h('p', null, 'Nothing here yet. A task comes here once it is over: a task with no date the day after you tick it, a task on the calendar after its last day.'),
      h('p', null, 'A short-term goal follows when all its tasks are over, and a long-term goal when all its short-term goals are.'));
    view.replaceChildren(...[head, empty, block('Long-term goals', longs), block('Short-term goals', shorts), block('Tasks', tasks)].filter(Boolean));
  }

  /* --- progress -----------------------------------------------------------------
     Consistency = of the tasks that were on the calendar, how many got ticked.
     The line shows that share over the 7 days up to each date, all areas together,
     so one missed day pulls it down and a good week brings it back up.
     Today is included as it stands, so every tick moves the line straight away.
     A task with no date cannot be missed; it counts as done on the day it is ticked. */

  let progDays = 30;

  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs || {}) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    n.append(...kids);
    return n;
  }

  function renderProgress() {
    const today = Schedule.today();
    const yest = Schedule.addDays(today, -1);
    const all = entries();
    const sched = all.filter(e => e.task.schedule);
    const onceDone = all.filter(e => !e.task.schedule).map(e => state.done[e.task.id + '|once']).filter(d => typeof d === 'string');
    const cache = {};
    const stat = d => cache[d] || (cache[d] = sched.reduce((a, e) => {
      if (Schedule.occursOn(e.task.schedule, d) && !closedBy(e, d)) {
        a.planned++;
        if (state.done[e.task.id + '|' + d]) a.done++;
      }
      return a;
    }, (n => ({ planned: n, done: n }))(onceDone.filter(x => x === d).length)));
    const rate = (end, n) => {
      let planned = 0, done = 0;
      for (let i = 0; i < n; i++) {
        const s = stat(Schedule.addDays(end, -i));
        planned += s.planned;
        done += s.done;
      }
      return planned ? done / planned : null;
    };
    const pct = v => (v == null ? '–' : Math.round(v * 100) + '%');

    const first = sched.map(e => e.task.schedule.start).concat(onceDone).reduce((m, d) => (!m || d < m ? d : m), '');
    const hasPast = !!first && first <= today;

    // days in a row with everything ticked; days with nothing planned neither help nor hurt
    let streak = 0;
    const t = stat(today);
    if (t.planned && t.done === t.planned) streak++;
    for (let d = yest; hasPast && d >= first; d = Schedule.addDays(d, -1)) {
      const s = stat(d);
      if (!s.planned) continue;
      if (s.done < s.planned) break;
      streak++;
    }

    const pts = [];
    if (hasPast) {
      const span = Schedule.diffDays(first, today) + 1;
      const from = span > progDays ? Schedule.addDays(today, -(progDays - 1)) : first;
      for (let d = from; d <= today; d = Schedule.addDays(d, 1)) pts.push({ date: d, v: rate(d, 7), day: stat(d) });
    }

    const head = h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'All three areas together'),
        h('h1', null, 'Progress')),
      h('div', { class: 'datenav' }, [[30, '30 days'], [90, '90 days'], [365, '1 year']].map(r =>
        h('button', {
          type: 'button', class: progDays === r[0] ? 'on' : null, 'aria-pressed': progDays === r[0] ? 'true' : 'false',
          onclick: () => { progDays = r[0]; render(); },
        }, r[1]))));

    const tile = (value, label) => h('div', { class: 'tile' }, h('b', null, value), h('span', null, label));
    const tiles = h('div', { class: 'tiles' },
      tile(pct(rate(today, 7)), 'Last 7 days'),
      tile(pct(rate(today, 30)), 'Last 30 days'),
      tile(String(streak), streak === 1 ? 'Perfect day in a row' : 'Perfect days in a row'),
      tile(t.planned ? t.done + ' of ' + t.planned : '–', 'Done today'));

    const holder = h('div', { class: 'chart' });
    const box = h('section', { class: 'chart-box' },
      h('h2', null, 'Consistency'),
      h('p', { class: 'sub' }, 'How much of what you planned you ticked off, over the 7 days up to each date, today included. Tasks without a date count on the day you tick them.'),
      pts.length ? holder : h('p', { class: 'col-empty' }, sched.length
        ? 'Your first task has not started yet. The graph begins on its first day.'
        : 'Add some tasks and tick them off. Your graph grows from there.'));

    view.replaceChildren(head, tiles, box);
    if (pts.length) drawChart(holder, pts, pct);
  }

  function drawChart(holder, pts, pct) {
    const W = Math.max(280, holder.clientWidth || 640), H = 260;
    const L = 40, R = 14, T = 12, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const n = pts.length;
    const x = i => L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const y = v => T + (1 - v) * ph;
    const short = d => Schedule.parse(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

    const root = svg('svg', {
      width: W, height: H, role: 'img',
      'aria-label': 'Consistency over time, ' + short(pts[0].date) + ' to ' + short(pts[n - 1].date) + '. Latest: ' + pct(pts[n - 1].v) + '.'
    });

    for (const g of [0, 0.25, 0.5, 0.75, 1]) {
      root.append(svg('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: 'grid' }));
      if (g === 0 || g === 0.5 || g === 1) root.append(svg('text', { x: L - 8, y: y(g) + 4, 'text-anchor': 'end' }, Math.round(g * 100) + '%'));
    }

    const ticks = [...new Set([0, 1, 2, 3, 4].map(k => Math.round((k * (n - 1)) / 4)))];
    for (const i of ticks) {
      root.append(svg('text', { x: x(i), y: H - 6, 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, short(pts[i].date)));
    }

    // the line breaks where a whole week had nothing planned
    let path = '', pen = false;
    pts.forEach((p, i) => {
      if (p.v == null) { pen = false; return; }
      path += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1);
      pen = true;
      const alone = (i === 0 || pts[i - 1].v == null) && (i === n - 1 || pts[i + 1].v == null);
      if (alone) root.append(svg('circle', { cx: x(i), cy: y(p.v), r: 3, class: 'pt' }));
    });
    if (path) root.append(svg('path', { d: path, class: 'line' }));
    if (pts[n - 1].v != null) root.append(svg('circle', { cx: x(n - 1), cy: y(pts[n - 1].v), r: 4, class: 'pt ring' }));

    const cross = svg('line', { y1: T, y2: T + ph, class: 'cross', visibility: 'hidden' });
    const dot = svg('circle', { r: 5, class: 'pt ring', visibility: 'hidden' });
    const tip = h('div', { class: 'chart-tip', hidden: true });
    const hit = svg('rect', { x: L - 10, y: T, width: pw + 20, height: ph, fill: 'transparent' });
    root.append(cross, dot, hit);

    const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    const show = ev => {
      const px = ev.clientX - root.getBoundingClientRect().left;
      const i = n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(((px - L) / pw) * (n - 1))));
      const p = pts[i];
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      if (p.v == null) dot.setAttribute('visibility', 'hidden');
      else { dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.v)); dot.setAttribute('visibility', 'visible'); }
      tip.replaceChildren(
        h('b', null, longDate(p.date)),
        h('span', null, p.v == null ? 'Nothing planned that week' : pct(p.v) + ' over the 7 days to here'),
        h('span', { class: 'muted' }, p.day.planned ? 'That day: ' + p.day.done + ' of ' + p.day.planned + ' done' : 'That day: nothing planned'));
      tip.hidden = false;
      const tw = Math.min(210, W - 16);
      tip.style.width = tw + 'px';
      tip.style.left = Math.min(W - tw, Math.max(0, x(i) > W / 2 ? x(i) - tw - 12 : x(i) + 12)) + 'px';
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);

    holder.replaceChildren(root, tip);
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (locked()) return;
      syncYarn();
      if (mode !== 'sankalpa' && route() === 'progress') render();
    }, 150);
  });

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
    $('g-cat-field').hidden = ctx.kind !== 'goal';
    $('g-cat').value = ctx.goal ? ctx.goal.category : ctx.cat.id;
    $('g-parent-field').hidden = ctx.kind !== 'short';
    if (ctx.kind === 'short') {
      $('g-parent').replaceChildren(...CATS.map(c => {
        const inside = state.goals.filter(g => g.category === c.id);
        return inside.length ? h('optgroup', { label: c.name }, inside.map(g => h('option', { value: g.id }, g.title))) : null;
      }).filter(Boolean));
      $('g-parent').value = ctx.goal.id;
    }
    $('g-delete').hidden = !item;
    $('goal-dialog').showModal();
  }

  $('goal-form').addEventListener('submit', e => {
    e.preventDefault();
    const title = $('g-title').value.trim();
    if (!title) return;
    const fields = { title, description: $('g-desc').value.trim(), target: $('g-target').value };
    if (gctx.kind === 'goal') {
      fields.category = catId($('g-cat').value);
      if (gctx.goal) Object.assign(gctx.goal, fields);
      else state.goals.push(Object.assign({ id: uid(), shorts: [] }, fields));
    } else {
      const parent = state.goals.find(g => g.id === $('g-parent').value) || gctx.goal;
      if (gctx.short) {
        Object.assign(gctx.short, fields);
        if (parent !== gctx.goal) {
          gctx.goal.shorts = gctx.goal.shorts.filter(s => s !== gctx.short);
          parent.shorts.push(gctx.short);
        }
      } else {
        parent.shorts.push(Object.assign({ id: uid(), tasks: [] }, fields));
      }
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
  $('g-cat').replaceChildren(...CATS.map(c => h('option', { value: c.id }, c.name)));

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
    $('t-nature').value = task ? natureOf({ goal, task }) : goal.category;

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

    const nature = catId($('t-nature').value);
    const fields = {
      title,
      description: $('t-desc').value.trim(),
      nature: nature === tctx.goal.category ? '' : nature,     // '' keeps following the goal if the goal moves
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
  $('t-nature').replaceChildren(...CATS.map(c => h('option', { value: c.id }, c.name)));

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
    const cat = catOf(natureOf(e));
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

  /* The dot on its own, no task and no countdown (opened from the Adhyaatmik page). */
  function openDot() {
    stopTimer();
    T.entry = null;
    T.finished = false;
    $('timer-cat').textContent = 'Adhyaatmik';
    $('timer-title').textContent = 'Breathing dot';
    $('timer-sub').textContent = 'Breathe with it. Its own settings are in the three dots, bottom right.';
    $('timer').className = 'cat-adhyaatmik with-dot dot-only';
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
    if (T.entry && T.entry.sankalpa) setSkDone(T.entry.sankalpa, T.date, true);
    else if (T.entry) setDone(T.entry.task, T.date, true);
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
      if (state.fired[key] || isDone(t, today) || closedBy(e, today) || !Schedule.occursOn(s, today)) continue;
      const p = s.time.split(':').map(Number);
      const at = p[0] * 60 + p[1];
      // from the reminder time until half an hour past the start; older than that is just noise
      if (mins < at - (t.reminder.before || 0) || mins > at + 30) continue;

      state.fired[key] = true;
      changed = true;
      const body = (mins < at ? 'Starts at ' : 'Was due at ') + s.time + ' · ' + e.short.title;
      toast({
        title: t.title, body, cls: 'cat-' + natureOf(e),
        action: { label: 'Open', run: () => { boardDate = today; sel = { taskId: t.id, date: today }; location.hash = 'board'; render(); } },
      });
      chime(1);
      notify(t.title, body);
    }
    for (const s of state.sankalpas) {
      if (!s.time || !s.reminder.enabled) continue;
      const st = skStatus(s, today);
      const key = s.id + '|' + today;
      if (st.state !== 'active' || st.doneToday || state.fired[key]) continue;
      const p = s.time.split(':').map(Number);
      const at = p[0] * 60 + p[1];
      if (mins < at - (s.reminder.before || 0) || mins > at + 30) continue;

      state.fired[key] = true;
      changed = true;
      const body = (mins < at ? 'Starts at ' : 'Was due at ') + s.time + ' · sankalpa, day ' + st.day + ' of ' + s.days;
      toast({ title: s.title, body, cls: 'cat-' + s.category, action: { label: 'Open', run: () => setMode('sankalpa') } });
      chime(1);
      notify(s.title, body);
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
    const data = { app: 'sva', version: 1, saved: new Date().toISOString(), goals: state.goals, done: state.done, sankalpas: state.sankalpas, yarn: state.yarn };
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
    const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');      // completed: the day it was marked complete
    return list.filter(g => g && typeof g === 'object' && str(g.title)).map(g => ({
      id: str(g.id) || uid(),
      category: catId(g.category),
      title: str(g.title), description: str(g.description), target: str(g.target), completed: date(g.completed),
      shorts: (Array.isArray(g.shorts) ? g.shorts : []).filter(s => s && typeof s === 'object' && str(s.title)).map(s => ({
        id: str(s.id) || uid(),
        title: str(s.title), description: str(s.description), target: str(s.target), completed: date(s.completed),
        tasks: (Array.isArray(s.tasks) ? s.tasks : []).filter(t => t && typeof t === 'object' && str(t.title)).map(t => ({
          id: str(t.id) || uid(),
          title: str(t.title), description: str(t.description),
          nature: CATS.some(c => c.id === t.nature) ? t.nature : '',
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
    if ((state.goals.length || state.sankalpas.length) && !confirm('Replace everything in Sva with the backup?')) return;
    const goals = cleanGoals(data.goals);
    state = Object.assign(blank(), { goals, done: cleanDone(data.done), sankalpas: cleanSankalpas(data.sankalpas), yarn: cleanYarn(data.yarn), owner: state.owner });
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

  /* --- Sankalpa mode -----------------------------------------------------------------
     The other way to run Sva. No long-term / short-term goals here: a sankalpa is one
     thing you resolve to do every day, for a set number of days.

       sankalpas: [{ id, title, description, category, start, days, time,
                     reminder: { enabled, before }, timer: { enabled, minutes, dot },
                     done: { 'YYYY-MM-DD': true } }]
       yarn: { total, offset,       how many petals / tangles the picture has, and how many
               petals, lotus }      kept sankalpas were already spent on an earlier picture.
                                    petals: '' = each petal takes its area's colour, as a pastel;
                                            'one' = the whole lotus is one colour, which is
                                    lotus: the colour you picked ('' = the one in main.css)

     The picture comes in two kinds, switched under it: the lotus (lotus.js, the
     default) gains a petal for every kept sankalpa; the yarn (yarn.js) loses a tangle.

     Nothing about a sankalpa's fate is stored; it is read off its ticks every time:
       upcoming  it has not started yet
       active    every day so far is ticked (today may still be open)
       broken    a day went by without a tick; it ended there, at once.
                 If you did do it and only missed ticking it, tap that day's circle
                 on the card: it asks, ticks the day, and the sankalpa carries on.
       kept      every day to the last is ticked; one tangle of the yarn comes loose */

  const MODE_KEY = 'sva.mode';
  const SEEN_KEY = 'sva.yarnSeen';
  let mode = 'sankalpa';         // what Sva opens in, until you pick the other on this device
  try { if (localStorage.getItem(MODE_KEY) === 'goals') mode = 'goals'; } catch (e) { /* default mode */ }

  function setMode(m) {
    mode = m === 'sankalpa' ? 'sankalpa' : 'goals';
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* just not remembered */ }
    location.hash = mode === 'sankalpa' ? 'sankalpa' : 'board';
    applyMode();
    render();
  }

  function applyMode() {
    document.body.classList.toggle('mode-sankalpa', mode === 'sankalpa');
    document.body.classList.toggle('mode-goals', mode !== 'sankalpa');
    for (const b of document.querySelectorAll('#mode button')) b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
  }

  for (const b of document.querySelectorAll('#mode button')) b.addEventListener('click', () => setMode(b.dataset.mode));

  function skStatus(s, today) {
    const end = Schedule.addDays(s.start, s.days - 1);
    if (today < s.start) return { state: 'upcoming', end };
    const last = today <= end ? Schedule.addDays(today, -1) : end;        // the last day that is over
    for (let d = s.start; d <= last; d = Schedule.addDays(d, 1)) {
      if (!s.done[d]) return { state: 'broken', on: d, day: Schedule.diffDays(s.start, d) + 1, end };
    }
    if (today > end || s.done[end]) return { state: 'kept', on: end, end };
    return { state: 'active', day: Schedule.diffDays(s.start, today) + 1, doneToday: !!s.done[today], end };
  }

  /* Kept sankalpas, oldest first: this order decides which tangle each one freed. */
  function keptList() {
    const today = Schedule.today();
    return state.sankalpas.map(s => ({ s, st: skStatus(s, today) })).filter(r => r.st.state === 'kept')
      .sort((a, b) => (a.st.on === b.st.on ? (a.s.id < b.s.id ? -1 : 1) : a.st.on < b.st.on ? -1 : 1));
  }

  /* Goals mode has its own picture, the garden (garden.js): a flower for every long-term
     goal still running, a petal for every short-term goal in it, and the petal is made of
     dots, one for every task. A task's dot is filled while the task is done. A task with
     no date: it is ticked. A task on the calendar: the last time it was due, you ticked
     it (today only counts once it is ticked, since today is not over yet). Everything in
     a goal that was marked complete counts as done. */
  function taskDone(task, today) {
    if (!task.schedule) return !!state.done[task.id + '|once'];
    if (state.done[task.id + '|' + today] && Schedule.occursOn(task.schedule, today)) return true;
    const first = task.schedule.start || today;
    for (let d = Schedule.addDays(today, -1), i = 0; d >= first && i < 400; d = Schedule.addDays(d, -1), i++) {
      if (Schedule.occursOn(task.schedule, d)) return !!state.done[task.id + '|' + d];
    }
    return false;
  }

  function gardenData() {
    const today = Schedule.today();
    const css = getComputedStyle(document.documentElement);
    const color = id => css.getPropertyValue('--' + id).trim() || '#888';
    let tasks = 0, done = 0;
    const flowers = state.goals.filter(g => !goalOver(g, today)).map(goal => ({
      id: goal.id, title: goal.title, color: color(goal.category),
      petals: goal.shorts.map(short => ({
        dots: short.tasks.map(task => {
          const on = !!short.completed || taskDone(task, today);
          tasks++;
          if (on) done++;
          return { id: task.id, on, color: color(natureOf({ goal, task })) };
        }),
      })),
    }));
    return { flowers, tasks, done };
  }

  function syncGarden() {
    pictures.lotus.hide();
    pictures.yarn.hide();
    yarnSig = null;
    pictures.garden.show($('yarn-canvas'));
    const g = gardenData();
    const sig = JSON.stringify(g.flowers);
    if (sig !== gardenSig) {
      const css = getComputedStyle(document.documentElement);
      const cssVar = name => css.getPropertyValue(name).trim();
      pictures.garden.set({
        flowers: g.flowers, track: cssVar('--yarn-track'), heart: cssVar('--lotus-heart'), ink: cssVar('--muted'),
        onPick: id => { const goal = state.goals.find(x => x.id === id); if (goal) location.hash = goal.category; },
      });
      gardenSig = sig;
    } else {
      pictures.garden.resize();
    }
    const n = g.flowers.length;
    $('yarn-count').textContent = !n
      ? 'No goals running. Every long-term goal you add grows a flower here.'
      : n + (n === 1 ? ' flower' : ' flowers') + ' · ' + (g.tasks ? g.done + ' of ' + g.tasks + (g.tasks === 1 ? ' task' : ' tasks') + ' done' : 'no tasks yet');
  }

  function yarnData() {
    const kept = keptList();
    const total = Math.min(2000, Math.max(1, parseInt(state.yarn.total, 10) || 1000));
    const offset = Math.min(kept.length, Math.max(0, parseInt(state.yarn.offset, 10) || 0));
    return { total, offset, kept, freed: kept.slice(offset, offset + total).map(r => r.s.category) };
  }

  let yarnSig = null, gardenSig = null;
  // if a picture's file did not load, the mode still works, just without that picture
  const noPicture = { show() {}, hide() {}, resize() {}, set() {} };
  const pictures = {
    lotus: typeof Lotus === 'object' ? Lotus : noPicture,
    yarn: typeof Yarn === 'object' ? Yarn : noPicture,
    garden: typeof Garden === 'object' ? Garden : noPicture,       // Goals mode
  };

  // which picture this device shows: the lotus, unless you picked the yarn
  const VISUAL_KEY = 'sva.visual';
  let visual = 'lotus';
  try { if (localStorage.getItem(VISUAL_KEY) === 'yarn') visual = 'yarn'; } catch (e) { /* default picture */ }

  function setVisual(v) {
    const next = v === 'yarn' ? 'yarn' : 'lotus';
    if (next === visual) return;
    pictures[visual].hide();
    visual = next;
    yarnSig = null;
    try { localStorage.setItem(VISUAL_KEY, visual); } catch (e) { /* just not remembered */ }
    syncYarn();
  }

  for (const b of document.querySelectorAll('#visual button')) b.addEventListener('click', () => setVisual(b.dataset.visual));

  /* The picture is on screen the whole time, in both modes (not on the sign-in page). */
  function syncYarn() {
    const on = !locked();
    const yarn = pictures[visual];
    $('yarn').hidden = !on;
    if (!on) { pictures.lotus.hide(); pictures.yarn.hide(); pictures.garden.hide(); yarnSig = gardenSig = null; return; }
    document.documentElement.style.setProperty('--top-h', $('top').offsetHeight + 'px');
    if (mode !== 'sankalpa') { syncGarden(); return; }
    pictures.garden.hide();
    gardenSig = null;
    for (const b of document.querySelectorAll('#visual button')) b.setAttribute('aria-pressed', b.dataset.visual === visual ? 'true' : 'false');
    yarn.show($('yarn-canvas'));

    const y = yarnData();
    const key = y.total + ':' + y.offset;
    const sig = visual + ':' + (state.yarn.petals || '') + ':' + (state.yarn.lotus || '') + ':' + key + ':' + y.freed.join(',');
    if (sig !== yarnSig) {
      // how many of these has this device already watched come loose?
      let seen = y.freed.length;
      try {
        const m = JSON.parse(localStorage.getItem(SEEN_KEY));
        if (m && m.key === key && m.count < seen) seen = m.count;
      } catch (e) { /* treat all as seen */ }
      const colors = {};
      const css = getComputedStyle(document.documentElement);
      // the colours come from the top of main.css
      const cssVar = name => css.getPropertyValue(name).trim();
      for (const c of CATS) colors[c.id] = cssVar('--yarn-' + c.id) || cssVar('--' + c.id) || cssVar('--text');
      const areaColors = {};                       // the lotus softens these into pastels itself
      for (const c of CATS) areaColors[c.id] = cssVar('--' + c.id);
      yarn.set({
        total: y.total, freed: y.freed, animate: y.freed.length - seen,
        colors: visual === 'lotus' ? areaColors : colors, byArea: state.yarn.petals !== 'one',
        track: cssVar('--yarn-track'), glint: cssVar('--yarn-glint'),
        lotus: state.yarn.lotus || cssVar('--lotus'), heart: cssVar('--lotus-heart'),
      });
      yarnSig = sig;
      try { localStorage.setItem(SEEN_KEY, JSON.stringify({ key, count: y.freed.length })); } catch (e) { /* fine */ }
    } else {
      yarn.resize();
    }
    const left = y.total - y.freed.length;
    if (visual === 'lotus') {
      $('yarn-count').textContent = left > 0
        ? y.freed.length + ' of ' + y.total + (y.total === 1 ? ' petal' : ' petals')
        : 'All ' + y.total + ' petals. The lotus is in full bloom.';
    } else {
      $('yarn-count').textContent = left > 0
        ? y.freed.length + ' of ' + y.total + ' untangled'
        : 'All ' + y.total + ' untangled. The yarn is free.';
    }
  }

  function setSkDone(s, date, on) {
    const before = skStatus(s, Schedule.today()).state;
    if (on) s.done[date] = true;
    else delete s.done[date];
    save();
    if (before !== 'kept' && skStatus(s, Schedule.today()).state === 'kept') {
      toast({ title: 'Sankalpa completed', body: s.title + ' · ' + s.days + (s.days === 1 ? ' day' : ' days') + (visual === 'lotus' ? '. A petal has opened.' : '. One tangle has come loose.'), cls: 'cat-' + s.category });
    }
  }

  function skTimer(s, st) {
    openTimer({
      sankalpa: s, goal: { category: s.category },
      short: { title: 'Day ' + st.day + ' of ' + s.days },
      task: { title: s.title, timer: s.timer },
    }, Schedule.today());
  }

  /* A question with two plain answers. Resolves true for yes, false for no (or Esc). */
  function ask(question, note, yes, no) {
    return new Promise(done => {
      const dlg = $('ask-dialog');
      $('ask-text').textContent = question;
      $('ask-note').textContent = note || '';
      $('ask-note').hidden = !note;
      $('ask-yes').textContent = yes;
      $('ask-no').textContent = no;
      const finish = answer => {
        $('ask-yes').onclick = $('ask-no').onclick = dlg.oncancel = null;
        dlg.close();
        done(answer);
      };
      $('ask-yes').onclick = () => finish(true);
      $('ask-no').onclick = () => finish(false);
      dlg.oncancel = e => { e.preventDefault(); finish(false); };
      dlg.showModal();
    });
  }

  /* Tapping a day's circle: an empty one asks whether you did it that day, a filled one
     whether you did not. This is how a day you did but could not tick gets put right. */
  async function askDay(s, d) {
    const today = Schedule.today();
    const when = d === today ? 'today' : 'on ' + longDate(d);
    if (s.done[d]) {
      const sure = await ask('Did you not do "' + s.title + '" ' + when + '?',
        d < today ? 'Unticking a past day breaks the sankalpa on that day.' : '',
        'I did not do it', 'I did do it');
      if (!sure) return;
      setSkDone(s, d, false);
    } else {
      const did = await ask('Did you do "' + s.title + '" ' + when + '?', '', 'Yes, I did it', 'No');
      if (!did) return;
      setSkDone(s, d, true);
    }
    render();
  }

  /* One circle per day: filled = done, ringed = today, red ring = the day it broke.
     Circles up to today can be tapped (see askDay). A long sankalpa shows a bar for the
     whole of it, and circles for the 30 days that matter now. */
  function skDays(s, st, today) {
    const count = Object.keys(s.done).length;
    const end = Schedule.addDays(s.start, s.days - 1);
    const long = s.days > 60;
    let from = s.start, to = end;
    if (long) {
      from = st.state === 'broken' ? st.on : Schedule.addDays(today < end ? today : end, -29);
      if (from < s.start) from = s.start;
      to = Schedule.addDays(from, 29);
      if (to > end) to = end;
    }
    const pips = [];
    for (let d = from; d <= to; d = Schedule.addDays(d, 1)) {
      const dot = h('i', { class: 'pip' + (s.done[d] ? ' on' : '') + (d === today && st.state === 'active' ? ' now' : '') + (st.state === 'broken' && d === st.on ? ' miss' : '') });
      pips.push(d <= today
        ? h('button', {
          type: 'button', class: 'pip-btn', title: Schedule.niceDate(d),
          'aria-label': Schedule.niceDate(d) + ': ' + (s.done[d] ? 'done' : 'not done') + '. Change',
          onclick: () => askDay(s, d),
        }, dot)
        : h('span', { class: 'pip-btn', title: Schedule.niceDate(d) }, dot));      // a day that has not come yet
    }
    const row = h('div', { class: 'pips', role: 'group', 'aria-label': count + ' of ' + s.days + ' days done' }, pips);
    if (!long) return row;
    return h('div', { class: 'sk-long' },
      h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round((count / s.days) * 100) + '%' })),
      h('p', { class: 'hint' }, Schedule.niceDate(from) + ' to ' + Schedule.niceDate(to) + ':'),
      row);
  }

  function skCard(r, today) {
    const s = r.s, st = r.st;
    const dayWord = s.days + (s.days === 1 ? ' day' : ' days');
    let mark, meta;
    if (st.state === 'active') {
      mark = h('button', {
        type: 'button', class: 'tick' + (st.doneToday ? ' on' : ''), 'aria-pressed': st.doneToday ? 'true' : 'false',
        'aria-label': (st.doneToday ? 'Mark not done today: ' : 'Mark done today: ') + s.title,
        onclick: () => { setSkDone(s, today, !st.doneToday); render(); },
      }, st.doneToday ? '✓' : '');
      meta = 'Day ' + st.day + ' of ' + s.days + (s.time ? ' · ' + s.time : '') + ' · until ' + Schedule.niceDate(st.end);
    } else if (st.state === 'kept') {
      mark = h('span', { class: 'tick on still', 'aria-hidden': 'true' }, '✓');
      meta = 'Completed ' + dayWord + ' · finished ' + Schedule.niceDate(st.on);
    } else if (st.state === 'broken') {
      mark = h('span', { class: 'tick still broken', 'aria-hidden': 'true' }, '×');
      meta = 'Broken on day ' + st.day + ' of ' + s.days + ' · ' + Schedule.niceDate(st.on);
    } else {
      mark = h('span', { class: 'tick still', 'aria-hidden': 'true' });
      meta = 'Starts ' + Schedule.niceDate(s.start) + ' · ' + dayWord + (s.time ? ' · ' + s.time : '');
    }
    const tags = [];
    if (s.timer.enabled) tags.push(s.timer.minutes + ' min timer');
    if (s.reminder.enabled) tags.push('Reminder');

    return h('li', { class: 'sk cat-' + s.category + ' is-' + st.state + (st.doneToday ? ' done' : '') },
      mark,
      h('div', { class: 'sk-main' },
        h('div', { class: 'sk-top' },
          h('span', { class: 'chip' }, catOf(s.category).name),
          h('div', { class: 'card-title' }, s.title)),
        h('div', { class: 'card-meta' }, meta),
        s.description && st.state === 'active' ? h('p', { class: 'goal-desc' }, s.description) : null,
        st.state === 'upcoming' ? null : skDays(s, st, today),
        tags.length && st.state !== 'kept' && st.state !== 'broken' ? h('div', { class: 'badges' }, tags.map(t => h('span', { class: 'badge' }, t))) : null,
        st.state === 'broken' ? h('p', { class: 'hint' }, 'Did it on ' + Schedule.niceDate(st.on) + ' but could not tick it here? Tap that day\'s circle (the red one).') : null,
        h('div', { class: 'sk-btns' },
          st.state === 'active' && s.timer.enabled && h('button', { type: 'button', class: 'small primary', onclick: () => skTimer(s, st) }, 'Open timer'),
          (st.state === 'kept' || st.state === 'broken') && h('button', { type: 'button', class: 'small', onclick: () => openSkDialog(null, s) }, 'Take it again'),
          h('button', { type: 'button', class: 'small ghost', onclick: () => openSkDialog(s) }, 'Edit'))));
  }

  /* Which blocks of the Sankalpas page are hidden (Broken, Completed). Remembered on this device only. */
  const SK_HIDE_KEY = 'sva.skHidden';
  let skHidden = new Set();
  try { skHidden = new Set(JSON.parse(localStorage.getItem(SK_HIDE_KEY)) || []); } catch (e) { /* start with everything shown */ }

  function toggleSkHidden(key) {
    if (!skHidden.delete(key)) skHidden.add(key);
    try { localStorage.setItem(SK_HIDE_KEY, JSON.stringify([...skHidden])); } catch (e) { /* just not remembered */ }
    render();
  }

  /* A broken sankalpa counts as taken again when a later one carries the same name. */
  function skRetaken(s) {
    const name = s.title.trim().toLowerCase();
    return state.sankalpas.some(o => o !== s && o.start > s.start && o.title.trim().toLowerCase() === name);
  }

  function skRows() {
    const today = Schedule.today();
    const rows = state.sankalpas.map(s => ({ s, st: skStatus(s, today) }));
    const of = k => rows.filter(r => r.st.state === k);
    const byEnd = (a, b) => b.st.on.localeCompare(a.st.on);
    const allBroken = of('broken').sort(byEnd);
    return {
      today, rows,
      active: of('active').sort((a, b) => (a.s.time || '99:99').localeCompare(b.s.time || '99:99')),
      upcoming: of('upcoming').sort((a, b) => a.s.start.localeCompare(b.s.start)),
      kept: of('kept').sort(byEnd),
      broken: allBroken.filter(r => !skRetaken(r.s)),         // still waiting for you
      retaken: allBroken.filter(r => skRetaken(r.s)),         // history
    };
  }

  function renderSkHistory() {
    const { today, kept, retaken } = skRows();
    const head = h('div', { class: 'page-head' },
      h('div', null, h('p', { class: 'eyebrow' }, 'What is finished'), h('h1', null, 'History')));
    const block = (title, list) => (list.length ? h('section', { class: 'sk-block' },
      h('h2', null, title, h('span', { class: 'col-count' }, ' ' + list.length)),
      h('ul', { class: 'sks' }, list.map(r => skCard(r, today)))) : null);
    const empty = kept.length || retaken.length ? null : h('div', { class: 'empty' },
      h('p', null, 'Nothing here yet. A sankalpa comes here when you complete it, and a broken one comes here once you have taken it again.'));
    view.replaceChildren(...[head, empty, block('Completed', kept), block('Broken, and taken again', retaken)].filter(Boolean));
  }

  function renderSankalpas() {
    const { today, rows, active, upcoming, kept, broken, retaken } = skRows();
    const left = active.filter(r => !r.st.doneToday).length;

    const head = h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, active.length ? (left ? left + ' still to do today' : 'All done for today') : 'Sankalpa mode'),
        h('h1', null, 'Sankalpas')),
      h('div', { class: 'head-btns' },
        h('button', { type: 'button', class: 'primary', onclick: () => openSkDialog(null) }, '+ Sankalpa')));

    const tile = (value, label) => h('div', { class: 'tile' }, h('b', null, String(value)), h('span', null, label));
    const tiles = h('div', { class: 'tiles three' }, tile(active.length, 'Running'), tile(kept.length, 'Completed'), tile(broken.length + retaken.length, 'Broken'));

    const empty = active.length || upcoming.length || broken.length ? null : h('div', { class: 'empty' },
      h('p', null, rows.length ? 'Nothing running now.' : 'No sankalpas yet.'),
      h('p', null, ' A sankalpa is one thing you resolve to do every day, for a number of days you choose: brush your teeth at night for the next 14 days.'),
      h('p', null, 'Tick it each day. Complete it to the last day and one tangle of the yarn comes loose. Miss a day and that sankalpa is broken; if you did it and only could not tick it, tap that day\'s circle to mark it afterwards, and you can always take it again.'));

    // a block with a key can be hidden: its heading stays, with a Show button (remembered on this device)
    const block = (title, list, key) => {
      if (!list.length) return null;
      const shut = !!key && skHidden.has(key);
      return h('section', { class: 'sk-block' },
        h('h2', null, title, h('span', { class: 'col-count' }, ' ' + list.length),
          key && h('button', {
            type: 'button', class: 'small ghost sk-hide', 'aria-expanded': String(!shut),
            onclick: () => toggleSkHidden(key),
          }, shut ? 'Show' : 'Hide')),
        shut ? null : h('ul', { class: 'sks' }, list.map(r => skCard(r, today))));
    };

    view.replaceChildren(...[head, tiles, empty,
      block('Today', active), block('Not started yet', upcoming), block('Broken', broken, 'broken'),
      kept.length + retaken.length ? h('p', { class: 'hint' }, h('a', { href: '#history' }, (kept.length + retaken.length) + ' finished in History')) : null].filter(Boolean));
  }

  /* --- sankalpa form */

  let kctx = null;          // the sankalpa being edited, or null for a new one

  function openSkDialog(s, template) {
    kctx = s;
    const src = s || template;
    const today = Schedule.today();
    const begun = !!s && today >= s.start;
    $('sk-heading').textContent = s ? 'Edit sankalpa' : template ? 'Take it again' : 'New sankalpa';
    $('k-title').value = src ? src.title : '';
    $('k-desc').value = src ? src.description || '' : '';
    $('k-cat').value = src ? src.category : CATS[0].id;
    $('k-start').value = s ? s.start : today;
    $('k-days').value = src ? src.days : 14;
    $('k-start').disabled = $('k-days').disabled = begun;      // a vow that has begun does not get easier
    $('k-locked').hidden = !begun;
    $('k-time').value = src ? src.time || '' : '';
    $('k-rem').checked = !!(src && src.reminder.enabled);
    $('k-before').value = String(src ? src.reminder.before || 0 : 10);
    $('k-timer').checked = !!(src && src.timer.enabled);
    $('k-minutes').value = src ? src.timer.minutes || 15 : 15;
    $('k-dot').checked = !!(src && src.timer.dot);
    $('k-delete').hidden = !s;
    $('k-error').hidden = true;
    syncSkForm();
    $('sk-dialog').showModal();
  }

  function syncSkForm() {
    const canRemind = !!$('k-time').value;
    $('k-rem').disabled = !canRemind;
    if (!canRemind) $('k-rem').checked = false;
    $('k-rem-hint').hidden = canRemind;
    $('k-rem-fields').hidden = !$('k-rem').checked;
    $('k-timer-fields').hidden = !$('k-timer').checked;
  }

  $('sk-form').addEventListener('input', syncSkForm);
  $('sk-form').addEventListener('change', syncSkForm);

  $('sk-form').addEventListener('submit', e => {
    e.preventDefault();
    const fail = msg => { $('k-error').textContent = msg; $('k-error').hidden = false; };
    const title = $('k-title').value.trim();
    if (!title) return;
    const today = Schedule.today();
    const begun = !!kctx && today >= kctx.start;
    const start = begun ? kctx.start : $('k-start').value;
    const days = begun ? kctx.days : parseInt($('k-days').value, 10);
    if (!start) return fail('Pick the day it starts.');
    if (!begun && start < today) return fail('A sankalpa starts today or later.');
    if (!(days >= 1 && days <= 3650)) return fail('Say for how many days: a number from 1 to 3650.');
    const time = $('k-time').value;
    const fields = {
      title, description: $('k-desc').value.trim(), category: catId($('k-cat').value), start, days, time,
      reminder: { enabled: $('k-rem').checked && !!time, before: parseInt($('k-before').value, 10) || 0 },
      timer: {
        enabled: $('k-timer').checked,
        minutes: Math.min(600, Math.max(1, parseInt($('k-minutes').value, 10) || 15)),
        dot: $('k-dot').checked,
      },
    };
    if (kctx) {
      Object.assign(kctx, fields);
      for (const k of Object.keys(state.fired)) if (k.split('|')[0] === kctx.id) delete state.fired[k];
    } else {
      state.sankalpas.push(Object.assign({ id: uid(), done: {} }, fields));
    }
    if (fields.reminder.enabled && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (err) { /* in-page reminders still work */ }
    }
    save();
    $('sk-dialog').close();
    render();
  });

  $('k-delete').addEventListener('click', () => {
    const at = keptList().findIndex(r => r.s === kctx);
    const msg = at >= 0
      ? 'Delete "' + kctx.title + '"? It was completed, so its tangle goes back into the yarn.'
      : 'Delete "' + kctx.title + '"?';
    if (!confirm(msg)) return;
    if (at >= 0 && at < state.yarn.offset) state.yarn.offset--;      // it belonged to an earlier yarn
    state.sankalpas = state.sankalpas.filter(s => s !== kctx);
    save();
    $('sk-dialog').close();
    render();
  });

  $('k-cancel').addEventListener('click', () => $('sk-dialog').close());
  $('k-cat').replaceChildren(...CATS.map(c => h('option', { value: c.id }, c.name)));

  /* --- yarn settings */

  const isHex = v => /^#[0-9a-f]{6}$/i.test(v || '');
  let lotusPicked = '';          // '' = keep using the colour from main.css

  function lotusDefault() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--lotus').trim();
    return isHex(v) ? v : '#f29bb7';
  }

  $('yarn-settings').addEventListener('click', () => {
    const y = yarnData();
    $('y-total').value = y.total;
    $('y-total').min = Math.max(1, y.freed.length);
    $('y-now').textContent = y.freed.length + ' of ' + y.total + ' sankalpas completed so far on this picture.';
    lotusPicked = isHex(state.yarn.lotus) ? state.yarn.lotus : '';
    $('y-lotus').value = lotusPicked || lotusDefault();
    $('y-petals').value = state.yarn.petals === 'one' ? 'one' : 'area';
    $('y-lotus-field').hidden = $('y-petals').value !== 'one';
    $('yarn-dialog').showModal();
  });

  $('y-petals').addEventListener('change', () => { $('y-lotus-field').hidden = $('y-petals').value !== 'one'; });
  $('y-lotus').addEventListener('input', () => { lotusPicked = $('y-lotus').value; });
  $('y-lotus-reset').addEventListener('click', () => { lotusPicked = ''; $('y-lotus').value = lotusDefault(); });

  $('yarn-form').addEventListener('submit', e => {
    e.preventDefault();
    const y = yarnData();
    state.yarn.total = Math.min(2000, Math.max(1, y.freed.length, parseInt($('y-total').value, 10) || y.total));
    state.yarn.lotus = lotusPicked;
    state.yarn.petals = $('y-petals').value === 'one' ? 'one' : '';
    save();
    $('yarn-dialog').close();
    render();
  });

  $('y-again').addEventListener('click', () => {
    if (!confirm('Start again from the beginning? Your sankalpas stay; the lotus goes back to no petals and the yarn to fully tangled.')) return;
    state.yarn.offset = keptList().length;
    state.yarn.total = Math.min(2000, Math.max(1, parseInt($('y-total').value, 10) || state.yarn.total));
    save();
    $('yarn-dialog').close();
    render();
  });

  $('y-cancel').addEventListener('click', () => $('yarn-dialog').close());

  function cleanSankalpas(list) {
    const str = v => (typeof v === 'string' ? v : '');
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
    return (Array.isArray(list) ? list : []).filter(s => s && typeof s === 'object' && str(s.title) && isDate(s.start)).map(s => ({
      id: str(s.id) || uid(),
      title: str(s.title), description: str(s.description), category: catId(s.category),
      start: s.start,
      days: Math.min(3650, Math.max(1, parseInt(s.days, 10) || 1)),
      time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '',
      reminder: { enabled: !!(s.reminder && s.reminder.enabled), before: parseInt(s.reminder && s.reminder.before, 10) || 0 },
      timer: {
        enabled: !!(s.timer && s.timer.enabled),
        minutes: Math.min(600, Math.max(1, parseInt(s.timer && s.timer.minutes, 10) || 15)),
        dot: !!(s.timer && s.timer.dot),
      },
      done: Object.keys(s.done && typeof s.done === 'object' ? s.done : {}).filter(isDate).reduce((o, d) => { o[d] = true; return o; }, {}),
    }));
  }

  function cleanYarn(y) {
    return {
      total: Math.min(2000, Math.max(1, parseInt(y && y.total, 10) || 1000)),
      offset: Math.max(0, parseInt(y && y.offset, 10) || 0),
      lotus: /^#[0-9a-f]{6}$/i.test(y && y.lotus) ? y.lotus : '',
      petals: y && y.petals === 'one' ? 'one' : '',
    };
  }

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
        ? { goals: cleanGoals(got.goals), done: cleanDone(got.done), sankalpas: cleanSankalpas(got.sankalpas), yarn: cleanYarn(got.yarn), updated: Number(got.updated) || 0 }
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
          const haveS = new Set(remote.sankalpas.map(s => s.id));
          const extraS = state.sankalpas.filter(s => !haveS.has(s.id));
          state.goals = remote.goals.concat(extra);
          state.done = Object.assign({}, state.done, remote.done);
          state.sankalpas = remote.sankalpas.concat(extraS);
          state.yarn = remote.yarn;
          state.updated = extra.length || extraS.length ? Date.now() : remote.updated;
          state.dirty = extra.length + extraS.length > 0;
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
        state.sankalpas = remote.sankalpas;
        state.yarn = remote.yarn;
        state.updated = remote.updated;
        state.dirty = false;
        changed = true;
      } else if (!remote || remote.updated < state.updated) {
        state.dirty = true;
      }

      // the account still holds the old area names: write it back with the new ones
      if (remote && hasOldCats(got.goals) && !state.dirty) { state.updated = Date.now(); state.dirty = true; }

      persist();
      if (changed) render();

      if (state.dirty) {
        const sent = state.updated;
        await Cloud.push({ goals: state.goals, done: state.done, sankalpas: state.sankalpas, yarn: state.yarn, updated: sent });
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
    syncYarn();
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

  $('signout').addEventListener('click', () => {
    if (confirm('Sign out? Your data is removed from this device and stays in your account.')) signOut();
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
  applyMode();
  if (locked()) {
    lock();
  } else {
    render();
    if (signedIn()) { setSync('Syncing…'); sync(); }
  }
  checkReminders();
  setInterval(checkReminders, 15000);
})();
