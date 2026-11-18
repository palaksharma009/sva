# Sva

A personal board for three areas — Physical, Spiritual, Intellectual — with a
breathing dot built in. Local files only — nothing is served, nothing phones home.

## Run it

Double-click `index.html`. That's the whole install.

## The app

- **Board** — what is on for the chosen day, one column per area. Click a task
  to see its details next to the board; tick it when it's done.
- **Physical / Spiritual / Intellectual** — where you set things up:
  long-term goal → short-term goals → tasks.
- **A task** can go on the calendar (once, or repeating daily / weekly /
  monthly, every N, until a date or for a number of times), can have a
  reminder, and can have a timer. Tick "Show the breathing dot" and the timer
  opens with the dot behind it.

Everything is saved in this browser (`localStorage`). Reminders only fire while
the page is open in a tab.

| file | what it is |
|---|---|
| `index.html`, `main.css`, `main.js` | the app |
| `schedule.js` | the repeat rules ("does this task fall on this day?") |
| `dot.html`, `styles.css`, `app.js`, `config.js` | the breathing dot, unchanged |

# The breathing dot

Everything below is about the dot on its own: use the "Breathing dot" button on
the Spiritual page, or open `dot.html` directly.

The About page text is in `index.html`, inside `<template id="about-content">`.

(Optional: if you want the "keep the screen awake" setting to work, browsers only
allow that on `localhost`/https. Run `python -m http.server 8000` in this folder
and open `http://localhost:8000`.)

## Two ways to set it up

**`config.js`** — the defaults. Edit, save, refresh.

**The three dots** in the corner → *Settings* — the same options, live, while
the dot is breathing. Anything you change there is saved in your browser and
overrides `config.js`.

> Because of that override: if you edit `config.js` and the page ignores you,
> it's because you'd changed something in Settings before. Hit **Reset to file**
> in Settings and `config.js` is back in charge.
>
> Going the other way, **Copy config** in Settings gives you the current setup as
> code — paste it over `config.js` to make it the permanent default.

## The breath

A list of steps, played top to bottom, then looped:

```js
breath: [
  { label: 'Inhale', duration: 4, from: 18, to: 62, easing: 'sine'   },
  { label: 'Hold',   duration: 8, from: 62, to: 62, easing: 'linear' },
  { label: 'Exhale', duration: 8, from: 62, to: 18, easing: 'sine'   },
  { label: 'Hold',   duration: 4, from: 18, to: 18, easing: 'linear' },
]
```

| field | what it does |
|---|---|
| `duration` | seconds this step takes |
| `from` / `to` | dot diameter at the start / end of the step, as a % of the shorter side of your screen (1–100) |
| `easing` | `sine` (slow at both ends, best for breathing), `linear`, `in`, `out`, `inOut`, `hold` |

Rules of thumb:

- **Hold still** → put the same number in `from` and `to`.
- **No jumps** → each step's `from` should match the previous step's `to`. (The
  Settings editor keeps these in step for you automatically.)
- Add or delete as many steps as you like — four is just a common box breath.

**Freeze** parks the dot at one size and ignores the sequence entirely, for when
you just want something still to look at. **Space** does a softer version:
pauses wherever the dot happens to be right now.

## Everything else in `config.js`

- `colors` — background and dot, solid hex, nothing else
- `labels` — the words and the countdown; both **off** by default, so the page is
  a dot and nothing more
- `menu` — which corner the three dots sit in, whether they fade out when the
  mouse stops. Set `show: false` and the page is completely bare; **S** still
  opens Settings.
- `startDelay` — seconds of stillness before the first breath
- `keepAwake` — stop the screen sleeping (needs localhost/https, see above)

## Keys

| | |
|---|---|
| `S` | settings |
| `Space` | pause / resume |
| `R` | restart the cycle |
| `F` | fullscreen |
| `Esc` | close |
