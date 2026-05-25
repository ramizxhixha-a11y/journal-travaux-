/* ═════════════════════════════════════════════════════════════════════════
   JOURNAL DES TRAVAUX — app.js V2.1
   Moteur PWA :
   - IndexedDB (projets, folios, compléments, config)
   - Navigation 5 écrans
   - Sauvegarde auto (debounce 600ms) + indicateur visuel
   - Météo Open-Meteo (manuelle + AUTO à l'ouverture d'un nouveau folio)
   - Détection débordement par case (data-overflow="N" → badge + bouton complément)
   - Publication GitHub + téléchargement PDF authentifié + partage natif
   - Import/export JSON
   - Spellcheck FR sur tous les inputs/textareas
   ═════════════════════════════════════════════════════════════════════════ */

(() => {
'use strict';

/* ───── CONSTANTES ─────────────────────────────────────────────────── */
const DB_NAME = 'journal-travaux-db';
const DB_VERSION = 2;
const STORES = {
  projet:      'projet',
  folios:      'folios',
  complements: 'complements',
  config:      'config',
};

const DEFAULT_CONFIG = {
  projet_id:    '',
  meteo_lat:    50.7949,   // Uccle
  meteo_lon:    4.3520,
  meteo_auto:   'oui',
  gh_owner:     '',
  gh_repo:      '',
  gh_branch:    'main',
  gh_token:     '',
};

// Mapping WMO weather codes → texte FR (Open-Meteo)
const WMO_TEXT = {
  0:  'Ciel dégagé',
  1:  'Ciel principalement clair',
  2:  'Partiellement nuageux',
  3:  'Ciel couvert',
  45: 'Brouillard',
  48: 'Brouillard givrant',
  51: 'Bruine légère',
  53: 'Bruine modérée',
  55: 'Bruine forte',
  56: 'Bruine verglaçante légère',
  57: 'Bruine verglaçante forte',
  61: 'Pluie faible',
  63: 'Pluie modérée',
  65: 'Pluie forte',
  66: 'Pluie verglaçante légère',
  67: 'Pluie verglaçante forte',
  71: 'Neige faible',
  73: 'Neige modérée',
  75: 'Neige forte',
  77: 'Grains de neige',
  80: 'Averses faibles',
  81: 'Averses modérées',
  82: 'Averses fortes',
  85: 'Averses de neige faibles',
  86: 'Averses de neige fortes',
  95: 'Orage',
  96: 'Orage avec grêle légère',
  99: 'Orage avec grêle forte',
};

/* ───── ÉTAT GLOBAL ────────────────────────────────────────────────── */
let db = null;
let state = {
  config:      { ...DEFAULT_CONFIG },
  projet:      null,
  folios:      [],
  complements: [],
  currentFolio: null,
  currentComplement: null,
  currentScreen: 'accueil',
  meteoFetchedForFolio: null,
};

let saveTimer = null;
const SAVE_DEBOUNCE_MS = 600;

/* ═════════════════════════════════════════════════════════════════════
   UTILITAIRES
   ═════════════════════════════════════════════════════════════════════ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDateFR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg, kind = '') {
  const c = $('#toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 2400);
}

function setSyncDot(state) {
  const dot = $('#sync-dot');
  if (!dot) return;
  dot.classList.remove('dirty', 'synced', 'error');
  if (state) dot.classList.add(state);
}

function showSaveIndicator(state, text) {
  const el = $('#save-indicator');
  if (!el) return;
  el.classList.remove('saving', 'saved', 'error');
  if (state) el.classList.add(state);
  el.textContent = text || (state === 'saving' ? '💾 ...' : '✓ Enregistré');
  el.classList.add('visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), 1600);
}

/* ═════════════════════════════════════════════════════════════════════
   INDEXEDDB
   ═════════════════════════════════════════════════════════════════════ */

function openDB() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => resolve(rq.result);
    rq.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORES.projet)) {
        _db.createObjectStore(STORES.projet, { keyPath: 'id' });
      }
      if (!_db.objectStoreNames.contains(STORES.folios)) {
        const s = _db.createObjectStore(STORES.folios, { keyPath: 'id' });
        s.createIndex('by_projet', 'projet_id', { unique: false });
      }
      if (!_db.objectStoreNames.contains(STORES.complements)) {
        const s = _db.createObjectStore(STORES.complements, { keyPath: 'id' });
        s.createIndex('by_projet', 'projet_id', { unique: false });
      }
      if (!_db.objectStoreNames.contains(STORES.config)) {
        _db.createObjectStore(STORES.config, { keyPath: 'key' });
      }
    };
  });
}

function dbPut(store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbClear(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ═════════════════════════════════════════════════════════════════════
   CONFIG : load / save
   ═════════════════════════════════════════════════════════════════════ */

async function loadConfig() {
  const rows = await dbGetAll(STORES.config);
  const cfg = { ...DEFAULT_CONFIG };
  rows.forEach(r => { cfg[r.key] = r.value; });
  state.config = cfg;
  return cfg;
}

async function saveConfigKey(key, value) {
  state.config[key] = value;
  await dbPut(STORES.config, { key, value });
}

/* ═════════════════════════════════════════════════════════════════════
   PROJET : load / create / save
   ═════════════════════════════════════════════════════════════════════ */

async function loadProjet() {
  if (!state.config.projet_id) { state.projet = null; return null; }
  const p = await dbGet(STORES.projet, state.config.projet_id);
  state.projet = p || null;
  return state.projet;
}

function emptyProjet(id) {
  return {
    id,
    nom: id,
    ministere: '',
    administration: '',
    service: '',
    dossier_no: '',
    travaux_de: '',
    cahier_charges_no: '',
    cahier_charges_de: '',
    entrepreneur: {
      nom:       'EEG Techniques Spéciales',
      adresse:   'Z.I., 6 rue des Gerboises - 5100 Naninne',
      tel:       '081/21 27 02',
      agreation: '',
      onss:      '',
      tva:       'BE 0442.891.013',
    },
    maitre_oeuvre: { nom: '', adresse: '', contact: '' },
    bureau_etude:  { nom: '', adresse: '', contact: '' },
    adresse_chantier: '',
    contacts_libre: '',
    fonctionnaire_dirigeant: '',
    prepose_surveillance: '',
    updated_at: new Date().toISOString(),
  };
}

async function saveProjet() {
  if (!state.projet) return;
  state.projet.updated_at = new Date().toISOString();
  await dbPut(STORES.projet, state.projet);
}

/* ═════════════════════════════════════════════════════════════════════
   FOLIOS & COMPLÉMENTS
   ═════════════════════════════════════════════════════════════════════ */

async function loadAll() {
  const allF = await dbGetAll(STORES.folios);
  const allC = await dbGetAll(STORES.complements);
  state.folios      = allF.filter(f => f.projet_id === state.config.projet_id);
  state.complements = allC.filter(c => c.projet_id === state.config.projet_id);
  // tri par folio_no
  state.folios.sort((a, b) => (a.folio_no || 0) - (b.folio_no || 0));
  state.complements.sort((a, b) => (a.folio_no || 0) - (b.folio_no || 0));
}

function nextFolioNo() {
  // 1..30 = folios journaliers
  const max = state.folios.reduce((m, f) => Math.max(m, f.folio_no || 0), 0);
  return max + 1;
}

function nextComplementNo() {
  // 31..40 = compléments
  const usedNos = state.complements.map(c => c.folio_no || 31);
  for (let n = 31; n <= 40; n++) {
    if (!usedNos.includes(n)) return n;
  }
  return 31;
}

function emptyFolio() {
  return {
    id: uid(),
    projet_id: state.config.projet_id,
    journal_no: 1,
    folio_no: nextFolioNo(),
    date: todayISO(),
    heures_debut: '07:00',
    heures_fin: '16:00',
    etat_atmospherique: '',
    temp_8h: null,
    temp_16h: null,
    ouvriers: [
      { classe: '', metier: '', nombre: 0 },
    ],
    case_B: '', case_C: '', case_D: '', case_E: '',
    case_F: '', case_G: '', case_H: '', case_J: '', case_K: '',
    signature_prepose: '',
    signature_entrepreneur: '',
    statut: 'brouillon',
    weather_fetched_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function emptyComplement(folioRef = null) {
  return {
    id: uid(),
    projet_id: state.config.projet_id,
    folio_no: nextComplementNo(),
    folio_no_ref: folioRef ? folioRef.folio_no : null,
    date_ref: folioRef ? folioRef.date : todayISO(),
    case: '',
    texte: '',
    signature_prepose: '',
    signature_entrepreneur: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function saveFolio() {
  if (!state.currentFolio) return;
  state.currentFolio.updated_at = new Date().toISOString();
  // total ouvriers calculé à la volée
  state.currentFolio.ouvriers_total = (state.currentFolio.ouvriers || [])
    .reduce((s, o) => s + (Number(o.nombre) || 0), 0);
  await dbPut(STORES.folios, state.currentFolio);
  // rafraîchit le cache local
  const idx = state.folios.findIndex(f => f.id === state.currentFolio.id);
  if (idx >= 0) state.folios[idx] = state.currentFolio;
  else state.folios.push(state.currentFolio);
  state.folios.sort((a, b) => (a.folio_no || 0) - (b.folio_no || 0));
}

async function saveComplement() {
  if (!state.currentComplement) return;
  state.currentComplement.updated_at = new Date().toISOString();
  await dbPut(STORES.complements, state.currentComplement);
  const idx = state.complements.findIndex(c => c.id === state.currentComplement.id);
  if (idx >= 0) state.complements[idx] = state.currentComplement;
  else state.complements.push(state.currentComplement);
  state.complements.sort((a, b) => (a.folio_no || 0) - (b.folio_no || 0));
}

/* ═════════════════════════════════════════════════════════════════════
   NAVIGATION
   ═════════════════════════════════════════════════════════════════════ */

function showScreen(name) {
  state.currentScreen = name;
  $$('.screen').forEach(s => s.classList.remove('active'));
  const target = $('#screen-' + name);
  if (target) target.classList.add('active');
  $$('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === name);
  });
  // scroll top
  window.scrollTo({ top: 0, behavior: 'instant' });
  // trigger render for screen
  if (name === 'accueil')    renderAccueil();
  if (name === 'projet')     renderProjet();
  if (name === 'historique') renderHistorique();
  if (name === 'reglages')   renderReglages();
}

/* ═════════════════════════════════════════════════════════════════════
   RENDER : ACCUEIL
   ═════════════════════════════════════════════════════════════════════ */

function renderAccueil() {
  $('#accueil-today-date').textContent =
    new Date().toLocaleDateString('fr-FR',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const pname = state.projet ? (state.projet.nom || state.projet.id) : 'Aucun projet sélectionné';
  $('#current-project-name').textContent = pname;
  $('#header-project').textContent = state.projet ? pname : '— aucun projet —';

  // Continuer le dernier folio non signé ?
  const draft = [...state.folios].reverse().find(f => f.statut !== 'signe');
  const btnCont = $('#btn-continue-folio');
  if (draft) {
    btnCont.hidden = false;
    btnCont.textContent = `↺ Continuer folio ${String(draft.folio_no).padStart(4, '0')}`;
    btnCont.onclick = () => openFolio(draft);
  } else {
    btnCont.hidden = true;
  }

  // Stats
  $('#stat-folios').textContent      = state.folios.length;
  $('#stat-complements').textContent = state.complements.length;
  const totOuv = state.folios.reduce((s, f) =>
    s + (Number(f.ouvriers_total) || (f.ouvriers || []).reduce((a, o) => a + (Number(o.nombre) || 0), 0)), 0);
  $('#stat-ouvriers').textContent = totOuv;
  $('#stat-journal').textContent = (state.folios[0]?.journal_no) || 1;

  // Récents : 5 derniers
  const recent = [...state.folios].reverse().slice(0, 5);
  const ul = $('#recent-folios-list');
  if (recent.length === 0) {
    ul.innerHTML = '<li class="empty-state">Aucun folio enregistré pour ce projet.</li>';
  } else {
    ul.innerHTML = recent.map(f => folioItemHTML(f)).join('');
    $$('.folio-item', ul).forEach(li => {
      const id = li.dataset.id;
      li.onclick = () => {
        const f = state.folios.find(x => x.id === id);
        if (f) openFolio(f);
      };
    });
  }

  // Web Share API : afficher le bouton seulement si supporté + secure context
  const canShare = !!navigator.share && window.isSecureContext;
  $('#btn-share-pdf').hidden = !canShare;
}

function folioItemHTML(f) {
  const sigLabel = (f.statut === 'signe') ? 'Signé' : 'Brouillon';
  const sigClass = (f.statut === 'signe') ? 'signe' : 'brouillon';
  const sum = (f.case_B || '').slice(0, 80) || '(travaux non renseignés)';
  return `
    <li class="folio-item" data-id="${f.id}">
      <div class="folio-num">N° ${String(f.folio_no).padStart(4, '0')}</div>
      <div class="folio-info">
        <div class="folio-date">${formatDateFR(f.date)}</div>
        <div class="folio-summary">${escapeHTML(sum)}</div>
      </div>
      <div class="folio-status ${sigClass}">${sigLabel}</div>
    </li>`;
}

function complementItemHTML(c) {
  const sum = (c.texte || '').slice(0, 80) || '(vide)';
  return `
    <li class="folio-item" data-id="${c.id}">
      <div class="folio-num">N° ${String(c.folio_no).padStart(4, '0')}</div>
      <div class="folio-info">
        <div class="folio-date">Case ${c.case || '—'} · folio ${c.folio_no_ref || '?'}</div>
        <div class="folio-summary">${escapeHTML(sum)}</div>
      </div>
    </li>`;
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* ═════════════════════════════════════════════════════════════════════
   RENDER : PROJET (page de garde)
   ═════════════════════════════════════════════════════════════════════ */

function renderProjet() {
  if (!state.projet && state.config.projet_id) {
    state.projet = emptyProjet(state.config.projet_id);
  }
  if (!state.projet) {
    // pas de projet → propose d'en créer un
    state.projet = emptyProjet(state.config.projet_id || 'PRJ-NEW');
  }
  // hydrate inputs
  fillForm($('#screen-projet'), { projet: state.projet });
}

/* ═════════════════════════════════════════════════════════════════════
   RENDER : HISTORIQUE
   ═════════════════════════════════════════════════════════════════════ */

function renderHistorique() {
  const ul = $('#all-folios-list');
  if (state.folios.length === 0) {
    ul.innerHTML = '<li class="empty-state">Aucun folio.</li>';
  } else {
    ul.innerHTML = state.folios.map(folioItemHTML).join('');
    $$('.folio-item', ul).forEach(li => {
      const id = li.dataset.id;
      li.onclick = () => {
        const f = state.folios.find(x => x.id === id);
        if (f) openFolio(f);
      };
    });
  }

  const ulc = $('#all-complements-list');
  if (state.complements.length === 0) {
    ulc.innerHTML = '<li class="empty-state">Aucun complément.</li>';
  } else {
    ulc.innerHTML = state.complements.map(complementItemHTML).join('');
    $$('.folio-item', ulc).forEach(li => {
      const id = li.dataset.id;
      li.onclick = () => {
        const c = state.complements.find(x => x.id === id);
        if (c) openComplement(c);
      };
    });
  }
}

/* ═════════════════════════════════════════════════════════════════════
   RENDER : RÉGLAGES
   ═════════════════════════════════════════════════════════════════════ */

function renderReglages() {
  fillForm($('#screen-reglages'), { config: state.config });
}

/* ═════════════════════════════════════════════════════════════════════
   FILLFORM / READFORM (data-field="namespace.path")
   ═════════════════════════════════════════════════════════════════════ */

function fillForm(root, sources) {
  $$('[data-field]', root).forEach(el => {
    const path = el.dataset.field;
    const [ns, ...rest] = path.split('.');
    const src = sources[ns];
    if (!src) { setInputValue(el, ''); return; }
    let v = src;
    for (const k of rest) {
      if (v == null) break;
      v = v[k];
    }
    setInputValue(el, v);
  });
}

function setInputValue(el, v) {
  if (v == null) v = '';
  if (el.type === 'checkbox') el.checked = !!v;
  else el.value = v;
}

function readForm(root, targets) {
  $$('[data-field]', root).forEach(el => {
    const path = el.dataset.field;
    const [ns, ...rest] = path.split('.');
    const tgt = targets[ns];
    if (!tgt) return;
    let cur = tgt;
    for (let i = 0; i < rest.length - 1; i++) {
      if (cur[rest[i]] == null || typeof cur[rest[i]] !== 'object') cur[rest[i]] = {};
      cur = cur[rest[i]];
    }
    const last = rest[rest.length - 1];
    let val = (el.type === 'checkbox') ? el.checked : el.value;
    if (el.type === 'number') val = (val === '' ? null : Number(val));
    cur[last] = val;
  });
}

/* ═════════════════════════════════════════════════════════════════════
   FOLIO : ouvrir, créer, ouvriers
   ═════════════════════════════════════════════════════════════════════ */

function openFolio(folio) {
  state.currentFolio = folio;
  $('#folio-title').textContent = `Folio N° ${String(folio.folio_no).padStart(4, '0')}`;
  // remplir le formulaire
  fillForm($('#screen-folio'), { folio });
  // ouvriers
  renderOuvriersTable();
  // débordement initial
  checkAllOverflows();
  // badge météo
  updateWeatherBadge();
  // afficher
  showScreen('folio');
  $('#screen-folio').classList.add('active');
  // météo AUTO si nouveau folio et activée
  maybeAutoFetchWeather();
}

async function createNewFolio() {
  if (!state.config.projet_id) {
    toast("Crée d'abord un projet dans Réglages.", 'error');
    return;
  }
  const f = emptyFolio();
  state.currentFolio = f;
  await saveFolio();
  openFolio(f);
}

function renderOuvriersTable() {
  const f = state.currentFolio;
  if (!f) return;
  if (!Array.isArray(f.ouvriers) || f.ouvriers.length === 0) {
    f.ouvriers = [{ classe: '', metier: '', nombre: 0 }];
  }
  const table = $('#ouvriers-table');
  table.innerHTML = '';
  // header
  const hdr = document.createElement('div');
  hdr.className = 'ouvriers-row';
  hdr.innerHTML = `
    <div style="font-weight:700;font-size:11px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.4px;">Classe</div>
    <div style="font-weight:700;font-size:11px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.4px;">Métier</div>
    <div style="font-weight:700;font-size:11px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.4px;text-align:center;">N</div>
    <div></div>`;
  table.appendChild(hdr);

  f.ouvriers.forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'ouvriers-row';
    row.innerHTML = `
      <div class="row-classe"><input type="text" value="${escapeHTML(o.classe || '')}" data-ouv="${i}.classe" spellcheck="true" lang="fr"></div>
      <div class="row-metier"><input type="text" value="${escapeHTML(o.metier || '')}" data-ouv="${i}.metier" spellcheck="true" lang="fr"></div>
      <div class="row-nb"><input type="number" min="0" value="${o.nombre || 0}" data-ouv="${i}.nombre"></div>
      <button class="row-delete" data-del="${i}" title="Supprimer">×</button>`;
    table.appendChild(row);
  });

  // wire les inputs
  $$('input[data-ouv]', table).forEach(el => {
    el.oninput = () => {
      const [i, key] = el.dataset.ouv.split('.');
      const idx = Number(i);
      let v = el.value;
      if (key === 'nombre') v = Number(v) || 0;
      f.ouvriers[idx][key] = v;
      updateOuvriersTotal();
      scheduleAutoSave('folio');
    };
  });
  $$('button[data-del]', table).forEach(btn => {
    btn.onclick = () => {
      const i = Number(btn.dataset.del);
      f.ouvriers.splice(i, 1);
      renderOuvriersTable();
      updateOuvriersTotal();
      scheduleAutoSave('folio');
    };
  });
  updateOuvriersTotal();
}

function updateOuvriersTotal() {
  const f = state.currentFolio;
  if (!f) return;
  const t = (f.ouvriers || []).reduce((s, o) => s + (Number(o.nombre) || 0), 0);
  $('#ouvriers-total').textContent = t;
}

/* ═════════════════════════════════════════════════════════════════════
   COMPLÉMENT : ouvrir, créer
   ═════════════════════════════════════════════════════════════════════ */

function openComplement(c) {
  state.currentComplement = c;
  $('#complement-title').textContent = `Complément N° ${String(c.folio_no).padStart(4, '0')}`;
  fillForm($('#screen-complement'), { complement: c });
  showScreen('complement');
  $('#screen-complement').classList.add('active');
}

async function createNewComplement(folioRef = null, caseLetter = null) {
  if (!state.config.projet_id) {
    toast("Crée d'abord un projet.", 'error');
    return;
  }
  const c = emptyComplement(folioRef);
  if (caseLetter) c.case = caseLetter;
  state.currentComplement = c;
  await saveComplement();
  openComplement(c);
  toast(`Complément N°${c.folio_no} créé`, 'success');
}

/* ═════════════════════════════════════════════════════════════════════
   DÉTECTION DE DÉBORDEMENT
   ═════════════════════════════════════════════════════════════════════ */

function checkOverflow(textarea) {
  const limit = Number(textarea.dataset.overflow) || 0;
  if (!limit) return false;
  const len = (textarea.value || '').length;
  const fs = textarea.closest('.case-fieldset');
  if (!fs) return false;
  const caseLetter = fs.dataset.case;
  const over = len > limit;
  fs.classList.toggle('overflowing', over);

  // badge dans summary
  const badge = fs.querySelector('.overflow-badge');
  if (badge) {
    badge.textContent = over ? `⚠ déborde (${len}/${limit})` : '';
    badge.style.display = over ? 'inline-flex' : 'none';
  }

  // warn block en bas du fieldset
  let warn = fs.querySelector('.overflow-warn');
  if (over) {
    if (!warn) {
      warn = document.createElement('div');
      warn.className = 'overflow-warn';
      warn.innerHTML = `
        <strong>⚠ Cette case dépasse l'espace du folio papier.</strong>
        <span class="char-count">${len}/${limit} car.</span>
        <button type="button" class="btn btn-primary btn-compact">+ Créer un complément case ${caseLetter}</button>`;
      textarea.parentElement.appendChild(warn);
      warn.querySelector('button').onclick = async () => {
        await saveFolio();
        await createNewComplement(state.currentFolio, caseLetter);
      };
    } else {
      warn.querySelector('.char-count').textContent = `${len}/${limit} car.`;
    }
  } else if (warn) {
    warn.remove();
  }

  return over;
}

function checkAllOverflows() {
  $$('#screen-folio textarea[data-overflow]').forEach(checkOverflow);
}

/* ═════════════════════════════════════════════════════════════════════
   MÉTÉO — manuelle + AUTO
   ═════════════════════════════════════════════════════════════════════ */

async function fetchWeather() {
  const f = state.currentFolio;
  if (!f) return;
  const btn = $('#btn-fetch-weather');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const lat = state.config.meteo_lat || 50.7949;
    const lon = state.config.meteo_lon || 4.3520;
    const date = f.date || todayISO();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,weathercode&start_date=${date}&end_date=${date}&timezone=Europe%2FBrussels`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const times = data.hourly?.time || [];
    const temps = data.hourly?.temperature_2m || [];
    const codes = data.hourly?.weathercode || [];

    // T8h, T16h
    const i8  = times.findIndex(t => t.endsWith('T08:00'));
    const i16 = times.findIndex(t => t.endsWith('T16:00'));
    const t8  = i8 >= 0 ? temps[i8] : null;
    const t16 = i16 >= 0 ? temps[i16] : null;

    // état atmo : code dominant entre 7h et 17h
    const slice = codes.slice(Math.max(0, i8), i16 >= 0 ? i16 + 1 : codes.length);
    const counts = {};
    slice.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
    const dominantCode = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]);
    const text = WMO_TEXT[dominantCode] || '';

    if (t8  != null) f.temp_8h  = Math.round(t8  * 10) / 10;
    if (t16 != null) f.temp_16h = Math.round(t16 * 10) / 10;
    if (text)        f.etat_atmospherique = text;
    f.weather_fetched_at = new Date().toISOString();

    fillForm($('#screen-folio'), { folio: f });
    await saveFolio();
    updateWeatherBadge();
    toast('Météo récupérée', 'success');
  } catch (e) {
    console.error('fetchWeather', e);
    toast('Erreur météo : ' + e.message, 'error');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function updateWeatherBadge() {
  const f = state.currentFolio;
  const badge = $('#weather-fetched-badge');
  if (f && f.weather_fetched_at) {
    badge.hidden = false;
    badge.textContent = '✓ météo OK';
  } else {
    badge.hidden = true;
  }
}

async function maybeAutoFetchWeather() {
  const f = state.currentFolio;
  if (!f) return;
  if (state.config.meteo_auto !== 'oui') return;
  // déjà fait pour ce folio ?
  if (f.weather_fetched_at) return;
  // déjà des températures saisies manuellement ?
  if (f.temp_8h != null && f.temp_16h != null) return;
  // déjà tenté dans la même session pour ce folio ?
  if (state.meteoFetchedForFolio === f.id) return;
  state.meteoFetchedForFolio = f.id;
  // pas de connexion → on s'abstient
  if (!navigator.onLine) {
    toast('Hors-ligne : météo non récupérée', '');
    return;
  }
  await fetchWeather();
}

/* ═════════════════════════════════════════════════════════════════════
   GITHUB : publier JSON + télécharger PDF + partager PDF
   ═════════════════════════════════════════════════════════════════════ */

function ghConfigured() {
  const c = state.config;
  return !!(c.gh_owner && c.gh_repo && c.gh_token);
}

async function publishToGitHub() {
  if (!ghConfigured()) {
    toast('Configure GitHub dans Réglages.', 'error');
    return;
  }
  const c = state.config;
  const projet_id = c.projet_id;
  if (!projet_id) { toast('Pas de projet actif.', 'error'); return; }

  const payload = {
    version: '2.1',
    projet: state.projet,
    folios: state.folios,
    complements: state.complements,
    exported_at: new Date().toISOString(),
  };
  const json = JSON.stringify(payload, null, 2);
  const b64  = btoa(unescape(encodeURIComponent(json)));
  const path = `data/${projet_id}.json`;

  toast('Publication en cours…');
  setSyncDot('dirty');

  try {
    // 1. Récupérer SHA existant si présent
    let sha = null;
    const getResp = await fetch(
      `https://api.github.com/repos/${c.gh_owner}/${c.gh_repo}/contents/${path}?ref=${c.gh_branch}`,
      { headers: { 'Authorization': `token ${c.gh_token}`, 'Accept': 'application/vnd.github+json' } }
    );
    if (getResp.ok) {
      const info = await getResp.json();
      sha = info.sha;
    }

    // 2. PUT
    const putResp = await fetch(
      `https://api.github.com/repos/${c.gh_owner}/${c.gh_repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `token ${c.gh_token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Journal: ${projet_id} (${todayISO()})`,
          content: b64,
          branch: c.gh_branch,
          sha: sha || undefined,
        }),
      }
    );
    if (!putResp.ok) {
      const err = await putResp.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${putResp.status}`);
    }
    setSyncDot('synced');
    toast('Publié sur GitHub ✓', 'success');
  } catch (e) {
    console.error('publishToGitHub', e);
    setSyncDot('error');
    toast('Échec publication : ' + e.message, 'error');
  }
}

async function downloadPDF() {
  if (!ghConfigured()) {
    toast('Configure GitHub dans Réglages.', 'error');
    return;
  }
  const c = state.config;
  const pid = c.projet_id;
  if (!pid) { toast('Pas de projet actif.', 'error'); return; }
  const path = `pdfs/Journal_Travaux_${pid}.pdf`;
  toast('Téléchargement du PDF…');
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${c.gh_owner}/${c.gh_repo}/contents/${path}?ref=${c.gh_branch}`,
      { headers: { 'Authorization': `token ${c.gh_token}`, 'Accept': 'application/vnd.github+json' } }
    );
    if (!resp.ok) throw new Error('PDF introuvable (HTTP ' + resp.status + ')');
    const info = await resp.json();
    const b64 = info.content.replace(/\n/g, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Journal_Travaux_${pid}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('PDF téléchargé ✓', 'success');
    return blob;
  } catch (e) {
    console.error('downloadPDF', e);
    toast('Échec PDF : ' + e.message, 'error');
  }
}

async function sharePDF() {
  if (!navigator.share) {
    toast("Partage non supporté sur ce navigateur.", 'error');
    return;
  }
  const blob = await downloadPDF();
  if (!blob) return;
  const pid = state.config.projet_id;
  const file = new File([blob], `Journal_Travaux_${pid}.pdf`, { type: 'application/pdf' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `Journal des Travaux — ${pid}`,
        text: `Journal des Travaux ${pid}`,
      });
    } else {
      await navigator.share({
        title: `Journal des Travaux — ${pid}`,
        text: `Journal des Travaux ${pid}`,
      });
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('sharePDF', e);
      toast('Partage annulé', '');
    }
  }
}

/* ═════════════════════════════════════════════════════════════════════
   IMPORT / EXPORT JSON
   ═════════════════════════════════════════════════════════════════════ */

function exportJSON() {
  const payload = {
    version: '2.1',
    config: { ...state.config, gh_token: '' }, // jamais le token dans l'export
    projet: state.projet,
    folios: state.folios,
    complements: state.complements,
    exported_at: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const pid = state.config.projet_id || 'projet';
  const today = todayISO();
  a.download = `journal-travaux_${pid}_${today}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Export terminé', 'success');
}

async function importJSON(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('JSON invalide');
    if (data.projet) {
      await dbPut(STORES.projet, data.projet);
      await saveConfigKey('projet_id', data.projet.id);
    }
    if (Array.isArray(data.folios)) {
      for (const f of data.folios) await dbPut(STORES.folios, f);
    }
    if (Array.isArray(data.complements)) {
      for (const c of data.complements) await dbPut(STORES.complements, c);
    }
    await loadConfig();
    await loadProjet();
    await loadAll();
    renderAccueil();
    toast('Import terminé ✓', 'success');
  } catch (e) {
    console.error('importJSON', e);
    toast('Erreur import : ' + e.message, 'error');
  }
}

/* ═════════════════════════════════════════════════════════════════════
   AUTOSAVE (debounce)
   ═════════════════════════════════════════════════════════════════════ */

function scheduleAutoSave(kind) {
  clearTimeout(saveTimer);
  showSaveIndicator('saving', '💾 ...');
  saveTimer = setTimeout(async () => {
    try {
      if (kind === 'folio'      && state.currentFolio)      { readForm($('#screen-folio'),      { folio: state.currentFolio }); await saveFolio(); }
      if (kind === 'complement' && state.currentComplement) { readForm($('#screen-complement'), { complement: state.currentComplement }); await saveComplement(); }
      if (kind === 'projet'     && state.projet)            { readForm($('#screen-projet'),     { projet: state.projet }); await saveProjet(); }
      if (kind === 'config')                                { readForm($('#screen-reglages'),   { config: state.config }); for (const k of Object.keys(state.config)) await saveConfigKey(k, state.config[k]); }
      showSaveIndicator('saved', '✓ Enregistré');
      setSyncDot('dirty'); // local OK, distant pas synchro
    } catch (e) {
      console.error('autosave', e);
      showSaveIndicator('error', '⚠ erreur');
    }
  }, SAVE_DEBOUNCE_MS);
}

function wireAutoSave() {
  // Folio
  $$('#screen-folio [data-field]').forEach(el => {
    el.addEventListener('input', () => {
      if (el.tagName === 'TEXTAREA' && el.dataset.overflow) checkOverflow(el);
      scheduleAutoSave('folio');
    });
  });
  // Complément
  $$('#screen-complement [data-field]').forEach(el => {
    el.addEventListener('input', () => scheduleAutoSave('complement'));
  });
  // Projet
  $$('#screen-projet [data-field]').forEach(el => {
    el.addEventListener('input', () => scheduleAutoSave('projet'));
  });
  // Réglages
  $$('#screen-reglages [data-field]').forEach(el => {
    el.addEventListener('input', () => scheduleAutoSave('config'));
  });

  // beforeunload : flush
  window.addEventListener('beforeunload', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      // tentative synchrone : appelle l'autosave immédiat
      if (state.currentFolio)      { try { readForm($('#screen-folio'),      { folio: state.currentFolio }); saveFolio(); } catch(_) {} }
      if (state.currentComplement) { try { readForm($('#screen-complement'), { complement: state.currentComplement }); saveComplement(); } catch(_) {} }
      if (state.projet)            { try { readForm($('#screen-projet'),     { projet: state.projet }); saveProjet(); } catch(_) {} }
    }
  });
  // visibilitychange
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {}, 0); // flush
    }
  });
}

/* ═════════════════════════════════════════════════════════════════════
   SPELLCHECK FR
   ═════════════════════════════════════════════════════════════════════ */

function enableSpellcheck(root = document) {
  $$('input[type="text"], textarea', root).forEach(el => {
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('lang', 'fr');
    el.setAttribute('autocorrect', 'on');
    if (el.tagName === 'TEXTAREA') {
      el.setAttribute('autocapitalize', 'sentences');
    }
  });
}

/* ═════════════════════════════════════════════════════════════════════
   WIRE EVENTS
   ═════════════════════════════════════════════════════════════════════ */

function wireEvents() {
  // bottom nav
  $$('.nav-btn').forEach(btn => {
    btn.onclick = () => showScreen(btn.dataset.screen);
  });

  // Accueil
  $('#btn-new-folio').onclick      = createNewFolio;
  $('#btn-publish-github').onclick = publishToGitHub;
  $('#btn-download-pdf').onclick   = downloadPDF;
  $('#btn-share-pdf').onclick      = sharePDF;
  $('#btn-export-json').onclick    = exportJSON;

  // Projet
  $('#btn-back-from-projet').onclick = () => showScreen('accueil');
  $('#btn-save-projet').onclick = async () => {
    readForm($('#screen-projet'), { projet: state.projet });
    await saveProjet();
    toast('Projet enregistré ✓', 'success');
    renderAccueil();
  };
  $('#btn-pick-project').onclick = pickProject;

  // Folio
  $('#btn-back-folio').onclick = async () => {
    if (state.currentFolio) {
      readForm($('#screen-folio'), { folio: state.currentFolio });
      await saveFolio();
    }
    showScreen('accueil');
  };
  $('#btn-add-ouvrier').onclick = () => {
    state.currentFolio.ouvriers.push({ classe: '', metier: '', nombre: 0 });
    renderOuvriersTable();
    scheduleAutoSave('folio');
  };
  $('#btn-save-folio').onclick = async () => {
    readForm($('#screen-folio'), { folio: state.currentFolio });
    await saveFolio();
    toast('Folio enregistré ✓', 'success');
  };
  $('#btn-delete-folio').onclick = async () => {
    if (!state.currentFolio) return;
    if (!confirm('Supprimer définitivement ce folio ?')) return;
    await dbDelete(STORES.folios, state.currentFolio.id);
    state.folios = state.folios.filter(f => f.id !== state.currentFolio.id);
    state.currentFolio = null;
    toast('Folio supprimé', '');
    showScreen('accueil');
  };
  $('#btn-fetch-weather').onclick = fetchWeather;

  // Complément
  $('#btn-back-complement').onclick = async () => {
    if (state.currentComplement) {
      readForm($('#screen-complement'), { complement: state.currentComplement });
      await saveComplement();
    }
    showScreen('historique');
  };
  $('#btn-save-complement').onclick = async () => {
    readForm($('#screen-complement'), { complement: state.currentComplement });
    await saveComplement();
    toast('Complément enregistré ✓', 'success');
  };
  $('#btn-delete-complement').onclick = async () => {
    if (!state.currentComplement) return;
    if (!confirm('Supprimer définitivement ce complément ?')) return;
    await dbDelete(STORES.complements, state.currentComplement.id);
    state.complements = state.complements.filter(c => c.id !== state.currentComplement.id);
    state.currentComplement = null;
    showScreen('historique');
  };
  $('#btn-new-complement').onclick = () => createNewComplement();

  // Réglages
  $('#btn-save-config').onclick = async () => {
    readForm($('#screen-reglages'), { config: state.config });
    for (const k of Object.keys(state.config)) {
      await saveConfigKey(k, state.config[k]);
    }
    await loadProjet();
    await loadAll();
    renderAccueil();
    toast('Réglages enregistrés ✓', 'success');
  };
  $('#btn-load-project').onclick = pickProject;
  $('#btn-new-project').onclick  = newProject;
  $('#btn-export-json-2').onclick = exportJSON;
  $('#btn-import-json').onclick   = () => $('#file-import-json').click();
  $('#file-import-json').onchange = (e) => {
    const file = e.target.files[0];
    if (file) importJSON(file);
    e.target.value = '';
  };
  $('#btn-clear-all').onclick = async () => {
    if (!confirm('Effacer TOUTES les données locales ?\n\nIrréversible. Continuer ?')) return;
    if (!confirm('Vraiment sûr ?')) return;
    await dbClear(STORES.projet);
    await dbClear(STORES.folios);
    await dbClear(STORES.complements);
    state.projet = null;
    state.folios = [];
    state.complements = [];
    toast('Données effacées', '');
    showScreen('accueil');
  };
}

async function pickProject() {
  const id = prompt('ID du projet à charger (ex : PRJ-CHIREC-CAVELL) :', state.config.projet_id || '');
  if (!id) return;
  await saveConfigKey('projet_id', id.trim());
  await loadProjet();
  await loadAll();
  renderAccueil();
  toast(`Projet « ${id} » chargé`, 'success');
}

async function newProject() {
  const id = prompt('ID du nouveau projet (ex : PRJ-CHIREC-CAVELL) :');
  if (!id) return;
  const cleanId = id.trim();
  await saveConfigKey('projet_id', cleanId);
  state.projet = emptyProjet(cleanId);
  await saveProjet();
  state.folios = [];
  state.complements = [];
  renderAccueil();
  showScreen('projet');
  toast(`Projet « ${cleanId} » créé`, 'success');
}

/* ═════════════════════════════════════════════════════════════════════
   SERVICE WORKER (offline minimal — désactivé par défaut)
   ═════════════════════════════════════════════════════════════════════ */
// Pas de SW pour l'instant : on garde simple. La PWA installable suffit
// via le manifest. (À ajouter dans une future V2.2 si besoin offline.)

/* ═════════════════════════════════════════════════════════════════════
   INIT
   ═════════════════════════════════════════════════════════════════════ */

(async function init() {
  try {
    db = await openDB();
    await loadConfig();
    await loadProjet();
    await loadAll();

    wireEvents();
    wireAutoSave();
    enableSpellcheck(document);
    renderAccueil();
    setSyncDot('idle');

    console.log('[Journal V2.1] prêt — projet:', state.config.projet_id || '(aucun)');
  } catch (e) {
    console.error('init', e);
    alert("Erreur d'initialisation : " + e.message);
  }
})();

})();
