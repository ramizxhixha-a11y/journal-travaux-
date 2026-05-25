/* ═════════════════════════════════════════════════════════════════════════
   JOURNAL DES TRAVAUX — App logic v2.1
   Stockage : IndexedDB (offline-first)
   Sync     : GitHub API (manuel, sur demande)
   V2.1     : météo auto + détection débordement + bouton complément case
   ═════════════════════════════════════════════════════════════════════════ */

'use strict';

// ──────────────────────────────────────────────────────────────────────────
// STATE & CONSTANTS
// ──────────────────────────────────────────────────────────────────────────
const DB_NAME = 'journal_travaux';
const DB_VERSION = 1;
const STORES = {
  projet:      'projet',
  folios:      'folios',
  complements: 'complements',
  settings:    'settings',
};

// Coords Uccle (chantier CHIREC Cavell)
const METEO_LAT = 50.7949;
const METEO_LON = 4.3520;

// WMO weather code → français
const WMO_FR = {
  0: 'Ensoleillé', 1: 'Beau', 2: 'Nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard',
  51: 'Pluie légère', 53: 'Pluie légère', 55: 'Pluie légère',
  56: 'Pluie légère', 57: 'Pluie légère',
  61: 'Pluie légère', 63: 'Pluie forte', 65: 'Pluie forte',
  66: 'Pluie légère', 67: 'Pluie forte',
  71: 'Neige', 73: 'Neige', 75: 'Neige', 77: 'Neige',
  80: 'Pluie légère', 81: 'Pluie forte', 82: 'Pluie forte',
  85: 'Neige', 86: 'Neige',
  95: 'Orage', 96: 'Orage', 99: 'Orage',
};

let db = null;
let state = {
  projet:      null,
  folios:      [],
  complements: [],
  currentFolioId: null,
  currentComplementId: null,
  meteoAutoTriggeredFor: null, // V2.1 — id du folio pour lequel l'auto-météo a déjà été lancée
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
// LOAD STATE
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
  return `${d.getFullYear()}-${pad(d.getMonth()+1,2)}-${pad(d.getDate(),2)}`;
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
  const d = $('#sync-indicator');
  d.className = 'sync-dot ' + status;
  d.title = {
    idle: 'Pas de modification', dirty: 'Modifications non sync',
    synced: 'Synchronisé GitHub', error: 'Erreur sync',
  }[status] || '';
}

// Bulle "Enregistré"
let saveIndicatorTimer = null;
function showSaveIndicator() {
  const el = $('#save-indicator');
  if (!el) return;
  el.classList.add('show');
  clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

// formToObject / objectToForm
function formToObject(formEl) {
  const obj = {};
  formEl.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name) return;
    let v = el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    obj[el.name] = v;
  });
  return obj;
}
function objectToForm(formEl, obj) {
  if (!obj) return;
  formEl.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name) return;
    if (obj[el.name] === undefined || obj[el.name] === null) el.value = '';
    else el.value = obj[el.name];
  });
}

// Spellcheck FR sur tous les inputs/textareas
function enableSpellcheck(root = document) {
  root.querySelectorAll('input[type="text"], input[type="tel"], textarea').forEach(el => {
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('lang', 'fr');
    el.setAttribute('autocorrect', 'on');
    el.setAttribute('autocapitalize', 'sentences');
  });
}

// ──────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────────────────────────────────────
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'accueil')  renderAccueil();
  if (name === 'projet')   renderProjet();
  if (name === 'folios')   renderFoliosList();
  if (name === 'reglages') renderReglages();
  window.scrollTo(0, 0);
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => showScreen(b.dataset.nav)));

// Action handlers
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const map = {
    'new-folio':            handleNewFolio,
    'open-current-folio':   handleOpenTodayFolio,
    'new-complement':       handleNewComplement,
    'back-to-list':         () => showScreen('folios'),
    'delete-folio':         handleDeleteFolio,
    'delete-complement':    handleDeleteComplement,
    'generate-pdf':         handleGeneratePdf,
    'download-pdf':         handleDownloadPdf,
    'share-pdf':            handleSharePdf,
    'export-json':          handleExportJson,
    'import-json':          handleImportJson,
    'publish-github':       handlePublishGitHub,
  };
  if (map[btn.dataset.action]) map[btn.dataset.action]();
});

// ──────────────────────────────────────────────────────────────────────────
// RENDER : ACCUEIL
// ──────────────────────────────────────────────────────────────────────────
function renderAccueil() {
  $('#today-date').textContent = new Date().toLocaleDateString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  $('#stat-folios').textContent = state.folios.length;
  const cumulOuvriers = state.folios.reduce((acc, f) =>
    acc + (f.ouvriers || []).reduce((a, o) => a + (Number(o.nombre) || 0), 0), 0);
  $('#stat-ouvriers').textContent = cumulOuvriers;
  $('#stat-complements').textContent = state.complements.length;
  $('#stat-jo').textContent = state.folios.length || '—';

  $('#header-projet-id').textContent  = state.projet?.projet_id || 'PRJ-???';
  $('#header-projet-nom').textContent = state.projet?.nom || 'Sans nom';

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

  // Cache "Partager" si pas supporté
  if (!navigator.canShare) {
    const btn = $('#btn-share-pdf');
    if (btn) btn.style.display = 'none';
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
    </li>`;
}

// ──────────────────────────────────────────────────────────────────────────
// RENDER : PROJET — avec champs intervenants
// ──────────────────────────────────────────────────────────────────────────
function renderProjet() {
  const p = state.projet || {};
  // Champs plats
  objectToForm($('#form-projet'), p);
  // Champs structurés → flatten dans les inputs
  const mo = p.maitre_oeuvre || {};
  const be = p.bureau_etude || {};
  $('#p-mo-nom').value = mo.nom || '';
  $('#p-mo-adr').value = mo.adresse || '';
  $('#p-mo-ct').value  = mo.contact || '';
  $('#p-be-nom').value = be.nom || '';
  $('#p-be-adr').value = be.adresse || '';
  $('#p-be-ct').value  = be.contact || '';
  $('#p-adr-ch').value = p.adresse_chantier || '';
  // Contacts → texte multilignes
  const contacts = p.contacts || [];
  $('#p-contacts').value = contacts.map(c =>
    [c.role, c.nom, c.tel, c.email].filter(x => x).join(' — ')
  ).join('\n');
  // Spellcheck (après que les contenus soient chargés)
  enableSpellcheck($('#form-projet'));
}

function parseContactsText(text) {
  if (!text) return [];
  return text.split('\n').map(line => {
    const parts = line.split('—').map(s => s.trim());
    if (parts.length < 2 || !parts.some(p => p)) return null;
    return {
      role:  parts[0] || '',
      nom:   parts[1] || '',
      tel:   parts[2] || '',
      email: parts[3] || '',
    };
  }).filter(c => c && (c.role || c.nom));
}

$('#save-projet').addEventListener('click', async () => {
  const data = formToObject($('#form-projet'));
  // Reconstruire les champs structurés
  data.maitre_oeuvre = {
    nom: data.mo_nom || '', adresse: data.mo_adresse || '', contact: data.mo_contact || ''
  };
  data.bureau_etude = {
    nom: data.be_nom || '', adresse: data.be_adresse || '', contact: data.be_contact || ''
  };
  data.contacts = parseContactsText(data.contacts_raw || '');
  // On supprime les clés _raw / mo_* / be_* du JSON final
  delete data.mo_nom; delete data.mo_adresse; delete data.mo_contact;
  delete data.be_nom; delete data.be_adresse; delete data.be_contact;
  delete data.contacts_raw;
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
      </li>`).join('');
    const items = cul.querySelectorAll('.folio-item');
    state.complements.forEach((c, i) => {
      items[i].addEventListener('click', () => openComplement(c.id));
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// FOLIO : nouveau, ouvrir, sauver
// ──────────────────────────────────────────────────────────────────────────
function nextFolioNo() {
  if (state.folios.length === 0) return 1;
  const max = Math.max(...state.folios.map(f => f.folio_no || 0));
  return Math.min(max + 1, 30);
}

async function handleNewFolio() {
  state.currentFolioId = null;
  const folio = {
    folio_no: nextFolioNo(), date: todayISO(),
    h_debut: '07:30', h_fin: '16:30',
    meteo: '', statut: 'Brouillon',
    signe_prep: 'Non', signe_ent: 'Non', ouvriers: [],
  };
  populateFolioForm(folio);
  showScreen('folio');
  // V2.1 — déclenche la météo auto pour ce nouveau folio
  maybeAutoFetchWeather(folio);
}
async function handleOpenTodayFolio() {
  const today = todayISO();
  const existing = state.folios.find(f => f.date === today);
  if (existing) openFolio(existing.id);
  else handleNewFolio();
}
function openFolio(id) {
  const f = state.folios.find(x => x.id === id);
  if (!f) return;
  state.currentFolioId = id;
  populateFolioForm(f);
  showScreen('folio');
  // V2.1 — météo auto si folio sans météo encore
  maybeAutoFetchWeather(f);
}
function populateFolioForm(folio) {
  $('#folio-title').textContent = `Folio N° ${pad(folio.folio_no || 1, 4)}`;
  objectToForm($('#form-folio'), folio);
  renderOuvriersRows(folio.ouvriers || []);
  enableSpellcheck($('#form-folio'));
  // V2.1 — vérifie le débordement de toutes les cases au chargement
  checkAllOverflows();
  // V2.1 — badge météo
  updateMeteoBadge(folio);
}

function updateMeteoBadge(folio) {
  const badge = $('#meteo-ok-badge');
  if (!badge) return;
  const hasMeteo = folio && (folio.meteo || folio.t_8h != null || folio.t_16h != null);
  badge.hidden = !hasMeteo;
}

$('#save-folio').addEventListener('click', () => saveFolio('Signé'));
$('#save-folio-draft').addEventListener('click', () => saveFolio('Brouillon'));

async function saveFolio(forceStatut = null) {
  const data = formToObject($('#form-folio'));
  data.ouvriers = collectOuvriersRows();
  if (forceStatut && !$('#f-statut').value.match(/Signé|Validé/)) data.statut = forceStatut;
  if (state.currentFolioId) data.id = state.currentFolioId;
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
    <button type="button" class="row-delete" title="Supprimer">×</button>`;
  wrap.appendChild(div);
  div.querySelector('.row-delete').addEventListener('click', () => {
    div.remove(); updateTotalOuvriers(); autoSaveFolio();
  });
  div.querySelectorAll('input').forEach(i => {
    i.addEventListener('input', () => { updateTotalOuvriers(); autoSaveFolio(); });
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
// COMPLEMENT
// ──────────────────────────────────────────────────────────────────────────
async function handleNewComplement(caseLetter = null, folioRef = null) {
  state.currentComplementId = null;
  const used = state.complements.map(c => c.folio_compl_no);
  let next = 31;
  while (used.includes(next) && next <= 40) next++;
  // Récupère la référence du folio courant si demandé
  let folio_no_ref = state.folios.length > 0 ? state.folios[state.folios.length - 1].folio_no : 1;
  let date_ref = todayISO();
  if (folioRef) {
    folio_no_ref = folioRef.folio_no || folio_no_ref;
    date_ref = folioRef.date || date_ref;
  } else if (state.currentFolioId) {
    const cur = state.folios.find(f => f.id === state.currentFolioId);
    if (cur) { folio_no_ref = cur.folio_no; date_ref = cur.date; }
  }
  const cpl = {
    folio_compl_no: next > 40 ? 40 : next,
    folio_no_ref,
    date_ref,
    case: caseLetter || 'H',
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
  enableSpellcheck($('#form-complement'));
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
// V2.1 — DÉTECTION DE DÉBORDEMENT (par case du folio)
// ──────────────────────────────────────────────────────────────────────────
function checkOverflow(textarea) {
  const limit = Number(textarea.dataset.overflow) || 0;
  if (!limit) return false;
  const len = (textarea.value || '').length;
  const fs = textarea.closest('.case-fieldset');
  if (!fs) return false;
  const caseLetter = fs.dataset.case;
  const over = len > limit;
  fs.classList.toggle('overflowing', over);

  // Badge dans le summary
  const badge = fs.querySelector('.overflow-badge');
  if (badge) {
    badge.textContent = over ? `⚠ déborde ${len}/${limit}` : '';
  }

  // Bloc d'alerte sous le textarea
  let warn = fs.querySelector('.overflow-warn');
  if (over) {
    if (!warn) {
      warn = document.createElement('div');
      warn.className = 'overflow-warn';
      warn.innerHTML = `
        <strong>⚠ Cette case déborde du folio papier.</strong>
        <span class="char-count">${len}/${limit} car.</span>
        <button type="button" class="btn-create-complement">+ Créer un complément pour la case ${caseLetter}</button>`;
      textarea.parentElement.appendChild(warn);
      warn.querySelector('button').addEventListener('click', async () => {
        // Sauve le folio en brouillon avant
        if (state.currentFolioId !== null) {
          const data = formToObject($('#form-folio'));
          data.ouvriers = collectOuvriersRows();
          data.id = state.currentFolioId;
          try { await dbPut(STORES.folios, data); } catch (e) { console.error(e); }
        }
        await loadState();
        const folioRef = state.currentFolioId
          ? state.folios.find(f => f.id === state.currentFolioId)
          : null;
        handleNewComplement(caseLetter, folioRef);
      });
    } else {
      warn.querySelector('.char-count').textContent = `${len}/${limit} car.`;
    }
  } else if (warn) {
    warn.remove();
  }
  return over;
}

function checkAllOverflows() {
  $$('#form-folio textarea[data-overflow]').forEach(checkOverflow);
}

// ──────────────────────────────────────────────────────────────────────────
// SAUVEGARDE AUTOMATIQUE (debounce 600ms + beforeunload + visibilitychange)
// ──────────────────────────────────────────────────────────────────────────
let autoSaveTimer = null;
async function autoSaveFolio() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    const folioScreen = $('section[data-screen="folio"]');
    if (!folioScreen || !folioScreen.classList.contains('active')) return;
    const data = formToObject($('#form-folio'));
    if (!data.folio_no) return; // pas encore valide
    data.ouvriers = collectOuvriersRows();
    if (state.currentFolioId) data.id = state.currentFolioId;
    try {
      const id = await dbPut(STORES.folios, data);
      state.currentFolioId = id;
      showSaveIndicator();
    } catch (e) { console.error('autosave folio', e); }
  }, 600);
}
async function autoSaveComplement() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    const screen = $('section[data-screen="complement"]');
    if (!screen || !screen.classList.contains('active')) return;
    const data = formToObject($('#form-complement'));
    if (!data.folio_compl_no) return;
    if (state.currentComplementId) data.id = state.currentComplementId;
    try {
      const id = await dbPut(STORES.complements, data);
      state.currentComplementId = id;
      showSaveIndicator();
    } catch (e) { console.error('autosave compl', e); }
  }, 600);
}
async function autoSaveProjet() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    const screen = $('section[data-screen="projet"]');
    if (!screen || !screen.classList.contains('active')) return;
    const data = formToObject($('#form-projet'));
    data.maitre_oeuvre = {
      nom: data.mo_nom || '', adresse: data.mo_adresse || '', contact: data.mo_contact || ''
    };
    data.bureau_etude = {
      nom: data.be_nom || '', adresse: data.be_adresse || '', contact: data.be_contact || ''
    };
    data.contacts = parseContactsText(data.contacts_raw || '');
    delete data.mo_nom; delete data.mo_adresse; delete data.mo_contact;
    delete data.be_nom; delete data.be_adresse; delete data.be_contact;
    delete data.contacts_raw;
    data.id = 'main';
    try {
      await dbPut(STORES.projet, data);
      state.projet = data;
      showSaveIndicator();
    } catch (e) { console.error('autosave projet', e); }
  }, 600);
}

// Wire l'auto-save sur tous les forms
function wireAutoSave() {
  $('#form-folio').addEventListener('input', (e) => {
    // V2.1 — vérifie le débordement si c'est un textarea avec data-overflow
    if (e.target.tagName === 'TEXTAREA' && e.target.dataset.overflow) {
      checkOverflow(e.target);
    }
    autoSaveFolio();
  });
  $('#form-complement').addEventListener('input', autoSaveComplement);
  $('#form-projet').addEventListener('input', autoSaveProjet);

  window.addEventListener('beforeunload', () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    // Sauve immédiatement le contenu visible
    const folioScreen = $('section[data-screen="folio"]');
    if (folioScreen?.classList.contains('active')) autoSaveFolio();
    const cplScreen = $('section[data-screen="complement"]');
    if (cplScreen?.classList.contains('active')) autoSaveComplement();
    const prjScreen = $('section[data-screen="projet"]');
    if (prjScreen?.classList.contains('active')) autoSaveProjet();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const folioScreen = $('section[data-screen="folio"]');
      if (folioScreen?.classList.contains('active')) autoSaveFolio();
      const cplScreen = $('section[data-screen="complement"]');
      if (cplScreen?.classList.contains('active')) autoSaveComplement();
      const prjScreen = $('section[data-screen="projet"]');
      if (prjScreen?.classList.contains('active')) autoSaveProjet();
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// MÉTÉO — Open-Meteo (coords Uccle, gratuit, sans clé)
// ──────────────────────────────────────────────────────────────────────────
async function fetchWeather() {
  const btn = $('#btn-fetch-meteo');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Récupération...'; }
  try {
    const dateISO = $('#f-date').value || todayISO();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${METEO_LAT}&longitude=${METEO_LON}` +
                `&hourly=temperature_2m,weather_code` +
                `&start_date=${dateISO}&end_date=${dateISO}` +
                `&timezone=Europe%2FBrussels`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
    const data = await res.json();
    const times = data.hourly?.time || [];
    const temps = data.hourly?.temperature_2m || [];
    const codes = data.hourly?.weather_code || [];

    let t8 = null, t16 = null, codeMidi = null;
    times.forEach((t, i) => {
      if (t.endsWith('T08:00')) t8 = Math.round(temps[i]);
      if (t.endsWith('T16:00')) t16 = Math.round(temps[i]);
      if (t.endsWith('T12:00')) codeMidi = codes[i];
    });

    if (t8 !== null) $('#f-t8').value = t8;
    if (t16 !== null) $('#f-t16').value = t16;
    if (codeMidi !== null) {
      const label = WMO_FR[codeMidi] || 'Variable';
      const sel = $('#f-meteo');
      const opt = Array.from(sel.options).find(o => o.value === label);
      if (opt) sel.value = label;
      else sel.value = '';
    }
    // V2.1 — badge
    const badge = $('#meteo-ok-badge');
    if (badge) badge.hidden = false;
    autoSaveFolio();
    toast('Météo récupérée ✓', 'success');
  } catch (err) {
    console.error(err);
    toast('Erreur météo : ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🌤️ Récupérer la météo du jour'; }
  }
}

// V2.1 — déclenche la météo automatiquement à l'ouverture d'un folio sans météo
async function maybeAutoFetchWeather(folio) {
  if (!folio) return;
  // Réglage utilisateur
  const cfg = await dbGet(STORES.settings, 'meteo_auto');
  if (cfg && cfg.value === 'non') return;
  // Déjà des données météo ?
  if (folio.meteo || folio.t_8h != null || folio.t_16h != null) return;
  // Pas de connexion ?
  if (!navigator.onLine) return;
  // Déjà tenté pour ce folio dans cette session ?
  const key = folio.id || `new-${folio.folio_no}-${folio.date}`;
  if (state.meteoAutoTriggeredFor === key) return;
  state.meteoAutoTriggeredFor = key;
  // Délai pour que l'UI ait fini de monter
  setTimeout(() => { fetchWeather(); }, 300);
}

// ──────────────────────────────────────────────────────────────────────────
// EXPORT / IMPORT JSON
// ──────────────────────────────────────────────────────────────────────────
function buildExportObject() {
  return {
    version: '2.1',
    exported_at: new Date().toISOString(),
    projet: state.projet,
    folios: state.folios,
    complements: state.complements,
  };
}
async function handleExportJson() {
  const obj = buildExportObject();
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const pid = state.projet?.projet_id || 'PRJ-XXX';
  a.href = url;
  a.download = `journal-travaux_${pid}_${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('JSON exporté ✓', 'success');
}
function handleImportJson() { $('#import-file').click(); }

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.projet) throw new Error('JSON invalide : "projet" manquant');
    if (!confirm("Importer ce JSON va REMPLACER toutes vos données locales.\nContinuer ?")) {
      e.target.value = ''; return;
    }
    await dbClear(STORES.projet);
    await dbClear(STORES.folios);
    await dbClear(STORES.complements);
    if (data.projet) await dbPut(STORES.projet, { ...data.projet, id: 'main' });
    if (Array.isArray(data.folios)) {
      for (const f of data.folios) { delete f.id; await dbPut(STORES.folios, f); }
    }
    if (Array.isArray(data.complements)) {
      for (const c of data.complements) { delete c.id; await dbPut(STORES.complements, c); }
    }
    await loadState();
    renderAccueil();
    toast('Import réussi ✓', 'success');
  } catch (err) {
    console.error(err);
    toast("Erreur d'import : " + err.message, 'error');
  }
  e.target.value = '';
});

// ──────────────────────────────────────────────────────────────────────────
// GITHUB
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
    toast("Configurez GitHub dans Réglages d'abord", 'error');
    showScreen('reglages'); return;
  }
  const pid = state.projet?.projet_id || 'PRJ-XXX';
  const path = `data/${pid}.json`;
  const content = btoa(unescape(encodeURIComponent(
    JSON.stringify(buildExportObject(), null, 2)
  )));
  toast('Publication en cours…');
  try {
    const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
    const getRes = await fetch(`${apiBase}/contents/${path}`, {
      headers: { Authorization: `Bearer ${cfg.token}` }
    });
    let sha = null;
    if (getRes.ok) sha = (await getRes.json()).sha;
    const body = {
      message: `Mise à jour journal ${pid} — ${todayISO()}`,
      content, ...(sha && { sha })
    };
    const putRes = await fetch(`${apiBase}/contents/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(err.message || 'HTTP ' + putRes.status);
    }
    setSyncDot('synced');
    toast('Publié sur GitHub ✓', 'success');
  } catch (err) {
    console.error(err);
    setSyncDot('error');
    toast('Erreur GitHub : ' + err.message, 'error');
  }
}

async function handleGeneratePdf() {
  const cfg = await getGitHubConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    toast("Configurez GitHub dans Réglages d'abord", 'error');
    showScreen('reglages'); return;
  }
  if (!confirm("On va d'abord publier vos données sur GitHub,\npuis lancer la génération du PDF (≈ 30 sec).\n\nContinuer ?")) return;
  await handlePublishGitHub();
  try {
    const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
    const res = await fetch(`${apiBase}/actions/workflows/generate-pdf.yml/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { projet_id: state.projet?.projet_id || 'PRJ-001' } }),
    });
    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'HTTP ' + res.status);
    }
    toast('PDF en cours de génération (~30 sec)', 'success');
  } catch (err) {
    console.error(err);
    toast('Erreur déclenchement PDF : ' + err.message, 'error');
  }
}

// Télécharger le PDF déjà committé dans le repo (par le bot)
async function fetchPdfBlob() {
  const cfg = await getGitHubConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    toast("Configurez GitHub dans Réglages d'abord", 'error');
    showScreen('reglages'); return null;
  }
  const pid = state.projet?.projet_id || 'PRJ-001';
  const path = `pdfs/Journal_Travaux_${pid}.pdf`;
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const res = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github.raw' }
  });
  if (!res.ok) {
    if (res.status === 404) {
      toast("Aucun PDF trouvé. Lance d'abord 'Générer le PDF'.", 'error');
    } else {
      toast('Erreur téléchargement : HTTP ' + res.status, 'error');
    }
    return null;
  }
  const blob = await res.blob();
  return { blob, filename: `Journal_Travaux_${pid}.pdf` };
}

async function handleDownloadPdf() {
  toast('Téléchargement du PDF…');
  const got = await fetchPdfBlob();
  if (!got) return;
  const url = URL.createObjectURL(got.blob);
  const a = document.createElement('a');
  a.href = url; a.download = got.filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('PDF téléchargé ✓', 'success');
}

async function handleSharePdf() {
  if (!navigator.canShare) {
    toast('Partage non supporté sur ce navigateur', 'error'); return;
  }
  toast('Préparation du partage…');
  const got = await fetchPdfBlob();
  if (!got) return;
  const file = new File([got.blob], got.filename, { type: 'application/pdf' });
  if (!navigator.canShare({ files: [file] })) {
    toast('Partage de fichiers non supporté', 'error'); return;
  }
  try {
    await navigator.share({
      title: 'Journal des Travaux',
      text: `Journal des Travaux ${state.projet?.projet_id || ''} du ${todayISO()}`,
      files: [file],
    });
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      toast('Erreur partage : ' + err.message, 'error');
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// MÉTÉO BUTTON
// ──────────────────────────────────────────────────────────────────────────
function wireMeteoButton() {
  const btn = $('#btn-fetch-meteo');
  if (btn) btn.addEventListener('click', fetchWeather);
}

// ──────────────────────────────────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────────────────────────────────
async function loadGitHubConfig() {
  const cfg = await getGitHubConfig();
  $('#g-owner').value = cfg.owner || '';
  $('#g-repo').value  = cfg.repo  || '';
  $('#g-token').value = cfg.token || '';
}
async function renderReglages() {
  await loadGitHubConfig();
  // V2.1 — météo auto
  const meteoAuto = await dbGet(STORES.settings, 'meteo_auto');
  const sel = $('#g-meteo-auto');
  if (sel) sel.value = (meteoAuto && meteoAuto.value === 'non') ? 'non' : 'oui';
}
$('#save-github-config').addEventListener('click', async () => {
  await dbPut(STORES.settings, { key: 'gh_owner', value: $('#g-owner').value.trim() });
  await dbPut(STORES.settings, { key: 'gh_repo',  value: $('#g-repo').value.trim()  });
  await dbPut(STORES.settings, { key: 'gh_token', value: $('#g-token').value.trim() });
  toast('Configuration GitHub enregistrée ✓', 'success');
});
// V2.1 — sauve la pref météo auto
const saveMeteoBtn = $('#save-meteo-config');
if (saveMeteoBtn) {
  saveMeteoBtn.addEventListener('click', async () => {
    const v = $('#g-meteo-auto').value;
    await dbPut(STORES.settings, { key: 'meteo_auto', value: v });
    toast('Météo auto : ' + (v === 'oui' ? 'activée' : 'désactivée'), 'success');
  });
}
$('#reset-data').addEventListener('click', async () => {
  if (!confirm("⚠ Cela va EFFACER toutes vos données locales. Continuer ?")) return;
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
    enableSpellcheck(document);
    wireAutoSave();
    wireMeteoButton();
    console.log('[Journal v2.1] prêt');
  } catch (err) {
    console.error(err);
    alert("Erreur d'initialisation : " + err.message);
  }
})();
