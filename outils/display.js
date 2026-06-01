/**
 * outils/display.js
 * Visualiseur cartographique multi-couches responsive.
 * Supporte le drag and drop d'un nombre illimité de GeoJSON et le requêtage du cloud Sheets.
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3yvNTl-aFgd7kAaSc2kyETuMfeUqIn4j2hnvKEs6dpGs7jNo4vMIdTFIGhpSyJm6c/exec';

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
  let layerControlList = []; // { id, name, color, leafletLayer, visible }
  let cloudFilesStorage = []; // Stockage global pour éviter la saturation HTML
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
        
        <div class="w-full lg:w-80 bg-gray-50 border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col h-48 lg:h-full p-4 space-y-3 overflow-y-auto shrink-0">
          <div class="space-y-2">
            <h4 class="font-bold text-gray-800 uppercase tracking-wider text-[10px]">Ajouter des calques</h4>
            
            <div id="disp-drop" class="border border-dashed border-gray-300 bg-white rounded-xl p-3 text-center relative cursor-pointer hover:bg-gray-50/80 transition-colors">
              <input type="file" id="disp-file-input" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" multiple accept=".geojson,.json" />
              <p class="text-gray-700 font-medium text-[11px]">📁 Déposer un ou plusieurs GeoJSON</p>
            </div>

            <button id="disp-cloud-btn" onclick="window.fetchDisplayCloud()" class="w-full bg-gray-900 text-white font-medium py-2 rounded-xl hover:bg-gray-800 transition-colors">
              ☁️ Importer depuis Google Sheets
            </button>
          </div>

          <div class="flex-1 pt-2 border-t border-gray-200">
            <h4 class="font-bold text-gray-400 uppercase tracking-wider text-[9px] mb-2">Couches actives</h4>
            <div id="active-layers-bucket" class="space-y-1.5">
              <p class="text-gray-400 italic text-center py-4 text-[11px]">Aucun calque affiché.</p>
            </div>
          </div>
        </div>

        <div class="flex-1 h-full relative">
          <div id="leaflet-display-map" class="w-full h-full bg-gray-100 z-10"></div>
        </div>

      </div>
    `;

    // Attente de la fin de l'animation de transition du Slot
    setTimeout(() => {
      initLeafletDisplay();
      setupDisplayDrop();
    }, 550);
  }

  function initLeafletDisplay() {
    if (mainMap) return;
    
    // Sécurité anti-asynchronisme : si Leaflet n'est pas encore téléchargé, on repousse de 100ms
    if (!window.L) {
      setTimeout(initLeafletDisplay, 100);
      return;
    }

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
      e.preventDefault();
      dropZone.classList.remove('bg-gray-100');
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
        try {
          const geojson = JSON.parse(e.target.result);
          injectGeoJsonLayer(geojson, file.name);
        } catch (err) {
          alert(`Fichier "${file.name}" corrompu ou non lisible.`);
        }
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
          radius: 6, fillColor: assignedColor, color: '#ffffff', weight: 1.5, fillOpacity: 0.8
        });
      },
      style: function () {
        return { color: assignedColor, weight: 2, fillColor: assignedColor, fillOpacity: 0.2 };
      },
      onEachFeature: function (feature, layer) {
        if (feature.properties) {
          const description = Object.keys(feature.properties)
            .map(k => `<strong>${k}:</strong> ${feature.properties[k]}`)
            .join('<br/>');
          layer.bindPopup(`<div class="text-[11px] leading-snug font-sans max-h-40 overflow-y-auto">${description || 'Aucun attribut'}</div>`);
        }
      }
    }).addTo(mainMap);

    const layerObject = {
      id: 'layer_' + Date.now() + Math.random().toString(36).slice(2, 7),
      name: layerName,
      color: assignedColor,
      leafletLayer: leafletGeoLayer,
      visible: true
    };

    layerControlList.push(layerObject);
    refreshLegendPanel();
    fitMapBounds();
  }

  function refreshLegendPanel() {
    const bucket = document.getElementById('active-layers-bucket');
    if (!bucket) return;

    if (layerControlList.length === 0) {
      bucket.innerHTML = `<p class="text-gray-400 italic text-center py-4 text-[11px]">Aucun calque affiché.</p>`;
      return;
    }

    bucket.innerHTML = layerControlList.map(lyr => `
      <div class="flex items-center justify-between p-2 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div class="flex items-center gap-2 overflow-hidden flex-1 pr-1">
          <span class="w-3 h-3 rounded-full shrink-0" style="background-color: ${lyr.color}"></span>
          <span class="font-medium text-gray-700 truncate block text-[11px]" title="${lyr.name}">${lyr.name}</span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button onclick="window.toggleLayerVisibility('${lyr.id}')" class="p-1 hover:bg-gray-100 rounded text-gray-500">
            ${lyr.visible ? '👁️' : '🙈'}
          </button>
          <button onclick="window.removeDisplayLayer('${lyr.id}')" class="p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded">
            ✕
          </button>
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
    if (bounds.isValid()) mainMap.fitBounds(bounds, { padding: [30, 30] });
  }

  // ── MODIFICATION SÉCURISÉE DE L'IMPORT CLOUD ──
  window.fetchDisplayCloud = function () {
    const btn = document.getElementById('disp-cloud-btn');
    btn.disabled = true;
    btn.textContent = 'Connexion au catalogue Cloud...';

    fetch(GOOGLE_SCRIPT_URL)
      .then(res => res.json())
      .then(files => {
        if (!files.length) {
          alert("L'onglet GeoJSON de votre Google Sheet est vide.");
          btn.disabled = false;
          btn.textContent = '☁️ Importer depuis Google Sheets';
          return;
        }

        // On bascule la sauvegarde dans la variable globale d'état
        cloudFilesStorage = files;

        const parent = btn.parentNode;
        const selectorWrap = document.createElement('div');
        selectorWrap.id = 'disp-cloud-picker-wrap';
        selectorWrap.className = 'space-y-1 pt-1';
        selectorWrap.innerHTML = `
          <label class="block font-medium text-gray-500 text-[10px]">Sélectionner une archive Cloud :</label>
          <select class="w-full p-1.5 bg-white border border-gray-300 rounded-lg text-xs focus:outline-none" onchange="window.handleCloudDisplayInject(this.value)">
            <option value="">-- Choisir la couche --</option>
            ${files.map((f, index) => `<option value="${index}">${f.fileName} (${f.sentAt})</option>`).join('')}
          </select>
          <button onclick="window.resetDisplayCloudBtn()" class="text-[10px] text-gray-400 underline block mt-1 hover:text-gray-600">Annuler</button>
        `;
        
        btn.classList.add('hidden');
        parent.appendChild(selectorWrap);
      })
      .catch(err => {
        alert("Erreur de communication : " + err.message);
        btn.disabled = false;
        btn.textContent = '☁️ Importer depuis Google Sheets';
      });
  };

  window.handleCloudDisplayInject = function (index) {
    if (index === "" || index === undefined) return;
    try {
      // Extraction directe depuis l'état mémoire de l'application via l'index numérique
      const targetArchive = cloudFilesStorage[parseInt(index)];
      const parsedGeo = typeof targetArchive.geojsonRaw === 'string' 
        ? JSON.parse(targetArchive.geojsonRaw) 
        : targetArchive.geojsonRaw;
      
      injectGeoJsonLayer(parsedGeo, `Cloud : ${targetArchive.fileName}`);
      window.resetDisplayCloudBtn();
    } catch (e) {
      alert("Erreur de parsing : impossible de lire la géométrie du fichier sélectionné.");
    }
  };

  window.resetDisplayCloudBtn = function () {
    const wrap = document.getElementById('disp-cloud-picker-wrap');
    const btn = document.getElementById('disp-cloud-btn');
    if (wrap) wrap.remove();
    if (btn) { btn.classList.remove('hidden'); btn.disabled = false; btn.textContent = '☁️ Importer depuis Google Sheets'; }
  };

  // Amorçage retardé
  setTimeout(() => {
    window.initDisplay();
  }, 500);

})();
