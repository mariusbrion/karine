/**
 * outils/display.js
 * Visualiseur cartographique multi-couches responsive.
 * Supporte le drag and drop multi-fichiers et l'importation Cloud structurée en dossiers.
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz1kvkUwAEwD-3Bc9SZqACaaZTVGhhGy_Om-F8vK0adfC5pBCg5amBNUEqSeteKJIrV/exec';

  // ── INJECTION SÉCURISÉE DE LEAFLET ──
  if (!document.getElementById('leaflet-css')) {
    const l = document.createElement('link');
    l.id = 'leaflet-css';
    l.rel = 'stylesheet';
    l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(l);
  }
  if (!window.L) {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    document.head.appendChild(s);
  }

  const container = document.getElementById('display-content');
  if (!container) return;

  // Variables d'état
  let mainMap = null;
  let layerControlList = []; 
  let cloudFilesStorage = []; // Cache mémoire des fichiers récupérés du Cloud
  const layerColors = ['#1a1a1a', '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6366F1'];
  let colorIndex = 0;

  window.initDisplay = function () {
    layerControlList = [];
    cloudFilesStorage = [];
    colorIndex = 0;
    if (mainMap) { mainMap.remove(); mainMap = null; }
    buildResponsiveLayout();
  };

  function buildResponsiveLayout() {
    container.innerHTML = `
      <div class="flex flex-col lg:flex-row h-[560px] w-full text-xs overflow-hidden">
        
        <div class="w-full lg:w-80 bg-gray-50 border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col h-56 lg:h-full p-4 space-y-3 overflow-y-auto shrink-0">
          <div class="space-y-2" id="display-import-zone">
            <h4 class="font-bold text-gray-800 uppercase tracking-wider text-[10px]">Ajouter des calques</h4>
            
            <div id="disp-drop" class="border border-dashed border-gray-300 bg-white rounded-xl p-2.5 text-center relative cursor-pointer hover:bg-gray-50/80 transition-colors">
              <input type="file" id="disp-file-input" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" multiple accept=".geojson,.json" />
              <p class="text-gray-700 font-medium text-[11px]">📁 Déposer des GeoJSON locaux</p>
            </div>

            <button id="disp-cloud-btn" onclick="window.fetchDisplayCloud()" class="w-full bg-gray-900 text-white font-medium py-2 rounded-xl hover:bg-gray-800 transition-colors">
              ☁️ Importer depuis Google Sheets
            </button>
          </div>

          <div class="flex-1 pt-2 border-t border-gray-200 flex flex-col overflow-hidden">
            <h4 class="font-bold text-gray-400 uppercase tracking-wider text-[9px] mb-2 shrink-0">Couches chargées sur la carte</h4>
            <div id="active-layers-bucket" class="space-y-1.5 flex-1 overflow-y-auto pr-0.5">
              <p class="text-gray-400 italic text-center py-4 text-[11px]">Aucun calque affiché.</p>
            </div>
          </div>
        </div>

        <div class="flex-1 h-full relative">
          <div id="leaflet-display-map" class="w-full h-full bg-gray-100 z-10"></div>
        </div>

      </div>
    `;

    setTimeout(() => {
      initLeafletDisplay();
      setupDisplayDrop();
    }, 550);
  }

  function initLeafletDisplay() {
    if (mainMap) return;
    if (!window.L) { setTimeout(initLeafletDisplay, 100); return; }

    mainMap = L.map('leaflet-display-map').setView([46.603354, 1.888334], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(mainMap);

    mainMap.invalidateSize();
  }

  function setupDisplayDrop() {
    const dropZone = document.getElementById('disp-drop');
    const input = document.getElementById('disp-file-input');

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('bg-gray-100'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('bg-gray-100'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('bg-gray-100');
      if (e.dataTransfer.files.length) handleMultipleFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', e => {
      if (input.files.length) handleMultipleFiles(input.files);
      input.value = '';
    });
  }

  function handleMultipleFiles(fileList) {
    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        try { injectGeoJsonLayer(JSON.parse(e.target.result), file.name); } 
        catch (err) { alert(`Erreur de lecture sur ${file.name}`); }
      };
      reader.readAsText(file);
    });
  }

  function injectGeoJsonLayer(geojson, layerName) {
    const assignedColor = layerColors[colorIndex % layerColors.length];
    colorIndex++;

    const leafletGeoLayer = L.geoJSON(geojson, {
      pointToLayer: function (feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 5.5, fillColor: assignedColor, color: '#ffffff', weight: 1.2, fillOpacity: 0.85
        });
      },
      style: function () {
        return { color: assignedColor, weight: 1.8, fillColor: assignedColor, fillOpacity: 0.15 };
      },
      onEachFeature: function (feature, layer) {
        if (feature.properties) {
          const description = Object.keys(feature.properties)
            .map(k => `<strong>${k}:</strong> ${feature.properties[k]}`)
            .join('<br/>');
          layer.bindPopup(`<div class="text-[10px] leading-snug font-sans max-h-36 overflow-y-auto">${description || 'Aucun attribut'}</div>`);
        }
      }
    }).addTo(mainMap);

    layerControlList.push({
      id: 'layer_' + Date.now() + Math.random().toString(36).slice(2, 7),
      name: layerName,
      color: assignedColor,
      leafletLayer: leafletGeoLayer,
      visible: true
    });

    refreshLegendPanel();
  }

  function refreshLegendPanel() {
    const bucket = document.getElementById('active-layers-bucket');
    if (!bucket) return;

    if (layerControlList.length === 0) {
      bucket.innerHTML = `<p class="text-gray-400 italic text-center py-4 text-[11px]">Aucun calque affiché.</p>`;
      return;
    }

    bucket.innerHTML = layerControlList.map(lyr => `
      <div class="flex items-center justify-between p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div class="flex items-center gap-1.5 overflow-hidden flex-1">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${lyr.color}"></span>
          <span class="font-medium text-gray-700 truncate block text-[11px]" title="${lyr.name}">${lyr.name}</span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button onclick="window.toggleLayerVisibility('${lyr.id}')" class="p-0.5 hover:bg-gray-100 rounded text-gray-500">${lyr.visible ? '👁️' : '🙈'}</button>
          <button onclick="window.removeDisplayLayer('${lyr.id}')" class="p-0.5 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded">✕</button>
        </div>
      </div>
    `).join('');
  }

  window.toggleLayerVisibility = function (id) {
    const lyr = layerControlList.find(l => l.id === id);
    if (!lyr) return;
    if (lyr.visible) { mainMap.removeLayer(lyr.leafletLayer); lyr.visible = false; }
    else { mainMap.addLayer(lyr.leafletLayer); lyr.visible = true; }
    refreshLegendPanel();
  };

  window.removeDisplayLayer = function (id) {
    const idx = layerControlList.findIndex(l => l.id === id);
    if (idx === -1) return;
    mainMap.removeLayer(layerControlList[idx].leafletLayer);
    layerControlList.splice(idx, 1);
    refreshLegendPanel();
    fitMapBounds();
  };

  function fitMapBounds() {
    const activeLayers = layerControlList.filter(l => l.visible);
    if (activeLayers.length === 0) return;
    const bounds = L.latLngBounds();
    activeLayers.forEach(lyr => bounds.extend(lyr.leafletLayer.getBounds()));
    if (bounds.isValid()) mainMap.fitBounds(bounds, { padding: [25, 25] });
  }

  // ── SÉLECTION CLOUD PAR STRATE DE DOSSIERS INTERACTIFS ──
  window.fetchDisplayCloud = function () {
    const btn = document.getElementById('disp-cloud-btn');
    btn.disabled = true; btn.textContent = 'Téléchargement de l\'arbre...';

    fetch(GOOGLE_SCRIPT_URL)
      .then(res => res.json())
      .then(files => {
        if (!files.length) {
          alert("Votre catalogue Cloud est vide.");
          window.resetDisplayCloudBtn(); return;
        }

        cloudFilesStorage = files; // Stockage indexé

        // Structuration des groupes de dossiers
        const groups = {};
        files.forEach((f, globalIdx) => {
          const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
          if (!groups[folderName]) groups[folderName] = [];
          groups[folderName].push({ data: f, index: globalIdx });
        });

        const parent = btn.parentNode;
        const selectorWrap = document.createElement('div');
        selectorWrap.id = 'disp-cloud-picker-wrap';
        selectorWrap.className = 'space-y-2 pt-1.5 max-h-60 overflow-y-auto border-t border-gray-200 mt-2';
        
        selectorWrap.innerHTML = `
          <div class="flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">
            <span>Arbre Cloud</span>
            <button onclick="window.resetDisplayCloudBtn()" class="text-red-500 underline lowercase normal-case font-normal text-[11px]">Annuler</button>
          </div>
          
          <div class="space-y-1.5">
            ${Object.keys(groups).map((folderName, fIdx) => {
              const items = groups[folderName];
              return `
                <div class="border border-gray-200 bg-white rounded-lg overflow-hidden">
                  <div class="flex items-center justify-between px-2.5 py-1.5 bg-gray-100/70 select-none">
                    <div class="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0" onclick="window.toggleCloudDispFolderDOM('c_fold_${fIdx}')">
                      <span id="c_icon_fold_${fIdx}">📁</span>
                      <span class="font-semibold text-gray-700 truncate text-[11px]">${folderName}</span>
                    </div>
                    <button onclick="window.loadCloudFolderToMap('${encodeURIComponent(folderName)}')" class="text-[9px] bg-gray-900 text-white font-medium px-1.5 py-0.5 rounded hover:bg-gray-800 shrink-0 ml-1">
                      ⚡ charger tout
                    </button>
                  </div>
                  
                  <div id="c_fold_${fIdx}" class="divide-y divide-gray-50 hidden bg-white">
                    ${items.map(item => `
                      <div class="p-2 flex items-center justify-between gap-2 hover:bg-gray-50/60">
                        <div class="min-w-0">
                          <p class="font-medium text-gray-800 text-[10px] truncate" title="${item.data.fileName}">${item.data.fileName}</p>
                          <p class="text-[9px] text-gray-400">${item.data.featureCount} entités</p>
                        </div>
                        <button onclick="window.loadCloudFileToMap(${item.index})" class="text-[10px] text-blue-600 font-medium hover:underline shrink-0">
                          ➕ ajouter
                        </button>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
        
        btn.classList.add('hidden');
        parent.appendChild(selectorWrap);
      })
      .catch(err => { alert(err.message); window.resetDisplayCloudBtn(); });
  };

  window.toggleCloudDispFolderDOM = function (id) {
    const el = document.getElementById(id);
    const icon = document.getElementById('icon_' + id);
    if (el.classList.contains('hidden')) { el.classList.remove('hidden'); icon.textContent = '📂'; }
    else { el.classList.add('hidden'); icon.textContent = '📁'; }
  };

  // Chargement d'une couche unique
  window.loadCloudFileToMap = function (globalIndex) {
    try {
      const archive = cloudFilesStorage[globalIndex];
      const geojson = typeof archive.geojsonRaw === 'string' ? JSON.parse(archive.geojsonRaw) : archive.geojsonRaw;
      injectGeoJsonLayer(geojson, archive.fileName);
      fitMapBounds();
    } catch (e) { alert("Erreur lors de l'intégration de la couche."); }
  };

  // Chargement en bloc de l'intégralité d'un dossier
  window.loadCloudFolderToMap = function (encodedFolderName) {
    const targetFolder = decodeURIComponent(encodedFolderName);
    let loadedCount = 0;

    cloudFilesStorage.forEach(archive => {
      const fileFolder = archive.folder && archive.folder.trim() !== "" ? archive.folder.trim() : "Fichiers non classés";
      if (fileFolder === targetFolder) {
        try {
          const geojson = typeof archive.geojsonRaw === 'string' ? JSON.parse(archive.geojsonRaw) : archive.geojsonRaw;
          injectGeoJsonLayer(geojson, archive.fileName);
          loadedCount++;
        } catch(e) { console.warn(`Échec de chargement sur : ${archive.fileName}`); }
      }
    });

    if (loadedCount > 0) {
      fitMapBounds(); // Recadrage global unique une fois toutes les couches injectées
      alert(`Dossier "${targetFolder}" : ${loadedCount} calques intégrés simultanément.`);
    }
  };

  window.resetDisplayCloudBtn = function () {
    const wrap = document.getElementById('disp-cloud-picker-wrap');
    const btn = document.getElementById('disp-cloud-btn');
    if (wrap) wrap.remove();
    if (btn) { btn.classList.remove('hidden'); btn.disabled = false; btn.textContent = '☁️ Importer depuis Google Sheets'; }
  };

  setTimeout(() => { window.initDisplay(); }, 500);
})();
