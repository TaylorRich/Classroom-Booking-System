/* =============================================================
   config.js — Backend API location
   =============================================================
   Automatically picks the right backend depending on where the
   frontend itself is being served from:
     - localhost / 127.0.0.1 (running node server.js yourself)
       → '' so script.js calls relative /api/... paths, which hit
         the same local server.
     - anywhere else (e.g. Vercel)
       → your deployed Render backend URL.

   This means you never have to remember to flip this value back
   and forth between local testing and pushing to production.
   ============================================================= */
window.API_BASE_URL =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? ''
    : 'https://classroom-booking-system-16v4.onrender.com';
