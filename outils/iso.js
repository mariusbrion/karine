/**
 * outils/iso.js
 * Générateur d'isochrones et d'isodistances basé sur l'API OpenRouteService (ORS).
 * Supporte le clic sur carte, l'import de points GeoJSON par lot et la sauvegarde de la clé API.
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzasNFTAqeoHRVFB4XNThEIe8CgxdSPvp2uObMErkko3dogkBIUlScozk85HhvxnsHC/exec';

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

  // États globaux de l'outil
  let isoMapInstance = null;
  let isoLayerGroup = null;
  let generatedIsochronesGeoJSON = null; 

  window.initIso = function () {
    generatedIsochronesGeoJSON = null;
    if (isoMapInstance) { isoMapInstance.remove(); isoMapInstance = null; }
    buildIsoLayout();
  };

  function buildIsoLayout() {
    // Récupération de la clé API ORS si déjà stockée par le passé
    const savedKey = localStorage.getItem('ors_api_key') || '';

    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 h-[460px]">
        
        <div class="flex flex-col h-full overflow-hidden space-y-4 text-xs">
          
          <div class="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <label class="block font-semibold text-gray-700 mb-1 uppercase tracking-wider text-[10px]">Clé API OpenRouteService :</label>
            <input type="password" id="ors-key-input" value="${savedKey}" placeholder="Coller la clé API tokens..." class="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400" onchange="localStorage.setItem('ors_api_key', this.value)" />
            <p class="text-[10px] text-gray-400 mt-1">Générée gratuitement sur openrouteservice.org. Stockée localement.</p>
          </div>

          <div class="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-3">
            <div>
              <div class="flex justify-between font-medium text-gray-700 mb-1">
                <span>Distance de calcul :</span>
                <span class="font-bold text-gray-900" id="distance-display">1000 m</span>
              </div>
              <input type="range" id="iso-distance-slider" min="100" max="5000" step="100" value="1000" class="w-full accent-gray-800" oninput="window.updateIsoConverter()" />
            </div>

            <div class="border-t border-gray-200/60 pt-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-gray-500">Vitesse d'estimation :</span>
                <div class="flex items-center gap-1">
                  <input type="number" id="iso-speed-input" value="4.5" step="0.5" min="1" max="130" class="w-12 text-center py-0.5 border border-gray-200 rounded focus:outline-none" oninput="window.updateIsoConverter()" />
                  <span class="text-gray-400 font-medium">km/h</span>
                </div>
              </div>
              <p class="bg-white/80 border border-gray-100 text-center py-1.5 rounded-md font-medium text-gray-700 mt-2" id="time-conversion-output">
                Soit environ 13 minutes de trajet
              </p>
            </div>
          </div>

          <div class="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-3 flex-1 flex flex-col justify-between">
            <div>
              <label class="block font-semibold text-gray-700 mb-1 uppercase tracking-wider text-[10px]">Mode de déplacement (Profil ORS) :</label>
              <select id="iso-profile-select" class="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg focus:outline-none">
                <option value="foot-walking">Piéton (foot-walking)</option>
                <option value="cycling-regular">Vélo standard (cycling-regular)</option>
                <option value="driving-car">Voiture (driving-car)</option>
              </select>
            </div>

            <div id="iso-drop" class="border border-dashed border-gray-200 bg-white rounded-lg p-4 text-center relative cursor-pointer hover:bg-gray-50 transition-colors">
              <input type="file" id="iso-file-input" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" accept=".geojson,.json" />
              <span class="text-xl block">📥</span>
              <p class="text-gray-700 font-medium mt-1">Lot : Glisser un GeoJSON de points</p>
              <p class="text-[10px] text-gray-400">Calcule une zone pour chaque point du fichier</p>
            </div>
          </div>
        </div>

        <div class="flex flex-col h-full border border-gray-200 rounded-xl overflow-hidden relative">
          <div id="leaflet-iso-map" class="w-full flex-1 bg-gray-100 z-10"></div>
          <div class="absolute inset-x-0 top-0 bg-gray-900/85 text-white text-[10px] p-2 text-center z-20 pointer-events-none tracking-wide">
            💡 CLIQUEZ SUR LA CARTE POUR GÉNÉRER UN ISOCHRONE UNIQUE
          </div>

          <div class="p-3 bg-white border-t border-gray-100 space-y-2 z-20">
            <button id="iso-btn-sheets" disabled onclick="window.exportIsoSheets()" class="w-full bg-gray-900 text-white text-xs font-medium py-2 rounded-lg opacity-50 cursor-not-allowed transition-colors hover:bg-gray-800">
              Envoyer l'isochrone vers Sheets →
            </button>
            <button id="iso-btn-dl" disabled onclick="window.downloadIsoGeoJSON()" class="w-full border border-gray-200 text-gray-700 text-xs font-medium py-2 rounded-lg opacity-50 cursor-not-allowed transition-colors hover:bg-gray-50">
              Télécharger le résultat (.geojson)
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
    isoMapInstance = L.map('leaflet-iso-map').setView([44.837789, -0.57918], 13); // Bordeaux
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(isoMapInstance);

    isoLayerGroup = L.layerGroup().addTo(isoMapInstance);

    isoMapInstance.on('click', function (e) {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      calculateSingleIso(lat, lng);
    });
  }

  // Convertisseur de texte : Distance / Vitesse -> Temps indicatif
  window.updateIsoConverter = function () {
    const distance = parseInt(document.getElementById('iso-distance-slider').value);
    const speed = parseFloat(document.getElementById('iso-speed-input').value) || 4.5;
    
    document.getElementById('distance-display').textContent = distance + ' m';

    // Temps (min) = (Distance en km / Vitesse en km/h) * 60
    const timeMinutes = Math.round(((distance / 1000) / speed) * 60);
    document.getElementById('time-conversion-output').textContent = `Soit environ ${timeMinutes} minute${timeMinutes > 1 ? 's' : ''} de trajet`;
  };

  function getApiKey() {
    const key = document.getElementById('ors-key-input').value.trim();
    if (!key) {
      alert("Veuillez renseigner votre clé API OpenRouteService à gauche pour lancer le calcul.");
      return null;
    }
    return key;
  }

  // Appele l'API ORS Isochrones basée sur la distance (isodistance)
  async function fetchIsochrone(lat, lng, distanceMeters, profile) {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const url = `https://api.openrouteservice.org/v2/isochrones/${profile}`;
    const body = {
      locations: [[lng, lat]],
      range: [distanceMeters],
      range_type: "distance"
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, application/geo+json; charset=utf-8',
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Erreur ORS (Statut ${response.status})`);
    }

    return await response.json();
  }

  // Traitement d'un clic isolé
  function calculateSingleIso(lat, lng) {
    const distance = parseInt(document.getElementById('iso-distance-slider').value);
    const profile = document.getElementById('iso-profile-select').value;

    isoLayerGroup.clearLayers();
    L.marker([lat, lng]).addTo(isoLayerGroup);

    fetchIsochrone(lat, lng, distance, profile)
      .then(geojson => {
        if (!geojson) return;
        
        // Ajout d'attributs de contexte dans les propriétés de la géométrie
        geojson.features.forEach(f => {
          f.properties = {
            source: "Calcul unitaire (clic carte)",
            distance_demandee: distance,
            mode_transport: profile,
            centre_lat: lat,
            centre_lng: lng
          };
        });

        generatedIsochronesGeoJSON = geojson;
        displayIsoOnMap(geojson);
        enableActionButtons();
      })
      .catch(err => alert("Erreur de calcul : " + err.message));
  }

  // Configuration du Drag & Drop pour le fichier de points
  function setupIsoDropZone() {
    const dropZone = document.getElementById('iso-drop');
    const input = document.getElementById('iso-file-input');

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('bg-gray-100'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('bg-gray-100'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-100');
      if (e.dataTransfer.files.length) processGeoJSONFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => {
      if (input.files.length) processGeoJSONFile(input.files[0]);
    });
  }

  // Extraction des points et lancement du traitement par lot
  function processGeoJSONFile(file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const inputGeo = JSON.parse(e.target.result);
        const points = [];

        if (inputGeo.type === 'FeatureCollection' && inputGeo.features) {
          inputGeo.features.forEach(f => {
            if (f.geometry && f.geometry.type === 'Point') {
              points.push({
                coords: f.geometry.coordinates, // [lng, lat]
                props: f.properties || {}
              });
            }
          });
        } else if (inputGeo.type === 'Feature' && inputGeo.geometry?.type === 'Point') {
          points.push({ coords: inputGeo.geometry.coordinates, props: inputGeo.properties || {} });
        }

        if (points.length === 0) {
          alert("Aucun objet géométrique de type 'Point' n'a été détecté dans votre fichier GeoJSON.");
          return;
        }

        if (points.length > 25) {
          if (!confirm(`Votre fichier contient ${points.length} points. L'API OpenRouteService gratuite limite les requêtes par minute. Souhaitez-vous poursuivre le calcul ?`)) return;
        }

        runBatchIsochrones(points, file.name);

      } catch (err) {
        alert("Impossible de lire le fichier GeoJSON : " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // Boucle asynchrone pour calculer l'isochrone de chaque point importé
  async function runBatchIsochrones(points, originalFileName) {
    const distance = parseInt(document.getElementById('iso-distance-slider').value);
    const profile = document.getElementById('iso-profile-select').value;
    
    isoLayerGroup.clearLayers();
    
    const combinedFeatures = [];
    let successCount = 0;

    // Affichage d'un loader temporaire sur la carte
    const loadingNotice = L.popup()
      .setLatLng(isoMapInstance.getCenter())
      .setContent(`<div class="text-xs p-1 text-center font-medium">⏳ Calcul en lot : <strong>0 / ${points.length}</strong> traité(s)</div>`)
      .openOn(isoMapInstance);

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const lng = pt.coords[0];
      const lat = pt.coords[1];

      // Ajout d'un marqueur témoin sur la carte
      L.circleMarker([lat, lng], { radius: 4, color: '#1a1a1a' }).addTo(isoLayerGroup);

      try {
        loadingNotice.setContent(`<div class="text-xs p-1 text-center font-semibold">⏳ Calcul de l'isochrone : <strong>${i + 1} / ${points.length}</strong></div>`);
        
        const resultIso = await fetchIsochrone(lat, lng, distance, profile);
        
        if (resultIso && resultIso.features) {
          resultIso.features.forEach(f => {
            // On fusionne les propriétés d'origine du point avec les métadonnées de calcul
            f.properties = {
              ...pt.props,
              iso_distance_m: distance,
              iso_profile: profile,
              iso_origin_lat: lat,
              iso_origin_lng: lng
            };
            combinedFeatures.push(f);
          });
          successCount++;
        }
        
        // Petit délai de sécurité (anti-spam / rate-limiting API)
        await new Promise(resolve => setTimeout(resolve, 600));

      } catch (err) {
        console.error(`Échec sur le point d'index ${i} :`, err);
      }
    }

    isoMapInstance.closePopup();

    if (combinedFeatures.length === 0) {
      alert("Le calcul par lot a échoué. Vérifiez vos quotas ou la validité de votre clé API.");
      return;
    }

    generatedIsochronesGeoJSON = {
      type: "FeatureCollection",
      features: combinedFeatures
    };

    displayIsoOnMap(generatedIsochronesGeoJSON);
    enableActionButtons();
    alert(`Calcul terminé avec succès : ${successCount} zone(s) générée(s) sur ${points.length} points.`);
  }

  function displayIsoOnMap(geojson) {
    const geoLayer = L.geoJSON(geojson, {
      style: function () {
        return {
          color: '#1a1a1a',
          weight: 1.5,
          fillColor: '#6B7280',
          fillOpacity: 0.25
        };
      }
    }).addTo(isoLayerGroup);

    // Ajustement automatique de la vue sur les polygones créés
    if (isoLayerGroup.getLayers().length > 0) {
      isoMapInstance.fitBounds(geoLayer.getBounds(), { padding: [20, 20] });
    }
  }

  function enableActionButtons() {
    ['iso-btn-sheets', 'iso-btn-dl'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    });
  }

  window.downloadIsoGeoJSON = function () {
    if (!generatedIsochronesGeoJSON) return;
    const blob = new Blob([JSON.stringify(generatedIsochronesGeoJSON, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `isochrones_${document.getElementById('iso-profile-select').value}.geojson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  window.exportIsoSheets = function () {
    if (!generatedIsochronesGeoJSON) return;

    const payload = {
      fileName: `Isochrones_${document.getElementById('iso-profile-select').value}`,
      sentAt: new Date().toLocaleString('fr-FR'),
      featureCount: generatedIsochronesGeoJSON.features.length,
      geojsonRaw: JSON.stringify(generatedIsochronesGeoJSON)
    };

    const sendBtn = document.getElementById('iso-btn-sheets');
    const oldText = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Transmission...';

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(() => {
      sendBtn.textContent = '✓ Transmis à l\'onglet GeoJSON !';
      sendBtn.classList.replace('bg-gray-900', 'bg-emerald-600');
      setTimeout(() => {
        sendBtn.disabled = false;
        sendBtn.textContent = oldText;
        sendBtn.classList.replace('bg-emerald-600', 'bg-gray-900');
      }, 3000);
    })
    .catch(err => {
      alert(`Erreur réseau Sheets : ${err.message}`);
      sendBtn.disabled = false;
      sendBtn.textContent = oldText;
    });
  };

})();
