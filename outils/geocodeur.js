/**
 * outils/geocodeur.js
 * Géocodeur de fichiers CSV basé sur l'API Batch de la Base Adresse Nationale (BAN).
 * Gestion des échecs via curseur de confiance, lien Google Maps et carte Leaflet interactive.
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3yvNTl-aFgd7kAaSc2kyETuMfeUqIn4j2hnvKEs6dpGs7jNo4vMIdTFIGhpSyJm6c/exec';

  // Chargement dynamique des dépendances
  if (!window.Papa) {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';
    document.head.appendChild(s);
  }
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

  // Styles locaux spécifiques au géocodeur
  if (!document.getElementById('geo-tool-styles')) {
    const style = document.createElement('style');
    style.id = 'geo-tool-styles';
    style.textContent = `
      .geo-drop-zone { border: 1.5px dashed #D8D8D4; background: #FAFAF9; transition: all 0.2s; cursor: pointer; }
      .geo-drop-zone:hover, .geo-drop-zone.dragover { border-color: #A0A09A; background: #F4F4F1; }
      .column-checkbox:checked + label { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
      .notif-card { border: 1px solid #EAEAE6; background: #fff; transition: border-color 0.2s, box-shadow 0.2s; }
      .notif-card:hover { border-color: #B0B0A8; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
      .notif-card.active { border-color: #3a3a38; background: #FAFAF9; box-shadow: inset 3px 0 0 #1a1a1a; }
    `;
    document.head.appendChild(style);
  }

  const container = document.getElementById('geocodeur-content');
  if (!container) return;

  // Variables d'état globales pour l'outil
  let csvHeaders = [];
  let csvRowsPreview = [];
  let currentFile = null;
  let geocodedResults = []; 
  let mapInstance = null;
  let mapMarker = null;
  let activeFixIndex = null;

  // Écran initial : Dépôt de fichier
  window.initGeocodeur = function () {
    csvHeaders = []; csvRowsPreview = []; currentFile = null; geocodedResults = [];
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }
    showUploadStep();
  };

  function showUploadStep() {
    container.innerHTML = `
      <div id="geo-drop" class="geo-drop-zone rounded-xl p-8 text-center relative mb-6">
        <input type="file" id="geo-file-input" class="absolute inset-0 opacity-0 cursor-pointer w-100 h-100" accept=".csv" />
        <span class="text-3xl block mb-2">📍</span>
        <p class="text-sm font-medium text-gray-700">Glisse ton fichier CSV ici</p>
        <p class="text-xs text-gray-400 mt-1">ou clique pour parcourir les dossiers</p>
      </div>

      <div class="bg-amber-50/60 border border-amber-100 rounded-xl p-4 text-xs text-amber-800 leading-relaxed">
        <p class="font-semibold mb-1">💡 Comment générer un fichier .csv propre depuis Excel ?</p>
        <ol class="list-decimal pl-4 space-y-1 text-gray-600">
          <li>Dans votre classeur Excel, cliquez sur le menu <strong class="text-gray-800">Fichier</strong> puis <strong class="text-gray-800">Enregistrer sous</strong>.</li>
          <li>Sélectionnez l'emplacement de sauvegarde, puis ouvrez le menu déroulant des formats.</li>
          <li>Choisissez l'option <strong class="text-gray-800">CSV (séparateur : point-virgule) (*.csv)</strong> ou <strong class="text-gray-800">CSV UTF-8 (séparateur : virgule)</strong>.</li>
          <li>Cliquez sur <strong class="text-gray-800">Enregistrer</strong>. Si Excel affiche une alerte de compatibilité, validez par "Oui".</li>
        </ol>
      </div>
    `;

    const dropZone = document.getElementById('geo-drop');
    const input = document.getElementById('geo-file-input');

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleCSVFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => {
      if (input.files.length) handleCSVFile(input.files[0]);
    });
  }

  function handleCSVFile(file) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Veuillez déposer un fichier au format .csv uniquement.');
      return;
    }
    currentFile = file;

    // Utilisation du mode auto-détection de PapaParse pour ingérer le fichier (virgule ou point-virgule)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      preview: 4,
      complete: function (results) {
        if (results.data.length === 0) {
          alert('Le fichier CSV semble vide.');
          return;
        }
        csvHeaders = results.meta.fields;
        csvRowsPreview = results.data.slice(0, 3);
        showMappingStep();
      }
    });
  }

  // Écran 2 : Sélection des colonnes constructrices de l'adresse
  function showMappingStep() {
    container.innerHTML = `
      <div class="mb-5">
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Étape 1 — Configuration</p>
        <h3 class="text-base font-medium text-gray-800">Quelles colonnes contiennent les éléments de l'adresse ?</h3>
        <p class="text-xs text-gray-400 mt-0.5">Cochez-les dans l'ordre de votre choix pour assembler l'adresse finale.</p>
      </div>

      <div class="flex flex-wrap gap-2 mb-6" id="columns-selector">
        ${csvHeaders.map(h => `
          <div class="relative">
            <input type="checkbox" id="chk_${h}" value="${h}" class="hidden column-checkbox" onchange="window.updateAddressPreview()" />
            <label for="chk_${h}" class="inline-block px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 cursor-pointer hover:border-gray-400 transition-colors">
              ${h}
            </label>
          </div>
        `).join('')}
      </div>

      <div class="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-6">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Aperçu de la première adresse générée</p>
        <p class="text-sm font-medium text-gray-800 italic" id="preview-address-string">Sélectionnez au moins une colonne...</p>
      </div>

      <div class="border-t border-gray-100 pt-4 flex gap-3">
        <button onclick="window.initGeocodeur()" class="px-4 py-2 text-xs border border-gray-200 rounded-lg font-medium text-gray-500 hover:bg-gray-50">Retour</button>
        <button id="start-geocode-btn" disabled onclick="window.runBANGeocoding()" class="flex-1 bg-gray-900 text-white font-medium py-2 text-xs rounded-lg opacity-50 cursor-not-allowed transition-all hover:bg-gray-800">
          Lancer le géocodage en masse →
        </button>
      </div>
    `;
  }

  window.updateAddressPreview = function () {
    const selected = Array.from(document.querySelectorAll('.column-checkbox:checked')).map(cb => cb.value);
    const previewEl = document.getElementById('preview-address-string');
    const btn = document.getElementById('start-geocode-btn');

    if (!selected.length || !csvRowsPreview.length) {
      previewEl.textContent = 'Sélectionnez au moins une colonne...';
      btn.disabled = true;
      btn.classList.add('opacity-50', 'cursor-not-allowed');
      return;
    }

    const firstRow = csvRowsPreview[0];
    const assembled = selected.map(col => firstRow[col] || '').filter(val => val.trim() !== '').join(' ');
    previewEl.textContent = assembled || '(Ligne vide pour ces colonnes)';
    
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'cursor-not-allowed');
  };

  // Traitement Batch avec restructuration stricte en virgules (évite l'erreur 400)
  window.runBANGeocoding = function () {
    const selectedColumns = Array.from(document.querySelectorAll('.column-checkbox:checked')).map(cb => cb.value);
    
    container.innerHTML = `
      <div class="text-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
        <p class="text-sm font-medium text-gray-700">Traitement et conversion du fichier en cours...</p>
        <p class="text-xs text-gray-400 mt-1">Envoi sécurisé vers la Base Adresse Nationale...</p>
      </div>
    `;

    // 1. Lire TOUT le fichier d'origine (gère le point-virgule d'Excel automatiquement)
    Papa.parse(currentFile, {
      header: true,
      skipEmptyLines: true,
      complete: function (fullResults) {
        
        // 2. Re-convertir le tableau d'objets en une chaîne de texte CSV avec séparateur VIRGULE strict (,)
        const standardizedCsvText = Papa.unparse(fullResults.data, { delimiter: ',' });
        
        // 3. Fabriquer un fichier virtuel (Blob) propre
        const csvBlob = new Blob([standardizedCsvText], { type: 'text/csv;charset=utf-8;' });

        // 4. Préparer l'envoi à la BAN
        const formData = new FormData();
        formData.append('data', csvBlob, 'input_clean.csv');
        selectedColumns.forEach(col => formData.append('columns', col));

        fetch('https://api-adresse.data.gouv.fr/search/csv/', {
          method: 'POST',
          body: formData
        })
        .then(res => {
          if (!res.ok) throw new Error(`Erreur BAN API (Statut ${res.status}). Vérifiez vos colonnes.`);
          return res.text();
        })
        .then(csvText => {
          Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
              geocodedResults = results.data.map(row => {
                let score = parseFloat(row.result_score) || 0;
                if (row.result_status === 'skipped') score = 0; 
                return {
                  ...row,
                  _lat: parseFloat(row.latitude) || null,
                  _lng: parseFloat(row.longitude) || null,
                  _score: score
                };
              });
              showResultsDashboard();
            }
          });
        })
        .catch(err => {
          alert(err.message);
          showMappingStep();
        });
      }
    });
  };

  // Écran Principal : Dashboard de contrôle, Filtre, Notifications et Carte
  function showResultsDashboard() {
    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 h-[440px]">
        
        <div class="flex flex-col h-full overflow-hidden">
          <div class="mb-3 bg-gray-50 border border-gray-100 rounded-xl p-3">
            <div class="flex justify-between text-xs font-medium text-gray-700 mb-1">
              <span>Seuil de confiance minimum :</span>
              <span id="slider-val" class="font-bold text-gray-900">70%</span>
            </div>
            <input type="range" id="confidence-slider" min="0" max="100" value="70" class="w-full accent-gray-800" oninput="window.filterGeocodeData()" />
            <p class="text-[10px] text-gray-400 mt-1">Les adresses en deçà du seuil seront isolées pour correction manuelle.</p>
          </div>

          <p class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2" id="notif-count-title">Anomalies détectées</p>
          <div class="flex-1 overflow-y-auto space-y-2 pr-1" id="notifications-container"></div>
        </div>

        <div class="flex flex-col h-full border border-gray-200 rounded-xl overflow-hidden relative">
          <div id="leaflet-geo-map" class="w-full flex-1 bg-gray-100 z-10"></div>
          <div id="map-overlay-tip" class="absolute inset-x-0 top-0 bg-gray-900/90 text-white text-[11px] p-2 text-center z-20 font-medium hidden">
            📍 Cliquez sur la carte pour repositionner l'adresse sélectionnée.
          </div>
          
          <div class="p-3 bg-white border-t border-gray-100 space-y-2 z-20">
            <button onclick="window.exportGeoSheets()" class="w-full bg-gray-900 text-white text-xs font-medium py-2 rounded-lg hover:bg-gray-800 transition-colors">
              Envoyer les adresses filtrées vers Sheets →
            </button>
            <button onclick="window.downloadGeoJSON()" class="w-full border border-gray-200 text-gray-700 text-xs font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors">
              Télécharger le fichier .geojson complet
            </button>
          </div>
        </div>

      </div>
    `;

    setTimeout(() => {
      initLeafletMap();
      window.filterGeocodeData();
    }, 50);
  }

  function initLeafletMap() {
    if (mapInstance) return;
    mapInstance = L.map('leaflet-geo-map').setView([46.603354, 1.888334], 5); // Recentrage France
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(mapInstance);

    mapInstance.on('click', function (e) {
      if (activeFixIndex === null) return;
      const { lat, lng } = e.latlng;

      if (mapMarker) {
        mapMarker.setLatLng(e.latlng);
      } else {
        mapMarker = L.marker(e.latlng).addTo(mapInstance);
      }

      // Écrasement des coordonnées erronées par le point cliqué
      geocodedResults[activeFixIndex]._lat = lat;
      geocodedResults[activeFixIndex]._lng = lng;
      geocodedResults[activeFixIndex]._score = 1.0; // Score forcé au maximum après action manuelle
      geocodedResults[activeFixIndex].latitude = lat.toString();
      geocodedResults[activeFixIndex].longitude = lng.toString();
      geocodedResults[activeFixIndex].result_label = "Repositionné manuellement sur la carte";

      const indexToKeep = activeFixIndex;
      window.filterGeocodeData();
      
      const targetCard = document.getElementById(`notif_${indexToKeep}`);
      if (targetCard) {
        targetCard.classList.add('active');
        activeFixIndex = indexToKeep;
      } else {
        activeFixIndex = null;
        if (mapMarker) { mapInstance.removeLayer(mapMarker); mapMarker = null; }
        document.getElementById('map-overlay-tip').style.display = 'none';
      }
    });
  }

  window.filterGeocodeData = function () {
    const slider = document.getElementById('confidence-slider');
    const sliderVal = document.getElementById('slider-val');
    const notifContainer = document.getElementById('notifications-container');
    const threshold = parseInt(slider.value) / 100;
    
    sliderVal.textContent = slider.value + '%';
    notifContainer.innerHTML = '';
    activeFixIndex = null;
    if (mapMarker) { mapInstance.removeLayer(mapMarker); mapMarker = null; }
    document.getElementById('map-overlay-tip').style.display = 'none';

    let failCount = 0;

    geocodedResults.forEach((row, index) => {
      if (row._score < threshold || !row._lat || !row._lng) {
        failCount++;
        
        // Extraction propre de toutes les métadonnées initiales du CSV pour affichage complet
        const metaDetails = Object.keys(row)
          .filter(k => !k.startsWith('result_') && !k.startsWith('_') && k !== 'latitude' && k !== 'longitude')
          .map(k => `<span class="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px] break-all"><strong>${k}:</strong> ${row[k] || ''}</span>`)
          .join(' ');

        const card = document.createElement('div');
        card.id = `notif_${index}`;
        card.className = 'notif-card p-3 rounded-xl cursor-pointer text-xs space-y-1.5';
        card.onclick = () => window.focusFixRow(index);
        card.innerHTML = `
          <div class="flex justify-between items-start">
            <span class="font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded text-[10px]">Confiance : ${Math.round(row._score * 100)}%</span>
            <button onclick="event.stopPropagation(); window.openGmaps('${encodeURIComponent(row.result_label || Object.values(row)[0])}')" class="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5">
              Ouvrir Google Maps ↗
            </button>
          </div>
          <p class="text-gray-800 font-medium leading-snug">${row.result_label || 'Adresse introuvable / imprécise'}</p>
          <div class="flex flex-wrap gap-1 pt-1 border-t border-gray-50">${metaDetails}</div>
        `;
        notifContainer.appendChild(card);
      }
    });

    document.getElementById('notif-count-title').textContent = `Anomalies détectées (${failCount})`;
    if (failCount === 0) {
      notifContainer.innerHTML = `
        <div class="text-center py-8 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
          <p class="text-xs font-medium text-gray-500">✨ Toutes les adresses respectent le seuil de confiance !</p>
        </div>
      `;
    }
    
    if (mapInstance) {
      mapInstance.invalidateSize();
    }
  };

  window.openGmaps = function (query) {
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
  };

  window.focusFixRow = function (index) {
    document.querySelectorAll('.notif-card').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(`notif_${index}`);
    if (target) target.classList.add('active');

    activeFixIndex = index;
    const row = geocodedResults[index];

    document.getElementById('map-overlay-tip').style.display = 'block';

    if (row._lat && row._lng) {
      mapInstance.setView([row._lat, row._lng], 16);
      if (mapMarker) {
        mapMarker.setLatLng([row._lat, row._lng]);
      } else {
        mapMarker = L.marker([row._lat, row._lng]).addTo(mapInstance);
      }
    } else {
      mapInstance.setView([46.603354, 1.888334], 5);
      if (mapMarker) { mapInstance.removeLayer(mapMarker); mapMarker = null; }
    }
  };

  function buildFilteredGeoJSON() {
    const slider = document.getElementById('confidence-slider');
    const threshold = slider ? parseInt(slider.value) / 100 : 0.7;

    const features = geocodedResults
      .filter(row => row._score >= threshold && row._lat && row._lng)
      .map(row => {
        const props = {};
        Object.keys(row).forEach(k => {
          if (!k.startsWith('_')) props[k] = row[k];
        });
        return {
          type: "Feature",
          properties: props,
          geometry: {
            type: "Point",
            coordinates: [row._lng, row._lat]
          }
        };
      });

    return { type: "FeatureCollection", features: features };
  }

  window.downloadGeoJSON = function () {
    const geojson = buildFilteredGeoJSON();
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile ? currentFile.name.replace('.csv', '.geojson') : 'export_geocode.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  window.exportGeoSheets = function () {
    const geojson = buildFilteredGeoJSON();
    if (!geojson.features.length) {
      alert("Aucune adresse ne remplit les critères de confiance pour l'export.");
      return;
    }

    const payload = {
      fileName: currentFile ? `Geocodage_${currentFile.name.replace('.csv', '')}` : 'Geocodage_Export',
      sentAt: new Date().toLocaleString('fr-FR'),
      featureCount: geojson.features.length,
      geojsonRaw: JSON.stringify(geojson)
    };

    const sendBtn = document.querySelector('button[onclick="window.exportGeoSheets()"]');
    const oldText = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Envoi vers Sheets...';

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(() => {
      sendBtn.textContent = '✓ Données transmises !';
      sendBtn.classList.replace('bg-gray-900', 'bg-emerald-600');
      setTimeout(() => {
        sendBtn.disabled = false;
        sendBtn.textContent = oldText;
        sendBtn.classList.replace('bg-emerald-600', 'bg-gray-900');
      }, 3000);
    })
    .catch(err => {
      alert(`Erreur réseau : ${err.message}`);
      sendBtn.disabled = false;
      sendBtn.textContent = oldText;
    });
  };

  // Exécution immédiate au premier chargement de l'injection de script
  window.initGeocodeur();

})();
