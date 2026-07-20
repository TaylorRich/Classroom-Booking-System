/* =============================================================
   config.js — Backend API location
   =============================================================
   Local dev (frontend served by the same Express server as the API):
     Leave this as '' — script.js will call relative /api/... paths,
     which hit the same origin (e.g. http://localhost:3000).

   Production on Vercel:
     The frontend is now on a different domain than the backend, so
     relative /api/... calls would hit Vercel itself and 404.
     Set this to your deployed backend's full URL (no trailing slash),
     e.g. 'https://classroom-booking-backend.onrender.com'
   ============================================================= */
window.API_BASE_URL = 'https://classroom-booking-system-16v4.onrender.com';
