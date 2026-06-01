/**
 * outils/upload.js
 * Gère le dépôt de fichiers .geojson, .zip (shapefile) ET de fichiers Shapefile séparés (.shp, .dbf, etc.).
 * Regroupe les composants de shapefiles non zippés par nom, les compresse à la volée,
 * convertit le tout en GeoJSON via shpjs, puis envoie à Google Sheets via Apps Script.
 *
 * ⚙️ CONFIG : remplace GOOGLE_SCRIPT_URL par l'URL de ton Apps Script déployé.
 */

(function () {

  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3yvNTl-aFgd7kAaSc2kyETuMfeUqIn4j2hnvKEs6dpGs7jNo4vMIdTFIGhpSyJm6c/exec';

  /* ── Chargement des dépendances (shpjs + JSZip) ── */
  if (!window._shpjsLoaded) {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/shpjs@latest/dist/shp.js';
    s.onload = () => { window._shpjsLoaded = true; };
    document.head.appendChild(s);
  }
  if (!window._jszipLoaded) {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => { window._jszipLoaded = true; };
    document.head.appendChild(s);
  }

  /* ── Styles ── */
  if (!document.getElementById('upload-tool-styles')) {
    const style = document.createElement('style');
    style.id = 'upload-tool-styles';
    style.textContent = `
      #drop-zone {
        border: 1.5px dashed #D8D8D4;
        border-radius: 12px;
        padding: 36px 24px;
        text-align: center;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
        background: #FAFAF9;
        position: relative;
      }
      #drop-zone:hover, #drop-zone.dragover {
        border-color: #A0A09A;
        background: #F4F4F1;
      }
      #drop-zone input[type="file"] {
        position: absolute; inset: 0; opacity: 0;
        cursor: pointer; width: 100%; height: 100%;
      }
      .drop-emoji {
        font-size: 2rem; line-height: 1; margin-bottom: 10px;
        display: block; transition: transform 0.2s;
      }
      #drop-zone:hover .drop-emoji, #drop-zone.dragover .drop-emoji {
        transform: scale(1.15) translateY(-2px);
      }
      .drop-title  { font-size: 0.9375rem; font-weight: 500; color: #3a3a38; }
      .drop-hint   { font-size: 0.75rem; color: #B0B0A8; margin-top: 5px; }
      .drop-formats {
        display: inline-flex; gap: 6px; margin-top: 10px; justify-content: center;
        flex-wrap: wrap;
      }
      .fmt-badge {
        font-size: 0.6875rem; font-weight: 500; letter-spacing: 0.04em;
        padding: 2px 8px; border-radius: 99px;
        background: #EEEEED; color: #7a7a74;
      }

      #file-list { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }

      .file-row {
        display: flex; align-items: flex-start; gap: 10px;
        background: #fff; border: 1px solid #EAEAE6;
        border-radius: 10px; padding: 10px 14px;
        animation: fadeUp 0.3s ease both;
        transition: border-color 0.2s;
      }
      .file-row.error   { border-color: #FBCFCF; background: #FFFAFA; }
      .file-row.success { border-color: #C2EDD6; background: #F6FEF9; }

      .file-icon { font-size: 1.25rem; flex-shrink: 0; margin-top: 1px; }
      .file-meta { flex: 1; overflow: hidden; }
      .file-name {
        font-size: 0.8125rem; font-weight: 500; color: #2a2a28;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .file-sub  { font-size: 0.6875rem; color: #B0B0A8; margin-top: 2px; }
      .file-sub.err { color: #E05A5A; }

      .file-progress-wrap {
        width: 100%; height: 3px; background: #F0F0EC;
        border-radius: 99px; margin-top: 7px; overflow: hidden; display: none;
      }
      .file-progress-bar {
        height: 100%; border-radius: 99px; background: #3a3a38;
        width: 0%; transition: width 0.35s ease;
      }
      .file-progress-bar.done     { background: #52c48a; }
      .file-progress-bar.errored { background: #E05A5A; }

      .file-remove {
        background: none; border: none; cursor: pointer;
        color: #C8C8C0; font-size: 1rem; padding: 2px 4px;
        border-radius: 4px; transition: color 0.15s, background 0.15s;
        flex-shrink: 0;
      }
      .file-remove:hover { color: #888; background: #F0F0EC; }

      #upload-send-btn {
        margin-top: 16px; width: 100%; padding: 11px;
        border-radius: 10px; border: none;
        background: #1a1a1a; color: #fafaf9;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.875rem; font-weight: 500;
        letter-spacing: 0.01em; cursor: pointer;
        transition: background 0.2s, transform 0.15s;
        display: none;
      }
      #upload-send-btn:hover  { background: #333330; transform: translateY(-1px); }
      #upload-send-btn:active { transform: translateY(0); }
      #upload-send-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

      #upload-status {
        margin-top: 10px; font-size: 0.8125rem; text-align: center;
        color: #9E9E98; min-height: 18px;
      }

      .config-warning {
        background: #FFF8EC; border: 1px solid #F5DFA0;
        border-radius: 10px; padding: 10px 14px;
        font-size: 0.75rem; color: #9A7A30; margin-bottom: 14px;
        display: flex; gap: 8px; align-items: flex-start;
      }
    `;
    document.head.appendChild(style);
  }

  /* ── HTML ── */
  const container = document.getElementById('upload-content');
  if (!container) return;

  const missingUrl = GOOGLE_SCRIPT_URL.includes('COLLE_ICI');

  container.innerHTML = `
    ${missingUrl ? `
    <div class="config-warning">
      <span>⚠️</span>
      <span>Configure <code>GOOGLE_SCRIPT_URL</code> dans <code>outils/upload.js</code> avec l'URL de ton Apps Script déployé.</span>
    </div>` : ''}

    <div id="drop-zone">
      <input type="file" id="file-input" multiple accept=".geojson,.json,.zip,.shp,.dbf,.shx,.prj" />
      <span class="drop-emoji">🗺️</span>
      <p class="drop-title">Glisse tes fichiers géo ici</p>
      <p class="drop-hint">ou clique pour parcourir (accepte les lots de fichiers Shapefile)</p>
      <div class="drop-formats">
        <span class="fmt-badge">.geojson</span>
        <span class="fmt-badge">.zip (shapefile)</span>
        <span class="fmt-badge">unitaire (.shp, .dbf, .shx, .prj)</span>
      </div>
    </div>

    <div id="file-list"></div>
    <button id="upload-send-btn">Envoyer vers Google Sheets →</button>
    <p id="upload-status"></p>
  `;

  /* ── Refs ── */
  const dropZone  = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileList  = document.getElementById('file-list');
  const sendBtn   = document.getElementById('upload-send-btn');
  const status    = document.getElementById('upload-status');

  // files[] = { name, size, id, isVirtualZip, components: [], geojson: null | object, error: null | string }
  let files = [];

  /* ── Helpers ── */
  function formatBytes(b) {
    if (b < 1024) return b + ' o';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' Ko';
    return (b / (1024 * 1024)).toFixed(1) + ' Mo';
  }

  function isZip(filename)     { return filename.toLowerCase().endsWith('.zip'); }
  function isGeoJson(filename) {
    const n = filename.toLowerCase();
    return n.endsWith('.geojson') || n.endsWith('.json');
  }

  /* ── Parsing d'une entité (Fichier unique ou Paquet Shapefile recomposé) ── */
  async function parseFile(entry) {
    // Cas 1 : GéoJSON classique
    if (isGeoJson(entry.name)) {
      const text = await entry.file.text();
      const gj   = JSON.parse(text);
      if (gj.type !== 'FeatureCollection' && gj.type !== 'Feature' && !gj.features) {
        throw new Error('JSON invalide — pas un GeoJSON reconnu');
      }
      if (gj.type === 'Feature') return { type: 'FeatureCollection', features: [gj] };
      return gj;
    }

    // Cas 2 : Fichier ZIP brut déjà existant
    if (isZip(entry.name)) {
      if (!window.shp) throw new Error('Librairie shpjs pas encore chargée, réessaie dans 2s');
      const buffer = await entry.file.arrayBuffer();
      return await processShpBuffer(buffer);
    }

    // Cas 3 : Shapefile morcelé qu'on a regroupé virtuellement dans un ZIP
    if (entry.isVirtualZip) {
      if (!window.shp) throw new Error('Librairie shpjs en cours de chargement…');
      if (!window.JSZip) throw new Error('Librairie de compression en cours de chargement…');

      // Vérifications de sécurité de base pour un Shapefile fonctionnel
      const extensions = entry.components.map(f => f.name.toLowerCase().split('.').pop());
      if (!extensions.includes('shp')) throw new Error('Composant .shp manquant');
      if (!extensions.includes('dbf')) throw new Error('Composant .dbf (données attributaires) manquant');

      // On monte le ZIP à la volée
      const zip = new window.JSZip();
      for (const component of entry.components) {
        zip.file(component.name, component);
      }
      
      const buffer = await zip.generateAsync({ type: 'arraybuffer' });
      return await processShpBuffer(buffer);
    }

    throw new Error('Format non supporté');
  }

  async function processShpBuffer(buffer) {
    const gj = await window.shp(buffer);
    if (Array.isArray(gj)) {
      return {
        type: 'FeatureCollection',
        features: gj.flatMap(fc => fc.features || [])
      };
    }
    return gj;
  }

  /* ── Rendu d'une ligne dans l'interface ── */
  function renderFileRow(entry) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.id = 'row_' + entry.id;
    
    let icon = '🗺️';
    if (isZip(entry.name) || entry.isVirtualZip) icon = '🗜️';

    row.innerHTML = `
      <span class="file-icon">${icon}</span>
      <div class="file-meta">
        <p class="file-name">${entry.name}</p>
        <p class="file-sub" id="sub_${entry.id}">${formatBytes(entry.size)} · Traitement…</p>
        <div class="file-progress-wrap" id="pwrap_${entry.id}">
          <div class="file-progress-bar" id="bar_${entry.id}"></div>
        </div>
      </div>
      <button class="file-remove" title="Retirer" onclick="removeFile('${entry.id}')">✕</button>
    `;
    fileList.appendChild(row);
  }

  function setRowSub(id, text, isErr = false) {
    const el = document.getElementById('sub_' + id);
    if (!el) return;
    el.textContent = text;
    el.className   = 'file-sub' + (isErr ? ' err' : '');
  }

  function setRowState(id, state) {
    const row = document.getElementById('row_' + id);
    if (row) row.className = 'file-row ' + state;
  }

  function setBar(id, pct, cls = '') {
    const wrap = document.getElementById('pwrap_' + id);
    const bar  = document.getElementById('bar_' + id);
    if (wrap) wrap.style.display = 'block';
    if (bar) {
      bar.style.width = pct + '%';
      bar.className   = 'file-progress-bar ' + cls;
    }
  }

  /* ── Analyse et répartition des fichiers déposés ── */
  async function addFiles(newFiles) {
    const shpGroups = {}; // Pour regrouper les .shp, .dbf par leur nom racine
    const standaloneFiles = [];

    // 1. Tri et regroupement
    for (const file of Array.from(newFiles)) {
      const name = file.name;
      
      if (isGeoJson(name) || isZip(name)) {
        standaloneFiles.push({
          file,
          name: file.name,
          size: file.size,
          id: 'f_' + Date.now() + Math.random().toString(36).slice(2),
          isVirtualZip: false,
          geojson: null,
          error: null
        });
      } else {
        // C'est potentiellement un morceau de shapefile séparé (.shp, .dbf, etc.)
        const parts = name.split('.');
        const ext = parts.pop().toLowerCase();
        const rootName = parts.join('.'); // Nom sans extension

        const shpExtensions = ['shp', 'dbf', 'shx', 'prj', 'cpg', 'qpj'];
        if (shpExtensions.includes(ext)) {
          if (!shpGroups[rootName]) shpGroups[rootName] = [];
          shpGroups[rootName].push(file);
        } else {
          status.textContent = `⚠️ "${name}" ignoré — format non reconnu`;
        }
      }
    }

    // 2. Traitement des fichiers GeoJSON et ZIP classiques
    for (const entry of standaloneFiles) {
      files.push(entry);
      renderFileRow(entry);
      triggerParsing(entry);
    }

    // 3. Traitement des groupes Shapefile unitaires
    for (const [rootName, components] of Object.entries(shpGroups)) {
      const totalSize = components.reduce((acc, f) => acc + f.size, 0);
      const entry = {
        name: `${rootName} (Shapefile)`,
        size: totalSize,
        id: 'shp_' + Date.now() + Math.random().toString(36).slice(2),
        isVirtualZip: true,
        components: components,
        geojson: null,
        error: null
      };

      files.push(entry);
      renderFileRow(entry);
      triggerParsing(entry);
    }

    updateSendBtn();
  }

  // Lancement asynchrone du parsing
  function triggerParsing(entry) {
    parseFile(entry)
      .then(gj => {
        entry.geojson = gj;
        const count = gj.features ? gj.features.length : '?';
        setRowSub(entry.id, `${formatBytes(entry.size)} · ${count} entité${count > 1 ? 's' : ''} prête${count > 1 ? 's' : ''} ✓`);
        setBar(entry.id, 100, 'done');
      })
      .catch(err => {
        entry.error = err.message;
        setRowSub(entry.id, `Erreur : ${err.message}`, true);
        setRowState(entry.id, 'error');
        setBar(entry.id, 100, 'errored');
      })
      .finally(updateSendBtn);
  }

  window.removeFile = function (id) {
    files = files.filter(f => f.id !== id);
    const row = document.getElementById('row_' + id);
    if (row) row.remove();
    updateSendBtn();
  };

  function updateSendBtn() {
    const ready = files.filter(f => f.geojson && !f.error);
    sendBtn.style.display = files.length > 0 ? 'block' : 'none';
    sendBtn.textContent   = ready.length
      ? `Envoyer ${ready.length} couche${ready.length > 1 ? 's' : ''} vers Google Sheets →`
      : 'Envoyer vers Google Sheets →';
    status.textContent = '';
  }

  /* ── Drag & drop Events ── */
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = '';
  });

  /* ── Envoi vers Google Sheets ── */
  sendBtn.addEventListener('click', async () => {
    const ready = files.filter(f => f.geojson && !f.error);
    if (!ready.length) return;

    sendBtn.disabled    = true;
    sendBtn.textContent = 'Envoi en cours…';
    status.textContent  = '';

    let sent = 0, errors = 0;

    for (const entry of ready) {
      const { id, name, geojson } = entry;
      setBar(id, 30);

      const payload = {
        fileName    : name,
        sentAt      : new Date().toLocaleString('fr-FR'),
        featureCount: geojson.features ? geojson.features.length : 0,
        geojsonRaw  : JSON.stringify(geojson)
      };

      try {
        setBar(id, 60);
        await fetch(GOOGLE_SCRIPT_URL, {
          method : 'POST',
          mode   : 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify(payload)
        });
        setBar(id, 100, 'done');
        setRowState(id, 'success');
        setRowSub(id, `Envoyé ✓ — ${payload.featureCount} features`);
        sent++;
      } catch (err) {
        setBar(id, 100, 'errored');
        setRowState(id, 'error');
        setRowSub(id, `Échec réseau : ${err.message}`, true);
        errors++;
      }
    }

    sendBtn.textContent = errors
      ? `${sent} envoyé(s), ${errors} erreur(s)`
      : `✓ ${sent} couche${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''} !`;

    setTimeout(() => {
      files = [];
      fileList.innerHTML    = '';
      sendBtn.disabled      = false;
      sendBtn.style.display = 'none';
      sendBtn.textContent   = 'Envoyer vers Google Sheets →';
      status.textContent    = '';
    }, 3000);
  });

  /* ── Init publique (ré-ouverture) ── */
  window.initUpload = function () {
    files = [];
    if (fileList) fileList.innerHTML = '';
    if (sendBtn)  { sendBtn.style.display = 'none'; sendBtn.disabled = false; }
    if (status)   status.textContent = '';
  };

})();
