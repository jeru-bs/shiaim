
/* ================================================================
   התנהלות שוטפת - שיאים | Main Application
   ================================================================ */

'use strict';

// ================================================================
// CONFIGURATION
// ================================================================

// Default passwords — used only on first launch.
// After that, passwords are stored in localStorage and changeable from the app.
const DEFAULT_PASSWORDS = {
  'aharon': 'aharon123',
  'yakov':  'yakov123'
};

function loadPasswords() {
  try {
    const stored = localStorage.getItem('shiaim_passwords');
    if (stored) return JSON.parse(stored);
  } catch {}
  return { ...DEFAULT_PASSWORDS };
}

function savePasswords(passwords) {
  localStorage.setItem('shiaim_passwords', JSON.stringify(passwords));
}

const CONFIG = {
  API_URL: localStorage.getItem('shiaim_api_url') || '',

  USERS: {
    'aharon': { displayName: 'אהרון', role: 'user'  },
    'yakov':  { displayName: 'יעקב',  role: 'boss'  }
  },

  DEFAULT_STATUSES: [
    'בתכנון',
    'בעיצוב ראשוני',
    'אושר עיצוב ע"י הלקוח',
    'בסבב תיקונים',
    'נשלח לעיצוב',
    'נשלח למפעל לביצוע'
  ]
};

// ================================================================
// STATE
// ================================================================
const S = {
  user:      null,   // { username, displayName, role }
  projects:  [],
  statuses:  [],
  changes:   [],
  lastSeen:  null,
  newCount:  0,
  view:      'active',  // 'active' | 'completed'
  filters:   { search: '', type: '', status: '', priority: '', client: '', deadline: '' },
  panelProjectId: null,
  panelDesignId:  null,
  panelTab:       'details',
  panelIdeaId:          null,
  panelClientId:        null,
  panelManufacturerId:  null,
  currentWing:          null,
  productsSubTab:       'manufacturers',
  ideas:                [],
  clients:              [],
  manufacturers:        [],
  products:             [],
};

// ================================================================
// UTILITIES
// ================================================================
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const fmt = {
  date(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
  },
  datetime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
  relativeTime(iso) {
    if (!iso) return '';
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diff = now - then;
    if (diff < 60000)    return 'עכשיו';
    if (diff < 3600000)  return `לפני ${Math.floor(diff/60000)} דקות`;
    if (diff < 86400000) return `לפני ${Math.floor(diff/3600000)} שעות`;
    if (diff < 604800000)return `לפני ${Math.floor(diff/86400000)} ימים`;
    return fmt.date(iso);
  }
};

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function deadlineStatus(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = d - now;
  if (diff < 0) return 'overdue';
  if (diff < 7 * 86400000) return 'soon';
  return 'ok';
}

// ================================================================
// API
// ================================================================
async function apiCall(action, data = {}) {
  const url = CONFIG.API_URL;
  if (!url) throw new Error('no_url');

  const res = await fetch(url, {
    method:  'POST',
    body:    JSON.stringify({ action, ...data }),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ================================================================
// DATA OPERATIONS
// ================================================================
async function loadAll() {
  showSpinner(true);
  try {
    const [pRes, sRes, lsRes, cRes] = await Promise.all([
      apiCall('getProjects'),
      apiCall('getStatuses'),
      apiCall('getLastSeen', { user: S.user.username }),
      apiCall('getChanges'),
    ]);

    S.projects = pRes.projects || [];
    S.statuses  = sRes.statuses || CONFIG.DEFAULT_STATUSES;
    S.changes   = cRes.changes  || [];
    S.lastSeen  = lsRes.lastSeen || null;

    // Count new changes since last login
    if (S.lastSeen) {
      const lastSeenTime = new Date(S.lastSeen).getTime();
      S.newCount = S.changes.filter(c =>
        c.user !== S.user.username &&
        new Date(c.timestamp).getTime() > lastSeenTime
      ).length;
    } else {
      S.newCount = 0;
    }

    // Update last seen
    await apiCall('updateLastSeen', { user: S.user.username, ts: new Date().toISOString() });

    renderAll();
  } catch (e) {
    if (e.message === 'no_url') {
      openSetupModal();
    } else {
      toast('שגיאה בטעינת הנתונים: ' + e.message, 'error');
      // Try to load from cache
      loadFromCache();
    }
  } finally {
    showSpinner(false);
  }
}

function loadFromCache() {
  try {
    const cached = localStorage.getItem('shiaim_cache');
    if (cached) {
      const data = JSON.parse(cached);
      S.projects = data.projects || [];
      S.statuses  = data.statuses  || CONFIG.DEFAULT_STATUSES;
      S.changes   = data.changes   || [];
      renderAll();
      toast('עובד במצב אופליין', '');
    }
  } catch {}
}

function saveToCache() {
  try {
    localStorage.setItem('shiaim_cache', JSON.stringify({
      projects: S.projects,
      statuses: S.statuses,
      changes:  S.changes,
    }));
  } catch {}
}

async function saveProject(project) {
  showSpinner(true);
  try {
    const result = await apiCall('saveProject', { project });
    // Capture Drive folder ID created for new projects
    if (result.folderId && !project.folderId) project.folderId = result.folderId;
    // Update local state
    const idx = S.projects.findIndex(p => p.id === project.id);
    if (idx >= 0) S.projects[idx] = project;
    else S.projects.push(project);
    saveToCache();
    renderProjectList();
    return true;
  } catch (e) {
    toast('שגיאה בשמירה: ' + e.message, 'error');
    return false;
  } finally {
    showSpinner(false);
  }
}

async function deleteProject(id) {
  showSpinner(true);
  try {
    const project = S.projects.find(p => p.id === id);
    await apiCall('deleteProject', { id });
    S.projects = S.projects.filter(p => p.id !== id);
    saveToCache();
    if (project) {
      await logChange('deleted', id, project.name, 'פרויקט נמחק');
    }
    renderProjectList();
    closePanel('project-panel');
    toast('הפרויקט נמחק', 'success');
    return true;
  } catch (e) {
    toast('שגיאה במחיקה: ' + e.message, 'error');
    return false;
  } finally {
    showSpinner(false);
  }
}

async function logChange(type, projectId, projectName, details) {
  const change = {
    id:          uid(),
    timestamp:   new Date().toISOString(),
    user:        S.user.username,
    projectId,
    projectName,
    changeType:  type,
    details,
  };
  try {
    await apiCall('addChange', { change });
    S.changes.unshift(change);
    saveToCache();
  } catch {}
}

// ================================================================
// AUTH
// ================================================================
function login(username, password) {
  const key = username.trim().toLowerCase();
  const u = CONFIG.USERS[key];
  if (!u) return false;
  const passwords = loadPasswords();
  if (passwords[key] !== password) return false;
  S.user = { username: key, displayName: u.displayName, role: u.role };
  localStorage.setItem('shiaim_user', JSON.stringify(S.user));
  return true;
}

// ── Change Password ──
function openChangePasswordModal() {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value     = '';
  document.getElementById('cp-confirm').value = '';
  document.getElementById('cp-error').textContent = '';
  openModalEl(document.getElementById('change-password-modal'));
}

function submitChangePassword() {
  const current = document.getElementById('cp-current').value;
  const newPw   = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  const errEl   = document.getElementById('cp-error');

  const passwords = loadPasswords();
  if (passwords[S.user.username] !== current) {
    errEl.textContent = 'הסיסמה הנוכחית שגויה';
    return;
  }
  if (newPw.length < 4) {
    errEl.textContent = 'הסיסמה חייבת להכיל לפחות 4 תווים';
    return;
  }
  if (newPw !== confirm) {
    errEl.textContent = 'הסיסמאות אינן תואמות';
    return;
  }

  passwords[S.user.username] = newPw;
  savePasswords(passwords);
  closeModalEl(document.getElementById('change-password-modal'));
  toast('הסיסמה עודכנה בהצלחה ✓', 'success');
}

function logout() {
  S.user = null;
  localStorage.removeItem('shiaim_user');
  S.projects = [];
  S.changes  = [];
  S.statuses = [];
  showScreen('login-screen');
}

function restoreSession() {
  try {
    const stored = localStorage.getItem('shiaim_user');
    if (stored) {
      S.user = JSON.parse(stored);
      return true;
    }
  } catch {}
  return false;
}

// ================================================================
// RENDER — Main List
// ================================================================
function renderAll() {
  renderHeader();
  renderProjectList();
  updateChangesBadge();
  updateFilterDropdowns();
  saveToCache();
}

function renderHeader() {
  const el = document.getElementById('user-display');
  el.innerHTML = `<span class="role-dot"></span><span>${escHtml(S.user.displayName)}</span>`;
  const isBoss = S.user.role === 'boss';
  document.getElementById('settings-btn').classList.toggle('hidden', !isBoss);
}

function renderFilters() {
  // Populate client filter
  const clients = [...new Set(S.projects.map(p => p.client).filter(Boolean))].sort();
  const clientSel = document.getElementById('filter-client');
  const currentClient = clientSel.value;
  clientSel.innerHTML = '<option value="">כל הלקוחות</option>' +
    clients.map(c => `<option value="${escHtml(c)}" ${c === currentClient ? 'selected' : ''}>${escHtml(c)}</option>`).join('');

  // Populate status filter
  const statusSel = document.getElementById('filter-status');
  const currentStatus = statusSel.value;
  statusSel.innerHTML = '<option value="">כל הסטטוסים</option>' +
    S.statuses.map(s => `<option value="${escHtml(s)}" ${s === currentStatus ? 'selected' : ''}>${escHtml(s)}</option>`).join('');

  // Highlight active filters
  ['filter-client','filter-status','filter-priority','filter-type','filter-deadline'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.toggle('active', !!el.value);
  });
}

function getFilteredProjects() {
  const f = S.filters;
  return S.projects.filter(p => {
    if (S.view === 'active'    && p.completed) return false;
    if (S.view === 'completed' && !p.completed) return false;
    if (f.search && !p.name?.toLowerCase().includes(f.search.toLowerCase()) &&
                    !p.client?.toLowerCase().includes(f.search.toLowerCase())) return false;
    if (f.type     && p.type     !== f.type)     return false;
    if (f.status   && p.status   !== f.status)   return false;
    if (f.priority && String(p.priority) !== f.priority) return false;
    if (f.client   && p.client   !== f.client)   return false;
    if (f.deadline) {
      const ds = deadlineStatus(p.deadline);
      if (f.deadline === 'overdue' && ds !== 'overdue') return false;
      if (f.deadline === 'soon'    && ds !== 'soon')    return false;
      if (f.deadline === 'none'    && p.deadline)       return false;
    }
    return true;
  }).sort((a, b) => {
    // Sort by priority desc, then by deadline asc
    const pd = (b.priority || 0) - (a.priority || 0);
    if (pd !== 0) return pd;
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return  1;
    return 0;
  });
}

function renderProjectList() {
  const list = document.getElementById('project-list');
  const projects = getFilteredProjects();

  // Update section header
  const label = S.view === 'active' ? 'פרויקטים פעילים' : 'פרויקטים שהסתיימו';
  document.getElementById('section-label').textContent = label;
  document.getElementById('section-count').textContent = `${projects.length} פרויקטים`;

  // Toggle view button
  const toggleBtn = document.getElementById('view-toggle');
  toggleBtn.textContent = S.view === 'active' ? 'הסתיימו' : 'פעילים';
  toggleBtn.classList.toggle('completed', S.view === 'completed');

  if (projects.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${S.view === 'completed' ? '✅' : '📋'}</div>
        <p>${S.view === 'completed' ? 'אין פרויקטים שהסתיימו' : 'אין פרויקטים'}</p>
      </div>`;
    return;
  }

  list.innerHTML = projects.map(p => renderProjectRow(p)).join('');

  // Attach click handlers
  list.querySelectorAll('.project-row').forEach(row => {
    row.addEventListener('click', () => openProjectPanel(row.dataset.id));
  });
  list.querySelectorAll('.design-subrow').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      openDesignFromList(row.dataset.projectId, parseInt(row.dataset.designIdx));
    });
  });
}

function renderProjectRow(p) {
  const notesCount   = (p.notes        || []).length;
  const infoCount    = (p.importantInfo || []).length;
  const designsCount = (p.designs       || []).length;
  const ds           = deadlineStatus(p.deadline);

  const starsHtml = [1,2,3,4,5].map(n =>
    `<span class="priority-star ${n <= (p.priority || 0) ? 'filled' : 'empty'}">★</span>`
  ).join('');

  const indicators = [
    notesCount   ? `<span class="indicator notes"   title="${notesCount} הערות">💬</span>` : '',
    infoCount    ? `<span class="indicator info"    title="${infoCount} מידע חשוב">ℹ️</span>` : '',
    designsCount ? `<span class="indicator designs" title="${designsCount} עיצובים">🎨</span>` : '',
  ].filter(Boolean).join('');

  const typeLabel = p.type === 'client' ? 'לקוח' : 'משרד';
  const typeClass = p.type === 'client' ? 'client' : 'office';

  const deadlineHtml = p.deadline
    ? `<span class="deadline-chip ${ds}" title="${p.deadline}">
         ${ds === 'overdue' ? '⚠️' : ds === 'soon' ? '⏰' : '📅'} ${fmt.date(p.deadline)}
       </span>`
    : '';

  const subRows = (p.designs || []).map((d, i) => `
    <div class="design-subrow" data-project-id="${escHtml(p.id)}" data-design-idx="${i}">
      <span class="design-sub-icon">🎨</span>
      <span class="design-sub-name">${escHtml(d.name || `עיצוב ${i+1}`)}</span>
      ${d.status ? `<span class="design-sub-status">${escHtml(d.status)}</span>` : ''}
    </div>`).join('');

  return `
    <div class="project-row" data-id="${escHtml(p.id)}" data-priority="${p.priority || 0}">
      <div class="row-top">
        <span class="row-name">${escHtml(p.name)}</span>
        <div class="row-priority">${starsHtml}</div>
      </div>
      <div class="row-bottom">
        <div class="row-meta">
          <span class="status-badge ${p.completed ? 'completed' : ''}">${escHtml(p.status || 'ללא סטטוס')}</span>
          ${p.client ? `<span class="client-text">${escHtml(p.client)}</span>` : ''}
          <span class="type-badge ${typeClass}">${typeLabel}</span>
          ${deadlineHtml}
        </div>
        <div class="row-indicators">${indicators}</div>
      </div>
    </div>
    ${subRows}`;
}

function updateChangesBadge() {
  const badge = document.getElementById('changes-badge');
  if (S.newCount > 0) {
    badge.textContent = S.newCount > 99 ? '99+' : S.newCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ================================================================
// DRIVE FILE HELPERS
// ================================================================
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/'))        return '🖼️';
  if (mimeType.includes('pdf'))             return '📕';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel'))   return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
  if (mimeType.includes('zip') || mimeType.includes('rar'))       return '🗜️';
  if (mimeType.includes('video'))           return '🎬';
  if (mimeType.includes('audio'))           return '🎵';
  return '📄';
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function loadProjectFiles(project) {
  const listEl = document.getElementById('project-files-list');
  if (!listEl || !project.folderId) return;
  try {
    const result = await apiCall('getProjectFiles', { folderId: project.folderId });
    const files  = result.files || [];
    if (files.length === 0) {
      listEl.innerHTML = '<p class="text-muted text-sm">אין קבצים עדיין</p>';
    } else {
      listEl.innerHTML = files.map(f => `
        <div class="project-file-item" data-file-id="${escHtml(f.id)}">
          <span class="file-icon">${fileIcon(f.mimeType)}</span>
          <a class="file-name" href="${escHtml(f.url)}" target="_blank" rel="noopener">${escHtml(f.name)}</a>
          <span class="file-size">${formatFileSize(f.size)}</span>
          <button class="btn-file-delete" onclick="deleteProjectFile('${escHtml(f.id)}', this)" title="מחק">✕</button>
        </div>`).join('');
    }
  } catch (e) {
    listEl.innerHTML = '<p class="text-muted text-sm">שגיאה בטעינת קבצים</p>';
  }
}

async function uploadProjectFile(project, file) {
  if (!project.folderId) { toast('אין תיקיית Drive לפרויקט', 'error'); return; }
  const MAX = 20 * 1024 * 1024;
  if (file.size > MAX) { toast(`${file.name} — גדול מ-20MB`, 'error'); return; }
  toast(`מעלה: ${file.name}…`, 'info');
  try {
    const base64 = await fileToBase64(file);
    const result = await apiCall('uploadFile', {
      folderId: project.folderId,
      filename: file.name,
      base64,
      mimeType: file.type || 'application/octet-stream'
    });
    if (result.error) throw new Error(result.error);
    toast(`${file.name} הועלה ✓`, 'success');
    loadProjectFiles(project);
  } catch (e) {
    toast('שגיאה בהעלאה: ' + e.message, 'error');
  }
}

async function deleteProjectFile(fileId, btn) {
  if (!confirm('למחוק את הקובץ מ-Drive?')) return;
  try {
    await apiCall('deleteFile', { fileId });
    btn.closest('.project-file-item').remove();
    toast('קובץ נמחק', 'success');
  } catch (e) {
    toast('שגיאה במחיקה: ' + e.message, 'error');
  }
}

// ================================================================
// PROJECT DETAIL PANEL
// ================================================================
function openProjectPanel(id) {
  const project = S.projects.find(p => p.id === id);
  if (!project) return;
  S.panelProjectId = id;
  S.panelTab = 'details';
  renderProjectPanel(project);
  openPanel('project-panel');
}

function openDesignFromList(projectId, designIdx) {
  const project = S.projects.find(p => p.id === projectId);
  if (!project) return;
  S.panelProjectId = projectId;
  S.panelTab = 'designs';
  renderProjectPanel(project);
  openPanel('project-panel');
  openDesignPanel(designIdx);
}

function renderProjectPanel(p) {
  const isBoss = S.user.role === 'boss';
  const panel  = document.getElementById('project-panel');

  panel.querySelector('.panel-title').innerHTML =
    `<span>פרויקט:</span> ${escHtml(p.name)}`;

  if (!S.panelTab) S.panelTab = 'details';

  const designsCount = (p.designs || []).length;
  const notesCount = (p.notes || []).length + (p.importantInfo || []).length;

  const tabsHtml = `
    <div class="panel-tabs">
      <button class="panel-tab-btn${S.panelTab === 'details' ? ' active' : ''}" data-tab="details">פרטים</button>
      <button class="panel-tab-btn${S.panelTab === 'designs' ? ' active' : ''}" data-tab="designs">
        עיצובים${designsCount > 0 ? ` <span class="panel-tab-count">${designsCount}</span>` : ''}
      </button>
      <button class="panel-tab-btn${S.panelTab === 'notes' ? ' active' : ''}" data-tab="notes">
        הערות${notesCount > 0 ? ` <span class="panel-tab-count">${notesCount}</span>` : ''}
      </button>
    </div>`;

  let tabContent = '';

  if (S.panelTab === 'details') {
    tabContent = `
      <div class="panel-section">
        <div class="field-grid">
          <div class="field-item">
            <span class="field-label">שם פרויקט</span>
            <div class="field-value editable" data-field="name" data-type="text">${escHtml(p.name)}</div>
          </div>
          <div class="field-item">
            <span class="field-label">לקוח</span>
            <div class="field-value editable" data-field="client" data-type="text">
              ${p.client ? escHtml(p.client) : '<span class="placeholder">—</span>'}
            </div>
          </div>
          <div class="field-item">
            <span class="field-label">סוג פרויקט</span>
            <div class="field-value editable" data-field="type" data-type="select" data-options="client:פרויקט לקוח,office:פרויקט משרד">
              ${p.type === 'client' ? 'פרויקט לקוח' : 'פרויקט משרד'}
            </div>
          </div>
          <div class="field-item">
            <span class="field-label">דדליין</span>
            <div class="field-value editable" data-field="deadline" data-type="date">
              ${p.deadline ? fmt.date(p.deadline) : '<span class="placeholder">ללא</span>'}
            </div>
          </div>
          <div class="field-item full">
            <span class="field-label">סטטוס</span>
            <div class="field-value editable" data-field="status" data-type="status">
              ${escHtml(p.status || 'בתכנון')}
            </div>
          </div>
          <div class="field-item full">
            <span class="field-label">רמת דחיפות ${!isBoss ? '(הבוס בלבד)' : ''}</span>
            <div class="field-value ${isBoss ? 'editable' : ''}" data-field="priority" data-type="priority">
              ${renderPriorityDisplay(p.priority || 0, isBoss)}
            </div>
          </div>
        </div>
      </div>`;
  } else if (S.panelTab === 'designs') {
    tabContent = `
      <div class="panel-section">
        <div class="designs-list">
          ${(p.designs || []).map((d, i) => `
            <div class="design-item" onclick="openDesignPanel(${i})">
              <div class="design-item-left">
                <div class="design-item-name">${escHtml(d.name || `עיצוב ${i+1}`)}</div>
                <div class="design-item-status">${escHtml(d.status || '')}</div>
              </div>
              <span class="design-item-arrow">‹</span>
            </div>`).join('')}
          ${designsCount === 0 ? '<p class="text-muted text-sm">אין עיצובים נוספים עדיין</p>' : ''}
          <button class="btn-add-design btn-add-design-lg" onclick="addDesign()">+ הוסף עיצוב</button>
        </div>
      </div>
      <div class="panel-section">
        <div class="section-title-row">
          <span class="section-title">קבצי הפרויקט</span>
          ${p.folderId ? `
            <label class="btn-upload-file" for="project-file-input">📎 הוסף קובץ</label>
            <input type="file" id="project-file-input" class="file-input-hidden" multiple />
            <a class="btn-drive-folder" href="https://drive.google.com/drive/folders/${escHtml(p.folderId)}" target="_blank" rel="noopener" title="פתח תיקייה ב-Drive">📁</a>
          ` : '<span class="text-muted text-sm">תיקיית Drive תיוצר עם הפרויקט הבא</span>'}
        </div>
        <div class="project-files-list" id="project-files-list">
          ${p.folderId ? '<p class="text-muted text-sm">טוען קבצים…</p>' : ''}
        </div>
      </div>`;
  } else if (S.panelTab === 'notes') {
    tabContent = `
      <div class="panel-section">
        <div class="section-title">הערות</div>
        <div class="log-list" id="notes-list">
          ${renderLogEntries(p.notes || [], 'notes-entry')}
        </div>
        <div class="log-add-form">
          <textarea class="log-textarea" id="new-note" placeholder="הוסף הערה..."></textarea>
          <button class="btn-gold" onclick="addLogEntry('notes')">הוסף הערה</button>
        </div>
      </div>
      <div class="panel-section">
        <div class="section-title">מידע חשוב</div>
        <div class="log-list" id="info-list">
          ${renderLogEntries(p.importantInfo || [], 'info-entry')}
        </div>
        <div class="log-add-form">
          <textarea class="log-textarea" id="new-info" placeholder="הוסף מידע חשוב..."></textarea>
          <button class="btn-gold" onclick="addLogEntry('info')">הוסף מידע</button>
        </div>
      </div>`;
  }

  const body = panel.querySelector('.panel-body');
  body.innerHTML = tabsHtml + `<div class="panel-tab-content">${tabContent}</div>`;

  // Tab click handlers
  body.querySelectorAll('.panel-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.panelTab = btn.dataset.tab;
      renderProjectPanel(p);
    });
  });

  // Designs tab: load files + wire upload
  if (S.panelTab === 'designs' && p.folderId) {
    loadProjectFiles(p);
    const fileInput = body.querySelector('#project-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', async e => {
        const files = [...e.target.files];
        for (const f of files) await uploadProjectFile(p, f);
        e.target.value = '';
      });
    }
  }

  // Details tab: inline-edit + priority star listeners
  if (S.panelTab === 'details') {
    body.querySelectorAll('.field-value.editable').forEach(el => {
      el.addEventListener('click', () => startInlineEdit(el, p));
    });
    if (isBoss) {
      body.querySelectorAll('.priority-star-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const val = parseInt(btn.dataset.value);
          await updateProjectField(p.id, 'priority', val);
          renderProjectPanel(S.projects.find(x => x.id === p.id));
        });
      });
    }
  }

  // Panel footer buttons
  panel.querySelector('#btn-complete-project').classList.toggle('hidden', !!p.completed);
  panel.querySelector('#btn-restore-project').classList.toggle('hidden', !p.completed);
}

function renderPriorityDisplay(val, editable) {
  if (editable) {
    return [1,2,3,4,5].map(n =>
      `<button class="priority-star-btn ${n <= val ? 'filled' : 'empty'}" data-value="${n}">★</button>`
    ).join('');
  }
  return `<div class="priority-stars-display">
    ${[1,2,3,4,5].map(n => `<span class="priority-star ${n <= val ? 'filled' : 'empty'}">★</span>`).join('')}
  </div>`;
}

function renderLogEntries(entries, cls) {
  if (!entries || entries.length === 0) return '<p class="text-muted text-sm">אין רשומות</p>';
  return entries.map(e => `
    <div class="log-entry ${escHtml(cls)}">
      <div class="log-meta">
        <span class="log-user">${escHtml(CONFIG.USERS[e.user]?.displayName || e.user)}</span>
        <span class="log-date">${fmt.datetime(e.date)}</span>
      </div>
      <div class="log-text">${escHtml(e.text)}</div>
    </div>`).join('');
}

// ── Inline Edit ──
function startInlineEdit(el, project) {
  const field   = el.dataset.field;
  const type    = el.dataset.type;
  const options = el.dataset.options;
  const current = project[field];

  let input;

  if (type === 'text') {
    input = document.createElement('input');
    input.type  = 'text';
    input.className = 'field-edit-input';
    input.value = current || '';

  } else if (type === 'date') {
    input = document.createElement('input');
    input.type  = 'date';
    input.className = 'field-edit-input';
    input.value = current || '';

  } else if (type === 'select') {
    input = document.createElement('select');
    input.className = 'field-edit-select';
    const pairs = options.split(',').map(o => o.split(':'));
    input.innerHTML = pairs.map(([v,l]) =>
      `<option value="${escHtml(v)}" ${v === current ? 'selected' : ''}>${escHtml(l)}</option>`
    ).join('');

  } else if (type === 'status') {
    input = document.createElement('select');
    input.className = 'field-edit-select';
    input.innerHTML = S.statuses.map(s =>
      `<option value="${escHtml(s)}" ${s === current ? 'selected' : ''}>${escHtml(s)}</option>`
    ).join('');

  } else {
    return;
  }

  el.innerHTML = '';
  el.appendChild(input);
  input.focus();

  const save = async () => {
    const newVal = input.value.trim() || (type === 'date' ? '' : current);
    if (newVal !== current) {
      await updateProjectField(project.id, field, newVal);
    } else {
      renderProjectPanel(S.projects.find(p => p.id === project.id));
    }
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

async function updateProjectField(projectId, field, value) {
  const project = S.projects.find(p => p.id === projectId);
  if (!project) return;
  const oldValue = project[field];
  project[field] = value;

  const fieldNames = {
    name: 'שם פרויקט', client: 'לקוח', type: 'סוג', status: 'סטטוס',
    deadline: 'דדליין', priority: 'דחיפות'
  };

  let details = `${fieldNames[field] || field}: `;
  if (field === 'status')   details += `"${oldValue}" → "${value}"`;
  else if (field === 'priority') details += `${oldValue} → ${value} ★`;
  else if (field === 'type') details += value === 'client' ? 'פרויקט לקוח' : 'פרויקט משרד';
  else details += `"${oldValue || '—'}" → "${value}"`;

  const changeType = field === 'status' ? 'status' : field === 'priority' ? 'priority' : 'field';

  const ok = await saveProject(project);
  if (ok) {
    await logChange(changeType, project.id, project.name, details);
    renderProjectPanel(project);
    toast('נשמר ✓', 'success');
  } else {
    project[field] = oldValue; // revert
    renderProjectPanel(project);
  }
}

// ── Log Entries ──
async function addLogEntry(type) {
  const project = S.projects.find(p => p.id === S.panelProjectId);
  if (!project) return;

  const textareaId = type === 'notes' ? 'new-note' : 'new-info';
  const textarea   = document.getElementById(textareaId);
  const text = textarea.value.trim();
  if (!text) { toast('אנא הזן טקסט', ''); return; }

  const entry = { date: new Date().toISOString(), user: S.user.username, text };

  if (type === 'notes') {
    project.notes = [...(project.notes || []), entry];
  } else {
    project.importantInfo = [...(project.importantInfo || []), entry];
  }

  const fieldLabel = type === 'notes' ? 'הערה' : 'מידע חשוב';
  const ok = await saveProject(project);
  if (ok) {
    await logChange('note', project.id, project.name, `נוספה ${fieldLabel}: "${text.slice(0,60)}"`);
    textarea.value = '';
    renderProjectPanel(project);
    toast(`${fieldLabel} נוספה`, 'success');
  }
}

// ── Complete / Restore ──
async function completeProject(id) {
  const project = S.projects.find(p => p.id === id);
  if (!project) return;
  project.completed = true;
  const ok = await saveProject(project);
  if (ok) {
    await logChange('completed', id, project.name, 'פרויקט הועבר להסתיים');
    closePanel('project-panel');
    toast('פרויקט הועבר לקטגוריה "הסתיימו"', 'success');
  }
}

async function restoreProject(id) {
  const project = S.projects.find(p => p.id === id);
  if (!project) return;
  project.completed = false;
  const ok = await saveProject(project);
  if (ok) {
    await logChange('field', id, project.name, 'פרויקט הוחזר לפעילים');
    closePanel('project-panel');
    toast('פרויקט הוחזר לפעילים', 'success');
  }
}

// ================================================================
// DESIGN PANEL
// ================================================================
function openDesignPanel(designIdx) {
  const project = S.projects.find(p => p.id === S.panelProjectId);
  if (!project) return;

  const designs = project.designs || [];
  const design  = designs[designIdx];
  if (!design) return;

  S.panelDesignId = designIdx;
  renderDesignPanel(project, design, designIdx);
  openPanel('design-panel');
}

function renderDesignPanel(project, design, idx) {
  const isBoss = S.user.role === 'boss';
  const panel  = document.getElementById('design-panel');

  panel.querySelector('.panel-title').innerHTML =
    `<span>עיצוב:</span> ${escHtml(design.name || `עיצוב ${idx + 1}`)}`;

  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-section">
      <div class="section-title">פרטים</div>
      <div class="field-grid">
        <div class="field-item full">
          <span class="field-label">שם עיצוב</span>
          <div class="field-value editable" data-dfield="name" data-type="text">${escHtml(design.name || '')}</div>
        </div>
        <div class="field-item full">
          <span class="field-label">סטטוס</span>
          <div class="field-value">
            <select class="field-edit-select design-status-sel">
              ${S.statuses.map(s => `<option value="${escHtml(s)}" ${s === (design.status || '') ? 'selected' : ''}>${escHtml(s)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field-item">
          <span class="field-label">דדליין</span>
          <div class="field-value editable" data-dfield="deadline" data-type="date">
            ${design.deadline ? fmt.date(design.deadline) : '<span class="placeholder">ללא</span>'}
          </div>
        </div>
        <div class="field-item">
          <span class="field-label">רמת דחיפות ${!isBoss ? '(בוס בלבד)' : ''}</span>
          <div class="field-value ${isBoss ? 'editable' : ''}" data-dfield="priority" data-type="priority">
            ${renderPriorityDisplay(design.priority || 0, isBoss)}
          </div>
        </div>
      </div>
    </div>

    <div class="panel-section">
      <div class="section-title">הערות</div>
      <div class="log-list">${renderLogEntries(design.notes || [], 'notes-entry')}</div>
      <div class="log-add-form">
        <textarea class="log-textarea" id="new-design-note" placeholder="הוסף הערה..."></textarea>
        <button class="btn-gold" onclick="addDesignLog('notes')">הוסף הערה</button>
      </div>
    </div>

    <div class="panel-section">
      <div class="section-title">מידע חשוב</div>
      <div class="log-list">${renderLogEntries(design.importantInfo || [], 'info-entry')}</div>
      <div class="log-add-form">
        <textarea class="log-textarea" id="new-design-info" placeholder="הוסף מידע חשוב..."></textarea>
        <button class="btn-gold" onclick="addDesignLog('info')">הוסף מידע</button>
      </div>
    </div>
  `;

  // Status select — direct change handler (no click-to-edit)
  const statusSel = body.querySelector('.design-status-sel');
  if (statusSel) {
    statusSel.addEventListener('change', async () => {
      const newVal = statusSel.value;
      if (newVal !== design.status) await updateDesignField(project, idx, 'status', newVal);
    });
  }

  // Other editable fields (name, deadline, priority)
  body.querySelectorAll('.field-value.editable').forEach(el => {
    el.addEventListener('click', () => startDesignInlineEdit(el, project, design, idx));
  });

  if (isBoss) {
    body.querySelectorAll('.priority-star-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        await updateDesignField(project, idx, 'priority', parseInt(btn.dataset.value));
        renderDesignPanel(project, project.designs[idx], idx);
      });
    });
  }
}

function startDesignInlineEdit(el, project, design, idx) {
  const field = el.dataset.dfield;
  const type  = el.dataset.type;
  const current = design[field];
  let input;

  if (type === 'text') {
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'field-edit-input';
    input.value = current || '';
  } else if (type === 'date') {
    input = document.createElement('input');
    input.type = 'date';
    input.className = 'field-edit-input';
    input.value = current || '';
  } else if (type === 'status') {
    input = document.createElement('select');
    input.className = 'field-edit-select';
    input.innerHTML = S.statuses.map(s =>
      `<option value="${escHtml(s)}" ${s === current ? 'selected' : ''}>${escHtml(s)}</option>`
    ).join('');
  } else return;

  el.innerHTML = '';
  el.appendChild(input);
  input.focus();
  if (type === 'status') {
    setTimeout(() => input.click(), 0);
  }

  const save = async () => {
    const newVal = input.value.trim() || current;
    if (newVal !== current) await updateDesignField(project, idx, field, newVal);
    else renderDesignPanel(project, project.designs[idx], idx);
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

async function updateDesignField(project, idx, field, value) {
  project.designs[idx][field] = value;
  const ok = await saveProject(project);
  if (ok) {
    await logChange('field', project.id, project.name,
      `עיצוב "${project.designs[idx].name || idx+1}" — ${field}: "${value}"`);
    renderDesignPanel(project, project.designs[idx], idx);
    toast('נשמר ✓', 'success');
  }
}

async function addDesignLog(type) {
  const project = S.projects.find(p => p.id === S.panelProjectId);
  if (!project) return;
  const design = project.designs[S.panelDesignId];
  if (!design) return;

  const taId = type === 'notes' ? 'new-design-note' : 'new-design-info';
  const ta = document.getElementById(taId);
  const text = ta.value.trim();
  if (!text) return;

  const entry = { date: new Date().toISOString(), user: S.user.username, text };
  if (type === 'notes') design.notes = [...(design.notes || []), entry];
  else design.importantInfo = [...(design.importantInfo || []), entry];

  const ok = await saveProject(project);
  if (ok) {
    await logChange('note', project.id, project.name,
      `עיצוב "${design.name || S.panelDesignId+1}" — נוספה הערה`);
    ta.value = '';
    renderDesignPanel(project, design, S.panelDesignId);
    toast('נשמר ✓', 'success');
  }
}

async function deleteDesign() {
  const project = S.projects.find(p => p.id === S.panelProjectId);
  if (!project || S.panelDesignId === null) return;
  const design = project.designs[S.panelDesignId];
  if (!design) return;
  project.designs.splice(S.panelDesignId, 1);
  const ok = await saveProject(project);
  if (ok) {
    await logChange('field', project.id, project.name,
      `עיצוב "${design.name || S.panelDesignId+1}" נמחק`);
    closePanel('design-panel');
    S.panelTab = 'designs';
    renderProjectPanel(project);
    toast('עיצוב נמחק', 'success');
  }
}

async function addDesign() {
  const project = S.projects.find(p => p.id === S.panelProjectId);
  if (!project) return;
  const newDesign = {
    id: uid(), name: `עיצוב ${(project.designs || []).length + 1}`,
    status: S.statuses[0] || 'בתכנון', deadline: '', priority: 0,
    notes: [], importantInfo: []
  };
  project.designs = [...(project.designs || []), newDesign];
  const ok = await saveProject(project);
  if (ok) {
    await logChange('field', project.id, project.name, 'נוסף עיצוב חדש');
    renderProjectPanel(project);
    toast('עיצוב נוסף', 'success');
  }
}

// ================================================================
// ADD PROJECT MODAL
// ================================================================
function openAddModal() {
  const modal = document.getElementById('add-modal');
  document.getElementById('add-project-name').value    = '';
  document.getElementById('add-project-client').value  = '';
  document.getElementById('add-project-type').value    = 'client';
  document.getElementById('add-project-deadline').value = '';

  const statusSel = document.getElementById('add-project-status');
  statusSel.innerHTML = S.statuses.map((s, i) =>
    `<option value="${escHtml(s)}" ${i === 0 ? 'selected' : ''}>${escHtml(s)}</option>`
  ).join('');

  openModalEl(modal);
}

async function submitAddProject() {
  const name   = document.getElementById('add-project-name').value.trim();
  const client = document.getElementById('add-project-client').value.trim();
  const type   = document.getElementById('add-project-type').value;
  const status = document.getElementById('add-project-status').value;
  const dl     = document.getElementById('add-project-deadline').value;

  if (!name) { toast('שם הפרויקט הוא שדה חובה', 'error'); return; }

  const project = {
    id:           uid(),
    name, client, type, status,
    deadline:     dl || '',
    priority:     0,
    notes:        [],
    importantInfo:[],
    designs:      [],
    completed:    false,
    createdAt:    new Date().toISOString(),
    createdBy:    S.user.username,
  };

  const ok = await saveProject(project);
  if (ok) {
    await logChange('created', project.id, project.name, `פרויקט חדש נוצר ע"י ${S.user.displayName}`);
    closeModalEl(document.getElementById('add-modal'));
    // Link to idea if converting
    if (window._convertingIdeaId) {
      const linkIdea = S.ideas.find(i => i.id === window._convertingIdeaId);
      if (linkIdea) { linkIdea.convertedProjectId = project.id; await saveIdeaData(linkIdea); }
      window._convertingIdeaId = null;
    }
    renderProjectList();
    toast('פרויקט נוסף בהצלחה', 'success');
  }
}

// ================================================================
// CONFIRM MODAL (generic — delete & complete)
// ================================================================
let pendingConfirmAction = null;

function openConfirmModal({ title, message, btnLabel, btnClass, action }) {
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  const btn = document.getElementById('btn-confirm-action');
  btn.textContent = btnLabel;
  btn.className = btnClass;
  pendingConfirmAction = action;
  openModalEl(document.getElementById('confirm-modal'));
}

async function runConfirmAction() {
  if (!pendingConfirmAction) return;
  closeModalEl(document.getElementById('confirm-modal'));
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  await action();
}

function openDeleteConfirm(id) {
  const project = S.projects.find(p => p.id === id);
  if (!project) return;
  openConfirmModal({
    title: 'אישור מחיקה',
    message: `האם למחוק את הפרויקט "${project.name}"? פעולה זו בלתי הפיכה.`,
    btnLabel: 'מחק',
    btnClass: 'btn-danger',
    action: () => deleteProject(id)
  });
}

function openCompleteConfirm(id) {
  const project = S.projects.find(p => p.id === id);
  if (!project) return;
  openConfirmModal({
    title: 'סיום פרויקט',
    message: `להעביר את "${project.name}" לפרויקטים שהסתיימו?`,
    btnLabel: 'סיים פרויקט',
    btnClass: 'btn-gold',
    action: () => completeProject(id)
  });
}

// ================================================================
// CHANGE FEED PANEL
// ================================================================
function openChangesPanel() {
  renderChangesPanel();
  openPanel('changes-panel');
  // Reset badge
  S.newCount = 0;
  updateChangesBadge();
}

function renderChangesPanel() {
  const body  = document.getElementById('changes-panel').querySelector('.panel-body');
  const panel = document.getElementById('changes-panel');

  const newChanges = S.lastSeen
    ? S.changes.filter(c => c.user !== S.user.username && new Date(c.timestamp) > new Date(S.lastSeen))
    : [];

  panel.querySelector('.changes-subheader').textContent =
    newChanges.length > 0 ? `${newChanges.length} שינויים חדשים מאז הכניסה האחרונה` : 'אין שינויים חדשים';

  if (S.changes.length === 0) {
    body.querySelector('.changes-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>אין שינויים עדיין</p>
      </div>`;
    return;
  }

  const newSet = new Set(newChanges.map(c => c.id));

  const icons = {
    status:    { cls: 'status',   icon: '🔄' },
    note:      { cls: 'note',     icon: '💬' },
    info:      { cls: 'info',     icon: 'ℹ️' },
    priority:  { cls: 'priority', icon: '⭐' },
    created:   { cls: 'created',  icon: '✨' },
    deleted:   { cls: 'deleted',  icon: '🗑️' },
    completed: { cls: 'completed',icon: '✅' },
    field:     { cls: 'field',    icon: '✏️' },
  };

  body.querySelector('.changes-list').innerHTML = S.changes.slice(0, 100).map(c => {
    const ic = icons[c.changeType] || icons.field;
    const user = CONFIG.USERS[c.user]?.displayName || c.user;
    return `
      <div class="change-item ${newSet.has(c.id) ? 'is-new' : ''}">
        <div class="change-icon ${ic.cls}">${ic.icon}</div>
        <div class="change-body">
          <div class="change-project">${escHtml(c.projectName)}</div>
          <div class="change-details">${escHtml(c.details)} — <strong>${escHtml(user)}</strong></div>
          <div class="change-time">${fmt.relativeTime(c.timestamp)}</div>
        </div>
      </div>`;
  }).join('');
}

// ================================================================
// STATUSES MODAL
// ================================================================
function openStatusesModal() {
  renderStatusesModal();
  openModalEl(document.getElementById('statuses-modal'));
}

function renderStatusesModal() {
  const list = document.getElementById('statuses-edit-list');
  list.innerHTML = S.statuses.map((s, i) => `
    <div class="status-edit-item" data-idx="${i}">
      <span class="drag-handle">⠿</span>
      <input type="text" value="${escHtml(s)}" data-idx="${i}" />
      <button class="btn-remove-status" onclick="removeStatus(${i})">×</button>
    </div>`).join('');
}

function addStatus() {
  S.statuses.push('סטטוס חדש');
  renderStatusesModal();
}

function removeStatus(idx) {
  S.statuses.splice(idx, 1);
  renderStatusesModal();
}

async function saveStatuses() {
  // Read current values from inputs
  const inputs = document.querySelectorAll('#statuses-edit-list input');
  S.statuses = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);

  showSpinner(true);
  try {
    await apiCall('updateStatuses', { statuses: S.statuses });
    closeModalEl(document.getElementById('statuses-modal'));
    renderFilters();
    toast('סטטוסים עודכנו', 'success');
  } catch (e) {
    toast('שגיאה בשמירת סטטוסים', 'error');
  } finally {
    showSpinner(false);
  }
}

// ================================================================
// SETUP MODAL
// ================================================================
function openSetupModal() {
  document.getElementById('setup-url-input').value = CONFIG.API_URL || '';
  openModalEl(document.getElementById('setup-modal'));
}

function saveSetup() {
  const url = document.getElementById('setup-url-input').value.trim();
  if (!url) { toast('אנא הזן כתובת API', 'error'); return; }
  CONFIG.API_URL = url;
  localStorage.setItem('shiaim_api_url', url);
  closeModalEl(document.getElementById('setup-modal'));
  toast('כתובת API נשמרה', 'success');
  loadAll();
}

// ================================================================
// PANEL / MODAL HELPERS
// ================================================================
function openPanel(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById('overlay').classList.remove('hidden');
}
function closePanel(id) {
  document.getElementById(id).classList.remove('open');
  checkOverlay();
}
function closeAllPanels() {
  document.querySelectorAll('.side-panel, .center-panel').forEach(p => p.classList.remove('open'));
  document.getElementById('overlay').classList.add('hidden');
}

function openModalEl(el) { el.classList.remove('hidden'); }
function closeModalEl(el) { el.classList.add('hidden'); }

function checkOverlay() {
  const anyOpen = [...document.querySelectorAll('.side-panel, .center-panel')].some(p => p.classList.contains('open'));
  document.getElementById('overlay').classList.toggle('hidden', !anyOpen);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ================================================================
// TOAST & SPINNER
// ================================================================
function toast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showSpinner(show) {
  document.getElementById('spinner').classList.toggle('hidden', !show);
}

// ================================================================
// FILTERS
// ================================================================
function updateFilterDropdowns() {
  // Populate status options
  const statusSel = document.getElementById('filter-status');
  const curStatus = S.filters.status;
  statusSel.innerHTML = '<option value="">כל הסטטוסים</option>' +
    S.statuses.map(s => `<option value="${escHtml(s)}" ${s === curStatus ? 'selected' : ''}>${escHtml(s)}</option>`).join('');

  // Populate client options
  const clients = [...new Set(S.projects.map(p => p.client).filter(Boolean))].sort();
  const clientSel = document.getElementById('filter-client');
  const curClient = S.filters.client;
  clientSel.innerHTML = '<option value="">כל הלקוחות</option>' +
    clients.map(c => `<option value="${escHtml(c)}" ${c === curClient ? 'selected' : ''}>${escHtml(c)}</option>`).join('');
}

function clearFilters() {
  document.getElementById('filter-search').value   = '';
  document.getElementById('filter-type').value     = '';
  document.getElementById('filter-status').value   = '';
  document.getElementById('filter-priority').value = '';
  document.getElementById('filter-client').value   = '';
  document.getElementById('filter-deadline').value = '';
  S.filters = { search: '', type: '', status: '', priority: '', client: '', deadline: '' };
  renderProjectList();
}

function applyFilters() {
  S.filters.search   = document.getElementById('filter-search').value;
  S.filters.type     = document.getElementById('filter-type').value;
  S.filters.status   = document.getElementById('filter-status').value;
  S.filters.priority = document.getElementById('filter-priority').value;
  S.filters.client   = document.getElementById('filter-client').value;
  S.filters.deadline = document.getElementById('filter-deadline').value;
  renderProjectList();
}

// ================================================================
// EVENT WIRING
// ================================================================
function wireEvents() {
  // Login
  document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    if (login(username, password)) {
      showScreen('app');
      loadAll();
    } else {
      document.getElementById('login-error').textContent = 'שם משתמש או סיסמה שגויים';
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // View toggle
  document.getElementById('view-toggle').addEventListener('click', () => {
    S.view = S.view === 'active' ? 'completed' : 'active';
    renderProjectList();
  });

  // Changes bell
  document.getElementById('changes-btn').addEventListener('click', openChangesPanel);

  // Settings (boss only)
  document.getElementById('settings-btn').addEventListener('click', openStatusesModal);

  // Change password
  document.getElementById('change-password-btn').addEventListener('click', openChangePasswordModal);
  document.getElementById('btn-submit-change-password').addEventListener('click', submitChangePassword);

  // Add project FAB
  document.getElementById('add-btn').addEventListener('click', openAddModal);

  // Overlay → close all panels
  document.getElementById('overlay').addEventListener('click', closeAllPanels);

  // Filters
  document.getElementById('filter-search').addEventListener('input', applyFilters);
  document.getElementById('filter-type').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-priority').addEventListener('change', applyFilters);
  document.getElementById('filter-client').addEventListener('change', applyFilters);
  document.getElementById('filter-deadline').addEventListener('change', applyFilters);
  document.getElementById('clear-filters').addEventListener('click', clearFilters);

  // Project panel buttons
  document.getElementById('btn-complete-project').addEventListener('click', () =>
    openCompleteConfirm(S.panelProjectId));
  document.getElementById('btn-restore-project').addEventListener('click', () =>
    restoreProject(S.panelProjectId));
  document.getElementById('btn-delete-project').addEventListener('click', () =>
    openDeleteConfirm(S.panelProjectId));

  // Panel close buttons
  document.querySelectorAll('.btn-panel-close').forEach(btn => {
    btn.addEventListener('click', () => {
      // Project panel X → close everything
      if (btn.closest('#project-panel')) { closeAllPanels(); return; }
      // Design panel X → close only design panel (project panel stays)
      if (btn.closest('#design-panel')) {
        closePanel('design-panel');
        // If project panel is open, keep it; otherwise check overlay
        checkOverlay();
        return;
      }
      // Other side panels (changes panel, etc.)
      const panel = btn.closest('.side-panel, .center-panel');
      if (panel) closePanel(panel.id);
    });
  });

  // Modal close buttons
  document.querySelectorAll('.btn-modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-backdrop');
      if (modal) closeModalEl(modal);
    });
  });
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) closeModalEl(modal); });
  });

  // Add project modal submit
  document.getElementById('btn-submit-add').addEventListener('click', submitAddProject);

  // Confirm action (delete / complete)
  document.getElementById('btn-confirm-action').addEventListener('click', runConfirmAction);

  // Statuses modal
  document.getElementById('btn-add-status').addEventListener('click', addStatus);
  document.getElementById('btn-save-statuses').addEventListener('click', saveStatuses);

  // Setup modal
  document.getElementById('btn-save-setup').addEventListener('click', saveSetup);
  document.getElementById('btn-open-setup').addEventListener('click', openSetupModal);

  // Login enter key
  document.getElementById('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-form').requestSubmit();
  });

  // Idea panel buttons
  document.getElementById('btn-convert-idea').addEventListener('click', convertIdeaToProject);
  document.getElementById('btn-delete-idea').addEventListener('click', deleteIdeaConfirm);

  // Client panel button
  document.getElementById('btn-delete-client').addEventListener('click', deleteClientConfirm);

  // Add idea modal
  document.getElementById('btn-submit-add-idea')?.addEventListener('click', submitAddIdea);

  // Add client modal
  document.getElementById('btn-submit-add-client')?.addEventListener('click', submitAddClient);

  // Add manufacturer modal
  document.getElementById('btn-submit-add-manufacturer').addEventListener('click', submitAddManufacturer);
}


// ================================================================
// WING NAVIGATION
// ================================================================
function openWing(name) {
  const wingContent    = document.getElementById('wing-content');
  const projectList    = document.getElementById('project-list');
  const filtersBar     = document.getElementById('filters-bar');
  const sectionBar     = document.getElementById('section-header-bar');
  const fab            = document.getElementById('add-btn');

  if (!name) {
    S.currentWing = null;
    wingContent.classList.add('hidden');
    projectList.classList.remove('hidden');
    filtersBar.classList.remove('hidden');
    sectionBar.classList.remove('hidden');
    fab.classList.remove('hidden');
    return;
  }

  S.currentWing = name;
  wingContent.classList.remove('hidden');
  projectList.classList.add('hidden');
  filtersBar.classList.add('hidden');
  sectionBar.classList.add('hidden');
  fab.classList.add('hidden');

  if      (name === 'clients')  loadAndRenderClientsWing();
  else if (name === 'ideas')    loadAndRenderIdeasWing();
  else if (name === 'products') { S.productsSubTab = null; renderProductsWing(); }
}

// ================================================================
// CLIENTS WING
// ================================================================
async function loadAndRenderClientsWing() {
  const wc = document.getElementById('wing-content');
  wc.innerHTML = `
    <div class="wing-header">
      <button class="btn-wing-back" onclick="openWing(null)">← חזרה</button>
      <h2 class="wing-title">👤 לקוחות</h2>
      <button class="btn-gold btn-sm" onclick="openAddClientModal()">+ לקוח</button>
    </div>
    <div class="clients-list" id="clients-list">
      <p class="text-muted text-sm">טוען…</p>
    </div>`;

  showSpinner(true);
  try {
    const result = await apiCall('getClients');
    S.clients = result.clients || [];
    renderClientsList();
  } catch(e) {
    toast('שגיאה בטעינת לקוחות: ' + e.message, 'error');
  } finally {
    showSpinner(false);
  }
}

function renderClientsList() {
  const list = document.getElementById('clients-list');
  if (!list) return;
  if (!S.clients.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><p>אין לקוחות עדיין</p></div>';
    return;
  }
  list.innerHTML = S.clients.map(c => `
    <div class="wing-item client-row" onclick="openClientPanel('${escHtml(c.id)}')">
      <div class="wing-item-title">${escHtml(c.name)}</div>
      <div class="wing-item-meta">
        ${c.phone ? `<span>📞 ${escHtml(c.phone)}</span>` : ''}
        ${c.email ? `<span>✉️ ${escHtml(c.email)}</span>` : ''}
      </div>
    </div>`).join('');
}

function openClientPanel(id) {
  const client = S.clients.find(c => c.id === id);
  if (!client) return;
  S.panelClientId = id;
  renderClientPanel(client);
  openPanel('client-panel');
}

function renderClientPanel(client) {
  const panel = document.getElementById('client-panel');
  panel.querySelector('.panel-title').textContent = client.name;
  const body = panel.querySelector('.panel-body');
  body.innerHTML = `
    <div class="panel-section">
      <div class="field-grid">
        <div class="field-item full">
          <span class="field-label">שם</span>
          <div class="field-value editable" data-cfield="name" data-type="text">${escHtml(client.name)}</div>
        </div>
        <div class="field-item">
          <span class="field-label">טלפון</span>
          <div class="field-value editable" data-cfield="phone" data-type="text">
            ${client.phone ? escHtml(client.phone) : '<span class="placeholder">—</span>'}
          </div>
        </div>
        <div class="field-item">
          <span class="field-label">אימייל</span>
          <div class="field-value editable" data-cfield="email" data-type="text">
            ${client.email ? escHtml(client.email) : '<span class="placeholder">—</span>'}
          </div>
        </div>
        <div class="field-item full">
          <span class="field-label">כתובת</span>
          <div class="field-value editable" data-cfield="address" data-type="text">
            ${client.address ? escHtml(client.address) : '<span class="placeholder">—</span>'}
          </div>
        </div>
        <div class="field-item full">
          <span class="field-label">הערות</span>
          <div class="field-value editable" data-cfield="notes" data-type="text">
            ${client.notes ? escHtml(client.notes) : '<span class="placeholder">—</span>'}
          </div>
        </div>
      </div>
    </div>`;

  body.querySelectorAll('.field-value.editable').forEach(el => {
    el.addEventListener('click', () => startClientInlineEdit(el, client));
  });
}

function startClientInlineEdit(el, client) {
  const field   = el.dataset.cfield;
  const current = client[field] || '';
  const input   = document.createElement('input');
  input.type      = 'text';
  input.className = 'field-edit-input';
  input.value     = current;
  el.innerHTML    = '';
  el.appendChild(input);
  input.focus();

  const save = async () => {
    const newVal = input.value.trim();
    if (newVal !== current) {
      client[field] = newVal;
      const ok = await saveClientData(client);
      if (ok) { renderClientPanel(client); renderClientsList(); toast('נשמר ✓', 'success'); }
      else     { client[field] = current;   renderClientPanel(client); }
    } else {
      renderClientPanel(client);
    }
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

async function saveClientData(client) {
  showSpinner(true);
  try {
    await apiCall('saveClient', { client });
    const idx = S.clients.findIndex(c => c.id === client.id);
    if (idx >= 0) S.clients[idx] = client; else S.clients.push(client);
    return true;
  } catch(e) {
    toast('שגיאה בשמירה: ' + e.message, 'error');
    return false;
  } finally { showSpinner(false); }
}

async function deleteClientConfirm() {
  const id     = S.panelClientId;
  const client = S.clients.find(c => c.id === id);
  if (!client) return;
  openConfirmModal({
    title: 'מחיקת לקוח',
    message: `למחוק את "${client.name}"? פעולה זו בלתי הפיכה.`,
    btnLabel: 'מחק', btnClass: 'btn-danger',
    action: async () => {
      showSpinner(true);
      try {
        await apiCall('deleteClient', { id });
        S.clients = S.clients.filter(c => c.id !== id);
        closePanel('client-panel');
        renderClientsList();
        toast('לקוח נמחק', 'success');
      } catch(e) { toast('שגיאה במחיקה: ' + e.message, 'error'); }
      finally    { showSpinner(false); }
    }
  });
}

function openAddClientModal() {
  document.getElementById('add-client-name').value  = '';
  document.getElementById('add-client-phone').value = '';
  document.getElementById('add-client-email').value = '';
  openModalEl(document.getElementById('add-client-modal'));
}

async function submitAddClient() {
  const name = document.getElementById('add-client-name').value.trim();
  if (!name) { toast('שם הלקוח הוא שדה חובה', 'error'); return; }
  const client = {
    id: uid(), name,
    phone:   document.getElementById('add-client-phone').value.trim(),
    email:   document.getElementById('add-client-email').value.trim(),
    address: '', notes: '',
    createdAt: new Date().toISOString()
  };
  const ok = await saveClientData(client);
  if (ok) {
    closeModalEl(document.getElementById('add-client-modal'));
    renderClientsList();
    toast('לקוח נוסף ✓', 'success');
  }
}

// ================================================================
// IDEAS WING
// ================================================================
async function loadAndRenderIdeasWing() {
  const wc = document.getElementById('wing-content');
  wc.innerHTML = `
    <div class="wing-header">
      <button class="btn-wing-back" onclick="openWing(null)">← חזרה</button>
      <h2 class="wing-title">💡 רעיונות</h2>
      <button class="btn-gold btn-sm" onclick="openAddIdeaModal()">+ רעיון</button>
    </div>
    <div class="ideas-list" id="ideas-list">
      <p class="text-muted text-sm">טוען…</p>
    </div>`;

  showSpinner(true);
  try {
    const result = await apiCall('getIdeas');
    S.ideas = result.ideas || [];
    renderIdeasList();
  } catch(e) {
    toast('שגיאה בטעינת רעיונות: ' + e.message, 'error');
  } finally {
    showSpinner(false);
  }
}

function renderIdeasList() {
  const list = document.getElementById('ideas-list');
  if (!list) return;
  if (!S.ideas.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">💡</div><p>אין רעיונות עדיין</p></div>';
    return;
  }
  list.innerHTML = S.ideas.map(idea => `
    <div class="wing-item" onclick="openIdeaPanel('${escHtml(idea.id)}')">
      <div class="wing-item-title">
        ${escHtml(idea.name)}
        ${idea.convertedProjectId ? ' <span style="font-size:0.75rem;color:var(--green)">✅ הפך לפרויקט</span>' : ''}
      </div>
      <div class="wing-item-meta">
        ${idea.stage    ? `<span>${escHtml(idea.stage)}</span>`    : ''}
        ${idea.category ? `<span>${escHtml(idea.category)}</span>` : ''}
      </div>
    </div>`).join('');
}

function openIdeaPanel(id) {
  const idea = S.ideas.find(i => i.id === id);
  if (!idea) return;
  S.panelIdeaId = id;
  renderIdeaPanel(idea);
  openPanel('idea-panel');
  if (idea.folderId) loadIdeaFiles(idea);
}

function renderIdeaPanel(idea) {
  const panel = document.getElementById('idea-panel');
  panel.querySelector('.panel-title').textContent = idea.name;
  const body = panel.querySelector('.panel-body');

  body.innerHTML = `
    <div class="panel-section">
      <div class="field-grid">
        <div class="field-item full">
          <span class="field-label">שם הרעיון</span>
          <div class="field-value editable" data-ifield="name" data-type="text">${escHtml(idea.name)}</div>
        </div>
        <div class="field-item full">
          <span class="field-label">תיאור</span>
          <div class="field-value editable" data-ifield="description" data-type="text">
            ${idea.description ? escHtml(idea.description) : '<span class="placeholder">—</span>'}
          </div>
        </div>
        <div class="field-item">
          <span class="field-label">שלב</span>
          <div class="field-value editable" data-ifield="stage" data-type="text">
            ${idea.stage ? escHtml(idea.stage) : '<span class="placeholder">—</span>'}
          </div>
        </div>
        <div class="field-item">
          <span class="field-label">קטגוריה</span>
          <div class="field-value editable" data-ifield="category" data-type="text">
            ${idea.category ? escHtml(idea.category) : '<span class="placeholder">—</span>'}
          </div>
        </div>
        <div class="field-item full">
          <span class="field-label">לקוחות</span>
          <div class="field-value editable" data-ifield="clients" data-type="text">
            ${idea.clients ? escHtml(idea.clients) : '<span class="placeholder">—</span>'}
          </div>
        </div>
        <div class="field-item full">
          <span class="field-label">הערות</span>
          <div class="field-value editable" data-ifield="notes" data-type="text">
            ${idea.notes ? escHtml(idea.notes) : '<span class="placeholder">—</span>'}
          </div>
        </div>
      </div>
    </div>
    <div class="panel-section">
      <div class="section-title-row">
        <span class="section-title">📎 קבצים</span>
        ${idea.folderId ? `
          <label class="btn-upload-file" for="idea-file-input">📎 הוסף קובץ</label>
          <input type="file" id="idea-file-input" class="file-input-hidden" multiple />
          <a class="btn-drive-folder"
             href="https://drive.google.com/drive/folders/${escHtml(idea.folderId)}"
             target="_blank" rel="noopener" title="פתח ב-Drive">📁</a>
        ` : `
          <button class="btn-secondary btn-sm" onclick="createIdeaFolder()">📁 צור תיקייה</button>
        `}
      </div>
      <div class="project-files-list" id="idea-files-list">
        ${idea.folderId
          ? '<p class="text-muted text-sm">טוען קבצים…</p>'
          : '<p class="text-muted text-sm">צור תיקייה כדי לצרף קבצים</p>'}
      </div>
    </div>`;

  // Inline edit listeners
  body.querySelectorAll('.field-value.editable').forEach(el => {
    el.addEventListener('click', () => startIdeaInlineEdit(el, idea));
  });

  // File upload listener
  if (idea.folderId) {
    const fi = body.querySelector('#idea-file-input');
    if (fi) {
      fi.addEventListener('change', async e => {
        for (const f of [...e.target.files]) await uploadIdeaFile(idea, f);
        e.target.value = '';
      });
    }
  }

  // Convert button
  const convertBtn = panel.querySelector('#btn-convert-idea');
  if (convertBtn) convertBtn.classList.toggle('hidden', !!idea.convertedProjectId);
}

function startIdeaInlineEdit(el, idea) {
  const field   = el.dataset.ifield;
  const current = idea[field] || '';
  const input   = document.createElement('input');
  input.type      = 'text';
  input.className = 'field-edit-input';
  input.value     = current;
  el.innerHTML    = '';
  el.appendChild(input);
  input.focus();

  const save = async () => {
    const newVal = input.value.trim();
    if (newVal !== current) {
      idea[field] = newVal;
      const ok = await saveIdeaData(idea);
      if (ok) { renderIdeaPanel(idea); renderIdeasList(); toast('נשמר ✓', 'success'); }
      else     { idea[field] = current; renderIdeaPanel(idea); }
    } else {
      renderIdeaPanel(idea);
    }
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

async function saveIdeaData(idea) {
  showSpinner(true);
  try {
    await apiCall('saveIdea', { idea });
    const idx = S.ideas.findIndex(i => i.id === idea.id);
    if (idx >= 0) S.ideas[idx] = idea; else S.ideas.push(idea);
    return true;
  } catch(e) {
    toast('שגיאה בשמירה: ' + e.message, 'error');
    return false;
  } finally { showSpinner(false); }
}

async function deleteIdeaConfirm() {
  const idea = S.ideas.find(i => i.id === S.panelIdeaId);
  if (!idea) return;
  openConfirmModal({
    title: 'מחיקת רעיון',
    message: `למחוק את "${idea.name}"? פעולה זו בלתי הפיכה.`,
    btnLabel: 'מחק', btnClass: 'btn-danger',
    action: async () => {
      showSpinner(true);
      try {
        await apiCall('deleteIdea', { id: idea.id });
        S.ideas = S.ideas.filter(i => i.id !== idea.id);
        closePanel('idea-panel');
        renderIdeasList();
        toast('רעיון נמחק', 'success');
      } catch(e) { toast('שגיאה במחיקה: ' + e.message, 'error'); }
      finally    { showSpinner(false); }
    }
  });
}

async function createIdeaFolder() {
  const idea = S.ideas.find(i => i.id === S.panelIdeaId);
  if (!idea) return;
  showSpinner(true);
  try {
    const result = await apiCall('getOrCreateIdeaFolder', { ideaId: idea.id, ideaName: idea.name });
    idea.folderId = result.folderId;
    await saveIdeaData(idea);
    renderIdeaPanel(idea);
    loadIdeaFiles(idea);
    toast('תיקייה נוצרה ✓', 'success');
  } catch(e) {
    toast('שגיאה ביצירת תיקייה: ' + e.message, 'error');
  } finally { showSpinner(false); }
}

async function loadIdeaFiles(idea) {
  const listEl = document.getElementById('idea-files-list');
  if (!listEl || !idea.folderId) return;
  try {
    const result = await apiCall('getProjectFiles', { folderId: idea.folderId });
    const files  = result.files || [];
    if (!files.length) {
      listEl.innerHTML = '<p class="text-muted text-sm">אין קבצים עדיין</p>';
    } else {
      listEl.innerHTML = files.map(f => `
        <div class="project-file-item" data-file-id="${escHtml(f.id)}">
          <span class="file-icon">${fileIcon(f.mimeType)}</span>
          <a class="file-name" href="${escHtml(f.url)}" target="_blank" rel="noopener">${escHtml(f.name)}</a>
          <span class="file-size">${formatFileSize(f.size)}</span>
          <button class="btn-file-delete" onclick="deleteIdeaFile('${escHtml(f.id)}',this)" title="מחק">✕</button>
        </div>`).join('');
    }
  } catch(e) {
    if (listEl) listEl.innerHTML = '<p class="text-muted text-sm">שגיאה בטעינת קבצים</p>';
  }
}

async function uploadIdeaFile(idea, file) {
  if (!idea.folderId) { toast('אין תיקיית Drive לרעיון', 'error'); return; }
  const MAX = 20 * 1024 * 1024;
  if (file.size > MAX) { toast(`${file.name} — גדול מ-20MB`, 'error'); return; }
  toast(`מעלה: ${file.name}…`, 'info');
  try {
    const base64 = await fileToBase64(file);
    await apiCall('uploadFile', {
      folderId: idea.folderId,
      filename: file.name,
      base64,
      mimeType: file.type || 'application/octet-stream'
    });
    toast(`${file.name} הועלה ✓`, 'success');
    loadIdeaFiles(idea);
  } catch(e) {
    toast('שגיאה בהעלאה: ' + e.message, 'error');
  }
}

async function deleteIdeaFile(fileId, btn) {
  if (!confirm('למחוק את הקובץ מ-Drive?')) return;
  try {
    await apiCall('deleteFile', { fileId });
    btn.closest('.project-file-item').remove();
    toast('קובץ נמחק', 'success');
  } catch(e) {
    toast('שגיאה במחיקה: ' + e.message, 'error');
  }
}

async function convertIdeaToProject() {
  const idea = S.ideas.find(i => i.id === S.panelIdeaId);
  if (!idea) return;
  closePanel('idea-panel');
  window._convertingIdeaId = idea.id;
  document.getElementById('add-project-name').value   = idea.name;
  document.getElementById('add-project-client').value = idea.clients || '';
  document.getElementById('add-project-type').value   = 'client';
  document.getElementById('add-project-deadline').value = '';
  const statusSel = document.getElementById('add-project-status');
  statusSel.innerHTML = S.statuses.map((s, i) =>
    `<option value="${escHtml(s)}"${i===0?' selected':''}>${escHtml(s)}</option>`
  ).join('');
  openModalEl(document.getElementById('add-modal'));
}

function openAddIdeaModal() {
  document.getElementById('add-idea-name').value        = '';
  document.getElementById('add-idea-description').value = '';
  document.getElementById('add-idea-stage').value       = '';
  openModalEl(document.getElementById('add-idea-modal'));
}

async function submitAddIdea() {
  const name = document.getElementById('add-idea-name').value.trim();
  if (!name) { toast('שם הרעיון הוא שדה חובה', 'error'); return; }
  const idea = {
    id: uid(), name,
    description:       document.getElementById('add-idea-description').value.trim(),
    stage:             document.getElementById('add-idea-stage').value.trim(),
    category: '', clients: '', notes: '',
    folderId: '', convertedProjectId: '',
    createdAt: new Date().toISOString()
  };
  const ok = await saveIdeaData(idea);
  if (ok) {
    closeModalEl(document.getElementById('add-idea-modal'));
    renderIdeasList();
    toast('רעיון נוסף ✓', 'success');
  }
}

// ================================================================
// PRODUCTS WING
// ================================================================
function renderProductsWing() {
  const wc  = document.getElementById('wing-content');
  const sub = S.productsSubTab;

  if (!sub) {
    wc.innerHTML = `
      <div class="wing-header">
        <button class="btn-wing-back" onclick="openWing(null)">← חזרה</button>
        <h2 class="wing-title">📦 מוצרים וספקים</h2>
      </div>
      <div class="wing-tiles">
        <button class="wing-tile" onclick="switchProductsTab('manufacturers')">
          <span class="wing-tile-icon">🏭</span>
          <span class="wing-tile-label">יצרנים</span>
        </button>
        <button class="wing-tile" onclick="switchProductsTab('products')">
          <span class="wing-tile-icon">📦</span>
          <span class="wing-tile-label">מוצרים</span>
        </button>
      </div>`;
    return;
  }

  if (sub === 'manufacturers') {
    wc.innerHTML = `
      <div class="wing-header">
        <button class="btn-wing-back" onclick="switchProductsTab(null)">← חזרה</button>
        <h2 class="wing-title">🏭 יצרנים</h2>
        <button class="btn-gold btn-sm" onclick="openAddManufacturerModal()">+ יצרן</button>
      </div>
      <div id="manufacturers-list-container"></div>`;
    loadManufacturers();
    return;
  }

  wc.innerHTML = `
    <div class="wing-header">
      <button class="btn-wing-back" onclick="switchProductsTab(null)">← חזרה</button>
      <h2 class="wing-title">📦 מוצרים</h2>
    </div>
    <div class="empty-state" style="padding:3rem 1rem;">
      <div class="empty-icon">🚧</div><p>בפיתוח — בקרוב</p>
    </div>`;
}

function switchProductsTab(tab) {
  S.productsSubTab = tab;
  renderProductsWing();
}

// ================================================================
// MANUFACTURERS TAB
// ================================================================
async function loadManufacturers() {
  const c = document.getElementById('manufacturers-list-container');
  if (!c) return;
  c.innerHTML = '<div style="padding:1rem;color:var(--text-muted)">טוען...</div>';
  try {
    const result = await apiCall('getManufacturers');
    S.manufacturers = result.manufacturers || [];
    renderManufacturersList();
  } catch(e) {
    c.innerHTML = `<p style="padding:1rem;color:var(--text-muted)">שגיאה: ${escHtml(e.message)}</p>`;
  }
}

function renderManufacturersList() {
  const c = document.getElementById('manufacturers-list-container');
  if (!c) return;

  if (!S.manufacturers.length) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏭</div>
        <p>אין יצרנים עדיין</p>
      </div>`;
    return;
  }

  c.innerHTML = `
    <div class="wing-list">
      ${S.manufacturers.map(m => `
        <div class="wing-item" onclick="openManufacturerPanel('${escHtml(m.id)}')">
          <div class="wing-item-name">${escHtml(m.name)}</div>
          <div class="wing-item-sub">${escHtml(m.contact?.person || '')}${m.contact?.phone ? ' · ' + escHtml(m.contact.phone) : ''}</div>
        </div>`).join('')}
    </div>`;
}

function openManufacturerPanel(id) {
  S.panelManufacturerId = id;
  const mfr = S.manufacturers.find(m => m.id === id);
  if (!mfr) return;
  renderManufacturerPanel(mfr);
  openPanel('manufacturer-panel');
}

function renderManufacturerPanel(mfr) {
  const panel = document.getElementById('manufacturer-panel');
  if (!panel) return;

  const productOptions = S.products.map(p => `<option value="${escHtml(p.name)}">`).join('');

  const priceRows = (mfr.priceTable || []).map(row => `
    <tr>
      <td><input type="text" class="form-input price-product" list="products-datalist" value="${escHtml(row.product || '')}" placeholder="שם מוצר" /></td>
      <td><input type="text" class="form-input price-qty" value="${escHtml(row.qty || '')}" placeholder="כמות" /></td>
      <td><input type="text" class="form-input price-val" value="${escHtml(row.price || '')}" placeholder="מחיר ₪" /></td>
      <td><button class="btn-icon-sm" onclick="removePriceRow(this)" title="מחק">✕</button></td>
    </tr>`).join('');

  const docsControls = mfr.folderId
    ? `<div style="display:flex;gap:0.4rem;align-items:center;">
         <label class="btn-upload-file" for="mfr-file-input" style="cursor:pointer">+ הוסף</label>
         <input type="file" id="mfr-file-input" class="file-input-hidden" multiple />
         <a class="btn-drive-folder" href="https://drive.google.com/drive/folders/${escHtml(mfr.folderId)}" target="_blank" rel="noopener" title="פתח ב-Drive">📁</a>
       </div>`
    : `<button class="btn-secondary btn-sm" onclick="createManufacturerFolder('${escHtml(mfr.id)}')">📁 צור תיקייה</button>`;

  const docsPlaceholder = mfr.folderId
    ? '<p class="text-muted text-sm">טוען קבצים…</p>'
    : '<p class="text-muted text-sm">צור תיקייה כדי לצרף קבצים</p>';

  panel.innerHTML = `
    <div class="panel-header">
      <button class="btn-panel-close" onclick="closePanel('manufacturer-panel')">✕</button>
      <h3 class="panel-title" contenteditable="true" id="mfr-name-edit">${escHtml(mfr.name)}</h3>
    </div>
    <div class="panel-body">
      <div class="panel-section">
        <div class="panel-section-header">פרטי קשר</div>
        <div class="field-grid">
          <div class="field-item">
            <span class="field-label">איש קשר</span>
            <input type="text" class="form-input field-editable" data-field="contact.person"  value="${escHtml(mfr.contact?.person  || '')}" placeholder="שם איש קשר" />
          </div>
          <div class="field-item">
            <span class="field-label">טלפון</span>
            <input type="text" class="form-input field-editable" data-field="contact.phone"   value="${escHtml(mfr.contact?.phone   || '')}" placeholder="מספר טלפון" />
          </div>
          <div class="field-item">
            <span class="field-label">אימייל</span>
            <input type="email" class="form-input field-editable" data-field="contact.email"  value="${escHtml(mfr.contact?.email   || '')}" placeholder="כתובת אימייל" />
          </div>
          <div class="field-item">
            <span class="field-label">כתובת</span>
            <input type="text" class="form-input field-editable" data-field="contact.address" value="${escHtml(mfr.contact?.address || '')}" placeholder="כתובת מפעל" />
          </div>
        </div>
      </div>

      <div class="panel-section">
        <div class="panel-section-header" style="display:flex;justify-content:space-between;align-items:center;">
          <span>טבלת מחירים</span>
          <button class="btn-sm btn-outline" onclick="addPriceRow()">+ שורה</button>
        </div>
        <datalist id="products-datalist">${productOptions}</datalist>
        <table class="price-table">
          <thead><tr><th>מוצר</th><th>כמות</th><th>מחיר ₪</th><th></th></tr></thead>
          <tbody id="price-tbody">${priceRows}</tbody>
        </table>
      </div>

      <div class="panel-section">
        <div class="panel-section-header">הערות</div>
        <textarea class="form-input" id="mfr-notes" rows="3" placeholder="הערות...">${escHtml(mfr.notes || '')}</textarea>
      </div>

      <div class="panel-section">
        <div class="panel-section-header" style="display:flex;justify-content:space-between;align-items:center;">
          <span>📎 מסמכים</span>
          ${docsControls}
        </div>
        <div class="project-files-list" id="mfr-files-list">${docsPlaceholder}</div>
      </div>
    </div>
    <div class="panel-footer">
      <button class="btn-gold" onclick="saveMfrPanel('${escHtml(mfr.id)}')">שמור</button>
      <button class="btn-danger btn-sm" onclick="deleteManufacturerConfirm('${escHtml(mfr.id)}')">מחק</button>
    </div>`;

  // File upload listener + initial load
  if (mfr.folderId) {
    const fi = panel.querySelector('#mfr-file-input');
    if (fi) {
      fi.addEventListener('change', async e => {
        for (const f of [...e.target.files]) await uploadManufacturerFile(mfr, f);
        e.target.value = '';
      });
    }
    loadManufacturerFiles(mfr);
  }
}

function addPriceRow() {
  const tbody = document.getElementById('price-tbody');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="form-input price-product" list="products-datalist" placeholder="שם מוצר" /></td>
    <td><input type="text" class="form-input price-qty" placeholder="כמות" /></td>
    <td><input type="text" class="form-input price-val" placeholder="מחיר ₪" /></td>
    <td><button class="btn-icon-sm" onclick="removePriceRow(this)" title="מחק">✕</button></td>`;
  tbody.appendChild(tr);
}

function removePriceRow(btn) {
  btn.closest('tr').remove();
}

function collectPriceTable() {
  return [...document.querySelectorAll('#price-tbody tr')].map(tr => ({
    product: tr.querySelector('.price-product')?.value.trim() || '',
    qty:     tr.querySelector('.price-qty')?.value.trim()     || '',
    price:   tr.querySelector('.price-val')?.value.trim()     || ''
  })).filter(r => r.product || r.qty || r.price);
}

// ── Manufacturer documents ─────────────────────────────────────────────────

async function createManufacturerFolder(id) {
  const mfr = S.manufacturers.find(m => m.id === id);
  if (!mfr) return;
  showSpinner(true);
  try {
    const res = await apiCall('getOrCreateManufacturerFolder', { mfrId: mfr.id, mfrName: mfr.name });
    mfr.folderId = res.folderId;
    await saveManufacturerData(mfr);
    renderManufacturerPanel(mfr);
  } catch(e) {
    toast('שגיאה ביצירת תיקייה: ' + e.message, 'error');
  } finally { showSpinner(false); }
}

async function loadManufacturerFiles(mfr) {
  const listEl = document.getElementById('mfr-files-list');
  if (!listEl || !mfr.folderId) return;
  try {
    const res = await apiCall('getProjectFiles', { folderId: mfr.folderId });
    const files = res.files || [];
    if (!files.length) {
      listEl.innerHTML = '<p class="text-muted text-sm">אין קבצים עדיין</p>';
      return;
    }
    listEl.innerHTML = files.map(f => `
      <div class="project-file-item">
        <a href="${escHtml(f.url)}" target="_blank" rel="noopener" class="file-link">📄 ${escHtml(f.name)}</a>
        <button class="btn-icon-sm" onclick="deleteMfrFile('${escHtml(f.id)}', this)" title="מחק">🗑</button>
      </div>`).join('');
  } catch(e) {
    if (listEl) listEl.innerHTML = '<p class="text-muted text-sm">שגיאה בטעינת קבצים</p>';
  }
}

async function uploadManufacturerFile(mfr, file) {
  toast(`מעלה: ${file.name}…`, 'info');
  try {
    const base64 = await fileToBase64(file);
    await apiCall('uploadFile', {
      folderId: mfr.folderId,
      filename: file.name,
      base64,
      mimeType: file.type || 'application/octet-stream'
    });
    toast(`${file.name} הועלה ✓`, 'success');
    await loadManufacturerFiles(mfr);
  } catch(e) {
    toast('שגיאה בהעלאה: ' + e.message, 'error');
  }
}

async function deleteMfrFile(fileId, btn) {
  if (!confirm('למחוק את הקובץ מ-Drive?')) return;
  try {
    await apiCall('deleteFile', { fileId });
    btn.closest('.project-file-item').remove();
    toast('קובץ נמחק', 'success');
  } catch(e) {
    toast('שגיאה: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function saveMfrPanel(id) {
  const mfr = S.manufacturers.find(m => m.id === id);
  if (!mfr) return;

  const nameEl = document.getElementById('mfr-name-edit');
  if (nameEl) mfr.name = nameEl.textContent.trim();

  document.querySelectorAll('.field-editable').forEach(inp => {
    const f = inp.dataset.field, v = inp.value.trim();
    if (!mfr.contact) mfr.contact = {};
    if (f === 'contact.person')  mfr.contact.person  = v;
    if (f === 'contact.phone')   mfr.contact.phone   = v;
    if (f === 'contact.email')   mfr.contact.email   = v;
    if (f === 'contact.address') mfr.contact.address = v;
  });

  mfr.priceTable = collectPriceTable();
  const notesEl = document.getElementById('mfr-notes');
  if (notesEl) mfr.notes = notesEl.value.trim();

  await saveManufacturerData(mfr);
}

async function saveManufacturerData(mfr) {
  showSpinner(true);
  try {
    await apiCall('saveManufacturer', { manufacturer: mfr });
    const idx = S.manufacturers.findIndex(m => m.id === mfr.id);
    if (idx >= 0) S.manufacturers[idx] = mfr;
    else S.manufacturers.push(mfr);
    renderManufacturersList();
    toast('יצרן נשמר ✓', 'success');
    return true;
  } catch(e) {
    toast('שגיאה בשמירה: ' + e.message, 'error');
    return false;
  } finally {
    showSpinner(false);
  }
}

function deleteManufacturerConfirm(id) {
  const mfr = S.manufacturers.find(m => m.id === id);
  if (!mfr) return;
  openConfirmModal({
    title: 'מחיקת יצרן',
    message: `למחוק את "${mfr.name}"? פעולה זו בלתי הפיכה.`,
    btnLabel: 'מחק', btnClass: 'btn-danger',
    action: async () => {
      showSpinner(true);
      try {
        await apiCall('deleteManufacturer', { id: mfr.id });
        S.manufacturers = S.manufacturers.filter(m => m.id !== mfr.id);
        closePanel('manufacturer-panel');
        renderManufacturersList();
        toast('יצרן נמחק', 'success');
      } catch(e) { toast('שגיאה במחיקה: ' + e.message, 'error'); }
      finally    { showSpinner(false); }
    }
  });
}

function openAddManufacturerModal() {
  const modal = document.getElementById('add-manufacturer-modal');
  if (!modal) return;
  document.getElementById('add-mfr-name').value    = '';
  document.getElementById('add-mfr-person').value  = '';
  document.getElementById('add-mfr-phone').value   = '';
  document.getElementById('add-mfr-email').value   = '';
  document.getElementById('add-mfr-address').value = '';
  document.getElementById('add-mfr-notes').value   = '';
  modal.classList.remove('hidden');
}

async function submitAddManufacturer() {
  const name = document.getElementById('add-mfr-name')?.value.trim();
  if (!name) { toast('שם יצרן נדרש', 'error'); return; }
  const mfr = {
    id: uid(), name,
    contact: {
      person:  document.getElementById('add-mfr-person')?.value.trim()  || '',
      phone:   document.getElementById('add-mfr-phone')?.value.trim()   || '',
      email:   document.getElementById('add-mfr-email')?.value.trim()   || '',
      address: document.getElementById('add-mfr-address')?.value.trim() || ''
    },
    priceTable: [],
    notes: document.getElementById('add-mfr-notes')?.value.trim() || '',
    createdAt: new Date().toISOString()
  };
  const ok = await saveManufacturerData(mfr);
  if (ok) {
    closeModalEl(document.getElementById('add-manufacturer-modal'));
    openManufacturerPanel(mfr.id);
  }
}


// ================================================================
// INIT
// ================================================================
function init() {
  wireEvents();

  if (restoreSession()) {
    showScreen('app');
    loadAll();
  } else {
    showScreen('login-screen');
  }

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);


// ================================================================
// AUTO-INJECT: add-idea-modal (missing from index.html)
// ================================================================
(function() {
  if (document.getElementById('add-idea-modal')) return;
  const el = document.createElement('div');
  el.id = 'add-idea-modal';
  el.className = 'modal-backdrop hidden';
  el.innerHTML =
    '<div class="modal-box">' +
    '<div class="modal-header">' +
    '<span class="modal-title">רעיון חדש</span>' +
    '<button class="btn-modal-close">✕</button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<div class="form-group">' +
    '<label class="form-label">שם הרעיון *</label>' +
    '<input type="text" id="add-idea-name" class="form-input" placeholder="שם הרעיון" />' +
    '</div>' +
    '<div class="form-group">' +
    '<label class="form-label">תיאור</label>' +
    '<textarea id="add-idea-description" class="form-input" rows="3" placeholder="תיאור הרעיון"></textarea>' +
    '</div>' +
    '<div class="form-group">' +
    '<label class="form-label">שלב</label>' +
    '<input type="text" id="add-idea-stage" class="form-input" placeholder="למשל: ראשוני, בפיתוח..." />' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button onclick="submitAddIdea()" class="btn-primary">הוסף רעיון</button>' +
    '<button class="btn-secondary btn-modal-close">ביטול</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(el);
})();

// Fix: prevent browser autocomplete from filling search with username
(function() {
  const fs = document.getElementById('filter-search');
  if (fs) {
    fs.setAttribute('autocomplete', 'off');
    fs.value = '';
    fs.addEventListener('focus', () => {
      // Clear any browser-autofilled value that matches username pattern
      setTimeout(() => {
        if (fs.value && !S.filters.search) { fs.value = ''; }
      }, 50);
    });
  }
})();


// ================================================================
// NOTIFICATIONS
// ================================================================

function computeNotifications() {
  const lsTime = S.lastSeen ? new Date(S.lastSeen).getTime() : 0;
  const TWO_DAYS = 172800000;
  const others = S.changes.filter(c =>
    c.user !== S.user.username && new Date(c.timestamp).getTime() > lsTime
  );
  S.notifs = {
    newProjects:       others.filter(c => c.changeType === 'created'),
    bossPriorities:    others.filter(c => c.changeType === 'priority' && c.user === 'yakov'),
    projectChanges:    others.filter(c => ['note','status','field','file'].includes(c.changeType)),
    upcomingDeadlines: S.projects.filter(p => {
      if (p.completed || !p.deadline) return false;
      const diff = new Date(p.deadline).getTime() - Date.now();
      return diff > 0 && diff <= TWO_DAYS;
    })
  };
  const tot = S.notifs.newProjects.length + S.notifs.bossPriorities.length +
              S.notifs.projectChanges.length + S.notifs.upcomingDeadlines.length;
  S.newCount = tot;
  updateChangesBadge();
}

function renderAll() {
  renderHeader();
  renderProjectList();
  updateChangesBadge();
  updateFilterDropdowns();
  saveToCache();
  computeNotifications();
}

function openChangesPanel() {
  _renderNotifPanel();
  openPanel('changes-panel');
  S.newCount = 0;
  updateChangesBadge();
}

function _renderNotifPanel() {
  const panel = document.getElementById('changes-panel');
  const body  = panel.querySelector('.panel-body');
  const sub   = panel.querySelector('.changes-subheader');
  const n = S.notifs || { newProjects:[], bossPriorities:[], projectChanges:[], upcomingDeadlines:[] };
  const tot = n.newProjects.length + n.bossPriorities.length +
              n.projectChanges.length + n.upcomingDeadlines.length;
  if (sub) sub.textContent = tot > 0 ? tot + ' התראות' : 'אין התראות חדשות';
  const cl = body.querySelector('.changes-list');
  if (!cl) return;
  const bits = [];

  if (n.upcomingDeadlines.length) {
    bits.push('<div class="notif-group"><div class="notif-group-title">⏰ דדליינים קרובים</div>' +
      n.upcomingDeadlines.map(p => {
        const days = Math.ceil((new Date(p.deadline) - Date.now()) / 86400000);
        return '<div class="change-item is-new" style="cursor:pointer" onclick="openProjectPanel(\'' +
          escHtml(p.id) + '\');closePanel(\'changes-panel\')">' +
          '<div class="change-icon status">⏰</div><div class="change-body">' +
          '<div class="change-project">' + escHtml(p.name) + '</div>' +
          '<div class="change-details">דדליין בעוד ' + days + ' ימים — ' + fmt.date(p.deadline) + '</div>' +
          '</div></div>';
      }).join('') + '</div>');
  }

  if (n.newProjects.length) {
    bits.push('<div class="notif-group"><div class="notif-group-title">🆕 פרויקטים חדשים</div>' +
      n.newProjects.map(c =>
        '<div class="change-item is-new"><div class="change-icon created">✨</div><div class="change-body">' +
        '<div class="change-project">' + escHtml(c.projectName) + '</div>' +
        '<div class="change-details">נוצר ע"י ' + escHtml(CONFIG.USERS[c.user]?.displayName || c.user) + '</div>' +
        '<div class="change-time">' + fmt.relativeTime(c.timestamp) + '</div>' +
        '</div></div>').join('') + '</div>');
  }

  if (n.bossPriorities.length) {
    bits.push('<div class="notif-group"><div class="notif-group-title">⭐ עד קעותיחת מהבוס</div>' +
      n.bossPriorities.map(c =>
        '<div class="change-item is-new"><div class="change-icon priority">⭐</div><div class="change-body">' +
        '<div class="change-project">' + escHtml(c.projectName) + '</div>' +
        '<div class="change-details">' + escHtml(c.details) + '</div>' +
        '<div class="change-time">' + fmt.relativeTime(c.timestamp) + '</div>' +
        '</div></div>').join('') + '</div>');
  }

  if (n.projectChanges.length) {
    const imap = { status:'🔄', note:'💬', field:'✏️', file:'📎' };
    bits.push('<div class="notif-group"><div class="notif-group-title">💬 שינויים בפרויקטים</div>' +
      n.projectChanges.slice(0,8).map(c =>
        '<div class="change-item is-new"><div class="change-icon ' + c.changeType + '">' +
        (imap[c.changeType]||'✏️') + '</div><div class="change-body">' +
        '<div class="change-project">' + escHtml(c.projectName) + '</div>' +
        '<div class="change-details">' + escHtml(c.details) + ' — <strong>' +
        escHtml(CONFIG.USERS[c.user]?.displayName || c.user) + '</strong></div>' +
        '<div class="change-time">' + fmt.relativeTime(c.timestamp) + '</div>' +
        '</div></div>').join('') +
      (n.projectChanges.length > 8 ? '<div style="padding:.25rem .75rem;color:var(--text-muted);font-size:.8rem">+ ' + (n.projectChanges.length - 8) + ' שינויים נוספים</div>' : '') +
      '</div>');
  }

  if (!bits.length) {
    bits.push('<div class="empty-state"><div class="empty-icon">🔔</div><p>אין התראות חדשות</p></div>');
  }

  if (S.changes.length) {
    const lsTime = S.lastSeen ? new Date(S.lastSeen).getTime() : 0;
    const imap2 = {
      status:{cls:'status',ic:'🔄'}, note:{cls:'note',ic:'💬'}, info:{cls:'info',ic:'ℹ️'},
      priority:{cls:'priority',ic:'⭐'}, created:{cls:'created',ic:'✨'},
      deleted:{cls:'deleted',ic:'🗑️'}, completed:{cls:'completed',ic:'✅'},
      field:{cls:'field',ic:'✏️'}, file:{cls:'file',ic:'📎'}
    };
    bits.push('<div class="notif-group-title" style="margin-top:.75rem;border-top:1px solid var(--border);padding-top:.75rem">📋 כל הפעילות</div>' +
      S.changes.slice(0,50).map(c => {
        const ic   = imap2[c.changeType] || imap2.field;
        const isN  = c.user !== S.user.username && new Date(c.timestamp).getTime() > lsTime;
        const user = CONFIG.USERS[c.user]?.displayName || c.user;
        return '<div class="change-item ' + (isN?'is-new':'') + '"><div class="change-icon ' + ic.cls + '">' + ic.ic + '</div>' +
          '<div class="change-body"><div class="change-project">' + escHtml(c.projectName) + '</div>' +
          '<div class="change-details">' + escHtml(c.details) + ' — <strong>' + escHtml(user) + '</strong></div>' +
          '<div class="change-time">' + fmt.relativeTime(c.timestamp) + '</div></div></div>';
      }).join(''));
  }

  cl.innerHTML = bits.join('');
}

(function() {
  const s = document.createElement('style');
  s.textContent = '.notif-group{margin-bottom:.5rem}.notif-group-title{font-size:.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;padding:.35rem .75rem;background:var(--bg-alt,rgba(0,0,0,.04));border-radius:4px;margin:.35rem 0}';
  document.head.appendChild(s);
})();

// ================================================================
// PRODUCTS WING — full implementation
// ================================================================

function renderProductsWing() {
  const wc  = document.getElementById('wing-content');
  const sub = S.productsSubTab;
  if (!sub) {
    wc.innerHTML =
      '<div class="wing-header">' +
      '<button class="btn-wing-back" onclick="openWing(null)">← חזרה</button>' +
      '<h2 class="wing-title">📦 מוצרים וספקים</h2></div>' +
      '<div class="wing-tiles">' +
      '<button class="wing-tile" onclick="switchProductsTab(\'manufacturers\')">' +
      '<span class="wing-tile-icon">🏭</span><span class="wing-tile-label">יצרנים</span></button>' +
      '<button class="wing-tile" onclick="switchProductsTab(\'products\')">' +
      '<span class="wing-tile-icon">📦</span><span class="wing-tile-label">מוצרים</span></button>' +
      '</div>';
    return;
  }
  if (sub === 'manufacturers') {
    wc.innerHTML =
      '<div class="wing-header">' +
      '<button class="btn-wing-back" onclick="switchProductsTab(null)">← חזרה</button>' +
      '<h2 class="wing-title">🏭 יצרנים</h2>' +
      '<button class="btn-add-wing" onclick="openModalEl(document.getElementById(\'add-manufacturer-modal\'))">+ הוסף</button>' +
      '</div>' +
      '<div class="wing-list-container" id="manufacturers-list-container">' +
      '<div style="padding:1rem;color:var(--text-muted)">טוען...</div></div>';
    loadManufacturers();
    return;
  }
  if (sub === 'products') {
    wc.innerHTML =
      '<div class="wing-header">' +
      '<button class="btn-wing-back" onclick="switchProductsTab(null)">← חזרה</button>' +
      '<h2 class="wing-title">📦 מוצרים</h2>' +
      '<button class="btn-add-wing" onclick="openAddProductModal()">+ הוסף מוצר</button>' +
      '</div>' +
      '<div class="wing-list-container" id="products-list-container">' +
      '<div style="padding:1rem;color:var(--text-muted)">טוען...</div></div>';
    loadProducts();
  }
}

async function loadProducts() {
  const c = document.getElementById('products-list-container');
  if (!c) return;
  try {
    const r = await apiCall('getProducts');
    S.products = r.products || [];
    renderProductsList();
  } catch(e) {
    if (c) c.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">' + escHtml(e.message) + '</p>';
  }
}

function renderProductsList() {
  const c = document.getElementById('products-list-container');
  if (!c) return;
  const dl = document.getElementById('products-datalist');
  if (dl) dl.innerHTML = S.products.map(p => '<option value="' + escHtml(p.name) + '">').join('');
  if (!S.products.length) {
    c.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>אין מוצרים עדיין</p></div>';
    return;
  }
  c.innerHTML = '<div class="wing-list">' + S.products.map(p =>
    '<div class="wing-item" onclick="openProductPanel(\'' + escHtml(p.id) + '\')">' +
    '<div class="wing-item-name">' + escHtml(p.name) + '</div>' +
    '<div class="wing-item-sub">' + escHtml(p.manufacturerName || '') +
    (p.barcode ? ' · ' + escHtml(p.barcode) : '') + '</div></div>'
  ).join('') + '</div>';
}

function openProductPanel(id) {
  const p = S.products.find(x => x.id === id);
  if (!p) return;
  S.panelProductId = id;
  renderProductPanel(p);
  openPanel('product-panel');
}

function renderProductPanel(prod) {
  const panel = document.getElementById('product-panel');
  if (!panel) return;
  const mfrOpts = '<option value="">— ללא יצרן —</option>' +
    S.manufacturers.map(m =>
      '<option value="' + escHtml(m.name) + '"' + (m.name === prod.manufacturerName ? ' selected' : '') +
      '>' + escHtml(m.name) + '</option>').join('');
  const hasFld = !!prod.folderId;

  panel.innerHTML =
    '<div class="panel-header">' +
    '<button class="btn-panel-close" onclick="closePanel(\'product-panel\')">✕</button>' +
    '<h3 class="panel-title" contenteditable="true" id="prod-name-edit">' + escHtml(prod.name) + '</h3>' +
    '</div>' +
    '<div class="panel-body">' +

    '<div class="panel-section">' +
    '<div class="panel-section-header">פרטי מוצר</div>' +
    '<div class="field-grid">' +
    '<div class="field-item full"><span class="field-label">יצרן</span>' +
    '<select class="form-input" id="prod-mfr-sel">' + mfrOpts + '</select></div>' +
    '<div class="field-item"><span class="field-label">ברקוד</span>' +
    '<input type="text" class="form-input" id="prod-barcode" value="' + escHtml(prod.barcode || '') + '" placeholder="ברקוד" /></div>' +
    '</div></div>' +

    '<div class="panel-section">' +
    '<div class="section-title-row"><span class="section-title">מסמכי תקן</span>' +
    '<label class="btn-upload-file" for="prod-std-fi">📎 הוסף</label>' +
    '<input type="file" id="prod-std-fi" class="file-input-hidden" multiple />' +
    '</div>' +
    '<div class="project-files-list" id="prod-std-files">' +
    (hasFld ? '<p class="text-muted text-sm">טוען...</p>' : '<p class="text-muted text-sm">אין קבצים</p>') +
    '</div></div>' +

    '<div class="panel-section">' +
    '<div class="section-title-row"><span class="section-title">מסמכי אריזה / הוראות</span>' +
    '<label class="btn-upload-file" for="prod-pkg-fi">📎 הוסף</label>' +
    '<input type="file" id="prod-pkg-fi" class="file-input-hidden" multiple />' +
    '</div>' +
    '<div class="project-files-list" id="prod-pkg-files">' +
    (hasFld ? '<p class="text-muted text-sm">טוען...</p>' : '<p class="text-muted text-sm">אין קבצים</p>') +
    '</div></div>' +

    '<div class="panel-section"><div class="section-title">הערות</div>' +
    '<div class="log-list">' + renderLogEntries(prod.notes || [], 'notes-entry') + '</div>' +
    '<div class="log-add-form">' +
    '<textarea class="log-textarea" id="new-prod-note" placeholder="הוסף הערה..."></textarea>' +
    '<button class="btn-gold" onclick="addProductNote()">הוסף הערה</button>' +
    '</div></div>' +

    '<div class="panel-section" style="display:flex;gap:.5rem;padding-top:.25rem">' +
    '<button class="btn-gold" onclick="saveProductPanel()">שמור שינויים</button>' +
    '<button class="btn-danger" onclick="deleteProduct(\'' + escHtml(prod.id) + '\')">מחק מוצר</button>' +
    '</div>' +
    '</div>';

  const nameEl = panel.querySelector('#prod-name-edit');
  if (nameEl) nameEl.addEventListener('blur', saveProductPanel);

  _loadProdFiles(prod, 'std');
  _loadProdFiles(prod, 'pkg');
  const sfi = panel.querySelector('#prod-std-fi');
  if (sfi) sfi.addEventListener('change', async e => {
    for (const f of [...e.target.files]) await _uploadProdFile(prod, f, 'std');
    e.target.value = '';
  });
  const pfi = panel.querySelector('#prod-pkg-fi');
  if (pfi) pfi.addEventListener('change', async e => {
    for (const f of [...e.target.files]) await _uploadProdFile(prod, f, 'pkg');
    e.target.value = '';
  });
}

async function _loadProdFiles(prod, type) {
  const el = document.getElementById('prod-' + type + '-files');
  if (!el) return;
  const fid = type === 'std' ? prod.stdFolderId : prod.pkgFolderId;
  if (!fid) { el.innerHTML = '<p class="text-muted text-sm">אין קבצים עדיין</p>'; return; }
  try {
    const r = await apiCall('getProjectFiles', { folderId: fid });
    const files = r.files || [];
    el.innerHTML = files.length
      ? files.map(f => `<div class="project-file-item"><span class="file-icon">${fileIcon(f.mimeType)}</span><a class="file-name" href="${escHtml(f.url)}" target="_blank" rel="noopener">${escHtml(f.name)}</a><span class="file-size">${formatFileSize(f.size)}</span><button class="btn-file-delete" onclick="deleteProdFile('${escHtml(f.id)}','${escHtml(prod.id)}','${type}',this)" title="מחק">🗑</button></div>`).join('')
      : '<p class="text-muted text-sm">אין קבצים עדיין</p>';
  } catch { el.innerHTML = '<p class="text-muted text-sm">שגיאה בטעינת קבצים</p>'; }
}

async function _uploadProdFile(prod, file, type) {
  toast('מעלה: ' + file.name + '...', 'info');
  try {
    const b64 = await fileToBase64(file);
    const r = await apiCall('uploadProductFile', {
      productId: prod.id, docType: type,
      filename: file.name, base64: b64,
      mimeType: file.type || 'application/octet-stream'
    });
    if (r.folderId)    prod.folderId    = r.folderId;
    if (r.stdFolderId) prod.stdFolderId = r.stdFolderId;
    if (r.pkgFolderId) prod.pkgFolderId = r.pkgFolderId;
    const idx = S.products.findIndex(p => p.id === prod.id);
    if (idx >= 0) S.products[idx] = prod;
    toast(file.name + ' הועלה ✓', 'success');
    _loadProdFiles(prod, type);
  } catch(e) { toast('שגיאה בהעלאה: ' + e.message, 'error'); }
}

async function deleteProdFile(fileId, prodId, type, btn) {
  if (!confirm('למחוק את הקובץ מ-Drive? פעולה זו בלתי הפיכה.')) return;
  try {
    await apiCall('deleteFile', { fileId });
    btn.closest('.project-file-item').remove();
    toast('קובץ נמחק', 'success');
  } catch(e) {
    toast('שגיאה במחיקה: ' + e.message, 'error');
  }
}

async function saveProductPanel() {
  const prod = S.products.find(p => p.id === S.panelProductId);
  if (!prod) return;
  const n = document.getElementById('prod-name-edit');
  const m = document.getElementById('prod-mfr-sel');
  const b = document.getElementById('prod-barcode');
  if (n && n.textContent.trim()) prod.name = n.textContent.trim();
  if (m) prod.manufacturerName = m.value;
  if (b) prod.barcode = b.value.trim();
  const ok = await saveProductData(prod);
  if (ok) { renderProductsList(); closePanel('product-panel'); toast('נשמר ✓', 'success'); }
}

async function addProductNote() {
  const prod = S.products.find(p => p.id === S.panelProductId);
  if (!prod) return;
  const ta = document.getElementById('new-prod-note');
  const text = ta.value.trim();
  if (!text) return;
  prod.notes = [...(prod.notes || []), { date: new Date().toISOString(), user: S.user.username, text }];
  const ok = await saveProductData(prod);
  if (ok) { ta.value = ''; renderProductPanel(prod); toast('הערה נוספה ✓', 'success'); }
}

async function deleteProduct(id) {
  if (!confirm('למחוק את המוצר?')) return;
  try {
    await apiCall('deleteProduct', { id });
    S.products = S.products.filter(p => p.id !== id);
    closePanel('product-panel');
    renderProductsList();
    toast('מוצר נמחק', 'success');
  } catch(e) { toast('שגיאה במחיקה: ' + e.message, 'error'); }
}

async function saveProductData(prod) {
  showSpinner(true);
  try {
    const r = await apiCall('saveProduct', { product: prod });
    if (r.folderId) prod.folderId = r.folderId;
    const idx = S.products.findIndex(p => p.id === prod.id);
    if (idx >= 0) S.products[idx] = prod; else S.products.push(prod);
    return true;
  } catch(e) { toast('שגיאה בשמירה: ' + e.message, 'error'); return false; }
  finally { showSpinner(false); }
}

function openAddProductModal() {
  if (!S.manufacturers.length) {
    apiCall('getManufacturers')
      .then(r => { S.manufacturers = r.manufacturers || []; _openAddProdModal(); })
      .catch(() => _openAddProdModal());
  } else {
    _openAddProdModal();
  }
}

function _openAddProdModal() {
  const m = document.getElementById('add-product-modal');
  if (!m) return;
  document.getElementById('add-prod-name').value = '';
  document.getElementById('add-prod-barcode').value = '';
  document.getElementById('add-prod-mfr').innerHTML =
    '<option value="">— ללא יצרן —</option>' +
    S.manufacturers.map(x =>
      '<option value="' + escHtml(x.name) + '">' + escHtml(x.name) + '</option>').join('');
  openModalEl(m);
}

async function submitAddProduct() {
  const name = document.getElementById('add-prod-name').value.trim();
  if (!name) { toast('שם המוצר הוא שדה חובה', 'error'); return; }
  const prod = {
    id: uid(), name,
    manufacturerName: document.getElementById('add-prod-mfr').value,
    barcode:          document.getElementById('add-prod-barcode').value.trim(),
    notes: [], folderId: '', stdFolderId: '', pkgFolderId: '',
    createdAt: new Date().toISOString()
  };
  const ok = await saveProductData(prod);
  if (ok) {
    closeModalEl(document.getElementById('add-product-modal'));
    renderProductsList();
    toast('מוצר נוסף ✓', 'success');
  }
}

// ── DOM injections ──
(function injectProductDom() {
  if (!document.getElementById('product-panel')) {
    const el = document.createElement('div');
    el.className = 'center-panel'; el.id = 'product-panel';
    document.body.appendChild(el);
  }
  if (!document.getElementById('add-product-modal')) {
    const el = document.createElement('div');
    el.className = 'modal-backdrop hidden'; el.id = 'add-product-modal';
    el.innerHTML =
      '<div class="modal">' +
      '<div class="modal-header"><h3>📦 מוצר חדש</h3>' +
      '<button class="btn-modal-close">✕</button></div>' +
      '<div class="modal-body">' +
      '<div class="form-group"><label>שם מוצר *</label>' +
      '<input type="text" id="add-prod-name" class="form-input" placeholder="שם המוצר" /></div>' +
      '<div class="form-group"><label>יצרן</label>' +
      '<select id="add-prod-mfr" class="form-input"><option value="">— ללא יצרן —</option></select></div>' +
      '<div class="form-group"><label>ברקוד</label>' +
      '<input type="text" id="add-prod-barcode" class="form-input" placeholder="ברקוד" /></div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn-gold" onclick="submitAddProduct()">הוסף מוצר</button>' +
      '</div></div>';
    document.body.appendChild(el);
    el.querySelector('.btn-modal-close').addEventListener('click', () => closeModalEl(el));
    el.addEventListener('click', e => { if (e.target === el) closeModalEl(el); });
  }
  if (!document.getElementById('products-datalist')) {
    const dl = document.createElement('datalist');
    dl.id = 'products-datalist';
    document.body.appendChild(dl);
  }
})();
