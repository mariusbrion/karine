/**
 * outils/iso.js
 * Générateur d'isochrones et d'isodistances basé sur l'API OpenRouteService (ORS).
 * Gestion cumulative des entités géographiques et file d'attente sérialisée (4s).
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx3yvNTl-aFgd7kAaSc2kyETuMfeUqIn4j2hnvKEs6dpGs7jNo4vMIdTFIGhpSyJm6c/exec';

  // Encodage Base64 fourni par l'utilisateur pour masquer le token ORS
  const encodedKey = "NWIzY2UzNTk3ODUxMTEwMDAxY2Y2MjQ4ODNlMDMyZTkyZmMzNDdiMzlhOGI5MmZkOTM1NDYwMGU=";
  const apiKey = atob(encodedKey);

  // Injection des dépendances Leaflet si non présentes
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

  const container = document.getElementById('iso-content');
  if (!container) return;

  // États globaux cumulatifs de l'outil
  let isoMapInstance = null;
  let isoLayerGroup = null;
  let accumulatedFeatures = []; 

  window.initIso = function () {
    accumulatedFeatures = [];
    if (isoMapInstance) { isoMapInstance.remove(); isoMapInstance = null; }
    buildIsoLayout();
  };

  function buildIsoLayout() {
    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 h-[460px]">
        
        <div class="flex flex-col h-full overflow-hidden space-y-3 text-xs">
          
          <div class="bg-gray-50 border border-gray-100 rounded-xl p-3 text-[11px] text-gray-500 leading-relaxed">
            ✨ <strong class="text-gray-700">Mode cumulatif actif :</strong> chaque clic sur la carte ou import de lot ajoute de nouvelles zones sans effacer les précédentes. Vous pouvez réinitialiser l'espace en rechargeant l'outil.
          </div>

          <div class="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-2.5">
            <div>
              <div class="flex justify-between font-medium text-gray-700 mb-1">
                <span>Distance de calcul :</span>
                <span class="font-bold text-gray-900" id="distance-display">1000 m</span>
              </div>
              <input type="range" id="iso-distance-slider" min="100" max="5000" step="100" value="1000" class="w-full accent-gray-800" oninput="window.updateIsoConverter()" />
            </div>

            <div class="border-t border-gray-200/60 pt-2 flex items-center justify-between">
              <span class="text-gray-500">Vitesse d'estimation :</span>
              <div class="flex items-center gap-1">
                <input type="number" id="iso-speed-input" value="4.5" step="0.5" class="w-10 text-center py-0.5 border border-gray-200 rounded focus:outline-none" oninput="window.updateIsoConverter()" />
                <span class="text-gray-400">km/h</span>
              </div>
            </div>
            <p class="bg-white border text-center py-1 rounded text-gray-600 font-medium" id="time-conversion-output"></p>
          </div>

          <div class="bg-gray-50 border border-gray-100 rounded-xl p-3 flex-1 flex flex-col justify-between space-y-2 overflow-y-auto">
            <div>
              <label class="block font-semibold text-gray-700 mb-1 uppercase tracking-wider text-[10px]">Mode de déplacement :</label>
              <select id="iso-profile-select" class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md focus:outline-none">
                <option value="foot-walking">Piéton</option>
                <option value="cycling-regular">Vélo standard</option>
                <option value="driving-car">Voiture</option>
              </select>
            </div>

            <div class="space-y-2 pt-1 border-t border-gray-200/60">
              <div id="iso-drop" class="border border-dashed border-gray-200 bg-white rounded-lg p-2 text-center relative cursor-pointer hover:bg-gray-50 transition-colors">
                <input type="file" id="iso-file-input" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" accept=".geojson,.json" />
                <p class="text-gray-700 font-medium text-[11px]">📁 Glisser un GeoJSON de points local</p>
              </div>
              
              <button id="iso-cloud-fetch-btn" onclick="window.fetchPointsFromCloud()" class="w-full bg-white border border-gray-200 text-gray-700 font-medium py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-[11px]">
                ☁️ Charger depuis Google Sheets
              </button>
              
              <div id="iso-cloud-select-container" class="hidden"></div>
            </div>
          </div>
        </div>

        <div class="flex flex-col h-full border border-gray-200 rounded-xl overflow-hidden relative">
          <div id="leaflet-iso-map" class="w-full flex-1 bg-gray-100 z-10"></div>
          <div class="absolute inset-x-0 top-0 bg-gray-900/85 text-white text-[10px] p-1.5 text-center z-20 pointer-events-none uppercase tracking-wider">
            💡 CLIQUEZ SUR LA CARTE POUR AJOUTER UN ISOCHRONE
          </div>

          <div class="p-2.5 bg-white border-t border-gray-100 space-y-1.5 z-20">
            <button id="iso-btn-sheets" disabled onclick="window.exportIsoSheets()" class="w-full bg-gray-900 text-white text-xs font-medium py-1.5 rounded-lg opacity-50 cursor-not-allowed hover:bg-gray-800 transition-colors">
              Envoyer l'ensemble cumulé vers Sheets →
            </button>
            <button id="iso-btn-dl" disabled onclick="window.downloadIsoGeoJSON()" class="w-full border border-gray-200 text-gray-700 text-xs font-medium py-1.5 rounded-lg opacity-50 cursor-not-allowed hover:bg-gray-50 transition-colors">
              Télécharger le GeoJSON cumulé
            </button>
          </div>
        </div>

      </div>
    `;

    setTimeout(() => {
      initIsoMap();
      window.updateIsoConverter();
      setupIsoDropZone();
    }, 50);
  }

  function initIsoMap() {
    if (isoMapInstance) return;
    isoMapInstance = L.map('leaflet-iso-map').setView([44.837789, -0.57918], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(isoMapInstance);
    isoLayerGroup = L.layerGroup().addTo(isoMapInstance);

    isoMapInstance.on('click', function (e) {
      calculateSingleIso(e.latlng.lat, e.latlng.lng);
    });
  }

  window.updateIsoConverter = function () {
    const distance = parseInt(document.getElementById('iso-distance-slider').value);
    const speed = parseFloat(document.getElementById('iso-speed-input').value) || 4.5;
    document.getElementById('distance-display').textContent = distance + ' m';
    const timeMinutes = Math.round(((distance / 1000) / speed) * 60);
    document.getElementById('time-conversion-output').textContent = `Soit environ ${timeMinutes} minute${timeMinutes > 1 ? 's' : ''} de trajet`;
  };

  async function fetchIsochrone(lat, lng, distanceMeters, profile) {
    const url = `https://api.openrouteservice.org/v2/isochrones/${profile}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, application/geo+json; charset=utf-8',
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ locations: [[lng, lat]], range: [distanceMeters], range_type: "distance" })
    });

    if (!response.ok) throw new Error(`Erreur API ORS (Statut ${response.status})`);
    return await response.json();
  }

  function calculateSingleIso(lat, lng) {
    const distance = parseInt(document.getElementById('iso-distance-slider').value);
    const profile = document.getElementById('iso-profile-select').value;

    // Ajout du marqueur permanent sur la carte pour ce point
    L.marker([lat, lng]).addTo(isoLayerGroup);

    fetchIsochrone(lat, lng, distance, profile)
      .then(geojson => {
        if (!geojson) return;
        geojson.features.forEach(f => {
          f.properties = { source: "Clic carte manuel", distance_m: distance, profile: profile, date_calcul: new Date().toLocaleDateString('fr-FR') };
          accumulatedFeatures.push(f); // Stockage dans la collection cumulative globale
        });
        displayIsoOnMap(geojson);
        enableActionButtons();
      })
      .catch(err => alert("Erreur d'isochrone : " + err.message));
  }

  window.fetchPointsFromCloud = function () {
    const cloudBtn = document.getElementById('iso-cloud-fetch-btn');
    const containerSelect = document.getElementById('iso-cloud-select-container');
    
    cloudBtn.disabled = true;
    cloudBtn.textContent = '☁️ Connexion au Cloud...';

    fetch(GOOGLE_SCRIPT_URL)
      .then(res => res.json())
      .then(files => {
        if (!files.length) {
          alert("Aucun fichier archivé n'a été trouvé dans la base GeoJSON.");
          cloudBtn.disabled = false;
          cloudBtn.textContent = '☁️ Charger depuis Google Sheets';
          return;
        }

        containerSelect.innerHTML = `
          <label class="block font-medium text-gray-500 mb-1 text-[10px]">Sélectionner une couche distante :</label>
          <select id="iso-cloud-picker" class="w-full p-1 bg-white border border-gray-200 rounded text-xs focus:outline-none" onchange="window.handleCloudSelection(this.value)">
            <option value="">-- Sélectionner --</option>
            ${files.map(f => `<option value="${encodeURIComponent(f.geojsonRaw)}">${f.fileName} (${f.sentAt})</option>`).join('')}
          </select>
        `;
        containerSelect.classList.remove('hidden');
        cloudBtn.textContent = '☁️ Liste mise à jour !';
      })
      .catch(err => {
        alert("Erreur de synchronisation cloud : " + err.message);
        cloudBtn.disabled = false;
        cloudBtn.textContent = '☁️ Charger depuis Google Sheets';
      });
  };

  window.handleCloudSelection = function (encodedGeo) {
    if (!encodedGeo) return;
    try {
      const rawJson = JSON.parse(decodeURIComponent(encodedGeo));
      parseAndRunPoints(rawJson, "Couche Cloud");
    } catch (e) {
      alert("Erreur de lecture de la structure JSON distante.");
    }
  };

  function setupIsoDropZone() {
    const dropZone = document.getElementById('iso-drop');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('bg-gray-50'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('bg-gray-50'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-50');
      if (e.dataTransfer.files.length) {
        const reader = new FileReader();
        reader.onload = ev => parseAndRunPoints(JSON.parse(ev.target.result), e.dataTransfer.files[0].name);
        reader.readAsText(e.dataTransfer.files[0]);
      }
    });
    document.getElementById('iso-file-input').addEventListener('change', e => {
      if (e.target.files.length) {
        const reader = new FileReader();
        reader.onload = ev => parseAndRunPoints(JSON.parse(ev.target.result), e.target.files[0].name);
        reader.readAsText(e.target.files[0]);
      }
    });
  }

  function parseAndRunPoints(geoStructure, title) {
    const points = [];
    if (geoStructure.type === 'FeatureCollection' && geoStructure.features) {
      geoStructure.features.forEach(f => {
        if (f.geometry && f.geometry.type === 'Point') points.push({ coords: f.geometry.coordinates, props: f.properties || {} });
      });
    } else if (geoStructure.type === 'Feature' && geoStructure.geometry?.type === 'Point') {
      points.push({ coords: geoStructure.geometry.coordinates, props: geoStructure.properties || {} });
    }

    if (!points.length) {
      alert("Aucun objet de type 'Point' détecté.");
      return;
    }
    runBatchIsochrones(points, title);
  }

  // Boucle sérialisée stricte (1 requête toutes les 4 secondes) pour contourner les blocages de quotas (Rate-limiting)
  async function runBatchIsochrones(points, title) {
    const distance = parseInt(document.getElementById('iso-distance-slider').value);
    const profile = document.getElementById('iso-profile-select').value;
    
    const newBatchFeatures = [];
    let successCount = 0;

    const notice = L.popup({ closeButton: false, autoClose: false })
      .setLatLng(isoMapInstance.getCenter())
      .setContent(`<div class="text-xs p-1 text-center font-medium">⏳ Traitement linéaire (intervalle 4s) : <strong id="batch-progress-log">0 / ${points.length}</strong></div>`)
      .openOn(isoMapInstance);

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const lng = pt.coords[0];
      const lat = pt.coords[1];

      L.circleMarker([lat, lng], { radius: 4, color: '#1a1a1a', fillColor: '#fff', fillOpacity: 1 }).addTo(isoLayerGroup);

      try {
        const logEl = document.getElementById('batch-progress-log');
        if (logEl) logEl.textContent = `${i + 1} / ${points.length}`;
        
        const res = await fetchIsochrone(lat, lng, distance, profile);
        if (res && res.features) {
          res.features.forEach(f => {
            f.properties = { ...pt.props, iso_dist: distance, iso_prof: profile, source_batch: title };
            accumulatedFeatures.push(f); // Ajout au catalogue cumulatif général
            newBatchFeatures.push(f);    // Sauvegarde locale pour rafraîchir la carte
          });
          successCount++;
        }
      } catch (err) { 
        console.error(`Erreur sur le point ${i} :`, err); 
      }

      // Attente obligatoire de 4000ms avant de passer à l'entité suivante (sauf pour le dernier point)
      if (i < points.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
    }

    isoMapInstance.closePopup();

    if (newBatchFeatures.length > 0) {
      displayIsoOnMap({ type: "FeatureCollection", features: newBatchFeatures });
      enableActionButtons();
    }
    alert(`Traitement terminé : ${successCount} zone(s) ajoutée(s) au cumulatif sur les ${points.length} points.`);
  }

  function displayIsoOnMap(geojson) {
    const layer = L.geoJSON(geojson, {
      style: () => ({ color: '#1a1a1a', weight: 1.5, fillColor: '#1a1a1a', fillOpacity: 0.15 })
    }).addTo(isoLayerGroup);
    isoMapInstance.fitBounds(layer.getBounds(), { padding: [30, 30] });
  }

  function enableActionButtons() {
    ['iso-btn-sheets', 'iso-btn-dl'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = false; el.classList.remove('opacity-50', 'cursor-not-allowed'); }
    });
  }

  window.downloadIsoGeoJSON = function () {
    if (!accumulatedFeatures.length) return;
    const finalGeoJSON = { type: "FeatureCollection", features: accumulatedFeatures };
    const blob = new Blob([JSON.stringify(finalGeoJSON, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `isochrones_cumules_${Date.now()}.geojson`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  window.exportIsoSheets = function () {
    if (!accumulatedFeatures.length) return;
    const sendBtn = document.getElementById('iso-btn-sheets');
    sendBtn.disabled = true; sendBtn.textContent = 'Transmission de la collection...';

    const finalGeoJSON = { type: "FeatureCollection", features: accumulatedFeatures };

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: `Isochrones_Cumules_${document.getElementById('iso-profile-select').value}`,
        sentAt: new Date().toLocaleString('fr-FR'),
        featureCount: finalGeoJSON.features.length,
        geojsonRaw: JSON.stringify(finalGeoJSON)
      })
    })
    .then(() => {
      sendBtn.textContent = '✓ Collection envoyée au Cloud !';
      sendBtn.classList.replace('bg-gray-900', 'bg-emerald-600');
      setTimeout(() => {
        sendBtn.disabled = false; sendBtn.textContent = "Envoyer l'ensemble cumulé vers Sheets →";
        sendBtn.classList.replace('bg-emerald-600', 'bg-gray-900');
      }, 3000);
    })
    .catch(err => { alert("Échec de l'export : " + err.message); sendBtn.disabled = false; });
  };

})();
