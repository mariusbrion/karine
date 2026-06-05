/**
 * outils/trajet.js
 * FlowMapper — Analyseur et consolidateur de flux vers pôle d'attraction.
 * Calcule dynamiquement les itinéraires depuis des points locaux (Fichiers) ou distants (Cloud).
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz1kvkUwAEwD-3Bc9SZqACaaZTVGhhGy_Om-F8vK0adfC5pBCg5amBNUEqSeteKJIrV/exec';

  const encodedKey = "NWIzY2UzNTk3ODUxMTEwMDAxY2Y2MjQ4ODNlMDMyZTkyZmMzNDdiMzlhOGI5MmZkOTM1NDYwMGU=";
  const apiKey = atob(encodedKey);

  // Injection asynchrone des dépendances
  if (!window.turf) {
    const s = document.createElement('script'); s.src = 'https://unpkg.com/@turf/turf@6/turf.min.js'; document.head.appendChild(s);
  }
  if (!window.Papa) {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'; document.head.appendChild(s);
  }
  if (!document.getElementById('leaflet-css')) {
    const l = document.createElement('link'); l.id = 'leaflet-css'; l.rel = 'stylesheet'; l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l);
  }
  if (!window.L) {
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; document.head.appendChild(s);
  }

  const container = document.getElementById('trajet-content');
  if (!container) return;

  // Variables d'état FlowMapper
  let fMap = null;
  let destinationMarker = null;
  let flowLayer = null;
  let isSettingDestination = false;
  let destinationLatLng = null;
  let trips = []; 
  let segmentsDict = {}; 
  let isProcessingBatch = false;
  let cloudTrajetStorage = [];

  window.initTrajet = function () {
    trips = []; segmentsDict = {}; isProcessingBatch = false; destinationLatLng = null; isSettingDestination = false; cloudTrajetStorage = [];
    if (fMap) { fMap.remove(); fMap = null; }
    buildTrajetLayout();
  };

  function buildTrajetLayout() {
    container.innerHTML = `
      <div class="flex flex-col lg:flex-row h-[560px] w-full text-xs overflow-hidden">
        
        <div class="w-full lg:w-80 bg-gray-50 border-b lg:border-b-0 lg:border-r border-gray-200 flex flex-col h-60 lg:h-full p-4 space-y-3 overflow-y-auto shrink-0">
          
          <div class="space-y-2">
            <button id="btnSetDest" onclick="window.toggleFlowDestinationMode()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl flex items-center justify-center gap-2 transition-colors">
              <span id="destStatusIcon">📍</span> <span id="destStatusText">Définir l'Arrivée</span>
            </button>

            <div>
              <label class="block text-[9px] font-bold text-gray-400 uppercase mb-1">Mode de transport</label>
              <select id="travelMode" class="w-full p-1.5 bg-white border border-gray-200 rounded-md outline-none">
                <option value="foot-walking">🚶 Piéton</option>
                <option value="cycling-regular">🚲 Vélo</option>
                <option value="driving-car">🚗 Voiture</option>
              </select>
            </div>
          </div>

          <div class="border-t border-gray-200 pt-2 grid grid-cols-2 gap-2">
            <div class="bg-white p-2 border border-gray-200 rounded-xl col-span-1">
              <label class="block text-[9px] font-bold text-gray-400 uppercase mb-1">Poids manuel</label>
              <input type="number" id="peopleCount" value="10" min="1" class="w-full p-1 border border-gray-200 rounded text-center" />
            </div>
            
            <div class="col-span-1 flex flex-col justify-end">
              <input type="file" id="trajFileInput" accept=".csv,.json,.geojson" class="hidden" onchange="window.handleTrajFileUpload(event)" />
              <button onclick="document.getElementById('trajFileInput').click()" class="w-full bg-white border border-gray-200 py-2 rounded-xl font-medium hover:bg-gray-50 text-[11px]">📁 Import Lot</button>
            </div>
          </div>

          <div id="batchProgressContainer" class="hidden bg-indigo-50 p-2 rounded-xl border border-indigo-100">
            <div class="flex justify-between text-[9px] mb-1 font-bold text-indigo-700">
              <span id="progressLabel">Calcul...</span> <span id="progressPercent">0%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-1">
              <div id="batchProgressBar" class="bg-indigo-600 h-1 rounded-full transition-all" style="width: 0%"></div>
            </div>
            <button onclick="window.stopTrajBatch()" class="text-[9px] text-red-500 underline w-full text-center mt-1 block">Interrompre</button>
          </div>

          <div class="border-t border-gray-200 pt-2 space-y-1.5">
            <button id="traj-cloud-btn" onclick="window.fetchTrajetCloud()" class="w-full bg-white border border-gray-200 text-gray-700 font-medium py-1.5 rounded-xl hover:bg-gray-50 text-[11px]">☁️ Calculer depuis le Cloud Sheets</button>
            <div id="traj-cloud-picker-wrap" class="hidden"></div>
          </div>

          <div class="flex-1 border-t border-gray-200 pt-2 flex flex-col overflow-hidden">
            <div class="flex justify-between items-center mb-1.5 shrink-0">
              <h4 class="font-bold text-gray-400 uppercase tracking-wider text-[9px]">Segments actifs</h4>
              <span id="tripsCounter" class="bg-gray-200 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-full">0</span>
            </div>
            <div id="tripsList" class="flex-1 overflow-y-auto space-y-1 pr-0.5 text-[10px]">
              <p class="text-gray-400 italic text-center py-2">Aucun tracé actif.</p>
            </div>
          </div>

          <div class="border-t border-gray-200 pt-2 space-y-1.5 shrink-0">
            <button id="btnExportSheet" disabled onclick="window.exportTrajetToCloud()" class="w-full bg-gray-900 text-white font-medium py-1.5 rounded-xl hover:bg-gray-800 text-[11px]">☁️ Archiver le résultat consolidé →</button>
            <button onclick="window.clearAllTrajets()" class="w-full text-red-500 hover:underline text-[10px] text-center block">Réinitialiser l'espace</button>
          </div>
        </div>

        <div class="flex-grow h-full relative">
          <div id="leaflet-trajet-map" class="w-full h-full bg-gray-100 z-10"></div>
        </div>
      </div>
    `;

    setTimeout(() => { initLeafletTrajet(); }, 550);
  }

  function initLeafletTrajet() {
    if (fMap) return;
    if (!window.L || !window.turf || !window.Papa) { setTimeout(initLeafletTrajet, 100); return; }

    fMap = L.map('leaflet-trajet-map').setView([44.837789, -0.57918], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(fMap);

    flowLayer = L.geoJSON(null, {
      style: (feature) => ({
        color: "#e11d48",
        weight: Math.min(Math.log1p(feature.properties.weight || 1) * 3.8, 15),
        opacity: Math.min(0.4 + (feature.properties.weight / 120), 0.85),
        lineCap: 'round'
      })
    }).addTo(fMap);

    fMap.on('click', handleMapClick);
  }

  window.toggleFlowDestinationMode = function () {
    isSettingDestination = !isSettingDestination;
    const btn = document.getElementById('btnSetDest');
    const text = document.getElementById('destStatusText');
    if (isSettingDestination) {
      btn.classList.replace('bg-blue-600', 'bg-orange-500'); text.innerText = "Cliquez la destination...";
    } else {
      btn.classList.remove('bg-orange-500'); btn.classList.add('bg-blue-600');
      text.innerText = destinationLatLng ? "Changer l'Arrivée" : "Définir l'Arrivée";
    }
  };

  async function addTrip(startLatLng, weight, mode, skipRender = false) {
    try {
      const url = `https://api.heigit.org/openrouteservice/v2/directions/${mode}/geojson`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': apiKey },
        body: JSON.stringify({ coordinates: [[startLatLng.lng, startLatLng.lat], [destinationLatLng.lng, destinationLatLng.lat]] })
      });

      if (!response.ok) throw new Error("Erreur itinéraire API.");
      const data = await response.json();
      const route = data.features[0];
      if (!route) return;

      trips.push({ id: Date.now() + Math.random(), weight, geometry: route.geometry, mode });
      processSegments(route.geometry.coordinates, weight);

      if (!skipRender) { renderFlow(); updateTripsList(); }
    } catch (err) { console.error("Erreur addTrip:", err); }
  }

  function processSegments(coordinates, weight) {
    for (let i = 0; i < coordinates.length - 1; i++) {
      const p1 = coordinates[i], p2 = coordinates[i + 1];
      const p1Str = `${p1[0].toFixed(6)},${p1[1].toFixed(6)}`;
      const p2Str = `${p2[0].toFixed(6)},${p2[1].toFixed(6)}`;
      const key = [p1Str, p2Str].sort().join('|');
      if (!segmentsDict[key]) segmentsDict[key] = { coords: [p1, p2], weight: 0 };
      segmentsDict[key].weight += weight;
    }
  }

  function renderFlow() {
    const features = Object.values(segmentsDict).map(seg => turf.lineString(seg.coords, { weight: seg.weight }));
    flowLayer.clearLayers().addData(turf.featureCollection(features));
    const btn = document.getElementById('btnExportSheet');
    if (btn) { btn.disabled = trips.length === 0; btn.classList.toggle('opacity-50', trips.length === 0); btn.classList.toggle('cursor-not-allowed', trips.length === 0); }
  }

  window.handleTrajFileUpload = function (e) {
    const file = e.target.files[0];
    if (!file || !destinationLatLng) { alert("Configurez la destination finale avant d'importer."); return; }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      let points = [];
      if (file.name.endsWith('.csv')) {
        const lines = ev.target.result.split('\n').filter(l => l.trim() !== '');
        lines.forEach(line => {
          const parts = line.split(/[;,]/);
          const lat = parseFloat(parts[0]), lng = parseFloat(parts[1]), w = parseFloat(parts[2]) || 1;
          if (!isNaN(lat) && !isNaN(lng)) points.push({ lat, lng, weight: w });
        });
      } else {
        const json = JSON.parse(ev.target.result);
        points = extractPointsFromGeoJSON(json, false); // false = garde le poids du fichier local si désiré
      }
      if (points.length > 0) await processPointsInBulk(points);
    };
    reader.readAsText(file);
  };

  // Correction de l'extraction des propriétés pour lire la longitude/latitude textuelle du Cloud
  // et forcer le poids à 1 si demandé.
  function extractPointsFromGeoJSON(json, forceWeightOne = false) {
    const points = [];
    const features = json.features || (json.type === 'Feature' ? [json] : []);
    
    features.forEach(f => {
      let lat = null;
      let lng = null;

      // 1. Essai de lecture depuis properties.latitude / properties.longitude (Cas du Cloud Sheets)
      if (f.properties?.latitude && f.properties?.longitude) {
        lat = parseFloat(f.properties.latitude);
        lng = parseFloat(f.properties.longitude);
      } 
      // 2. Fallback standard GeoJSON Point geometry
      else if (f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
        lng = f.geometry.coordinates[0];
        lat = f.geometry.coordinates[1];
      }

      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        // Applique 1 si forceWeightOne est vrai, sinon cherche le poids standard
        const weight = forceWeightOne ? 1 : (f.properties?.weight || f.properties?.count || f.properties?.result_score || 1);
        points.push({ lat, lng, weight });
      }
    });
    return points;
  }

  async function processPointsInBulk(points) {
    if (isProcessingBatch) return; // Sécurité double exécution
    isProcessingBatch = true;
    
    const containerBlock = document.getElementById('batchProgressContainer');
    const bar = document.getElementById('batchProgressBar');
    const percentText = document.getElementById('progressPercent');
    const mode = document.getElementById('travelMode').value;

    containerBlock.classList.remove('hidden');
    const total = points.length;

    // Boucle stricte séquentielle un trajet à la fois (await)
    for (let i = 0; i < total; i++) {
      if (!isProcessingBatch) break;
      
      // Exécute et attend la fin de la requête API avant de passer au point suivant
      await addTrip({ lat: points[i].lat, lng: points[i].lng }, points[i].weight, mode, true);
      
      const progress = Math.round(((i + 1) / total) * 100);
      bar.style.width = progress + '%';
      percentText.innerText = progress + '%';

      // Rafraîchissement régulier de l'interface graphique
      if (i % 2 === 0 || i === total - 1) { 
        renderFlow(); 
        updateTripsList(); 
      }
      
      // Respect strict des limites de l'API (1.5 seconde de délai entre chaque requête)
      await new Promise(r => setTimeout(r, 1500));
    }
    
    renderFlow();
    updateTripsList();
    isProcessingBatch = false;
    setTimeout(() => containerBlock.classList.add('hidden'), 2500);
  }

  window.stopTrajBatch = function () { isProcessingBatch = false; };

  function updateTripsList() {
    const list = document.getElementById('tripsList');
    document.getElementById('tripsCounter').innerText = trips.length;
    if (!trips.length) { list.innerHTML = `<p class="text-gray-400 italic text-center py-2">Aucun tracé actif.</p>`; return; }
    list.innerHTML = trips.slice(-30).reverse().map(t => `
      <div class="flex items-center justify-between p-1 bg-white border border-gray-200 rounded text-[10px]">
        <span>⚡ <b>${t.weight}</b> voyageurs (${t.mode.replace('-regular','')})</span>
      </div>
    `).join('');
  }

  window.clearAllTrajets = function () {
    trips = []; segmentsDict = {}; flowLayer.clearLayers(); updateTripsList();
    if (destinationMarker) { fMap.removeLayer(destinationMarker); destinationMarker = null; }
    destinationLatLng = null;
    const btn = document.getElementById('btnSetDest'); btn.querySelector('span:last-child').innerText = "Définir l'Arrivée";
    renderFlow();
  };

  async function handleMapClick(e) {
    if (isSettingDestination) {
      destinationLatLng = e.latlng;
      if (destinationMarker) fMap.removeLayer(destinationMarker);
      destinationMarker = L.marker(e.latlng, {
        icon: L.divIcon({
          className: 'bg-none',
          html: `<div class="bg-blue-600 w-8 h-8 rounded-full border-2 border-white shadow-md flex items-center justify-center text-sm">🎯</div>`,
          iconSize: [32, 32], iconAnchor: [16, 16]
        })
      }).addTo(fMap);
      window.toggleFlowDestinationMode();
      return;
    }

    if (!destinationLatLng) { alert("Définissez d'abord le pôle d'arrivée (bouton bleu)."); return; }
    const count = parseInt(document.getElementById('peopleCount').value) || 10;
    const mode = document.getElementById('travelMode').value;
    await addTrip(e.latlng, count, mode);
  }

  // ── RECALIBRAGE : IMPORTATION ET INTERPRÉTATION DIRECTE DES POINTS CLOUD ──
  window.fetchTrajetCloud = function () {
    if (!destinationLatLng) { alert("Veuillez d'abord définir la destination cible (bouton bleu) sur la carte."); return; }
    
    const btn = document.getElementById('traj-cloud-btn');
    const wrap = document.getElementById('traj-cloud-picker-wrap');
    btn.disabled = true; btn.textContent = 'Synchronisation Cloud...';

    fetch(GOOGLE_SCRIPT_URL)
      .then(res => res.json())
      .then(files => {
        if (!files.length) { alert("Aucune couche disponible sur la feuille d'envoi."); window.resetTrajCloudBtn(); return; }
        
        cloudTrajetStorage = files;
        wrap.innerHTML = `
          <label class="block text-[9px] font-bold text-gray-400 uppercase mb-1">Sélectionner la couche d'origine :</label>
          <select class="w-full p-1.5 bg-white border border-gray-300 rounded-lg mt-1 text-[11px]" onchange="window.injectCloudTrajet(this.value)">
            <option value="">-- Choisir la couche de points --</option>
            ${files.map((f, i) => `<option value="${i}">${f.fileName} (${f.sentAt})</option>`).join('')}
          </select>
          <button onclick="window.resetTrajCloudBtn()" class="text-[9px] text-gray-400 underline block mt-1 hover:text-gray-600">Fermer</button>
        `;
        wrap.classList.remove('hidden'); btn.classList.add('hidden');
      }).catch(err => { alert(err.message); window.resetTrajCloudBtn(); });
  };

  window.injectCloudTrajet = function (index) {
    if (index === "") return;
    if (!destinationLatLng) { alert("Définissez le pôle d'arrivée avant de lancer le calcul."); window.resetTrajCloudBtn(); return; }
    
    try {
      const archive = cloudTrajetStorage[parseInt(index)];
      const geojson = typeof archive.geojsonRaw === 'string' ? JSON.parse(archive.geojsonRaw) : archive.geojsonRaw;
      
      // On passe "true" pour forcer chaque ligne issue du Cloud à avoir un weight de 1
      const extractedPoints = extractPointsFromGeoJSON(geojson, true);

      if (extractedPoints.length === 0) {
        alert("Aucune entité géométrique de type 'Point' ou propriétés 'latitude'/'longitude' n'a été trouvée dans ce fichier Cloud.");
        return;
      }

      window.resetTrajCloudBtn();
      
      // Lancement de la file d'attente progressive de calcul d'itinéraire
      processPointsInBulk(extractedPoints);
      
    } catch(e) { alert("Erreur de parsing géométrique ou de chargement du fichier."); }
  };

  window.resetTrajCloudBtn = function () {
    const wrap = document.getElementById('traj-cloud-picker-wrap');
    const btn = document.getElementById('traj-cloud-btn');
    if (wrap) wrap.classList.add('hidden');
    if (btn) { btn.classList.remove('hidden'); btn.disabled = false; btn.textContent = '☁️ Calculer depuis le Cloud Sheets'; }
  };

  window.exportTrajetToCloud = function () {
    if (!trips.length) return;
    const btn = document.getElementById('btnExportSheet');
    btn.disabled = true; btn.textContent = 'Exportation...';

    const features = Object.values(segmentsDict).map(seg => turf.lineString(seg.coords, { weight: seg.weight }));
    const geojson = turf.featureCollection(features);

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: `Flux_FlowMapper_${document.getElementById('travelMode').value}`,
        sentAt: new Date().toLocaleString('fr-FR'),
        featureCount: features.length,
        geojsonRaw: JSON.stringify(geojson),
        folder: "Trajets & Flux"
      })
    })
    .then(() => {
      btn.textContent = '✓ Flux Archivé !';
      setTimeout(() => { btn.disabled = false; btn.textContent = '☁️ Archiver le résultat de flux →'; }, 2500);
    }).catch(err => { alert(err.message); btn.disabled = false; });
  };

  setTimeout(() => { window.initTrajet(); }, 500);
})();
