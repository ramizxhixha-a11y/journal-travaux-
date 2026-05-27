/* ═════════════════════════════════════════════════════════════════════════
   JOURNAL DES TRAVAUX — app.js V2.3
   Moteur PWA :
   - IndexedDB (projets, folios, compléments, config)
   - Navigation 5 écrans
   - Sauvegarde auto (debounce 600ms) + indicateur visuel
   - Météo Open-Meteo (manuelle + AUTO à l'ouverture d'un nouveau folio)
   - Détection débordement par case (data-overflow="N" → badge + bouton complément)
   - Publication GitHub + téléchargement PDF authentifié + partage natif
   - Import/export JSON
   - Spellcheck FR sur tous les inputs/textareas

   V2.3 (nouveautés) :
   - Badge "🔗 Compl. N°X" sur folios liés dans les listes
   - Stat card Compléments cliquable → Historique
   - Section "Compléments récents" sur Accueil
   - "Ouvriers du jour" filtré par date today sur Accueil
   - Synthèse projet complète dans Historique (cumul ouvriers, jours travaillés)
   - GitHub : auto-détection owner+repo depuis window.location
   - GitHub : bouton Tester la connexion avec diagnostic précis
   - GitHub : messages d'erreur publish détaillés par code HTTP
   - Modaux in-app remplacent les prompts natifs (Charger/Nouveau projet)
   - Nettoyage code mort renderComplementScreen
   - Autosave wiring pour les inputs dynamiques du complément
   - Bug fix newProject : loadAll() au lieu de reset arrays manuel
   ═════════════════════════════════════════════════════════════════════════ */

(() => {
'use strict';

/* ───── CONSTANTES ─────────────────────────────────────────────────── */
const APP_VERSION = '2.3';
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

const CASE_LABELS = {
  A: 'Ouvriers', B: 'Travaux exécutés', C: 'Matériel en service',
  D: 'Matériel hors service', E: 'Matériaux entrés', F: 'Essais sur chantier',
  G: 'Échantillons expédiés', H: 'Événements imprévus', J: 'Décisions prises', K: 'Visites – divers',
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

function pad4(n) { return String(n || 0).padStart(4, '0'); }

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

function setSyncDot(s) {
  const dot = $('#sync-dot');
  if (!dot) return;
  dot.classList.remove('dirty', 'synced', 'error');
  if (s) dot.classList.add(s);
}

function showSaveIndicator(s, text) {
  const el = $('#save-indicator');
  if (!el) return;
  el.classList.remove('saving', 'saved', 'error');
  if (s) el.classList.add(s);
  el.textContent = text || (s === 'saving' ? '💾 ...' : '✓ Enregistré');
  el.classList.add('visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), 1600);
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
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
  state.folios.sort((a, b) => (a.folio_no || 0) - (b.folio_no || 0));
  state.complements.sort((a, b) => (a.folio_no || 0) - (b.folio_no || 0));
}

function nextFolioNo() {
  const max = state.folios.reduce((m, f) => Math.max(m, f.folio_no || 0), 0);
  return max + 1;
}

function nextComplementNo(folioRef) {
  // V2.2 : Complément N°X = Folio N°X (même numéro)
  if (folioRef) return folioRef.folio_no;
  const max = state.folios.reduce((m, f) => Math.max(m, f.folio_no || 0), 0);
  return max || 1;
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
    folio_no: nextComplementNo(folioRef),
    folio_no_ref: folioRef ? folioRef.folio_no : null,
    date_ref: folioRef ? folioRef.date : todayISO(),
    sections: {},
    case: '',
    texte: '',
    signature_prepose: '',
    signature_entrepreneur: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function ouvriersTotalForFolio(f) {
  return Number(f.ouvriers_total) || (f.ouvriers || []).reduce((a, o) => a + (Number(o.nombre) || 0), 0);
}

async function saveFolio() {
  if (!state.currentFolio) return;
  state.currentFolio.updated_at = new Date().toISOString();
  state.currentFolio.ouvriers_total = (state.currentFolio.ouvriers || [])
    .reduce((s, o) => s + (Number(o.nombre) || 0), 0);
  await dbPut(STORES.folios, state.currentFolio);
  const idx = state.folios.findIndex(f => f.id === state.currentFolio.id);
  if (idx >= 0) state.folios[idx] = state.currentFolio;
  else state.folios.push(state.currentFolio);
  state.folios.sort((a, b) => (a.folio_no || 0) - (b.folio_no || 0));
}

async function saveComplement() {
  if (!state.currentComplement) return;
  readComplementSections(state.currentComplement);
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
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (name === 'accueil')    renderAccueil();
  if (name === 'projet')     renderProjet();
  if (name === 'historique') renderHistorique();
  if (name === 'reglages')   renderReglages();
}

/* ═════════════════════════════════════════════════════════════════════
   RENDER : ACCUEIL (V2.3 : ouvriers du jour, compléments récents, badges)
   ═════════════════════════════════════════════════════════════════════ */

function renderAccueil() {
  $('#accueil-today-date').textContent =
    new Date().toLocaleDateString('fr-FR',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const pname = state.projet ? (state.projet.nom || state.projet.id) : 'Aucun projet sélectionné';
  $('#current-project-name').textContent = pname;
  $('#header-project').textContent = state.projet ? pname : '— aucun projet —';

  // Continuer le dernier folio non signé
  const draft = [...state.folios].reverse().find(f => f.statut !== 'signe');
  const btnCont = $('#btn-continue-folio');
  if (draft) {
    btnCont.hidden = false;
    btnCont.textContent = `↺ Continuer folio ${pad4(draft.folio_no)}`;
    btnCont.onclick = () => openFolio(draft);
  } else {
    btnCont.hidden = true;
  }

  // V2.3 — Stats
  $('#stat-folios').textContent      = state.folios.length;
  $('#stat-complements').textContent = state.complements.length;

  // V2.3 — Ouvriers DU JOUR (folios datés today uniquement)
  const today = todayISO();
  const todayFolios = state.folios.filter(f => f.date === today);
  const totOuvJour = todayFolios.reduce((s, f) => s + ouvriersTotalForFolio(f), 0);
  $('#stat-ouvriers').textContent = totOuvJour;

  $('#stat-journal').textContent = (state.folios[0]?.journal_no) || 1;

  // V2.3 — Stat card Compléments cliquable
  const statComplCard = $('#stat-card-complements');
  if (statComplCard) {
    statComplCard.onclick = () => {
      showScreen('historique');
      setTimeout(() => {
        const t = $('#hist-complements-title');
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    };
  }

  // Derniers folios : 5 derniers
  const recentFolios = [...state.folios].reverse().slice(0, 5);
  const ulF = $('#recent-folios-list');
  if (recentFolios.length === 0) {
    ulF.innerHTML = '<li class="empty-state">Aucun folio enregistré pour ce projet.</li>';
  } else {
    ulF.innerHTML = recentFolios.map(folioItemHTML).join('');
    wireFolioListClicks(ulF);
  }

  // V2.3 — Compléments récents (3 derniers, masqué si vide)
  const recentCompl = [...state.complements].reverse().slice(0, 3);
  const titleC = $('#recent-complements-title');
  const ulC    = $('#recent-complements-list');
  if (recentCompl.length === 0) {
    titleC.hidden = true;
    ulC.hidden = true;
    ulC.innerHTML = '';
  } else {
    titleC.hidden = false;
    ulC.hidden = false;
    ulC.innerHTML = recentCompl.map(complementItemHTML).join('');
    wireComplementListClicks(ulC);
  }

  // Web Share API : afficher le bouton seulement si supporté + secure context
  const canShare = !!navigator.share && window.isSecureContext;
  $('#btn-share-pdf').hidden = !canShare;
}

function wireFolioListClicks(ul) {
  $$('.folio-item', ul).forEach(li => {
    const id = li.dataset.id;
    li.onclick = () => {
      const f = state.folios.find(x => x.id === id);
      if (f) openFolio(f);
    };
  });
  // V2.3 — boutons "🔗 Compl. N°X" sur folios liés
  $$('.folio-complement-link', ul).forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const complId = btn.dataset.complid;
      const c = state.complements.find(x => x.id === complId);
      if (c) openComplement(c);
    };
  });
}

function wireComplementListClicks(ul) {
  $$('.folio-item', ul).forEach(li => {
    const id = li.dataset.id;
    li.onclick = () => {
      const c = state.complements.find(x => x.id === id);
      if (c) openComplement(c);
    };
  });
}

function folioItemHTML(f) {
  const sigLabel = (f.statut === 'signe') ? 'Signé' : 'Brouillon';
  const sigClass = (f.statut === 'signe') ? 'signe' : 'brouillon';
  const sum = (f.case_B || '').slice(0, 80) || '(travaux non renseignés)';

  // V2.3 — badge complément si lié
  const linkedC = state.complements.find(c => c.folio_no_ref === f.folio_no);
  const complementBadge = linkedC
    ? `<button class="folio-complement-link" data-complid="${escapeHTML(linkedC.id)}" type="button" title="Ouvrir le complément lié">🔗 Compl. N°${pad4(linkedC.folio_no)}</button>`
    : '';

  return `
    <li class="folio-item" data-id="${escapeHTML(f.id)}">
      <div class="folio-num">N° ${pad4(f.folio_no)}</div>
      <div class="folio-info">
        <div class="folio-date">${formatDateFR(f.date)}</div>
        <div class="folio-summary">${escapeHTML(sum)}</div>
        ${complementBadge}
      </div>
      <div class="folio-status ${sigClass}">${sigLabel}</div>
    </li>`;
}

function complementItemHTML(c) {
  const sections = c.sections || {};
  const casesList = Object.keys(sections).sort().join(', ') || (c.case || '—');
  const sum = Object.values(sections).join(' ').slice(0, 80) || (c.texte || '').slice(0, 80) || '(vide)';
  return `
    <li class="folio-item" data-id="${escapeHTML(c.id)}">
      <div class="folio-num">N° ${pad4(c.folio_no)}</div>
      <div class="folio-info">
        <div class="folio-date">Cases ${escapeHTML(casesList)} · folio ${c.folio_no_ref || '?'}</div>
        <div class="folio-summary">${escapeHTML(sum)}</div>
      </div>
    </li>`;
}

/* ═════════════════════════════════════════════════════════════════════
   RENDER : PROJET (page de garde)
   ═════════════════════════════════════════════════════════════════════ */

function renderProjet() {
  if (!state.projet && state.config.projet_id) {
    state.projet = emptyProjet(state.config.projet_id);
  }
  if (!state.projet) {
    state.projet = emptyProjet(state.config.projet_id || 'PRJ-NEW');
  }
  fillForm($('#screen-projet'), { projet: state.projet });
}

/* ═════════════════════════════════════════════════════════════════════
   RENDER : HISTORIQUE (V2.3 : synthèse projet complète)
   ═════════════════════════════════════════════════════════════════════ */

function renderHistorique() {
  // V2.3 — Stats projet
  $('#hist-stat-folios').textContent = state.folios.length;
  $('#hist-stat-complements').textContent = state.complements.length;
  const totOuvCumul = state.folios.reduce((s, f) => s + ouvriersTotalForFolio(f), 0);
  $('#hist-stat-ouvriers').textContent = totOuvCumul;
  const uniqueDates = new Set(state.folios.map(f => f.date).filter(Boolean));
  $('#hist-stat-jours').textContent = uniqueDates.size;

  // Liste folios
  const ulF = $('#all-folios-list');
  if (state.folios.length === 0) {
    ulF.innerHTML = '<li class="empty-state">Aucun folio.</li>';
  } else {
    ulF.innerHTML = state.folios.map(folioItemHTML).join('');
    wireFolioListClicks(ulF);
  }

  // Liste compléments
  const ulC = $('#all-complements-list');
  if (state.complements.length === 0) {
    ulC.innerHTML = '<li class="empty-state">Aucun complément.</li>';
  } else {
    ulC.innerHTML = state.complements.map(complementItemHTML).join('');
    wireComplementListClicks(ulC);
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
  $('#folio-title').textContent = `Folio N° ${pad4(folio.folio_no)}`;
  fillForm($('#screen-folio'), { folio });
  renderOuvriersTable();
  checkAllOverflows();
  updateWeatherBadge();
  showScreen('folio');
  $('#screen-folio').classList.add('active');
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
   COMPLÉMENT V2.2/V2.3 — rendu multi-sections (D : code mort retiré)
   ═════════════════════════════════════════════════════════════════════ */

function renderComplementScreen(c) {
  // En-tête statique
  const headerEl = $('#complement-header-info');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="grid-2">
        <div class="field"><label>Complément N°</label>
          <input type="number" data-field="complement.folio_no" value="${c.folio_no || ''}" min="1">
        </div>
        <div class="field"><label>Suite du Folio N°</label>
          <input type="number" data-field="complement.folio_no_ref" value="${c.folio_no_ref || ''}" min="1">
        </div>
      </div>
      <div class="field"><label>Date du folio</label>
        <input type="date" data-field="complement.date_ref" value="${c.date_ref || ''}">
      </div>`;
    // V2.3 (E) — wire autosave sur ces inputs dynamiques (sinon ils sont créés
    // APRÈS wireAutoSave et n'ont pas de listener input)
    $$('[data-field]', headerEl).forEach(el => {
      el.addEventListener('input', () => scheduleAutoSave('complement'));
    });
  }

  // Sections dynamiques
  const sectionsEl = $('#complement-sections');
  if (!sectionsEl) return;
  const sections = c.sections || {};

  // Migrer V2.1 legacy (case + texte → sections)
  if (!Object.keys(sections).length && c.case && c.texte) {
    sections[c.case] = c.texte;
    c.sections = sections;
  }

  sectionsEl.innerHTML = '';

  // Afficher les sections existantes
  const existingCases = Object.keys(sections).sort();
  existingCases.forEach(letter => {
    sectionsEl.appendChild(makeSectionBlock(c, letter, sections[letter]));
  });

  // Bouton pour ajouter une nouvelle section
  const addDiv = document.createElement('div');
  addDiv.style.marginTop = '16px';
  const remainingCases = Object.keys(CASE_LABELS).filter(k => !sections[k]);
  addDiv.innerHTML = `
    <label style="font-size:12px;color:var(--ink-soft);display:block;margin-bottom:6px;">Ajouter une suite pour la case :</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${remainingCases.map(k => `<button type="button" class="btn-add-section" data-addcase="${k}">${k}</button>`).join('')}
      ${remainingCases.length === 0 ? '<span style="font-size:12px;color:var(--ink-soft);">Toutes les cases ont déjà une suite.</span>' : ''}
    </div>`;
  sectionsEl.appendChild(addDiv);

  $$('.btn-add-section', sectionsEl).forEach(btn => {
    btn.onclick = () => {
      const letter = btn.dataset.addcase;
      if (!c.sections) c.sections = {};
      c.sections[letter] = '';
      renderComplementScreen(c);
      scheduleAutoSave('complement');
      setTimeout(() => {
        const anchor = document.getElementById('complement-section-' + letter);
        if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const ta = document.getElementById('complement-textarea-' + letter);
        if (ta) ta.focus();
      }, 80);
    };
  });

  enableSpellcheck(sectionsEl);

  // V2.3 (D) — code mort retiré : avant il y avait
  //   sigsEl.querySelector(...)?.setValue || fillForm(...)
  // setValue n'existe pas sur les inputs DOM, donc cette ligne ne faisait rien.
  // fillForm était rappelé juste après (en double). On garde un seul appel propre.
  fillForm($('#screen-complement'), { complement: c });
}

function makeSectionBlock(c, letter, texte) {
  const div = document.createElement('div');
  div.className = 'fieldset complement-section';
  div.id = 'complement-section-' + letter;
  div.innerHTML = `
    <div class="complement-section-header">
      <span class="case-tag">${letter}</span>
      <span class="complement-section-label">Suite de la case ${letter} — ${escapeHTML(CASE_LABELS[letter] || '')}</span>
      <button type="button" class="btn-remove-section" data-removecase="${letter}" title="Supprimer cette section">×</button>
    </div>
    <div class="field field-large">
      <textarea id="complement-textarea-${letter}" rows="6"
        placeholder="Suite de la case ${letter}…"
        data-section="${letter}">${escapeHTML(texte || '')}</textarea>
    </div>`;
  // suppression de section
  div.querySelector('.btn-remove-section').onclick = () => {
    if (confirm(`Supprimer la section "Suite de la case ${letter}" ?`)) {
      delete c.sections[letter];
      renderComplementScreen(c);
      scheduleAutoSave('complement');
    }
  };
  // V2.3 — un seul listener input qui fait update + autosave (avant : 2 listeners séparés)
  const ta = div.querySelector('textarea');
  ta.addEventListener('input', () => {
    if (!c.sections) c.sections = {};
    c.sections[letter] = ta.value;
    scheduleAutoSave('complement');
  });
  return div;
}

function readComplementSections(c) {
  if (!c.sections) c.sections = {};
  $$('#complement-sections textarea[data-section]').forEach(ta => {
    c.sections[ta.dataset.section] = ta.value;
  });
  const fn  = $('#screen-complement [data-field="complement.folio_no"]');
  const fnr = $('#screen-complement [data-field="complement.folio_no_ref"]');
  const dr  = $('#screen-complement [data-field="complement.date_ref"]');
  if (fn)  c.folio_no     = Number(fn.value)  || c.folio_no;
  if (fnr) c.folio_no_ref = Number(fnr.value) || c.folio_no_ref;
  if (dr)  c.date_ref     = dr.value          || c.date_ref;
}

function openComplement(c, targetCase = null) {
  state.currentComplement = c;
  $('#complement-title').textContent = `Complément N° ${pad4(c.folio_no)}`;
  renderComplementScreen(c);
  showScreen('complement');
  $('#screen-complement').classList.add('active');
  if (targetCase) {
    setTimeout(() => {
      const anchor = document.getElementById('complement-section-' + targetCase);
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const ta = document.getElementById('complement-textarea-' + targetCase);
      if (ta) ta.focus();
    }, 200);
  }
}

async function createNewComplement(folioRef = null, caseLetter = null) {
  if (!state.config.projet_id) {
    toast("Crée d'abord un projet.", 'error');
    return;
  }
  // V2.2 : un seul complément par folio — chercher s'il existe déjà
  let c = null;
  if (folioRef) {
    c = state.complements.find(x => x.folio_no_ref === folioRef.folio_no);
  }
  if (!c) {
    c = emptyComplement(folioRef);
    if (!c.sections) c.sections = {};
    state.currentComplement = c;
    await saveComplement();
    toast(`Complément N°${c.folio_no} créé`, 'success');
  }
  if (caseLetter) {
    if (!c.sections) c.sections = {};
    if (!c.sections[caseLetter]) {
      c.sections[caseLetter] = '';
      state.currentComplement = c;
      await saveComplement();
    }
  }
  state.currentComplement = c;
  openComplement(c, caseLetter);
}

/* ═════════════════════════════════════════════════════════════════════
   DÉTECTION DE DÉBORDEMENT (bouton "suite" cases C-K)
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

  const badge = fs.querySelector('.overflow-badge');
  if (badge) {
    badge.textContent = over ? `${len}/${limit}` : '';
    badge.style.display = over ? 'inline-flex' : 'none';
  }

  const casesCK = ['C','D','E','F','G','H','J','K'];
  if (!casesCK.includes(caseLetter)) {
    return over;
  }

  let suiteBtn = fs.querySelector('.btn-suite');
  if (over) {
    if (!suiteBtn) {
      suiteBtn = document.createElement('button');
      suiteBtn.type = 'button';
      suiteBtn.className = 'btn-suite';
      suiteBtn.textContent = 'suite';
      suiteBtn.title = `Ouvrir complément — case ${caseLetter}`;
      const summary = fs.querySelector('summary');
      if (summary) summary.appendChild(suiteBtn);
      suiteBtn.onclick = async (e) => {
        e.stopPropagation();
        await saveFolio();
        await createNewComplement(state.currentFolio, caseLetter);
      };
    }
  } else if (suiteBtn) {
    suiteBtn.remove();
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

    const i8  = times.findIndex(t => t.endsWith('T08:00'));
    const i16 = times.findIndex(t => t.endsWith('T16:00'));
    const t8  = i8 >= 0 ? temps[i8] : null;
    const t16 = i16 >= 0 ? temps[i16] : null;

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
  if (f.weather_fetched_at) return;
  if (f.temp_8h != null && f.temp_16h != null) return;
  if (state.meteoFetchedForFolio === f.id) return;
  state.meteoFetchedForFolio = f.id;
  if (!navigator.onLine) {
    toast('Hors-ligne : météo non récupérée', '');
    return;
  }
  await fetchWeather();
}

/* ═════════════════════════════════════════════════════════════════════
   GITHUB — config helpers (V2.3) + publish + PDF + share
   ═════════════════════════════════════════════════════════════════════ */

function ghConfigured() {
  const c = state.config;
  return !!(c.gh_owner && c.gh_repo && c.gh_token);
}

// V2.3 (H) — Auto-détecte owner+repo depuis window.location (github.io)
function autoDetectGitHub() {
  const host = window.location.hostname;
  const path = window.location.pathname;
  let owner = '', repo = '';

  // Cas github.io classique : https://OWNER.github.io/REPO/
  const m = host.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    owner = m[1];
    const pathMatch = path.match(/^\/([^/]+)/);
    if (pathMatch) repo = pathMatch[1];
  }

  if (!owner || !repo) {
    toast('Auto-détection impossible (URL non github.io)', 'error');
    return;
  }

  // Lire d'abord les valeurs courantes du form pour ne pas perdre token/branche
  readForm($('#screen-reglages'), { config: state.config });
  state.config.gh_owner = owner;
  state.config.gh_repo  = repo;
  if (!state.config.gh_branch) state.config.gh_branch = 'main';

  fillForm($('#screen-reglages'), { config: state.config });
  toast(`Détecté : ${owner}/${repo}`, 'success');
  setSyncDot('dirty');
  showSaveIndicator('saving', '💾 ...');
  // Persister immédiatement
  Promise.all([
    saveConfigKey('gh_owner', owner),
    saveConfigKey('gh_repo',  repo),
    saveConfigKey('gh_branch', state.config.gh_branch),
  ]).then(() => showSaveIndicator('saved', '✓ Enregistré'));
}

// V2.3 (I) — Tester la connexion GitHub avec diagnostic précis
async function testGitHubConnection() {
  readForm($('#screen-reglages'), { config: state.config });
  const c = state.config;

  if (!c.gh_owner) { toast('Owner manquant', 'error'); return; }
  if (!c.gh_repo)  { toast('Repo manquant',  'error'); return; }
  if (!c.gh_token) { toast('Token manquant (PAT)', 'error'); return; }

  const btn = $('#btn-gh-test');
  if (btn) btn.disabled = true;
  toast('Test en cours…', '');

  try {
    // 1. Repo accessible ?
    const repoResp = await fetch(
      `https://api.github.com/repos/${c.gh_owner}/${c.gh_repo}`,
      { headers: { 'Authorization': `token ${c.gh_token}`, 'Accept': 'application/vnd.github+json' } }
    );

    if (repoResp.status === 401) {
      toast('❌ Token invalide ou expiré', 'error');
      return;
    }
    if (repoResp.status === 404) {
      toast(`❌ Repo introuvable : ${c.gh_owner}/${c.gh_repo} (orthographe, dashes, casse)`, 'error');
      return;
    }
    if (!repoResp.ok) throw new Error('HTTP ' + repoResp.status);

    const repoInfo = await repoResp.json();

    // 2. Branche existe ?
    const branch = c.gh_branch || 'main';
    const brResp = await fetch(
      `https://api.github.com/repos/${c.gh_owner}/${c.gh_repo}/branches/${branch}`,
      { headers: { 'Authorization': `token ${c.gh_token}`, 'Accept': 'application/vnd.github+json' } }
    );
    if (brResp.status === 404) {
      toast(`❌ Branche "${branch}" introuvable sur le repo`, 'error');
      return;
    }
    if (!brResp.ok) throw new Error('HTTP ' + brResp.status);

    // 3. Permissions d'écriture ?
    const canWrite = repoInfo.permissions?.push;
    if (canWrite === false) {
      toast('⚠ Connexion OK mais token sans droit d\'écriture (scope `repo` requis)', 'error');
      return;
    }

    toast(`✅ Connexion OK · ${c.gh_owner}/${c.gh_repo} · ${branch}`, 'success');
  } catch (e) {
    console.error('testGitHubConnection', e);
    toast(`❌ Erreur réseau : ${e.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function publishToGitHub() {
  if (!ghConfigured()) {
    toast('Configure GitHub dans Réglages (owner + repo + token).', 'error');
    return;
  }
  const c = state.config;
  const projet_id = c.projet_id;
  if (!projet_id) { toast('Pas de projet actif.', 'error'); return; }

  const payload = {
    version: APP_VERSION,
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
    let sha = null;
    const getResp = await fetch(
      `https://api.github.com/repos/${c.gh_owner}/${c.gh_repo}/contents/${path}?ref=${c.gh_branch}`,
      { headers: { 'Authorization': `token ${c.gh_token}`, 'Accept': 'application/vnd.github+json' } }
    );
    if (getResp.ok) {
      const info = await getResp.json();
      sha = info.sha;
    }

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
      const httpErr = new Error(err.message || `HTTP ${putResp.status}`);
      httpErr.status = putResp.status;
      throw httpErr;
    }
    setSyncDot('synced');
    toast('Publié sur GitHub ✓', 'success');
  } catch (e) {
    console.error('publishToGitHub', e);
    setSyncDot('error');
    // V2.3 (I) — messages d'erreur détaillés par code HTTP
    let userMsg;
    switch (e.status) {
      case 401: userMsg = '❌ Token invalide ou expiré. Vérifie dans Réglages.'; break;
      case 403: userMsg = '❌ Permission refusée. Le PAT doit avoir le scope `repo`.'; break;
      case 404: userMsg = `❌ Repo/branche introuvable (${c.gh_owner}/${c.gh_repo}/${c.gh_branch}).`; break;
      case 409:
      case 422: userMsg = '❌ Conflit de version. Réessaye dans un instant.'; break;
      default:  userMsg = '❌ Échec publication : ' + e.message;
    }
    toast(userMsg, 'error');
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
   MODAL GÉNÉRIQUE (V2.3 — J)
   Remplace window.prompt() par un modal in-app stylé.
   ═════════════════════════════════════════════════════════════════════ */

function openModal({ title, bodyHTML, onConfirm, confirmLabel = 'Valider', cancelLabel = 'Annuler' }) {
  return new Promise((resolve) => {
    const backdrop  = $('#modal-backdrop');
    const titleEl   = $('#modal-title');
    const bodyEl    = $('#modal-body');
    const btnCancel = $('#modal-cancel');
    const btnConfirm = $('#modal-confirm');

    titleEl.textContent = title;
    bodyEl.innerHTML    = bodyHTML;
    btnCancel.textContent  = cancelLabel;
    btnConfirm.textContent = confirmLabel;
    backdrop.hidden = false;

    const cleanup = () => {
      backdrop.hidden = true;
      btnCancel.onclick  = null;
      btnConfirm.onclick = null;
      backdrop.onclick   = null;
      document.removeEventListener('keydown', onKey);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        btnConfirm.click();
      }
    };
    document.addEventListener('keydown', onKey);

    btnCancel.onclick = () => { cleanup(); resolve(null); };
    backdrop.onclick = (e) => {
      if (e.target === backdrop) { cleanup(); resolve(null); }
    };
    btnConfirm.onclick = async () => {
      const result = onConfirm ? await onConfirm() : null;
      if (result === false) return; // validation échouée, garder le modal ouvert
      cleanup();
      resolve(result);
    };

    setTimeout(() => {
      const firstInput = bodyEl.querySelector('input, select, textarea');
      if (firstInput) firstInput.focus();
    }, 50);
  });
}

/* ═════════════════════════════════════════════════════════════════════
   PROJET : pickProject / newProject (V2.3 J+K — modaux + bug fix)
   ═════════════════════════════════════════════════════════════════════ */

async function pickProject() {
  const allProjects = await dbGetAll(STORES.projet);

  let bodyHTML;
  if (allProjects.length > 0) {
    bodyHTML = `
      <div class="field">
        <label>Projets existants</label>
        <select id="modal-pick-select">
          <option value="">— Choisir un projet —</option>
          ${allProjects.map(p => {
            const selected = (p.id === state.config.projet_id) ? 'selected' : '';
            const label = `${p.nom || p.id} (${p.id})`;
            return `<option value="${escapeHTML(p.id)}" ${selected}>${escapeHTML(label)}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="field">
        <label>Ou saisir un ID manuellement</label>
        <input type="text" id="modal-pick-input" placeholder="PRJ-CHIREC-CAVELL">
      </div>`;
  } else {
    bodyHTML = `
      <p style="margin-bottom:12px;color:var(--ink-soft);font-size:13px;">
        Aucun projet enregistré localement. Saisis un ID ou utilise "Nouveau projet".
      </p>
      <div class="field">
        <label>ID du projet à charger</label>
        <input type="text" id="modal-pick-input" placeholder="PRJ-CHIREC-CAVELL" value="${escapeHTML(state.config.projet_id || '')}">
      </div>`;
  }

  const result = await openModal({
    title: 'Charger un projet',
    bodyHTML,
    confirmLabel: 'Charger',
    onConfirm: () => {
      const sel = $('#modal-pick-select');
      const inp = $('#modal-pick-input');
      const id = (sel && sel.value) || (inp && inp.value.trim());
      if (!id) { toast('ID requis', 'error'); return false; }
      return id;
    },
  });

  if (!result) return;

  await saveConfigKey('projet_id', result);
  await loadProjet();
  await loadAll();
  renderAccueil();
  if (state.currentScreen === 'reglages') renderReglages();
  toast(`Projet « ${result} » chargé`, 'success');
}

async function newProject() {
  const bodyHTML = `
    <div class="field">
      <label>ID du projet (slug sans espace)</label>
      <input type="text" id="modal-new-id" placeholder="PRJ-CHIREC-CAVELL" required>
      <div class="field-hint">Ex : PRJ-CHIREC-CAVELL · projet-naninne · etc.</div>
    </div>
    <div class="field">
      <label>Nom du projet</label>
      <input type="text" id="modal-new-nom" placeholder="CHIREC Cavell — Lot 3">
    </div>
    <div class="field">
      <label>Description (optionnel)</label>
      <textarea id="modal-new-desc" rows="3" placeholder="Type de travaux, contexte…"></textarea>
    </div>`;

  const result = await openModal({
    title: 'Nouveau projet',
    bodyHTML,
    confirmLabel: 'Créer',
    onConfirm: () => {
      const id = $('#modal-new-id').value.trim();
      const nom = $('#modal-new-nom').value.trim();
      const desc = $('#modal-new-desc').value.trim();
      if (!id) { toast('ID requis', 'error'); return false; }
      if (/\s/.test(id)) { toast('Pas d\'espace dans l\'ID', 'error'); return false; }
      return { id, nom, desc };
    },
  });

  if (!result) return;

  await saveConfigKey('projet_id', result.id);
  state.projet = emptyProjet(result.id);
  if (result.nom)  state.projet.nom = result.nom;
  if (result.desc) state.projet.travaux_de = result.desc;
  await saveProjet();
  // V2.3 (K) bug fix : loadAll() au lieu de state.folios/complements = []
  // (sinon état inconsistant si on recrée un projet avec un ID déjà utilisé)
  await loadAll();
  renderAccueil();
  if (state.currentScreen === 'reglages') renderReglages();
  showScreen('projet');
  toast(`Projet « ${result.id} » créé`, 'success');
}

/* ═════════════════════════════════════════════════════════════════════
   IMPORT / EXPORT JSON
   ═════════════════════════════════════════════════════════════════════ */

function exportJSON() {
  const payload = {
    version: APP_VERSION,
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

    if (data.projet && data.projet.id) {
      await dbPut(STORES.projet, data.projet);
      await saveConfigKey('projet_id', data.projet.id);
    }

    if (Array.isArray(data.folios)) {
      for (const f of data.folios) {
        if (!f.projet_id && data.projet) f.projet_id = data.projet.id;
        await dbPut(STORES.folios, f);
      }
    }

    if (Array.isArray(data.complements)) {
      for (const c of data.complements) {
        if (!c.projet_id && data.projet) c.projet_id = data.projet.id;
        if (!c.sections) {
          c.sections = {};
          if (c.case && c.texte) c.sections[c.case] = c.texte;
        }
        await dbPut(STORES.complements, c);
      }
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
      if (kind === 'complement' && state.currentComplement) { await saveComplement(); }
      if (kind === 'projet'     && state.projet)            { readForm($('#screen-projet'),     { projet: state.projet }); await saveProjet(); }
      if (kind === 'config')                                { readForm($('#screen-reglages'),   { config: state.config }); for (const k of Object.keys(state.config)) await saveConfigKey(k, state.config[k]); }
      showSaveIndicator('saved', '✓ Enregistré');
      setSyncDot('dirty');
    } catch (e) {
      console.error('autosave', e);
      showSaveIndicator('error', '⚠ erreur');
    }
  }, SAVE_DEBOUNCE_MS);
}

function wireAutoSave() {
  $$('#screen-folio [data-field]').forEach(el => {
    el.addEventListener('input', () => {
      if (el.tagName === 'TEXTAREA' && el.dataset.overflow) checkOverflow(el);
      scheduleAutoSave('folio');
    });
  });
  // Complément : ne câbler ici que les inputs STATIQUES (signatures). Les inputs
  // dynamiques du header sont câblés dans renderComplementScreen (V2.3 - E).
  $$('#screen-complement [data-field]').forEach(el => {
    el.addEventListener('input', () => scheduleAutoSave('complement'));
  });
  $$('#screen-projet [data-field]').forEach(el => {
    el.addEventListener('input', () => scheduleAutoSave('projet'));
  });
  $$('#screen-reglages [data-field]').forEach(el => {
    el.addEventListener('input', () => scheduleAutoSave('config'));
  });

  window.addEventListener('beforeunload', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      if (state.currentFolio)      { try { readForm($('#screen-folio'),      { folio: state.currentFolio }); saveFolio(); } catch(_) {} }
      if (state.currentComplement) { try { readForm($('#screen-complement'), { complement: state.currentComplement }); saveComplement(); } catch(_) {} }
      if (state.projet)            { try { readForm($('#screen-projet'),     { projet: state.projet }); saveProjet(); } catch(_) {} }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {}, 0);
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
      readComplementSections(state.currentComplement);
      await saveComplement();
    }
    showScreen('historique');
  };
  $('#btn-save-complement').onclick = async () => {
    readComplementSections(state.currentComplement);
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
    const savedProjetId = state.config.projet_id;
    readForm($('#screen-reglages'), { config: state.config });
    if (!state.config.projet_id && savedProjetId) {
      state.config.projet_id = savedProjetId;
    }
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

  // V2.3 (H+I) — GitHub helpers
  $('#btn-gh-autodetect').onclick = autoDetectGitHub;
  $('#btn-gh-test').onclick       = testGitHubConnection;
}

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

    console.log(`[Journal V${APP_VERSION}] prêt — projet:`, state.config.projet_id || '(aucun)');
  } catch (e) {
    console.error('init', e);
    alert("Erreur d'initialisation : " + e.message);
  }
})();

})();
