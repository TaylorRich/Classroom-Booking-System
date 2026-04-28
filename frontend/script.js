/* =============================================================
   script.js — Central University Classroom Booking System
   ============================================================= */

// ─────────────────────────────────────────────────────────────
// SHARED UTILITIES
// ─────────────────────────────────────────────────────────────

const Auth = {
  getToken() { return localStorage.getItem('token'); },
  getUser()  { return JSON.parse(localStorage.getItem('user') || 'null'); },
  save(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },
  clear() { localStorage.clear(); },
  redirectByRole(role, mustChangePassword) {
    if (mustChangePassword) { window.location.href = 'changepassword.html'; return; }
    const map = { superadmin: 'superadmin.html', admin: 'admin.html', course_rep: 'courserep.html' };
    window.location.href = map[role] || 'index.html';
  }
};

// Central fetch wrapper — always returns the response object or null
async function api(method, path, body) {
  try {
    const res = await fetch('/api' + path, {
      method,
      headers: {
        'Authorization': `Bearer ${Auth.getToken()}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { Auth.clear(); window.location.href = 'index.html'; return null; }
    return res;
  } catch (err) {
    console.error('Network error on', method, path, err);
    showToast('Network error — is the server running?', 'error');
    return null;
  }
}

// Safe JSON parse — always returns an array or object, never crashes
async function safeJson(res, fallback = []) {
  if (!res) return fallback;
  try { return await res.json(); }
  catch { return fallback; }
}

function showModal(id)  { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }
function $(id) { return document.getElementById(id); }

let _toastTimer;
function showToast(msg, type = 'success') {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = `alert alert-${type} toast`;
  t.textContent = msg;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t?.remove(), 3500);
}

function fmt(dt) {
  return new Date(dt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function avg(arr, key) {
  if (!arr || !arr.length) return null;
  return (arr.reduce((s, c) => s + (c[key] || 0), 0) / arr.length).toFixed(1);
}

function roundUpHour() {
  const d = new Date(); d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1); return d;
}

function toLocalInput(dt) {
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function initPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target || 'password';
      const input = $(targetId);
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      const eyeOn  = $('eyeIcon');
      const eyeOff = $('eyeOffIcon');
      if (eyeOn && eyeOff) {
        eyeOn.style.display  = isHidden ? 'none' : '';
        eyeOff.style.display = isHidden ? ''     : 'none';
      }
      btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });
  });
}

function initTabs(containerId) {
  const container = $(containerId);
  if (!container) return;
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab)?.classList.add('active');
    });
  });
}

// ─────────────────────────────────────────────────────────────
// LOGIN PAGE
// ─────────────────────────────────────────────────────────────

const LoginPage = {
  tempToken: null,   // holds partial JWT during 2FA step
  isSetup:   false,  // true when we're on first-time 2FA setup screen

  init() {
    const token = Auth.getToken();
    const user  = Auth.getUser();
    if (token && user) { Auth.redirectByRole(user.role); return; }

    initPasswordToggles();
    this._inject2FAModal();

    const INDEX_PATTERN = /^[a-zA-Z]+\/.+$/;

    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn      = $('loginBtn');
      const alertEl  = $('loginAlert');
      alertEl.style.display = 'none';
      btn.innerHTML  = '<span class="loader"></span> Signing in…';
      btn.disabled   = true;

      const identifier = $('identifier').value.trim();
      const password   = $('password').value;

      const body = INDEX_PATTERN.test(identifier)
        ? { indexNumber: identifier, password }
        : { username: identifier, password };

      try {
        const res  = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();

        if (res.ok) {
          if (data.requiresTwoFactorSetup) {
            this.tempToken = data.tempToken;
            this.isSetup   = true;
            this._show2FASetup(data.qrCodeUrl, data.secret);
            btn.innerHTML = 'Sign In';
            btn.disabled  = false;
          } else if (data.requiresTwoFactor) {
            this.tempToken = data.tempToken;
            this.isSetup   = false;
            this._show2FAVerify();
            btn.innerHTML = 'Sign In';
            btn.disabled  = false;
          } else {
            Auth.save(data.token, data.user);
            Auth.redirectByRole(data.user.role, data.user.mustChangePassword);
          }
        } else {
          alertEl.textContent   = data.error || 'Invalid credentials. Please try again.';
          alertEl.style.display = 'block';
          btn.innerHTML = 'Sign In';
          btn.disabled  = false;
        }
      } catch {
        alertEl.textContent   = 'Cannot reach server. Make sure the backend is running.';
        alertEl.style.display = 'block';
        btn.innerHTML = 'Sign In';
        btn.disabled  = false;
      }
    });
  },

  _inject2FAModal() {
    const modal = document.createElement('div');
    modal.id = 'twoFAModal';
    modal.style.cssText = `
      display:none; position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,0.6); align-items:center; justify-content:center;
    `;
    modal.innerHTML = `
      <div style="background:#fff; border-radius:16px; padding:2rem; max-width:420px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div id="twoFASetupSection" style="display:none;">
          <h2 style="margin:0 0 0.5rem; font-size:1.3rem; color:#1e293b;">🔐 Set Up Two-Factor Authentication</h2>
          <p style="color:#64748b; font-size:0.9rem; margin:0 0 1rem;">
            Scan this QR code with <strong>Google Authenticator</strong> (or any TOTP app), then enter the 6-digit code to confirm.
          </p>
          <div style="text-align:center; margin-bottom:1rem;">
            <img id="twoFAQR" src="" alt="QR Code" style="width:200px; height:200px; border:1px solid #e2e8f0; border-radius:8px;">
          </div>
          <details style="margin-bottom:1rem;">
            <summary style="cursor:pointer; color:#64748b; font-size:0.8rem;">Can't scan? Enter key manually</summary>
            <code id="twoFASecret" style="display:block; background:#f1f5f9; padding:0.5rem; border-radius:6px; font-size:0.85rem; word-break:break-all; margin-top:0.5rem;"></code>
          </details>
        </div>
        <div id="twoFAVerifySection" style="display:none;">
          <h2 style="margin:0 0 0.5rem; font-size:1.3rem; color:#1e293b;">🔑 Two-Factor Authentication</h2>
          <p style="color:#64748b; font-size:0.9rem; margin:0 0 1rem;">
            Open <strong>Google Authenticator</strong> and enter the 6-digit code for this account.
          </p>
        </div>
        <div id="twoFAError" style="display:none; background:#fef2f2; color:#dc2626; border:1px solid #fca5a5; border-radius:8px; padding:0.75rem; margin-bottom:1rem; font-size:0.875rem;"></div>
        <div style="display:flex; gap:0.5rem; flex-direction:column;">
          <input id="totpCodeInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
            placeholder="Enter 6-digit code"
            style="width:100%; box-sizing:border-box; padding:0.75rem 1rem; border:1.5px solid #cbd5e1; border-radius:8px; font-size:1.1rem; text-align:center; letter-spacing:0.3em; outline:none;"
            autocomplete="one-time-code">
          <button id="twoFASubmitBtn" style="width:100%; padding:0.75rem; background:#3b5bdb; color:#fff; border:none; border-radius:8px; font-size:1rem; font-weight:600; cursor:pointer;">
            Verify
          </button>
          <button id="twoFACancelBtn" style="width:100%; padding:0.6rem; background:none; border:none; color:#94a3b8; font-size:0.875rem; cursor:pointer;">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    $('twoFASubmitBtn').addEventListener('click', () => this._submitTOTP());
    $('twoFACancelBtn').addEventListener('click', () => this._hide2FAModal());
    $('totpCodeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._submitTOTP(); });
    $('totpCodeInput').addEventListener('input', (e) => {
      if (e.target.value.replace(/\D/g,'').length === 6) this._submitTOTP();
    });
  },

  _show2FASetup(qrCodeUrl, secret) {
    $('twoFASetupSection').style.display = 'block';
    $('twoFAVerifySection').style.display = 'none';
    $('twoFAQR').src = qrCodeUrl;
    $('twoFASecret').textContent = secret || '';
    $('twoFAError').style.display = 'none';
    $('totpCodeInput').value = '';
    $('twoFASubmitBtn').textContent = 'Confirm Setup';
    const modal = $('twoFAModal');
    modal.style.display = 'flex';
    setTimeout(() => $('totpCodeInput').focus(), 100);
  },

  _show2FAVerify() {
    $('twoFASetupSection').style.display = 'none';
    $('twoFAVerifySection').style.display = 'block';
    $('twoFAError').style.display = 'none';
    $('totpCodeInput').value = '';
    $('twoFASubmitBtn').textContent = 'Verify';
    const modal = $('twoFAModal');
    modal.style.display = 'flex';
    setTimeout(() => $('totpCodeInput').focus(), 100);
  },

  _hide2FAModal() {
    $('twoFAModal').style.display = 'none';
    this.tempToken = null;
    this.isSetup   = false;
  },

  async _submitTOTP() {
    const code = $('totpCodeInput').value.replace(/\D/g, '').trim();
    const errorEl = $('twoFAError');
    const btn = $('twoFASubmitBtn');

    errorEl.style.display = 'none';
    if (code.length !== 6) {
      errorEl.textContent = 'Please enter the full 6-digit code.';
      errorEl.style.display = 'block';
      return;
    }

    btn.textContent = '…';
    btn.disabled = true;

    const endpoint = this.isSetup ? '/api/auth/confirm-2fa-setup' : '/api/auth/verify-2fa';
    try {
      const res  = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken: this.tempToken, totpCode: code })
      });
      const data = await res.json();

      if (res.ok) {
        if (data.newTotpSecret) {
          alert(`✅ 2FA setup complete!\n\nAdd this line to your backend .env file and restart the server:\n\nSUPERADMIN_TOTP_SECRET=${data.newTotpSecret}`);
        }
        this._hide2FAModal();
        Auth.save(data.token, data.user);
        Auth.redirectByRole(data.user.role, data.user.mustChangePassword);
      } else {
        errorEl.textContent = data.error || 'Invalid code. Please try again.';
        errorEl.style.display = 'block';
        $('totpCodeInput').value = '';
        $('totpCodeInput').focus();
        btn.textContent = this.isSetup ? 'Confirm Setup' : 'Verify';
        btn.disabled = false;
      }
    } catch {
      errorEl.textContent = 'Cannot reach server.';
      errorEl.style.display = 'block';
      btn.textContent = this.isSetup ? 'Confirm Setup' : 'Verify';
      btn.disabled = false;
    }
  }
};

// ─────────────────────────────────────────────────────────────
// COURSE REP PAGE
// ─────────────────────────────────────────────────────────────

const CourseRepPage = {
  user: null,
  allClassrooms: [],
  pendingBookingId: null,
  pendingReviewId: null,
  pendingUnlock: null,

  init() {
    this.user = Auth.getUser();
    if (!Auth.getToken() || !this.user || this.user.role !== 'course_rep') {
      Auth.clear(); window.location.href = 'index.html'; return;
    }

    $('navUsername').textContent = this.user.fullName || this.user.indexNumber || 'Course Rep';
    if (this.user.department) $('deptLabel').textContent = '📚 ' + this.user.department;

    $('logoutBtn').addEventListener('click',        () => { Auth.clear(); window.location.href = 'index.html'; });
    $('searchInput').addEventListener('input',      () => this.filterClassrooms());
    $('closeBookModal').addEventListener('click',   () => closeModal('bookModal'));
    $('cancelBookBtn').addEventListener('click',    () => closeModal('bookModal'));
    $('bookForm').addEventListener('submit',        (e) => this.submitBooking(e));
    $('closeReviewModal').addEventListener('click', () => closeModal('reviewModal'));
    $('skipReviewBtn').addEventListener('click',    () => closeModal('reviewModal'));
    $('reviewForm').addEventListener('submit',      (e) => this.submitReview(e));
    $('closeUnlockModal').addEventListener('click', () => closeModal('unlockModal'));
    $('cancelUnlockBtn').addEventListener('click',  () => closeModal('unlockModal'));
    $('confirmUnlockBtn').addEventListener('click', () => this.confirmUnlock());

    this.loadClassrooms();
  },

  async loadClassrooms() {
    const grid = $('classroomsGrid');
    grid.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>Loading classrooms…</p></div>`;

    const res  = await api('GET', '/classrooms');
    const data = await safeJson(res, []);

    if (!Array.isArray(data)) {
      grid.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${data.error || 'Failed to load classrooms.'}</p></div>`;
      return;
    }

    this.allClassrooms = data;
    this.renderAll();
  },

  filterClassrooms() {
    const q = $('searchInput').value.toLowerCase();
    this.renderGrid(this.allClassrooms.filter(c => c.name.toLowerCase().includes(q)));
  },

  renderAll() {
    this.renderBanner();
    this.renderGrid(this.allClassrooms);
  },

  renderBanner() {
    const now = new Date();
    const myActive = [];
    this.allClassrooms.forEach(c => {
      c.bookings.forEach(b => {
        if (b.status === 'active' && new Date(b.endTime) > now && b.courseRep?._id === this.user.id) {
          myActive.push({ classroom: c, booking: b });
        }
      });
    });
    const banner = $('myBookingsBanner');
    if (!myActive.length) { banner.innerHTML = ''; return; }

    banner.innerHTML = `
      <div class="card banner-card">
        <div class="card-header"><h3>🔴 My Active Bookings</h3></div>
        ${myActive.map(({ classroom: c, booking: b }) => `
          <div class="banner-row">
            <div>
              <strong>${c.name}</strong>
              <div class="booking-time">${fmt(b.startTime)} → ${fmt(b.endTime)}</div>
            </div>
            <div class="banner-actions">
              <button class="btn btn-sm btn-unlock" data-action="unlock"
                data-cid="${c._id}" data-bid="${b._id}" data-name="${c.name}">🔓 Unlock Early</button>
              <button class="btn btn-sm btn-gold" data-action="review" data-cid="${c._id}">💬 Review</button>
            </div>
          </div>`).join('')}
      </div>`;

    banner.querySelectorAll('[data-action="unlock"]').forEach(btn =>
      btn.addEventListener('click', () => this.openUnlock(btn.dataset.cid, btn.dataset.bid, btn.dataset.name)));
    banner.querySelectorAll('[data-action="review"]').forEach(btn =>
      btn.addEventListener('click', () => this.openReview(btn.dataset.cid)));
  },

  renderGrid(list) {
    const grid = $('classroomsGrid');
    if (!list || !list.length) {
      grid.innerHTML = `<div class="empty-state"><div class="icon">🏫</div><p>No classrooms found.</p></div>`;
      return;
    }
    const now = new Date();
    grid.innerHTML = list.map(c => {
      const activeBooking = c.bookings.find(b => b.status === 'active' && new Date(b.endTime) > now);
      const locked = !!activeBooking;
      const isMyBooking = activeBooking && activeBooking.courseRep?._id === this.user.id;
      const avgP = avg(c.comments, 'projector');
      const avgD = avg(c.comments, 'desks');
      const avgS = avg(c.comments, 'speakers');
      return `
        <div class="classroom-card ${locked ? 'locked' : ''}">
          <div class="classroom-header">
            <div>
              <div class="classroom-name">${c.name}</div>
              <div class="classroom-capacity">👥 Capacity: ${c.capacity}</div>
            </div>
            <span class="status-badge ${locked ? 'status-locked' : 'status-available'}">
              ${locked ? '🔒 Locked' : '✅ Available'}
            </span>
          </div>
          ${c.resources?.length ? `<div class="resources-list">${c.resources.map(r => `<span class="resource-chip">${r}</span>`).join('')}</div>` : ''}
          ${locked ? `<div class="booking-time">
            🔒 Booked by <strong>${activeBooking.courseRep?.fullName || activeBooking.courseRep?.indexNumber || 'Someone'}</strong>
            ${activeBooking.courseRep?.department ? '(' + activeBooking.courseRep.department + ')' : ''}<br>Until: ${fmt(activeBooking.endTime)}
          </div>` : ''}
          ${avgP ? `
            <div class="ratings-row">
              <div class="rating-item"><div class="rating-score">${avgP}</div><div class="rating-label">Projector</div></div>
              <div class="rating-item"><div class="rating-score">${avgD}</div><div class="rating-label">Desks</div></div>
              <div class="rating-item"><div class="rating-score">${avgS}</div><div class="rating-label">Audio</div></div>
            </div>` : ''}
          <div class="card-actions">
            <button class="btn btn-primary btn-sm" style="flex:1;"
              ${locked ? 'disabled' : ''}
              data-action="book" data-cid="${c._id}" data-name="${c.name}">📅 Book</button>
            ${isMyBooking ? `<button class="btn btn-unlock btn-sm"
              data-action="unlock" data-cid="${c._id}" data-bid="${activeBooking._id}" data-name="${c.name}">🔓 Unlock</button>` : ''}
            <button class="btn btn-outline btn-sm" data-action="review" data-cid="${c._id}">💬 Review</button>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('[data-action="book"]').forEach(btn =>
      btn.addEventListener('click', () => this.openBook(btn.dataset.cid, btn.dataset.name)));
    grid.querySelectorAll('[data-action="unlock"]').forEach(btn =>
      btn.addEventListener('click', () => this.openUnlock(btn.dataset.cid, btn.dataset.bid, btn.dataset.name)));
    grid.querySelectorAll('[data-action="review"]').forEach(btn =>
      btn.addEventListener('click', () => this.openReview(btn.dataset.cid)));
  },

  openBook(id, name) {
    this.pendingBookingId = id;
    $('bookModalTitle').textContent = `Book ${name}`;
    const start = roundUpHour();
    const end   = new Date(start.getTime() + 60 * 60 * 1000);
    $('startTime').value = toLocalInput(start);
    $('endTime').value   = toLocalInput(end);
    $('bookAlert').innerHTML = '';
    showModal('bookModal');
  },

  async submitBooking(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const body = { startTime: fd.get('startTime'), endTime: fd.get('endTime') };
    const res  = await api('POST', `/classrooms/${this.pendingBookingId}/book`, body);
    const data = await safeJson(res, {});
    if (res && res.ok) {
      closeModal('bookModal');
      showToast('Classroom booked successfully!');
      await this.loadClassrooms();
      setTimeout(() => this.openReview(this.pendingBookingId), 500);
    } else {
      $('bookAlert').innerHTML = `<div class="alert alert-error">${data.error || 'Booking failed.'}</div>`;
    }
  },

  openReview(id) {
    this.pendingReviewId = id;
    $('reviewAlert').innerHTML = '';
    $('reviewForm').reset();
    showModal('reviewModal');
  },

  async submitReview(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const body = { projector: fd.get('projector'), desks: fd.get('desks'), speakers: fd.get('speakers'), comments: fd.get('comments') };
    const res  = await api('POST', `/classrooms/${this.pendingReviewId}/comment`, body);
    const data = await safeJson(res, {});
    if (res && res.ok) {
      closeModal('reviewModal');
      showToast('Review submitted. Thank you!');
      this.loadClassrooms();
    } else {
      $('reviewAlert').innerHTML = `<div class="alert alert-error">${data.error || 'Review failed.'}</div>`;
    }
  },

  openUnlock(classroomId, bookingId, name) {
    this.pendingUnlock = { classroomId, bookingId };
    $('unlockRoomName').textContent = name;
    showModal('unlockModal');
  },

  async confirmUnlock() {
    const { classroomId, bookingId } = this.pendingUnlock;
    const res  = await api('PATCH', `/classrooms/${classroomId}/unlock/${bookingId}`);
    const data = await safeJson(res, {});
    if (res && res.ok) {
      closeModal('unlockModal');
      showToast('Classroom unlocked successfully!');
      this.loadClassrooms();
    } else {
      showToast(data.error || 'Failed to unlock', 'error');
    }
  }
};

// ─────────────────────────────────────────────────────────────
// ADMIN PAGE
// ─────────────────────────────────────────────────────────────

const PRESET_RESOURCES = ['Projector','Speakers','Whiteboard','Air Conditioning','Smart Board','Microphone','Video Camera','Computers'];

const AdminPage = {
  user: null,
  allClassrooms: [],
  allReps: [],
  customResources: [],
  confirmCallback: null,

  init() {
    this.user = Auth.getUser();
    if (!Auth.getToken() || !this.user || this.user.role !== 'admin') {
      Auth.clear(); window.location.href = 'index.html'; return;
    }

    $('navUsername').textContent = this.user.username || this.user.fullName || 'Admin';
    $('logoutBtn').addEventListener('click', () => { Auth.clear(); window.location.href = 'index.html'; });

    initTabs('adminTabs');
    initPasswordToggles();

    $('addClassroomBtn').addEventListener('click',      () => this.openAddClassroom());
    $('closeClassroomModal').addEventListener('click',  () => closeModal('classroomModal'));
    $('cancelClassroomBtn').addEventListener('click',   () => closeModal('classroomModal'));
    $('addCustomResourceBtn').addEventListener('click', () => this.addCustomResource());
    $('classroomForm').addEventListener('submit',       (e) => this.submitClassroom(e));

    $('addRepBtn').addEventListener('click',        () => this.openAddRep());
    $('closeAddRepModal').addEventListener('click', () => closeModal('addRepModal'));
    $('cancelAddRepBtn').addEventListener('click',  () => closeModal('addRepModal'));
    $('addRepForm').addEventListener('submit',      (e) => this.submitAddRep(e));

    $('closeConfirmModal').addEventListener('click', () => closeModal('confirmModal'));
    $('cancelConfirmBtn').addEventListener('click',  () => closeModal('confirmModal'));
    $('confirmActionBtn').addEventListener('click',  () => { closeModal('confirmModal'); this.confirmCallback?.(); });

    this.loadAll();
  },

  async loadAll() {
    ['statRooms','statReps','statBookings','statReviews'].forEach(id => { if ($(id)) $(id).textContent = '…'; });

    const [resC, resU] = await Promise.all([
      api('GET', '/classrooms/all'),
      api('GET', '/auth/users')
    ]);

    const classroomsData = await safeJson(resC, []);
    const usersData      = await safeJson(resU, []);

    if (!Array.isArray(classroomsData)) {
      showToast(classroomsData.error || 'Failed to load classrooms.', 'error');
      $('classroomsGrid').innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${classroomsData.error || 'Could not load classrooms.'}</p></div>`;
      return;
    }
    if (!Array.isArray(usersData)) {
      showToast(usersData.error || 'Failed to load users.', 'error');
      return;
    }

    this.allClassrooms = classroomsData;
    this.allReps       = usersData.filter(u => u.role === 'course_rep');

    this.updateStats();
    this.renderClassrooms();
    this.renderReps();
    this.renderReviews();
  },

  updateStats() {
    const now = new Date();
    const activeBookings = this.allClassrooms.reduce((s, c) =>
      s + c.bookings.filter(b => b.status === 'active' && new Date(b.endTime) > now).length, 0);
    const totalReviews = this.allClassrooms.reduce((s, c) => s + c.comments.length, 0);
    $('statRooms').textContent    = this.allClassrooms.filter(c => c.isActive).length;
    $('statReps').textContent     = this.allReps.length;
    $('statBookings').textContent = activeBookings;
    $('statReviews').textContent  = totalReviews;
  },

  renderClassrooms() {
    const now  = new Date();
    const grid = $('classroomsGrid');
    if (!this.allClassrooms.length) {
      grid.innerHTML = `<div class="empty-state"><div class="icon">🏫</div><p>No classrooms yet. Add one above.</p></div>`;
      return;
    }
    grid.innerHTML = this.allClassrooms.map(c => {
      const activeBooking = c.bookings.find(b => b.status === 'active' && new Date(b.endTime) > now);
      const locked = !!activeBooking;
      return `
        <div class="classroom-card ${!c.isActive ? 'locked' : ''}">
          <div class="classroom-header">
            <div>
              <div class="classroom-name">${c.name}</div>
              <div class="classroom-capacity">👥 ${c.capacity}</div>
            </div>
            <span class="status-badge ${c.isActive ? (locked ? 'status-locked' : 'status-available') : 'status-locked'}">
              ${!c.isActive ? '❌ Inactive' : locked ? '🔒 Locked' : '✅ Active'}
            </span>
          </div>
          ${c.resources?.length ? `<div class="resources-list">${c.resources.map(r => `<span class="resource-chip">${r}</span>`).join('')}</div>` : ''}
          ${locked ? `<div class="booking-time">
            Booked by <strong>${activeBooking.courseRep?.fullName || activeBooking.courseRep?.indexNumber || 'Unknown'}</strong>
            ${activeBooking.courseRep?.department ? '(' + activeBooking.courseRep.department + ')' : ''}<br>Until: ${fmt(activeBooking.endTime)}
          </div>` : ''}
          <div class="classroom-meta">${c.bookings.length} bookings · ${c.comments.length} reviews</div>
          <div class="card-actions">
            <button class="btn btn-outline btn-sm" data-action="edit" data-cid="${c._id}">✏️ Edit</button>
            ${locked ? `<button class="btn btn-unlock btn-sm" data-action="unlock"
              data-cid="${c._id}" data-bid="${activeBooking._id}" data-name="${c.name}">🔓 Unlock</button>` : ''}
            <button class="btn btn-sm ${c.isActive ? 'btn-danger' : 'btn-gold'}"
              data-action="toggle" data-cid="${c._id}" data-active="${c.isActive}">
              ${c.isActive ? '❌ Deactivate' : '✅ Reactivate'}
            </button>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('[data-action="edit"]').forEach(btn =>
      btn.addEventListener('click', () => this.openEditClassroom(btn.dataset.cid)));
    grid.querySelectorAll('[data-action="toggle"]').forEach(btn =>
      btn.addEventListener('click', () => this.toggleClassroom(btn.dataset.cid, btn.dataset.active === 'true')));
    grid.querySelectorAll('[data-action="unlock"]').forEach(btn =>
      btn.addEventListener('click', () => this.unlockClassroom(btn.dataset.cid, btn.dataset.bid, btn.dataset.name)));
  },

  renderReps() {
    const tbody = $('repsTable');
    if (!this.allReps.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No course reps yet.</td></tr>`; return;
    }
    tbody.innerHTML = this.allReps.map(r => `
      <tr>
        <td data-label="Full Name"><strong>${r.fullName || '—'}</strong></td>
        <td data-label="Index No.">${r.indexNumber || '—'}</td>
        <td data-label="Level / Dept">${r.level ? `Level ${r.level}` : '—'} · ${r.department || '—'}</td>
        <td data-label="Actions">
          <button class="btn btn-danger btn-sm" data-action="del-rep" data-id="${r._id}" data-name="${r.fullName || r.indexNumber}">Remove</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-action="del-rep"]').forEach(btn =>
      btn.addEventListener('click', () => this.confirmDeleteRep(btn.dataset.id, btn.dataset.name)));
  },

  renderReviews() {
    const container = $('reviewsContainer');
    const all = [];
    this.allClassrooms.forEach(c => c.comments.forEach(r => all.push({ ...r, classroomName: c.name, classroomId: c._id })));
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!all.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">💬</div><p>No reviews yet.</p></div>`; return;
    }
    container.innerHTML = all.map(r => `
      <div class="review-card">
        <div class="review-meta" style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <strong>${r.classroomName}</strong> ·
            ${r.courseRep?.fullName || r.courseRep?.indexNumber || 'Unknown'}
            ${r.courseRep?.department ? '(' + r.courseRep.department + ')' : ''} ·
            ${new Date(r.createdAt).toLocaleDateString('en-GB')}
          </div>
          <button class="btn btn-danger btn-sm" data-action="del-review"
            data-cid="${r.classroomId}" data-rid="${r._id}">🗑 Delete</button>
        </div>
        <div class="review-stars">
          Projector: ${'★'.repeat(r.projector||0)}${'☆'.repeat(5-(r.projector||0))} &nbsp;
          Desks: ${'★'.repeat(r.desks||0)}${'☆'.repeat(5-(r.desks||0))} &nbsp;
          Audio: ${'★'.repeat(r.speakers||0)}${'☆'.repeat(5-(r.speakers||0))}
        </div>
        ${r.comments ? `<p class="review-comment">"${r.comments}"</p>` : ''}
      </div>`).join('');

    container.querySelectorAll('[data-action="del-review"]').forEach(btn =>
      btn.addEventListener('click', () => this.deleteReview(btn.dataset.cid, btn.dataset.rid)));
  },

  async deleteReview(classroomId, commentId) {
    this.confirmCallback = async () => {
      const res = await api('DELETE', `/classrooms/${classroomId}/comment/${commentId}`);
      if (res && res.ok) { showToast('Review deleted.'); this.loadAll(); }
      else { const d = await safeJson(res, {}); showToast(d.error || 'Failed', 'error'); }
    };
    $('confirmMsg').textContent = 'Delete this review? This cannot be undone.';
    showModal('confirmModal');
  },

  unlockClassroom(classroomId, bookingId, name) {
    this.confirmCallback = async () => {
      const res  = await api('PATCH', `/classrooms/${classroomId}/unlock/${bookingId}`);
      const data = await safeJson(res, {});
      if (res && res.ok) { showToast(name + ' unlocked.'); this.loadAll(); }
      else { showToast(data.error || 'Failed to unlock', 'error'); }
    };
    $('confirmMsg').textContent = 'Unlock "' + name + '" early? The current booking will be ended.';
    showModal('confirmModal');
  },

  buildResourcesGrid(selected = []) {
    const all = [...new Set([...PRESET_RESOURCES, ...this.customResources])];
    $('resourcesCheckGrid').innerHTML = all.map(r => `
      <label class="resource-check-item">
        <input type="checkbox" value="${r}" ${selected.includes(r) ? 'checked' : ''} /> ${r}
      </label>`).join('');
  },

  addCustomResource() {
    const input = $('customResource');
    const val   = input.value.trim();
    if (!val) return;
    this.customResources.push(val);
    input.value = '';
    this.buildResourcesGrid([...this.getCheckedResources(), val]);
  },

  getCheckedResources() {
    return [...document.querySelectorAll('#resourcesCheckGrid input:checked')].map(i => i.value);
  },

  openAddClassroom() {
    $('editClassroomId').value = '';
    $('classroomModalTitle').textContent = 'Add Classroom';
    $('roomName').value = ''; $('roomCapacity').value = '';
    $('classroomAlert').innerHTML = '';
    $('classroomSubmitBtn').textContent = 'Add Classroom';
    this.customResources = [];
    this.buildResourcesGrid();
    showModal('classroomModal');
  },

  openEditClassroom(id) {
    const c = this.allClassrooms.find(x => x._id === id);
    if (!c) return;
    $('editClassroomId').value = id;
    $('classroomModalTitle').textContent = 'Edit Classroom';
    $('roomName').value = c.name; $('roomCapacity').value = c.capacity;
    $('classroomAlert').innerHTML = '';
    $('classroomSubmitBtn').textContent = 'Save Changes';
    this.customResources = (c.resources || []).filter(r => !PRESET_RESOURCES.includes(r));
    this.buildResourcesGrid(c.resources || []);
    showModal('classroomModal');
  },

  async submitClassroom(e) {
    e.preventDefault();
    const id   = $('editClassroomId').value;
    const body = { name: $('roomName').value.trim(), capacity: parseInt($('roomCapacity').value), resources: this.getCheckedResources() };
    const res  = id ? await api('PATCH', `/classrooms/${id}`, body) : await api('POST', '/classrooms', body);
    const data = await safeJson(res, {});
    if (res && res.ok) {
      closeModal('classroomModal');
      showToast(id ? 'Classroom updated!' : 'Classroom added!');
      this.loadAll();
    } else {
      $('classroomAlert').innerHTML = `<div class="alert alert-error">${data.error || 'Failed to save classroom.'}</div>`;
    }
  },

  toggleClassroom(id, isActive) {
    this.confirmCallback = async () => {
      const res = await api('PATCH', `/classrooms/${id}`, { isActive: !isActive });
      if (res && res.ok) { showToast(`Classroom ${isActive ? 'deactivated' : 'reactivated'}.`); this.loadAll(); }
    };
    $('confirmMsg').textContent = `Are you sure you want to ${isActive ? 'deactivate' : 'reactivate'} this classroom?`;
    showModal('confirmModal');
  },

  openAddRep() {
    $('addRepForm').reset(); $('addRepAlert').innerHTML = '';
    showModal('addRepModal');
  },

  async submitAddRep(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const body = {
      fullName:    fd.get('fullName'),
      indexNumber: fd.get('indexNumber'),
      level:       fd.get('level'),
      department:  fd.get('department')
    };
    const res  = await api('POST', '/auth/register', body);
    const data = await safeJson(res, {});
    if (res && res.ok) {
      closeModal('addRepModal'); showToast('Course rep added! Default password: rep123'); this.loadAll();
    } else {
      $('addRepAlert').innerHTML = `<div class="alert alert-error">${data.error || 'Failed to create rep.'}</div>`;
    }
  },

  confirmDeleteRep(id, name) {
    this.confirmCallback = async () => {
      const res = await api('DELETE', `/auth/rep/${id}`);
      if (res && res.ok) { showToast('Course rep removed.'); this.loadAll(); }
      else { const d = await safeJson(res, {}); showToast(d.error || 'Failed', 'error'); }
    };
    $('confirmMsg').textContent = `Remove course rep "${name}"? This cannot be undone.`;
    showModal('confirmModal');
  }
};

// ─────────────────────────────────────────────────────────────
// SUPER ADMIN PAGE
// ─────────────────────────────────────────────────────────────

const SuperAdminPage = {
  user: null,
  allUsers: [],
  confirmCallback: null,

  init() {
    this.user = Auth.getUser();
    if (!Auth.getToken() || !this.user || this.user.role !== 'superadmin') {
      Auth.clear(); window.location.href = 'index.html'; return;
    }

    $('logoutBtn').addEventListener('click', () => { Auth.clear(); window.location.href = 'index.html'; });

    initTabs('superTabs');
    initPasswordToggles();

    $('addAdminBtn').addEventListener('click',      () => this.openCreate('admin'));
    $('addRepBtn').addEventListener('click',        () => this.openCreate('course_rep'));
    $('closeCreateModal').addEventListener('click', () => closeModal('createModal'));
    $('cancelCreateBtn').addEventListener('click',  () => closeModal('createModal'));
    $('createForm').addEventListener('submit',      (e) => this.submitCreate(e));

    $('closeConfirmModal').addEventListener('click', () => closeModal('confirmModal'));
    $('cancelConfirmBtn').addEventListener('click',  () => closeModal('confirmModal'));
    $('confirmActionBtn').addEventListener('click',  () => { closeModal('confirmModal'); this.confirmCallback?.(); });

    this.loadUsers();
  },

  async loadUsers() {
    const res  = await api('GET', '/auth/users');
    const data = await safeJson(res, []);
    if (!Array.isArray(data)) {
      showToast(data.error || 'Failed to load users.', 'error'); return;
    }
    this.allUsers = data;
    this.updateStats();
    this.renderAdmins();
    this.renderReps();
  },

  updateStats() {
    $('statAdmins').textContent = this.allUsers.filter(u => u.role === 'admin').length;
    $('statReps').textContent   = this.allUsers.filter(u => u.role === 'course_rep').length;
    $('statTotal').textContent  = this.allUsers.length;
  },

  renderAdmins() {
    const tbody  = $('adminsTable');
    const admins = this.allUsers.filter(u => u.role === 'admin');
    if (!admins.length) { tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No admins yet.</td></tr>`; return; }
    tbody.innerHTML = admins.map(u => `
      <tr>
        <td data-label="Username"><strong>${u.username}</strong></td>
        <td data-label="Role"><span class="badge badge-admin">Admin</span></td>
        <td data-label="2FA">
          ${u.twoFactorEnabled
            ? '<span style="color:#16a34a;font-weight:600;">✅ Enabled</span>'
            : '<span style="color:#dc2626;font-weight:600;">⚠️ Not set up</span>'}
        </td>
        <td data-label="Actions" style="display:flex;gap:0.4rem;flex-wrap:wrap;">
          ${u.twoFactorEnabled ? `<button class="btn btn-sm" style="background:#f59e0b;color:#fff;" data-action="reset2fa" data-id="${u._id}" data-name="${u.username}" title="Reset 2FA so admin sets it up again on next login">Reset 2FA</button>` : ''}
          <button class="btn btn-danger btn-sm" data-action="del" data-id="${u._id}" data-name="${u.username}">Remove</button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-action="del"]').forEach(btn =>
      btn.addEventListener('click', () => this.confirmDelete(btn.dataset.id, btn.dataset.name)));
    tbody.querySelectorAll('[data-action="reset2fa"]').forEach(btn =>
      btn.addEventListener('click', () => this.reset2FA(btn.dataset.id, btn.dataset.name)));
  },

  async reset2FA(id, name) {
    if (!confirm(`Reset 2FA for "${name}"? They will be required to set it up again on next login.`)) return;
    const res  = await api('DELETE', `/auth/users/${id}/2fa`);
    const data = await safeJson(res, {});
    if (res && res.ok) {
      showToast(data.message || '2FA reset successfully.', 'success');
      await this.loadUsers();
    } else {
      showToast(data.error || 'Failed to reset 2FA.', 'error');
    }
  },

  renderReps() {
    const tbody = $('repsTable');
    const reps  = this.allUsers.filter(u => u.role === 'course_rep');
    if (!reps.length) { tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No course reps yet.</td></tr>`; return; }
    tbody.innerHTML = reps.map(u => `
      <tr>
        <td data-label="Full Name"><strong>${u.fullName || '—'}</strong></td>
        <td data-label="Index No.">${u.indexNumber || '—'}</td>
        <td data-label="Level / Dept">${u.level ? `Level ${u.level}` : '—'} · ${u.department || '—'}</td>
        <td data-label="Actions"><button class="btn btn-danger btn-sm" data-action="del" data-id="${u._id}" data-name="${u.fullName || u.indexNumber}">Remove</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-action="del"]').forEach(btn =>
      btn.addEventListener('click', () => this.confirmDelete(btn.dataset.id, btn.dataset.name)));
  },

  openCreate(role) {
    $('createRole').value = role;
    $('createModalTitle').textContent = role === 'admin' ? 'Create Administrator' : 'Create Course Rep';
    $('adminCreateFields').style.display = role === 'admin'       ? 'block' : 'none';
    $('repCreateFields').style.display   = role === 'course_rep'  ? 'block' : 'none';
    $('createAlert').innerHTML = '';
    $('createForm').reset();
    showModal('createModal');
  },

  async submitCreate(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const role = $('createRole').value;
    let body;
    if (role === 'course_rep') {
      body = {
        role,
        fullName:    fd.get('fullName'),
        indexNumber: fd.get('indexNumber'),
        level:       fd.get('level'),
        department:  fd.get('department') || undefined
      };
    } else {
      body = { username: fd.get('username'), password: fd.get('password'), role };
    }
    const res  = await api('POST', '/auth/users', body);
    const data = await safeJson(res, {});
    if (res && res.ok) {
      closeModal('createModal');
      showToast(role === 'course_rep' ? 'Course rep created! Default password: rep123' : 'User created successfully!');
      this.loadUsers();
    } else {
      $('createAlert').innerHTML = `<div class="alert alert-error">${data.error || 'Failed to create user.'}</div>`;
    }
  },

  confirmDelete(id, name) {
    this.confirmCallback = async () => {
      const res = await api('DELETE', `/auth/users/${id}`);
      if (res && res.ok) { showToast('User deleted.'); this.loadUsers(); }
      else { const d = await safeJson(res, {}); showToast(d.error || 'Failed', 'error'); }
    };
    $('confirmMsg').textContent = `Permanently delete user "${name}"? This cannot be undone.`;
    showModal('confirmModal');
  }
};

// ─────────────────────────────────────────────────────────────
// CHANGE PASSWORD PAGE
// ─────────────────────────────────────────────────────────────

const ChangePasswordPage = {
  init() {
    const token = Auth.getToken();
    const user  = Auth.getUser();
    if (!token || !user) { window.location.href = 'index.html'; return; }
    if (!user.mustChangePassword) { Auth.redirectByRole(user.role); return; }

    initPasswordToggles();

    $('cpForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertEl = $('cpAlert');
      const btn     = $('cpBtn');
      alertEl.style.display = 'none';

      const currentPassword = $('currentPassword').value;
      const newPassword     = $('newPassword').value;
      const confirmPassword = $('confirmPassword').value;

      if (newPassword.length < 6) {
        alertEl.textContent = 'New password must be at least 6 characters.';
        alertEl.className = 'alert alert-error';
        alertEl.style.display = 'block'; return;
      }
      if (newPassword !== confirmPassword) {
        alertEl.textContent = 'Passwords do not match.';
        alertEl.className = 'alert alert-error';
        alertEl.style.display = 'block'; return;
      }

      btn.innerHTML = '<span class="loader"></span> Saving…';
      btn.disabled  = true;

      try {
        const res  = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Auth.getToken()}`
          },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (res.ok) {
          const updatedUser = { ...user, mustChangePassword: false };
          Auth.save(token, updatedUser);
          alertEl.textContent = '✅ Password changed! Redirecting…';
          alertEl.className = 'alert alert-success';
          alertEl.style.display = 'block';
          setTimeout(() => Auth.redirectByRole(user.role), 1200);
        } else {
          alertEl.textContent = data.error || 'Failed to change password.';
          alertEl.className = 'alert alert-error';
          alertEl.style.display = 'block';
          btn.innerHTML = 'Set Password & Continue';
          btn.disabled  = false;
        }
      } catch {
        alertEl.textContent = 'Cannot reach server.';
        alertEl.className = 'alert alert-error';
        alertEl.style.display = 'block';
        btn.innerHTML = 'Set Password & Continue';
        btn.disabled  = false;
      }
    });
  }
};