# Sva

A personal board for three areas — Shareerik, Adhyaatmik, Maansik — with a
breathing dot built in. Plain files, no build step. You sign in, and your data
follows you to every device.

## Sankalpa mode

Sva opens in Sankalpa mode; the **Sankalpa / Goals** switch at the top changes
to the goals board and back, and each device remembers your choice. In Sankalpa
mode there are no long-term or short-term goals: a sankalpa is one thing you
resolve to do every day, for a number of days you choose (required). It has an
area and its colour, and can have a time, a reminder and a timer like a task.

- Tick it each day. **Miss a day and it is broken at once**; "Take it again"
  starts it over from day one.
- **Keep it to its last day** and one tangle of the yarn comes loose.
- **The yarn** is on screen the whole time in this mode: a tangled lump of
  thread in the three area colours, 1000 tangles to begin with. Each kept
  sankalpa pulls one knot out and lays it down neatly on the coil around the
  lump. The lump is 3D: it turns slowly by itself, and you can drag it with
  the mouse or a finger to spin it any way. "Yarn settings" changes the number
  of tangles or starts a fresh yarn.

## Run it

Open `https://palaksharma009.github.io/sva/` and sign in. (Double-clicking
`index.html` works too.)

## The app

- **Board** — what is on for the chosen day, one column per area. Click a task
  to see its details next to the board; tick it when it's done.
- **Progress** — a graph of your consistency over time, all three areas
  together: how much of what was on the calendar you ticked off, over the 7 days
  up to each date, today included. Miss a day and the line drops; keep going and
  it climbs back. A task with no date counts on the day you tick it.
- **Shareerik / Adhyaatmik / Maansik** — where you set things up:
  long-term goal → short-term goals → tasks. Tap the title of a long-term or
  short-term goal (or the arrow beside it) to fold it shut or open it again.
  To move a long-term goal to another area, drag it onto that area's name in
  the top bar, or pick the area in the goal's Edit form (the way to do it on a
  phone). To move a short-term goal, drag it onto another long-term goal on the
  same page, or pick the long-term goal in its Edit form (which also reaches
  goals in the other areas).
- **A task's nature** can differ from its goal's area: breathing practice
  (Adhyaatmik) for a running goal (Shareerik). Set **Nature** in the task form.
  The task stays under its goal, shows in its nature's column on the Board, and
  is also listed at the bottom of that area's page.
- **A task** can go on the calendar (once, or repeating daily / weekly /
  monthly, every N, until a date or for a number of times), can have a
  reminder, and can have a timer. Tick "Show the breathing dot" and the timer
  opens with the dot behind it.

Your data is kept in your account and a copy stays in the browser
(`localStorage`), so Sva works without signal and catches up afterwards.
Reminders only fire while the page is open in a tab.

## Login and sync

Sva is a public page, so the login is what keeps your data yours. It uses a
free Firebase project that you own:

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
   (Analytics can stay off).
2. **Build → Authentication → Get started → Email/Password → Enable**. Then
   **Users → Add user**: this email and password are your Sva login.
   Under **Settings → User actions**, untick **Enable create (sign-up)** so
   nobody else can make an account.
3. **Build → Firestore Database → Create database** (production mode), then
   **Rules** → replace everything with this and **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
4. **Project settings → General → Your apps → `</>` (Web)**, register an app,
   and copy `apiKey` and `projectId` into `cloud-config.js`.

Those two values are not secrets; your password and the rule above are the lock.
Sign out is on the About page. If two devices change things at the same time,
the most recent change wins.

## On a phone

Sva needs a web address to open on a phone. With GitHub Pages switched on for
this repo (Settings → Pages → Deploy from a branch → `main`, `/ (root)`), it
lives at `https://palaksharma009.github.io/sva/`.

Open that address in Chrome or Samsung Internet, then use the browser menu →
**Add to Home screen** / **Install app**. After that it opens like any other
app and works without signal.

Sign in with the same email and password and the phone shows the same data as
your computer. About → **Save a backup file** gives you a copy of your own.

| file | what it is |
|---|---|
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | what makes it installable and usable offline |
| `index.html`, `main.css`, `main.js` | the app |
| `cloud-config.js`, `sync.js` | which Firebase project to use, and the login + sync |
| `yarn.js`, `anime.min.js` | the yarn picture in Sankalpa mode, and the animation library it uses ([anime.js](https://animejs.com), MIT) |
| `schedule.js` | the repeat rules ("does this task fall on this day?") |
| `dot.html`, `styles.css`, `app.js`, `config.js` | the breathing dot, unchanged |

# The breathing dot

Everything below is about the dot on its own: use the "Breathing dot" button on
the Adhyaatmik page, or open `dot.html` directly.

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
