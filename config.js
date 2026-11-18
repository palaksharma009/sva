/* ============================================================================
   dot — configuration

   Everything lives here. Edit, save, refresh the page.

   Note: changes you make in the in-page Settings modal are saved in your
   browser and override this file. Hit "Reset to file" in Settings to go back
   to whatever is written below.
   ============================================================================ */

const CONFIG = {

  /* --- colors (solid only) --------------------------------------------- */
  colors: {
    background: '#0d0f12',
    dot:        '#e9e4da',
  },

  /* --- the breath ------------------------------------------------------
     A list of steps, played top to bottom, then looped.

       label    : name of the step (only shown if labels.show is true)
       duration : seconds this step takes
       from     : dot diameter at the start of the step
       to       : dot diameter at the end of the step
                  (sizes are % of the shorter side of the screen, 1-100)
       easing   : how it travels from -> to
                  'sine'   smooth, slow at both ends (best for breathing)
                  'linear' constant speed
                  'in'     starts slow, ends fast
                  'out'    starts fast, ends slow
                  'inOut'  slow, fast, slow (stronger than sine)
                  'hold'   doesn't move, then snaps at the end

     A step that holds still = same number in `from` and `to`.
     Add as many steps as you like. Delete any you don't want.
     ------------------------------------------------------------------- */
  breath: [
    { label: 'Inhale', duration: 4, from: 18, to: 62, easing: 'sine'   },
    { label: 'Hold',   duration: 8, from: 62, to: 62, easing: 'linear' },
    { label: 'Exhale', duration: 8, from: 62, to: 18, easing: 'sine'   },
    { label: 'Hold',   duration: 4, from: 18, to: 18, easing: 'linear' },
  ],

  /* --- freeze ----------------------------------------------------------
     Ignore the sequence entirely and park the dot at one size.
     (Spacebar pauses at the current size instead, without touching this.)
     ------------------------------------------------------------------- */
  freeze: {
    enabled: false,
    size:    40,
  },

  /* --- text on screen (off = a bare dot, nothing else) ------------------ */
  labels: {
    show:      false,   // the words Inhale / Hold / Exhale
    countdown: false,   // seconds left in the current step
    color:     '#6d7076',
    size:      13,      // px
  },

  /* --- the three dots in the corner ------------------------------------ */
  menu: {
    show:     true,             // false = fully invisible page; press S for settings
    position: 'bottom-right',   // bottom-right | bottom-left | top-right | top-left
    autoHide: true,             // fade out when the mouse stops moving
  },

  /* --- misc ------------------------------------------------------------ */
  startDelay: 0,      // seconds of stillness before the first breath begins
  keepAwake:  true,   // try to stop the screen from sleeping (needs localhost/https)
};
