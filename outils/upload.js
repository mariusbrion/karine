/**
 * outils/upload.js
 * Injecté dynamiquement dans index.html quand on ouvre l'outil "J'ai un fichier à déposer".
 * Ajoute la zone de dépôt dans #upload-content et gère toute la logique d'upload.
 */

(function () {
  /* ── Styles spécifiques à l'outil ── */
  const style = document.createElement('style');
  style.textContent = `
    /* Drop zone */
    #drop-zone {
      border: 1.5px dashed #D8D8D4;
      border-radius: 12px;
      padding: 40px 24px;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      background: #FAFAF9;
      position: relative;
    }
    #drop-zone:hover,
    #drop-zone.dragover {
      border-color: #A0A09A;
      background: #F4F4F1;
    }
    #drop-zone input[type="file"] {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      width: 100%;
      height: 100%;
    }
    .drop-emoji {
      font-size: 2rem;
      line-height: 1;
      margin-bottom: 10px;
      display: block;
      transition: transform 0.2s;
    }
    #drop-zone:hover .drop-emoji,
    #drop-zone.dragover .drop-emoji {
      transform: scale(1.15) translateY(-2px);
    }
    .drop-hint {
      font-size: 0.8125rem;
      color: #9E9E98;
      margin-top: 6px;
    }
    .drop-title {
      font-size: 0.9375rem;
      font-weight: 500;
      color: #3a3a38;
    }

    /* File list */
    #file-list {
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .file-row {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #fff;
      border: 1px solid #EAEAE6;
      border-radius: 10px;
      padding: 10px 14px;
      animation: fadeUp 0.3s ease both;
    }
    .file-icon {
      font-size: 1.25rem;
      flex-shrink: 0;
    }
    .file-meta {
      flex: 1;
      overflow: hidden;
    }
    .file-name {
      font-size: 0.8125rem;
      font-weight: 500;
      color: #2a2a28;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-size {
      font-size: 0.6875rem;
      color: #B0B0A8;
      margin-top: 1px;
    }
    .file-remove {
      background: none;
      border: none;
      cursor: pointer;
      color: #C8C8C0;
      font-size: 1rem;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }
    .file-remove:hover { color: #888; background: #F0F0EC; }

    /* Progress bar */
    .file-progress-wrap {
      width: 100%;
      height: 3px;
      background: #F0F0EC;
      border-radius: 99px;
      margin-top: 6px;
      overflow: hidden;
    }
    .file-progress-bar {
      height: 100%;
      border-radius: 99px;
      background: #3a3a38;
      width: 0%;
      transition: width 0.4s ease;
    }
    .file-progress-bar.done { background: #52c48a; }

    /* Send button */
    #upload-send-btn {
      margin-top: 18px;
      width: 100%;
      padding: 11px;
      border-radius: 10px;
      border: none;
      background: #1a1a1a;
      color: #fafaf9;
      font-family: 'DM Sans', sans-serif;
      font-size: 0.875rem;
      font-weight: 500;
      letter-spacing: 0.01em;
      cursor: pointer;
      transition: background 0.2s, transform 0.15s;
      display: none;
    }
    #upload-send-btn:hover  { background: #333330; transform: translateY(-1px); }
    #upload-send-btn:active { transform: translateY(0); }

    /* Status message */
    #upload-status {
      margin-top: 12px;
      font-size: 0.8125rem;
      text-align: center;
      color: #9E9E98;
      min-height: 20px;
      transition: opacity 0.3s;
    }
  `;
  document.head.appendChild(style);

  /* ── HTML injecté dans #upload-content ── */
  const container = document.getElementById('upload-content');
  if (!container) return;

  container.innerHTML = `
    <div id="drop-zone">
      <input type="file" id="file-input" multiple accept="*/*" />
      <span class="drop-emoji">📎</span>
      <p class="drop-title">Glisse tes fichiers ici</p>
      <p class="drop-hint">ou clique pour parcourir · tous formats acceptés</p>
    </div>

    <div id="file-list"></div>
    <button id="upload-send-btn">Envoyer les fichiers →</button>
    <p id="upload-status"></p>
  `;

  /* ── Logique ── */
  const dropZone  = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileList  = document.getElementById('file-list');
  const sendBtn   = document.getElementById('upload-send-btn');
  const status    = document.getElementById('upload-status');

  let files = []; // { file, id }

  const FILE_ICONS = {
    'pdf':  '📄', 'doc': '📝', 'docx': '📝',
    'xls':  '📊', 'xlsx': '📊', 'csv': '📊',
    'ppt':  '📑', 'pptx': '📑',
    'jpg':  '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'svg': '🖼️',
    'zip':  '🗜️', 'rar': '🗜️', '7z': '🗜️',
    'mp4':  '🎬', 'mov': '🎬', 'mp3': '🎵', 'wav': '🎵',
    'js':   '💻', 'ts': '💻', 'html': '💻', 'css': '💻', 'json': '💻', 'py': '💻',
  };

  function extIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return FILE_ICONS[ext] || '📁';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  }

  function addFiles(newFiles) {
    Array.from(newFiles).forEach(file => {
      const id = 'f_' + Date.now() + Math.random().toString(36).slice(2);
      files.push({ file, id });
      renderFileRow({ file, id });
    });
    updateSendBtn();
  }

  function renderFileRow({ file, id }) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.id = 'row_' + id;
    row.innerHTML = `
      <span class="file-icon">${extIcon(file.name)}</span>
      <div class="file-meta">
        <p class="file-name">${file.name}</p>
        <p class="file-size">${formatBytes(file.size)}</p>
        <div class="file-progress-wrap" style="display:none">
          <div class="file-progress-bar" id="bar_${id}"></div>
        </div>
      </div>
      <button class="file-remove" title="Retirer" onclick="removeFile('${id}')">✕</button>
    `;
    fileList.appendChild(row);
  }

  window.removeFile = function(id) {
    files = files.filter(f => f.id !== id);
    const row = document.getElementById('row_' + id);
    if (row) row.remove();
    updateSendBtn();
  };

  function updateSendBtn() {
    sendBtn.style.display = files.length > 0 ? 'block' : 'none';
    status.textContent = '';
  }

  /* Drag & drop */
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

  /* Simulated upload with progress */
  sendBtn.addEventListener('click', () => {
    if (!files.length) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Envoi en cours…';
    status.textContent = '';

    let completed = 0;
    const total = files.length;

    files.forEach(({ id }) => {
      const wrap = document.querySelector(`#row_${id} .file-progress-wrap`);
      const bar  = document.getElementById('bar_' + id);
      if (wrap) wrap.style.display = 'block';

      // Simulate progress
      let pct = 0;
      const tick = setInterval(() => {
        pct += Math.random() * 18 + 6;
        if (pct >= 100) {
          pct = 100;
          clearInterval(tick);
          if (bar) bar.classList.add('done');
          completed++;
          if (completed === total) onAllDone();
        }
        if (bar) bar.style.width = Math.min(pct, 100) + '%';
      }, 120);
    });
  });

  function onAllDone() {
    sendBtn.textContent = '✓ Envoyé !';
    status.textContent  = `${files.length} fichier${files.length > 1 ? 's' : ''} déposé${files.length > 1 ? 's' : ''} avec succès.`;

    setTimeout(() => {
      files = [];
      fileList.innerHTML = '';
      sendBtn.disabled = false;
      sendBtn.style.display = 'none';
      sendBtn.textContent = 'Envoyer les fichiers →';
      status.textContent  = '';
    }, 2200);
  }

  /* Public init hook (called if script already loaded on re-open) */
  window.initUpload = function () {
    files = [];
    if (fileList) fileList.innerHTML = '';
    if (sendBtn)  sendBtn.style.display = 'none';
    if (status)   status.textContent = '';
  };

})();
