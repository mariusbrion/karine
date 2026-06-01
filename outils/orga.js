/**
 * outils/orga.js
 * Gestionnaire d'organisation cloud pour les couches cartographiques de la boîte à outils.
 * Permet le regroupement en dossiers (Colonne E), renommage, suppression et téléchargements.
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz1kvkUwAEwD-3Bc9SZqACaaZTVGhhGy_Om-F8vK0adfC5pBCg5amBNUEqSeteKJIrV/exec';

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
        <p class="text-xs text-gray-500">Synchronisation avec le catalogue Google Sheet...</p>
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

    // Regroupement par dossier
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
                  <button onclick="window.downloadFolderLot(${fIdx}, '${folderName}')" class="text-[10px] bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded hover:bg-gray-100 font-medium transition-colors" title="Télécharger tout le dossier fusionné">
                    📥 Tout télécharger
                  </button>
                </div>
              </div>

              <div id="fold_body_${fIdx}" class="divide-y divide-gray-100 hidden">
                ${folderItems.map((file, fileIdx) => {
                  // Génération d'un identifiant unique local basé sur les index
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

                      <div id="edit_form_${uniqueId}" class="hidden bg-gray-50 border border-gray-200/80 rounded-xl p-3 space-y-2.5 animate-fadeUp">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label class="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Nom du calque :</label>
                            <input type="text" id="input_name_${uniqueId}" value="${file.fileName}" class="w-full p-1.5 border border-gray-200 bg-white rounded focus:outline-none focus:border-gray-400" />
                          </div>
                          <div>
                            <label class="block text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Dossier de rangement :</label>
                            <input type="text" id="input_fold_${uniqueId}" value="${isUnclassified ? '' : folderName}" placeholder="Ex: Mobilité, Espaces Publics..." class="w-full p-1.5 border border-gray-200 bg-white rounded focus:outline-none focus:border-gray-400" />
                          </div>
                        </div>
                        <div class="flex justify-end gap-2 text-[10px]">
                          <button onclick="window.closeInlineEdit('${uniqueId}')" class="text-gray-500 hover:underline px-2">Annuler</button>
                          <button onclick="window.submitEditCloud('${uniqueId}', ${fIdx}, ${fileIdx})" class="bg-gray-900 text-white px-3 py-1 rounded font-medium hover:bg-gray-800">Sauvegarder les mutations</button>
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

  // Toggle d'ouverture des dossiers
  window.toggleFolderDOM = function (id) {
    const el = document.getElementById(id);
    const icon = document.getElementById('icon_' + id);
    if (el.classList.contains('hidden')) {
      el.classList.remove('hidden');
      icon.textContent = '📂';
    } else {
      el.classList.add('hidden');
      icon.textContent = '📁';
    }
  };

  // Gestion de l'édition en ligne (sans prompt)
  window.openInlineEdit = function (uid) {
    document.getElementById('edit_form_' + uid).classList.remove('hidden');
  };
  window.closeInlineEdit = function (uid) {
    document.getElementById('edit_form_' + uid).classList.add('hidden');
  };

  // Envoi des mutations (Mutation de nom et/ou transfert de dossier)
  window.submitEditCloud = function (uid, folderIndex, fileIndex) {
    // Reconstruction de la référence globale
    const groups = {};
    localFilesBackup.forEach(f => {
      const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[folderName]) groups[folderName] = [];
      groups[folderName].push(f);
    });

    const folderKey = Object.keys(groups)[folderIndex];
    const targetFile = groups[folderKey][fileIndex];

    const newName = document.getElementById(`input_name_${uid}`).value.trim();
    const newFolder = document.getElementById(`input_fold_${uid}`).value.trim();

    if (!newName) { alert("Le nom du fichier ne peut pas être vide."); return; }

    const submitBtn = document.querySelector(`#edit_form_${uid} button[onclick*="submitEditCloud"]`);
    submitBtn.disabled = true; submitBtn.textContent = 'Mise à jour...';

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        fileName: targetFile.fileName,
        sentAt: targetFile.sentAt,
        newFileName: newName,
        folder: newFolder
      })
    })
    .then(() => {
      alert("Fichier mis à jour !");
      fetchAndRenderOrga(); // Rechargement et synchronisation
    })
    .catch(err => { alert(err.message); submitBtn.disabled = false; submitBtn.textContent = 'Sauvegarder'; });
  };

  // Suppression physique d'un fichier du Google Sheet
  window.deleteFileCloud = function (uid) {
    if (!confirm("Voulez-vous vraiment supprimer définitivement ce calque du cloud ? Cette action est irréversible.")) return;

    // Analyse des index pour cibler l'objet
    const parts = uid.split('_');
    const fIdx = parseInt(parts[1]);
    const fileIdx = parseInt(parts[2]);

    const groups = {};
    localFilesBackup.forEach(f => {
      const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[folderName]) groups[folderName] = [];
      groups[folderName].push(f);
    });

    const folderKey = Object.keys(groups)[fIdx];
    const targetFile = groups[folderKey][fileIdx];

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        fileName: targetFile.fileName,
        sentAt: targetFile.sentAt
      })
    })
    .then(() => {
      alert("Calque effacé du cloud.");
      fetchAndRenderOrga();
    })
    .catch(err => alert("Erreur lors de la suppression : " + err.message));
  };

  // Télécharger une couche unique GeoJSON
  window.downloadSingleFileCloud = function (uid) {
    const parts = uid.split('_');
    const fIdx = parseInt(parts[1]);
    const fileIdx = parseInt(parts[2]);

    const groups = {};
    localFilesBackup.forEach(f => {
      const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[folderName]) groups[folderName] = [];
      groups[folderName].push(f);
    });

    const folderKey = Object.keys(groups)[fIdx];
    const targetFile = groups[folderKey][fileIdx];

    try {
      const parsed = typeof targetFile.geojsonRaw === 'string' ? JSON.parse(targetFile.geojsonRaw) : targetFile.geojsonRaw;
      triggerBlobDownload(parsed, targetFile.fileName);
    } catch (e) { alert("Impossible de parser le GeoJSON de ce fichier."); }
  };

  // Télécharger TOUT UN DOSSIER (Compilation et fusion en une FeatureCollection unique)
  window.downloadFolderLot = function (folderIndex, folderName) {
    const groups = {};
    localFilesBackup.forEach(f => {
      const name = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
      if (!groups[name]) groups[name] = [];
      groups[name].push(f);
    });

    const targetItems = groups[folderName];
    if (!targetItems || !targetItems.length) return;

    const consolidatedFeatures = [];

    targetItems.forEach(item => {
      try {
        const parsed = typeof item.geojsonRaw === 'string' ? JSON.parse(item.geojsonRaw) : item.geojsonRaw;
        if (parsed.type === 'FeatureCollection' && parsed.features) {
          consolidatedFeatures.push(...parsed.features);
        } else if (parsed.type === 'Feature') {
          consolidatedFeatures.push(parsed);
        }
      } catch (e) { console.warn(`Fichier sauté lors de la fusion : ${item.fileName}`); }
    });

    if (consolidatedFeatures.length === 0) {
      alert("Aucune entité géométrique valide n'a pu être consolidée pour ce dossier.");
      return;
    }

    const mergedGeoJSON = {
      type: "FeatureCollection",
      folder_metadata: folderName,
      features: consolidatedFeatures
    };

    triggerBlobDownload(mergedGeoJSON, `Dossier_${folderName.replace(/\s+/g, '_')}.geojson`);
  };

  function triggerBlobDownload(jsonObj, filename) {
    const blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename.endsWith('.geojson') ? filename : filename + '.geojson';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Amorçage au chargement
  setTimeout(() => {
    window.initOrga();
  }, 500);

})();
