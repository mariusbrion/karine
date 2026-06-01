/**
 * outils/orga.js
 * Gestionnaire d'organisation cloud pour les couches cartographiques de la boîte à outils.
 * Permet le regroupement en dossiers (Colonne E), renommage, suppression et téléchargements.
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyl132O-cCNrE5H4AVHE2F7pCWO3bzq_r3Tz-MK562sOkd52XyS8auIga0p8h5Rrjkh/exec';

  const container = document.getElementById('orga-content');
  if (!container) return;

  let localFilesBackup = [];

  window.initOrga = function () {
    localFilesBackup = [];
    fetchAndRenderOrga();
  };

  function fetchAndRenderOrga() {
    container.innerHTML = `
      <div class="text-center py-12">
        <div class="animate-spin rounded-full h-7 w-7 border-b-2 border-gray-900 mx-auto mb-3"></div>
        <p class="text-xs text-gray-500">Synchronisation active avec le catalogue Google Sheet...</p>
      </div>
    `;

    fetch(GOOGLE_SCRIPT_URL)
      .then(res => res.json())
      .then(files => {
        localFilesBackup = files;
        renderOrgaTree(files);
      })
      .catch(err => {
        container.innerHTML = `
          <div class="p-4 bg-red-50 text-red-700 rounded-xl text-xs">
            ⚠️ Échec de la synchronisation : ${err.message}
          </div>
        `;
      });
  }

  function renderOrgaTree(files) {
    if (!files.length) {
      container.innerHTML = `
        <div class="text-center py-12 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
          <p class="text-xs text-gray-400 italic">Le catalogue cloud est vide. Déposez des fichiers dans le module 1 pour commencer.</p>
        </div>
      `;
      return;
    }

    const groups = {};
    files.forEach(f => {
      const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[folderName]) groups[folderName] = [];
      groups[folderName].push(f);
    });

    container.innerHTML = `
      <div class="space-y-4 text-xs" id="orga-tree-root">
        ${Object.keys(groups).map((folderName, fIdx) => {
          const folderItems = groups[folderName];
          const isUnclassified = folderName === "Fichiers non classés";
          
          return `
            <div class="border border-gray-200 bg-white rounded-xl overflow-hidden shadow-sm">
              
              <div class="flex items-center justify-between px-4 py-3 bg-gray-50/80 border-b border-gray-100 select-none">
                <div class="flex items-center gap-2 cursor-pointer flex-1" onclick="window.toggleFolderDOM('fold_body_${fIdx}')">
                  <span class="text-base" id="icon_fold_body_${fIdx}">📁</span>
                  <span class="font-semibold text-gray-800 text-[12px]">${folderName}</span>
                  <span class="bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px] font-medium">${folderItems.length}</span>
                </div>
                
                <div class="flex items-center gap-2">
                  <button onclick="window.downloadFolderLot(${fIdx}, '${folderName}')" class="text-[10px] bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-100 font-medium transition-colors">
                    📥 Tout télécharger
                  </button>
                </div>
              </div>

              <div id="fold_body_${fIdx}" class="divide-y divide-gray-100 hidden">
                ${folderItems.map((file, fileIdx) => {
                  const uniqueId = `file_${fIdx}_${fileIdx}`;
                  return `
                    <div class="p-3 bg-white space-y-2" id="wrapper_${uniqueId}">
                      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div class="space-y-0.5">
                          <p class="font-medium text-gray-800 text-[11px] break-all" id="name_display_${uniqueId}">${file.fileName}</p>
                          <p class="text-[10px] text-gray-400">Importé le ${file.sentAt} · <span class="text-gray-500 font-medium">${file.featureCount} entités</span></p>
                        </div>
                        
                        <div class="flex items-center gap-1.5 self-end sm:self-center">
                          <button onclick="window.openInlineEdit('${uniqueId}')" class="p-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 text-[10px] font-medium">✏️ Gérer</button>
                          <button onclick="window.downloadSingleFileCloud('${uniqueId}')" class="p-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 text-[10px] font-medium">📥 Ouvrir</button>
                          <button onclick="window.deleteFileCloud('${uniqueId}')" class="p-1 border border-red-100 bg-red-50/30 text-red-600 hover:bg-red-50 rounded text-[10px] font-medium">🗑️ Supprimer</button>
                        </div>
                      </div>

                      <div id="edit_form_${uniqueId}" class="hidden bg-gray-50 border border-gray-200/80 rounded-xl p-3 space-y-2.5">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label class="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Nom du calque :</label>
                            <input type="text" id="input_name_${uniqueId}" value="${file.fileName}" class="w-full p-1.5 border border-gray-200 bg-white rounded focus:outline-none focus:border-gray-400" />
                          </div>
                          <div>
                            <label class="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Dossier de rangement :</label>
                            <input type="text" id="input_fold_${uniqueId}" value="${isUnclassified ? '' : folderName}" placeholder="Ex: Mobilité, Enquêtes..." class="w-full p-1.5 border border-gray-200 bg-white rounded focus:outline-none focus:border-gray-400" />
                          </div>
                        </div>
                        <div class="flex justify-end gap-2 text-[10px]">
                          <button onclick="window.closeInlineEdit('${uniqueId}')" class="text-gray-500 hover:underline px-2">Annuler</button>
                          <button onclick="window.submitEditCloud('${uniqueId}', ${fIdx}, ${fileIdx})" class="bg-gray-900 text-white px-3 py-1 rounded font-medium hover:bg-gray-800">Sauvegarder</button>
                        </div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>

            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  window.toggleFolderDOM = function (id) {
    const el = document.getElementById(id);
    const icon = document.getElementById('icon_' + id);
    if (el.classList.contains('hidden')) { el.classList.remove('hidden'); icon.textContent = '📂'; }
    else { el.classList.add('hidden'); icon.textContent = '📁'; }
  };

  window.openInlineEdit = function (uid) { document.getElementById('edit_form_' + uid).classList.remove('hidden'); };
  window.closeInlineEdit = function (uid) { document.getElementById('edit_form_' + uid).classList.add('hidden'); };

  window.submitEditCloud = function (uid, folderIndex, fileIndex) {
    const groups = {};
    localFilesBackup.forEach(f => {
      const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[folderName]) groups[folderName] = []; groups[folderName].push(f);
    });

    const folderKey = Object.keys(groups)[folderIndex];
    const targetFile = groups[folderKey][fileIndex];

    const newName = document.getElementById(`input_name_${uid}`).value.trim();
    const newFolder = document.getElementById(`input_fold_${uid}`).value.trim();

    if (!newName) { alert("Le nom du fichier ne peut pas être vide."); return; }

    // Remplacement par un écran de verrouillage visuel pendant le délai de commit Google
    container.innerHTML = `
      <div class="text-center py-12">
        <div class="animate-spin rounded-full h-7 w-7 border-b-2 border-gray-900 mx-auto mb-3"></div>
        <p class="text-xs text-emerald-600 font-medium">Mutation prise en compte ! Alignement du serveur cloud...</p>
      </div>
    `;

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        fileName: targetFile.fileName,
        sentAt: targetFile.sentAt,
        newFileName: newName,
        folder: newFolder
      })
    })
    .then(() => {
      // Temporisation forcée de 2000ms : laisse le temps à Google de consigner le changement avant le GET
      setTimeout(fetchAndRenderOrga, 2000);
    })
    .catch(err => { alert(err.message); fetchAndRenderOrga(); });
  };

  window.deleteFileCloud = function (uid) {
    if (!confirm("Supprimer définitivement ce calque de la base Cloud ?")) return;

    const parts = uid.split('_');
    const fIdx = parseInt(parts[1]);
    const fileIdx = parseInt(parts[2]);

    const groups = {};
    localFilesBackup.forEach(f => {
      const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[folderName]) groups[folderName] = []; groups[folderName].push(f);
    });

    const folderKey = Object.keys(groups)[fIdx];
    const targetFile = groups[folderKey][fileIdx];

    container.innerHTML = `
      <div class="text-center py-12">
        <div class="animate-spin rounded-full h-7 w-7 border-b-2 border-gray-900 mx-auto mb-3"></div>
        <p class="text-xs text-red-600 font-medium">Suppression transmise ! Réorganisation du catalogue en cours...</p>
      </div>
    `;

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        fileName: targetFile.fileName,
        sentAt: targetFile.sentAt
      })
    })
    .then(() => {
      // Temporisation forcée de 2000ms pour parer la latence du commit Google
      setTimeout(fetchAndRenderOrga, 2000);
    })
    .catch(err => { alert(err.message); fetchAndRenderOrga(); });
  };

  window.downloadSingleFileCloud = function (uid) {
    const parts = uid.split('_');
    const fIdx = parseInt(parts[1]);
    const fileIdx = parseInt(parts[2]);
    const groups = {};
    localFilesBackup.forEach(f => {
      const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[folderName]) groups[folderName] = []; groups[folderName].push(f);
    });
    const folderKey = Object.keys(groups)[fIdx];
    const targetFile = groups[folderKey][fileIdx];
    try {
      const parsed = typeof targetFile.geojsonRaw === 'string' ? JSON.parse(targetFile.geojsonRaw) : targetFile.geojsonRaw;
      triggerBlobDownload(parsed, targetFile.fileName);
    } catch (e) { alert("Erreur de parsing."); }
  };

  window.downloadFolderLot = function (folderIndex, folderName) {
    const groups = {};
    localFilesBackup.forEach(f => {
      const name = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[name]) groups[name] = []; groups[name].push(f);
    });
    const targetItems = groups[folderName];
    if (!targetItems || !targetItems.length) return;
    const consolidatedFeatures = [];
    targetItems.forEach(item => {
      try {
        const parsed = typeof item.geojsonRaw === 'string' ? JSON.parse(item.geojsonRaw) : item.geojsonRaw;
        if (parsed.type === 'FeatureCollection' && parsed.features) consolidatedFeatures.push(...parsed.features);
        else if (parsed.type === 'Feature') consolidatedFeatures.push(parsed);
      } catch (e) {}
    });
    if (!consolidatedFeatures.length) { alert("Aucune entité valide."); return; }
    triggerBlobDownload({ type: "FeatureCollection", folder_metadata: folderName, features: consolidatedFeatures }, `Dossier_${folderName.replace(/\s+/g, '_')}.geojson`);
  };

  function triggerBlobDownload(jsonObj, filename) {
    const blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url;
    a.download = filename.endsWith('.geojson') ? filename : filename + '.geojson';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  setTimeout(() => { window.initOrga(); }, 500);
})();
