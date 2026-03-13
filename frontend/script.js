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
  redirectByRole(role) {
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
  init() {
    const token = Auth.getToken();
    const user  = Auth.getUser();
    if (token && user) { Auth.redirectByRole(user.role); return; }

    initPasswordToggles();

    // Index number pattern: starts with letters then a slash e.g. csc/22/01/0561
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

      // Build body based on whether identifier looks like an index number
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
          Auth.save(data.token, data.user);
          Auth.redirectByRole(data.user.role);
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

    // Guard: must be an array
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
          ${locked ? `<div class="booking-time">Until: ${fmt(activeBooking.endTime)}</div>` : ''}
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
    // Show loading state in stats
    ['statRooms','statReps','statBookings','statReviews'].forEach(id => { if ($(id)) $(id).textContent = '…'; });

    const [resC, resU] = await Promise.all([
      api('GET', '/classrooms/all'),
      api('GET', '/auth/users')
    ]);

    const classroomsData = await safeJson(resC, []);
    const usersData      = await safeJson(resU, []);

    // Guard: if either response is an error object instead of array, show a toast
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
      const locked = c.bookings.some(b => b.status === 'active' && new Date(b.endTime) > now);
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
          <div class="classroom-meta">${c.bookings.length} bookings · ${c.comments.length} reviews</div>
          <div class="card-actions">
            <button class="btn btn-outline btn-sm" data-action="edit" data-cid="${c._id}">✏️ Edit</button>
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
    this.allClassrooms.forEach(c => c.comments.forEach(r => all.push({ ...r, classroomName: c.name })));
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!all.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">💬</div><p>No reviews yet.</p></div>`; return;
    }
    container.innerHTML = all.map(r => `
      <div class="review-card">
        <div class="review-meta">
          <strong>${r.classroomName}</strong> · ${r.courseRep?.username || 'Unknown'} · ${new Date(r.createdAt).toLocaleDateString('en-GB')}
        </div>
        <div class="review-stars">
          Projector: ${'★'.repeat(r.projector||0)}${'☆'.repeat(5-(r.projector||0))} &nbsp;
          Desks: ${'★'.repeat(r.desks||0)}${'☆'.repeat(5-(r.desks||0))} &nbsp;
          Audio: ${'★'.repeat(r.speakers||0)}${'☆'.repeat(5-(r.speakers||0))}
        </div>
        ${r.comments ? `<p class="review-comment">"${r.comments}"</p>` : ''}
      </div>`).join('');
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
      department:  fd.get('department'),
      password:    fd.get('password')
    };
    const res  = await api('POST', '/auth/register', body);
    const data = await safeJson(res, {});
    if (res && res.ok) {
      closeModal('addRepModal'); showToast('Course rep added!'); this.loadAll();
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
    if (!admins.length) { tbody.innerHTML = `<tr><td colspan="3" class="table-empty">No admins yet.</td></tr>`; return; }
    tbody.innerHTML = admins.map(u => `
      <tr>
        <td data-label="Username"><strong>${u.username}</strong></td>
        <td data-label="Role"><span class="badge badge-admin">Admin</span></td>
        <td data-label="Actions"><button class="btn btn-danger btn-sm" data-action="del" data-id="${u._id}" data-name="${u.username}">Remove</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-action="del"]').forEach(btn =>
      btn.addEventListener('click', () => this.confirmDelete(btn.dataset.id, btn.dataset.name)));
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
      closeModal('createModal'); showToast('User created successfully!'); this.loadUsers();
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