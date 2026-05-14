# Journal des Travaux — PWA + GitHub

Application web autonome pour saisir le **Journal des Travaux** quotidien sur chantier (modèle Embuild 9545 F, entrepreneur EEG Techniques spéciales).

- **Saisie** : sur PC, tablette ou téléphone Android — hors-ligne OK
- **Stockage** : local sur l'appareil (IndexedDB) + sync GitHub à la demande
- **PDF** : généré automatiquement par GitHub Actions, fidèle au modèle Embuild

---

## 📦 Structure du projet

```
journal-travaux/                  ← Votre repo GitHub privé
├── index.html                    ← La PWA
├── style.css                     ← Styles
├── app.js                        ← Logique (IndexedDB, GitHub sync)
├── manifest.json                 ← PWA installable
├── cachet.png                    ← Cachet entrepreneur (remplaçable)
├── data/                         ← Vos données (JSON)
│   └── PRJ-001.json              ← Exemple créé par la PWA
├── pdf/                          ← Scripts Python pour générer le PDF
│   ├── build_pdf.py
│   └── requirements.txt
└── .github/
    └── workflows/
        └── generate-pdf.yml      ← Action qui génère le PDF
```

---

## 🚀 Mise en route — 6 étapes

### 1. Créer le repo sur GitHub

1. Allez sur https://github.com/new
2. **Repository name** : `journal-travaux`
3. **Visibilité** : ☑️ **Private**
4. NE PAS cocher "Add a README" (on en a déjà un)
5. Cliquer **Create repository**

### 2. Uploader les fichiers

Sur la page du repo vide, cliquer **"uploading an existing file"** et glisser-déposer **tous les fichiers** depuis le dossier que je vous ai fourni :

- `index.html`, `style.css`, `app.js`, `manifest.json`, `cachet.png`, `README.md`
- Le dossier `pdf/` (avec `build_pdf.py` et `requirements.txt`)
- Le dossier `.github/workflows/` (avec `generate-pdf.yml`)

> ⚠️ Important : conservez exactement la même arborescence. GitHub crée les sous-dossiers automatiquement si vous nommez les fichiers avec `/` (ex. `pdf/build_pdf.py`).

Cliquer **Commit changes**.

### 3. Activer les GitHub Actions

1. Onglet **Actions** du repo
2. Cliquer **I understand my workflows, go ahead and enable them**

### 4. Créer un Personal Access Token (PAT)

Le token permet à la PWA d'écrire dans votre repo.

1. Allez sur https://github.com/settings/tokens/new
2. **Note** : `Journal des Travaux`
3. **Expiration** : `90 days` (ou plus, à votre choix)
4. **Scope** : cocher **uniquement `repo`** (toutes les sous-cases sous `repo`)
5. Cliquer **Generate token** en bas
6. **⚠️ Copier le token immédiatement** — il commence par `ghp_...` ou `github_pat_...`. Vous ne le reverrez plus.

### 5. Télécharger `index.html` sur chaque appareil

Sur chaque PC / tablette / téléphone :

1. Allez sur `https://github.com/ramizxhixha-a11y/journal-travaux`
2. Cliquer sur `index.html`
3. Cliquer sur **"Download raw file"** (icône ⬇ en haut à droite du contenu)
4. Sauvegarder le fichier sur l'appareil

**Sur Android** : ouvrir le fichier avec Chrome → menu (⋮) → **Ajouter à l'écran d'accueil**. L'app apparaît comme une vraie app.

**Sur PC** : ouvrir le fichier dans Chrome ou Edge.

### 6. Configurer la PWA

1. Ouvrir l'app
2. Onglet **Réglages** (en bas à droite)
3. Section **Synchronisation GitHub** :
   - **Owner** : `ramizxhixha-a11y`
   - **Repo** : `journal-travaux`
   - **Token** : collez votre PAT
4. Cliquer **Enregistrer**

✅ **C'est prêt.** Vous pouvez maintenant saisir des folios.

---

## 📝 Utilisation quotidienne

1. Ouvrir la PWA
2. Bouton **"+ Nouveau folio"** ou **"Ouvrir le folio du jour"**
3. Remplir les cases A à K + ouvriers + signatures
4. **Sauvegarder** → tout reste sur l'appareil
5. **"Publier sur GitHub"** (Accueil) → vos données sont commitées dans le repo privé
6. **"Générer le PDF"** → lance l'Action GitHub, vous récupérez le PDF dans l'onglet **Actions** du repo (artefact téléchargeable)

### Synchroniser entre appareils

- Sur Appareil A : **"Publier sur GitHub"**
- Sur Appareil B : ouvrir le repo GitHub, télécharger `data/PRJ-001.json`, puis dans la PWA → Réglages → **"Importer un JSON"**

Plus tard (V2), on fera de la sync auto, mais ce flux marche dès maintenant.

---

## 🖋️ Changer le cachet

Remplacez simplement `cachet.png` à la racine du repo par votre propre image (ratio ~2:1, 800-1000 px de large). Le prochain PDF utilisera ce cachet.

---

## 🔧 Si quelque chose casse

- **L'action PDF échoue** → onglet Actions → cliquer sur le workflow rouge → voir les logs
- **La PWA ne sauvegarde pas** → vérifiez Réglages → token/owner/repo bien remplis
- **Le PDF n'a pas mes derniers folios** → vous avez oublié **"Publier sur GitHub"** avant **"Générer PDF"**

---

## 🛣️ Roadmap

### V1 (cette version) ✅
- PWA installable hors-ligne
- Saisie folio + projet + compléments
- Stockage local IndexedDB
- Sync GitHub manuelle
- PDF automatique via Action

### V2 (prochaine session, si vous voulez)
- 🌡️ Météo automatique via API
- 📅 Jours fériés belges détectés
- 👷 Carnet d'ouvriers récurrents
- 🔁 Bouton "Comme hier"
- 🎤 Dictée vocale

### V3 (plus tard)
- 📸 Photos par case
- 🖊️ Signature tactile
- 📷 OCR bons de livraison
- 📊 Dashboard graphique

---

**Conçu pour le chantier École Naninne, modèle Embuild 9545 F.**
**Mono-utilisateur, données chiffrées en transit (HTTPS GitHub).**
