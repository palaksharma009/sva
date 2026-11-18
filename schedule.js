/* ============================================================================
   Schedule — "does this task fall on this day?"
   Dates are plain 'YYYY-MM-DD' strings in local time. Weeks start on Monday.

   A schedule looks like:
     { start: '2026-11-18', time: '07:00' | '',
       repeat: 'none' | 'daily' | 'weekly' | 'monthly',
       interval: 1,                  // every N days / weeks / months
       weekdays: [1, 3],             // weekly only; 0 = Sunday ... 6 = Saturday
       end: 'never' | 'until' | 'count',
       until: '2026-12-31', count: 10 }
   ============================================================================ */

const Schedule = (function () {
  'use strict';

  const DAY = 864e5;
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // noon, so daylight-saving shifts never push a date across midnight
  function parse(s) {
    const p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12);
  }

  function fmt(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function today() { return fmt(new Date()); }

  function addDays(s, n) {
    const d = parse(s);
    d.setDate(d.getDate() + n);
    return fmt(d);
  }

  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / DAY); }

  function weekStart(s) {
    const d = parse(s);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return fmt(d);
  }

  function every(s) { return Math.max(1, parseInt(s.interval, 10) || 1); }

  /* The repeat pattern only — ignores the end condition. */
  function matches(s, date) {
    if (date < s.start) return false;
    const n = every(s);
    switch (s.repeat) {
      case 'daily':
        return diffDays(s.start, date) % n === 0;
      case 'weekly': {
        const days = s.weekdays && s.weekdays.length ? s.weekdays : [parse(s.start).getDay()];
        if (!days.includes(parse(date).getDay())) return false;
        return (diffDays(weekStart(s.start), weekStart(date)) / 7) % n === 0;
      }
      case 'monthly': {
        const a = parse(s.start), b = parse(date);
        if (a.getDate() !== b.getDate()) return false;
        return ((b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()) % n === 0;
      }
      default:
        return date === s.start;
    }
  }

  function occursOn(s, date) {
    if (!s || !s.start || !matches(s, date)) return false;
    if (!s.repeat || s.repeat === 'none') return true;
    if (s.end === 'until' && s.until && date > s.until) return false;
    if (s.end === 'count') {
      const max = Math.max(1, parseInt(s.count, 10) || 1);
      let seen = 0;
      for (let d = s.start; d <= date; d = addDays(d, 1)) {
        if (matches(s, d) && ++seen > max) return false;
      }
    }
    return true;
  }

  function niceDate(s) {
    return parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* "Every 2 weeks on Mon, Wed at 07:00, until 31 Dec 2026" */
  function describe(s) {
    if (!s || !s.start) return 'Not on the calendar';
    const n = every(s);
    let text;
    if (s.repeat === 'daily') {
      text = n === 1 ? 'Every day' : 'Every ' + n + ' days';
    } else if (s.repeat === 'weekly') {
      const days = (s.weekdays && s.weekdays.length ? s.weekdays : [parse(s.start).getDay()])
        .slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map(d => DAY_NAMES[d]).join(', ');
      text = (n === 1 ? 'Every week' : 'Every ' + n + ' weeks') + ' on ' + days;
    } else if (s.repeat === 'monthly') {
      text = (n === 1 ? 'Every month' : 'Every ' + n + ' months') + ' on day ' + parse(s.start).getDate();
    } else {
      text = 'Once on ' + niceDate(s.start);
    }
    if (s.time) text += ' at ' + s.time;
    if (s.repeat && s.repeat !== 'none') {
      if (s.end === 'until' && s.until) text += ', until ' + niceDate(s.until);
      else if (s.end === 'count') text += ', ' + Math.max(1, parseInt(s.count, 10) || 1) + ' times';
      if (s.start > today()) text += ', from ' + niceDate(s.start);
    }
    return text;
  }

  return { parse, fmt, today, addDays, diffDays, occursOn, describe, niceDate };
})();
