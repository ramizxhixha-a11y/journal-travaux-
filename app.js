/* ═════════════════════════════════════════════════════════════════════════
   JOURNAL DES TRAVAUX — App logic
   Stockage : IndexedDB (offline-first)
   Sync     : GitHub API (manuel, sur demande)
   ═════════════════════════════════════════════════════════════════════════ */

'use strict';

// ──────────────────────────────────────────────────────────────────────────
// STATE & CONSTANTS
// ──────────────────────────────────────────────────────────────────────────
const DB_NAME = 'journal_travaux';
const DB_VERSION = 1;
const STORES = {
  projet:      'projet',       // 1 row : page de garde + synthèse
  folios:      'folios',       // n rows : un folio par jour
  complements: 'complements',  // n rows : un complément par cas qui déborde
  settings:    'settings',     // GitHub token, owner, repo, etc.
};

let db = null;
let state = {
  projet:      null,
  folios:      [],
  complements: [],
  currentFolioId: null,
  currentComplementId: null,
};

// ──────────────────────────────────────────────────────────────────────────
// INDEXEDDB
// ──────────────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.projet))
        db.createObjectStore(STORES.projet, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.folios))
        db.createObjectStore(STORES.folios, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(STORES.complements))
        db.createObjectStore(STORES.complements, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(STORES.settings))
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
    };
  });
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbPut(store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbClear(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// LOAD / REFRESH STATE
// ──────────────────────────────────────────────────────────────────────────
async function loadState() {
  state.projet = (await dbGet(STORES.projet, 'main')) || {
    id: 'main',
    projet_id: 'PRJ-001',
    statut: 'Actif',
  };
  state.folios      = await dbGetAll(STORES.folios);
  state.complements = await dbGetAll(STORES.complements);
  state.folios.sort((a, b) => (a.folio_no || 0) - (b.folio_no || 0));
  state.complements.sort((a, b) => (a.folio_compl_no || 0) - (b.folio_compl_no || 0));
}

// ──────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────
function $(sel)  { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function pad(n, len = 4) { return String(n).padStart(len, '0'); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1, 2)}-${pad(d.getDate(), 2)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('#toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function setSyncDot(status) {
  // status: 'idle' | 'dirty' | 'synced' | 'error'
  const d = $('#sync-indicator');
  d.className = 'sync-dot ' + status;
  d.title = {
    idle:   'Pas de modification non sauvegardée',
    dirty:  'Modifications non synchronisées',
    synced: 'Synchronisé avec GitHub',
    error:  'Erreur de synchronisation',
  }[status] || '';
}

// Lecture / écriture des champs d'un formulaire
function formToObject(formEl) {
  const obj = {};
  const els = formEl.querySelectorAll('input, select, textarea');
  els.forEach(el => {
    if (!el.name) return;
    let v = el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    obj[el.name] = v;
  });
  return obj;
}

function objectToForm(formEl, obj) {
  if (!obj) return;
  const els = formEl.querySelectorAll('input, select, textarea');
  els.forEach(el => {
    if (!el.name) return;
    if (obj[el.name] === undefined || obj[el.name] === null) {
      el.value = '';
    } else {
      el.value = obj[el.name];
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// NAVIGATION (between screens)
// ──────────────────────────────────────────────────────────────────────────
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  // Hooks
  if (name === 'accueil')  renderAccueil();
  if (name === 'projet')   renderProjet();
  if (name === 'folios')   renderFoliosList();
  window.scrollTo(0, 0);
}

$$('.nav-btn').forEach(b => {
  b.addEventListener('click', () => showScreen(b.dataset.nav));
});

// Generic action handlers (data-action attributes)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const map = {
    'new-folio':            handleNewFolio,
    'open-current-folio':   handleOpenTodayFolio,
    'new-complement':       handleNewComplement,
    'back-to-list':         () => showScreen('folios'),
    'delete-folio':         handleDeleteFolio,
    'delete-complement':    handleDeleteComplement,
    'generate-pdf':         handleGeneratePdf,
    'export-json':          handleExportJson,
    'import-json':          handleImportJson,
    'publish-github':       handlePublishGitHub,
  };
  if (map[action]) map[action]();
});

// ──────────────────────────────────────────────────────────────────────────
// RENDER : ACCUEIL
// ──────────────────────────────────────────────────────────────────────────
function renderAccueil() {
  $('#today-date').textContent = new Date().toLocaleDateString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  $('#stat-folios').textContent = state.folios.length;
  const cumulOuvriers = state.folios.reduce((acc, f) => {
    return acc + (f.ouvriers || []).reduce((a, o) => a + (Number(o.nombre) || 0), 0);
  }, 0);
  $('#stat-ouvriers').textContent = cumulOuvriers;
  $('#stat-complements').textContent = state.complements.length;
  $('#stat-jo').textContent = state.folios.length || '—';

  // Header
  $('#header-projet-id').textContent  = state.projet?.projet_id || 'PRJ-???';
  $('#header-projet-nom').textContent = state.projet?.nom || 'Sans nom';

  // Liste des 5 derniers folios
  const recent = state.folios.slice().reverse().slice(0, 5);
  const ul = $('#recent-folios');
  if (recent.length === 0) {
    ul.innerHTML = '<li class="empty-state">Aucun folio saisi pour le moment.</li>';
  } else {
    ul.innerHTML = recent.map(folioListHtml).join('');
    ul.querySelectorAll('.folio-item').forEach((li, i) => {
      li.addEventListener('click', () => openFolio(recent[i].id));
    });
  }
}

function folioListHtml(f) {
  const statut = (f.statut || 'Brouillon').toLowerCase();
  const cls = statut.includes('sign') ? 'signe' : 'brouillon';
  const summary = (f.b_travaux || '').substring(0, 60);
  return `
    <li class="folio-item">
      <span class="folio-num">N°${pad(f.folio_no || 0, 4)}</span>
      <div class="folio-info">
        <div class="folio-date">${fmtDate(f.date)}</div>
        <div class="folio-summary">${summary || '<span style="opacity:.5">— vide —</span>'}</div>
      </div>
      <span class="folio-status ${cls}">${f.statut || 'Brouillon'}</span>
    </li>
  `;
}

// ──────────────────────────────────────────────────────────────────────────
// RENDER : PROJET (form)
// ──────────────────────────────────────────────────────────────────────────
function renderProjet() {
  objectToForm($('#form-projet'), state.projet);
}

$('#save-projet').addEventListener('click', async () => {
  const data = formToObject($('#form-projet'));
  data.id = 'main';
  await dbPut(STORES.projet, data);
  state.projet = data;
  setSyncDot('dirty');
  toast('Projet sauvegardé ✓', 'success');
  renderAccueil();
});

// ──────────────────────────────────────────────────────────────────────────
// RENDER : FOLIOS LIST
// ──────────────────────────────────────────────────────────────────────────
function renderFoliosList() {
  const ul = $('#all-folios');
  if (state.folios.length === 0) {
    ul.innerHTML = '<li class="empty-state">Aucun folio. Tapez "+ Nouveau" pour démarrer.</li>';
  } else {
    ul.innerHTML = state.folios.slice().reverse().map(folioListHtml).join('');
    const items = ul.querySelectorAll('.folio-item');
    state.folios.slice().reverse().forEach((f, i) => {
      items[i].addEventListener('click', () => openFolio(f.id));
    });
  }

  const cul = $('#all-complements');
  if (state.complements.length === 0) {
    cul.innerHTML = '<li class="empty-state">Aucun complément.</li>';
  } else {
    cul.innerHTML = state.complements.map(c => `
      <li class="folio-item">
        <span class="folio-num">N°${pad(c.folio_compl_no || 0, 4)}</span>
        <div class="folio-info">
          <div class="folio-date">Case ${c.case || '?'} · Folio ${pad(c.folio_no_ref || 0, 4)}</div>
          <div class="folio-summary">${(c.texte || '').substring(0, 60)}</div>
        </div>
      </li>
    `).join('');
    const items = cul.querySelectorAll('.folio-item');
    state.complements.forEach((c, i) => {
      items[i].addEventListener('click', () => openComplement(c.id));
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// FOLIO : nouveau, ouvrir, sauver, supprimer
// ──────────────────────────────────────────────────────────────────────────
function nextFolioNo() {
  if (state.folios.length === 0) return 1;
  const max = Math.max(...state.folios.map(f => f.folio_no || 0));
  return Math.min(max + 1, 30);
}

async function handleNewFolio() {
  state.currentFolioId = null;
  const folio = {
    folio_no: nextFolioNo(),
    date: todayISO(),
    h_debut: '07:30',
    h_fin: '16:30',
    meteo: '',
    statut: 'Brouillon',
    signe_prep: 'Non',
    signe_ent:  'Non',
    ouvriers: [],
  };
  populateFolioForm(folio);
  showScreen('folio');
}

async function handleOpenTodayFolio() {
  const today = todayISO();
  const existing = state.folios.find(f => f.date === today);
  if (existing) {
    openFolio(existing.id);
  } else {
    handleNewFolio();
  }
}

function openFolio(id) {
  const f = state.folios.find(x => x.id === id);
  if (!f) return;
  state.currentFolioId = id;
  populateFolioForm(f);
  showScreen('folio');
}

function populateFolioForm(folio) {
  $('#folio-title').textContent = `Folio N° ${pad(folio.folio_no || 1, 4)}`;
  objectToForm($('#form-folio'), folio);
  renderOuvriersRows(folio.ouvriers || []);
}

$('#save-folio').addEventListener('click', () => saveFolio('Signé'));
$('#save-folio-draft').addEventListener('click', () => saveFolio('Brouillon'));

async function saveFolio(forceStatut = null) {
  const form = $('#form-folio');
  const data = formToObject(form);
  data.ouvriers = collectOuvriersRows();
  if (forceStatut && !$('#f-statut').value.match(/Signé|Validé/)) {
    data.statut = forceStatut;
  }
  if (state.currentFolioId) {
    data.id = state.currentFolioId;
  }
  const id = await dbPut(STORES.folios, data);
  state.currentFolioId = id;
  await loadState();
  setSyncDot('dirty');
  toast('Folio sauvegardé ✓', 'success');
  showScreen('folios');
}

async function handleDeleteFolio() {
  if (!state.currentFolioId) return;
  if (!confirm('Supprimer ce folio ? Action irréversible.')) return;
  await dbDelete(STORES.folios, state.currentFolioId);
  state.currentFolioId = null;
  await loadState();
  setSyncDot('dirty');
  toast('Folio supprimé', '');
  showScreen('folios');
}

// ──────────────────────────────────────────────────────────────────────────
// OUVRIERS rows
// ──────────────────────────────────────────────────────────────────────────
function renderOuvriersRows(rows = []) {
  const wrap = $('#ouvriers-rows');
  wrap.innerHTML = '';
  if (rows.length === 0) addOuvrierRow();
  else rows.forEach(o => addOuvrierRow(o));
  updateTotalOuvriers();
}

function addOuvrierRow(data = {}) {
  const wrap = $('#ouvriers-rows');
  const div = document.createElement('div');
  div.className = 'ouvriers-row';
  div.innerHTML = `
    <div class="row-classe"><input type="text" placeholder="Classe" value="${data.classe || ''}"></div>
    <div class="row-metier"><input type="text" placeholder="Métier" value="${data.metier || ''}"></div>
    <div class="row-nb"><input type="number" min="0" placeholder="0" value="${data.nombre ?? ''}"></div>
    <button type="button" class="row-delete" title="Supprimer">×</button>
  `;
  wrap.appendChild(div);
  div.querySelector('.row-delete').addEventListener('click', () => {
    div.remove();
    updateTotalOuvriers();
  });
  div.querySelectorAll('input').forEach(i => {
    i.addEventListener('input', updateTotalOuvriers);
  });
}

function collectOuvriersRows() {
  return Array.from(document.querySelectorAll('.ouvriers-row')).map(row => ({
    classe: row.querySelector('.row-classe input').value.trim(),
    metier: row.querySelector('.row-metier input').value.trim(),
    nombre: Number(row.querySelector('.row-nb input').value) || 0,
  })).filter(r => r.classe || r.metier || r.nombre);
}

function updateTotalOuvriers() {
  const total = collectOuvriersRows().reduce((a, o) => a + o.nombre, 0);
  $('#total-ouvriers').textContent = total;
}

$('#add-ouvrier-row').addEventListener('click', () => addOuvrierRow());

// ──────────────────────────────────────────────────────────────────────────
// COMPLEMENT : nouveau, ouvrir, sauver, supprimer
// ──────────────────────────────────────────────────────────────────────────
async function handleNewComplement() {
  state.currentComplementId = null;
  const used = state.complements.map(c => c.folio_compl_no);
  let next = 31;
  while (used.includes(next) && next <= 40) next++;
  const cpl = {
    folio_compl_no: next > 40 ? 40 : next,
    case: 'H',
  };
  populateComplementForm(cpl);
  showScreen('complement');
}

function openComplement(id) {
  const c = state.complements.find(x => x.id === id);
  if (!c) return;
  state.currentComplementId = id;
  populateComplementForm(c);
  showScreen('complement');
}

function populateComplementForm(cpl) {
  $('#complement-title').textContent = `Complément N° ${pad(cpl.folio_compl_no || 31, 4)}`;
  objectToForm($('#form-complement'), cpl);
}

$('#save-complement').addEventListener('click', async () => {
  const data = formToObject($('#form-complement'));
  if (state.currentComplementId) data.id = state.currentComplementId;
  const id = await dbPut(STORES.complements, data);
  state.currentComplementId = id;
  await loadState();
  setSyncDot('dirty');
  toast('Complément sauvegardé ✓', 'success');
  showScreen('folios');
});

async function handleDeleteComplement() {
  if (!state.currentComplementId) return;
  if (!confirm('Supprimer ce complément ? Action irréversible.')) return;
  await dbDelete(STORES.complements, state.currentComplementId);
  state.currentComplementId = null;
  await loadState();
  setSyncDot('dirty');
  toast('Complément supprimé', '');
  showScreen('folios');
}

// ──────────────────────────────────────────────────────────────────────────
// EXPORT / IMPORT JSON
// ──────────────────────────────────────────────────────────────────────────
function buildExportObject() {
  return {
    version: '1.0',
    exported_at: new Date().toISOString(),
    projet: state.projet,
    folios: state.folios,
    complements: state.complements,
  };
}

async function handleExportJson() {
  const obj = buildExportObject();
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const pid = state.projet?.projet_id || 'PRJ-XXX';
  a.href = url;
  a.download = `journal-travaux_${pid}_${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('JSON exporté ✓', 'success');
}

function handleImportJson() {
  $('#import-file').click();
}

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.projet) throw new Error('JSON invalide : "projet" manquant');

    if (!confirm("Importer ce JSON va REMPLACER toutes vos données locales.\nContinuer ?")) {
      e.target.value = '';
      return;
    }
    // Reset stores et réinjecter
    await dbClear(STORES.projet);
    await dbClear(STORES.folios);
    await dbClear(STORES.complements);

    if (data.projet) {
      const p = { ...data.projet, id: 'main' };
      await dbPut(STORES.projet, p);
    }
    if (Array.isArray(data.folios)) {
      for (const f of data.folios) {
        delete f.id; // auto-increment va lui en réassigner un
        await dbPut(STORES.folios, f);
      }
    }
    if (Array.isArray(data.complements)) {
      for (const c of data.complements) {
        delete c.id;
        await dbPut(STORES.complements, c);
      }
    }

    await loadState();
    renderAccueil();
    toast('Import réussi ✓', 'success');
  } catch (err) {
    console.error(err);
    toast('Erreur d\'import : ' + err.message, 'error');
  }
  e.target.value = '';
});

// ──────────────────────────────────────────────────────────────────────────
// GITHUB SYNC : publier le JSON dans le repo
// ──────────────────────────────────────────────────────────────────────────
async function getGitHubConfig() {
  const r = await Promise.all([
    dbGet(STORES.settings, 'gh_owner'),
    dbGet(STORES.settings, 'gh_repo'),
    dbGet(STORES.settings, 'gh_token'),
  ]);
  return { owner: r[0]?.value, repo: r[1]?.value, token: r[2]?.value };
}

async function handlePublishGitHub() {
  const cfg = await getGitHubConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    toast('Configurez GitHub dans Réglages d\'abord', 'error');
    showScreen('reglages');
    return;
  }

  const pid = state.projet?.projet_id || 'PRJ-XXX';
  const path = `data/${pid}.json`;
  const content = btoa(unescape(encodeURIComponent(
    JSON.stringify(buildExportObject(), null, 2)
  )));

  toast('Publication en cours…');

  try {
    // 1. Get current SHA (si fichier existe déjà)
    const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
    const getRes = await fetch(`${apiBase}/contents/${path}`, {
      headers: { Authorization: `Bearer ${cfg.token}` }
    });
    let sha = null;
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }

    // 2. PUT le fichier
    const body = {
      message: `Mise à jour journal ${pid} — ${new Date().toISOString().slice(0, 10)}`,
      content: content,
      ...(sha && { sha })
    };
    const putRes = await fetch(`${apiBase}/contents/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(err.message || `HTTP ${putRes.status}`);
    }

    setSyncDot('synced');
    toast('Publié sur GitHub ✓', 'success');
  } catch (err) {
    console.error(err);
    setSyncDot('error');
    toast('Erreur GitHub : ' + err.message, 'error');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// GÉNÉRATION PDF : déclenche la GitHub Action
// ──────────────────────────────────────────────────────────────────────────
async function handleGeneratePdf() {
  const cfg = await getGitHubConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    toast('Configurez GitHub dans Réglages d\'abord', 'error');
    showScreen('reglages');
    return;
  }
  if (!confirm("On va d'abord publier vos données actuelles sur GitHub,\npuis lancer la génération du PDF (≈ 1 minute).\n\nContinuer ?")) return;

  // 1. Publier
  await handlePublishGitHub();

  // 2. Déclencher l'Action
  try {
    const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
    const res = await fetch(`${apiBase}/actions/workflows/generate-pdf.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { projet_id: state.projet?.projet_id || 'PRJ-001' },
      }),
    });
    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    toast('PDF en cours de génération ! Vérifiez l\'onglet Actions de votre repo.', 'success');
  } catch (err) {
    console.error(err);
    toast('Erreur déclenchement PDF : ' + err.message, 'error');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// SETTINGS — GitHub config
// ──────────────────────────────────────────────────────────────────────────
async function loadGitHubConfig() {
  const cfg = await getGitHubConfig();
  $('#g-owner').value = cfg.owner || '';
  $('#g-repo').value  = cfg.repo  || '';
  $('#g-token').value = cfg.token || '';
}

$('#save-github-config').addEventListener('click', async () => {
  await dbPut(STORES.settings, { key: 'gh_owner', value: $('#g-owner').value.trim() });
  await dbPut(STORES.settings, { key: 'gh_repo',  value: $('#g-repo').value.trim()  });
  await dbPut(STORES.settings, { key: 'gh_token', value: $('#g-token').value.trim() });
  toast('Configuration GitHub enregistrée ✓', 'success');
});

$('#reset-data').addEventListener('click', async () => {
  if (!confirm("⚠ Cela va EFFACER toutes vos données locales (projet, folios, compléments). Pensez à exporter avant si nécessaire. Continuer ?")) return;
  await dbClear(STORES.projet);
  await dbClear(STORES.folios);
  await dbClear(STORES.complements);
  await loadState();
  renderAccueil();
  toast('Données effacées', '');
});

// ──────────────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────────────
(async function init() {
  try {
    db = await openDB();
    await loadState();
    await loadGitHubConfig();
    renderAccueil();
    setSyncDot('idle');
  } catch (err) {
    console.error(err);
    alert('Erreur d\'initialisation : ' + err.message);
  }
})();
