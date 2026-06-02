/**
 * outils/display.js
 * Visualiseur cartographique multi-couches responsive avec édition de symbologie,
 * gestion dynamique des lignes de flux complexes et export PDF automatisé.
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz1kvkUwAEwD-3Bc9SZqACaaZTVGhhGy_Om-F8vK0adfC5pBCg5amBNUEqSeteKJIrV/exec';

  // ── INJECTION SÉCURISÉE DES REQUIS DE BASE (LEAFLET + STYLES DES ÉTIQUETTES) ──
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

  if (!document.getElementById('flux-label-style')) {
    const style = document.createElement('style');
    style.id = 'flux-label-style';
    style.innerHTML = `
      .flux-polyline-label {
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid #4B5563;
        border-radius: 4px;
        padding: 1px 4px;
        font-size: 9px;
        font-weight: bold;
        color: #1F2937;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  const container = document.getElementById('display-content');
  if (!container) return;

  // Variables d'état
  let mainMap = null;
  let layerControlList = []; 
  let cloudFilesStorage = [];
  const layerColors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6366F1', '#1a1a1a'];
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
            <div id="active-layers-bucket" class="space-y-2 flex-1 overflow-y-auto pr-0.5">
              <p class="text-gray-400 italic text-center py-4 text-[11px]">Aucun calque affiché.</p>
            </div>
          </div>
        </div>

        <div class="flex-1 h-full relative">
          <div id="leaflet-display-map" class="w-full h-full bg-gray-100 z-10"></div>
          
          <button id="disp-export-pdf-btn" onclick="window.exportMapToPDF()" class="absolute bottom-4 right-4 z-[500] bg-red-600 text-white font-semibold px-3 py-2 rounded-xl shadow-lg hover:bg-red-700 transition-all flex items-center gap-1.5 text-[11px]">
            📄 Export PDF
          </button>
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
      attribution: '© OpenStreetMap',
      crossOrigin: true
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

    // Analyse préliminaire pour identifier s'il s'agit d'une couche "Ligne de Flux"
    let isFlux = false;
    let maxWeight = -Infinity;
    let minWeight = Infinity;

    if (geojson && geojson.features && Array.isArray(geojson.features)) {
      geojson.features.forEach(f => {
        if (f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) {
          if (f.properties && typeof f.properties.weight !== 'undefined') {
            const w = parseFloat(f.properties.weight);
            if (!isNaN(w)) {
              isFlux = true;
              if (w > maxWeight) maxWeight = w;
              if (w < minWeight) minWeight = w;
            }
          }
        }
      });
    }

    // Algorithme de calcul de la largeur proportionnelle (Rapport de 1 à 10 exigé)
    let computeFluxWidth = function (w) { return 2.0; };
    if (isFlux && maxWeight !== -Infinity) {
      if (minWeight === Infinity || minWeight === maxWeight) minWeight = maxWeight * 0.1; // Fallback
      const baseMin = 1.5; // Épaisseur de la plus petite ligne
      computeFluxWidth = function (w) {
        if (maxWeight === minWeight) return baseMin;
        // Interpolation linéaire stricte pour garantir que le max = 10 fois le min
        return baseMin + (9 * baseMin) * ((w - minWeight) / (maxWeight - minWeight));
      };
    }

    let labelCounter = 0;

    const leafletGeoLayer = L.geoJSON(geojson, {
      // Filtrage automatique des valeurs inférieures à 20% du maximum total
      filter: function(feature) {
        if (isFlux && maxWeight !== -Infinity && feature.properties && typeof feature.properties.weight !== 'undefined') {
          const w = parseFloat(feature.properties.weight);
          return w >= (0.2 * maxWeight);
        }
        return true;
      },
      pointToLayer: function (feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 5.5, fillColor: assignedColor, color: '#ffffff', weight: 1.2, fillOpacity: 0.85
        });
      },
      style: function (feature) {
        if (isFlux && feature.properties && typeof feature.properties.weight !== 'undefined') {
          const w = parseFloat(feature.properties.weight);
          return { color: assignedColor, weight: computeFluxWidth(w), opacity: 0.85 };
        }
        return { color: assignedColor, weight: 1.8, fillColor: assignedColor, fillOpacity: 0.15 };
      },
      onEachFeature: function (feature, layer) {
        // Popups d'attributs standardisés
        if (feature.properties) {
          const description = Object.keys(feature.properties)
            .map(k => `<strong>${k}:</strong> ${feature.properties[k]}`)
            .join('<br/>');
          layer.bindPopup(`<div class="text-[10px] leading-snug font-sans max-h-36 overflow-y-auto">${description || 'Aucun attribut'}</div>`);
        }

        // Placement intelligent des étiquettes de flux (skip 1 segment sur 3, priorité absolue à la max value)
        if (isFlux && feature.properties && typeof feature.properties.weight !== 'undefined' && typeof layer.getBounds === 'function') {
          const w = parseFloat(feature.properties.weight);
          let showLabel = false;

          if (w === maxWeight) {
            showLabel = true;
          } else {
            labelCounter++;
            if (labelCounter % 3 === 0) showLabel = true;
          }

          if (showLabel) {
            layer.bindTooltip(String(w), {
              permanent: true,
              direction: 'center',
              className: 'flux-polyline-label'
            });
          }
        }
      }
    }).addTo(mainMap);

    layerControlList.push({
      id: 'layer_' + Date.now() + Math.random().toString(36).slice(2, 7),
      name: layerName,
      color: assignedColor,
      weight: isFlux ? 2 : 1.8, // Valeur de base servant de multiplicateur pour le flux ou fixe pour le reste
      opacity: 0.85,
      isFlux: isFlux,
      maxWeight: maxWeight,
      minWeight: minWeight,
      computeFluxWidth: computeFluxWidth,
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
      <div class="p-2 bg-white border border-gray-200 rounded-lg shadow-sm space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 overflow-hidden flex-1">
            <span class="w-2.5 h-2.5 rounded-full shrink-0 legend-color-dot-${lyr.id}" style="background-color: ${lyr.color}; opacity: ${lyr.opacity}"></span>
            <span class="font-medium text-gray-700 truncate block text-[11px]" title="${lyr.name}">${lyr.name}</span>
            ${lyr.isFlux ? `<span class="px-1 py-0.2 bg-blue-50 text-blue-600 text-[8px] font-bold rounded border border-blue-200">Flux</span>` : ''}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button onclick="window.toggleLayerStyleConfig('${lyr.id}')" class="p-0.5 hover:bg-gray-100 rounded text-gray-500" title="Modifier le style">🎨</button>
            <button onclick="window.toggleLayerVisibility('${lyr.id}')" class="p-0.5 hover:bg-gray-100 rounded text-gray-500">${lyr.visible ? '👁️' : '🙈'}</button>
            <button onclick="window.removeDisplayLayer('${lyr.id}')" class="p-0.5 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded">✕</button>
          </div>
        </div>
        
        <div id="style-panel-${lyr.id}" class="hidden border-t border-gray-100 pt-1.5 grid grid-cols-3 gap-1.5 text-[10px] text-gray-600 bg-gray-50/50 p-1 rounded">
          <div>
            <label class="block text-[8px] text-gray-400 font-medium uppercase">Couleur</label>
            <input type="color" value="${lyr.color}" oninput="window.updateLayerSymbology('${lyr.id}', 'color', this.value)" class="w-full h-5 p-0 border-0 rounded cursor-pointer" />
          </div>
          <div>
            <label class="block text-[8px] text-gray-400 font-medium uppercase">${lyr.isFlux ? 'Échelle' : 'Épaisseur'}</label>
            <input type="range" min="0.5" max="10" step="0.5" value="${lyr.weight}" oninput="window.updateLayerSymbology('${lyr.id}', 'weight', this.value)" class="w-full accent-gray-700" />
          </div>
          <div>
            <label class="block text-[8px] text-gray-400 font-medium uppercase">Opacité</label>
            <input type="range" min="0.1" max="1" step="0.1" value="${lyr.opacity}" oninput="window.updateLayerSymbology('${lyr.id}', 'opacity', this.value)" class="w-full accent-gray-700" />
          </div>
        </div>
      </div>
    `).join('');
  }

  // Fonctions de contrôle de l'interface de style
  window.toggleLayerStyleConfig = function (id) {
    const panel = document.getElementById(`style-panel-${id}`);
    if (panel) panel.classList.toggle('hidden');
  };

  window.updateLayerSymbology = function (id, property, value) {
    const lyr = layerControlList.find(l => l.id === id);
    if (!lyr) return;

    if (property === 'color') {
      lyr.color = value;
      // Met à jour les éléments vectoriels de base ainsi que les marqueurs de points potentiels
      lyr.leafletLayer.setStyle({ color: value, fillColor: value });
      lyr.leafletLayer.eachLayer(sub => { if (sub.setStyle) sub.setStyle({ color: value, fillColor: value }); });
    } 
    else if (property === 'weight') {
      const numVal = parseFloat(value);
      lyr.weight = numVal;
      if (lyr.isFlux) {
        // Applique l'épaisseur proportionnellement comme coefficient d'échelle globale
        lyr.leafletLayer.eachLayer(sub => {
          if (sub.feature && typeof sub.feature.properties.weight !== 'undefined' && sub.setStyle) {
            const w = parseFloat(sub.feature.properties.weight);
            sub.setStyle({ weight: lyr.computeFluxWidth(w) * (numVal / 2) });
          }
        });
      } else {
        lyr.leafletLayer.setStyle({ weight: numVal });
      }
    } 
    else if (property === 'opacity') {
      const numVal = parseFloat(value);
      lyr.opacity = numVal;
      lyr.leafletLayer.setStyle({ opacity: numVal, fillOpacity: numVal * 0.4 });
      lyr.leafletLayer.eachLayer(sub => { if (sub.setStyle) sub.setStyle({ opacity: numVal, fillOpacity: numVal * 0.85 }); });
    }

    // Rafraîchissement direct de la pastille de couleur sans recréer le DOM (évite la perte de focus des sliders)
    const dot = document.querySelector(`.legend-color-dot-${id}`);
    if (dot) {
      dot.style.backgroundColor = lyr.color;
      dot.style.opacity = lyr.opacity;
    }
  };

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

  // ── MOTEUR D'EXPORTATION CARTOGRAPHIQUE PDF MULTI-COUCHES ──
  window.exportMapToPDF = function () {
    const btn = document.getElementById('disp-export-pdf-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⌛ Génération PDF...';

    function loadDependency(url) {
      return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }

    const loaders = [];
    if (!window.html2canvas) loaders.push(loadDependency('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'));
    if (!window.jspdf) loaders.push(loadDependency('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'));

    Promise.all(loaders).then(() => {
      const mapElement = document.getElementById('leaflet-display-map');

      // Capture de l'élément de carte Leaflet en tenant compte des configurations CORS des tuiles
      html2canvas(mapElement, {
        useCORS: true,
        allowTaint: false,
        scale: 2, // Augmentation de la résolution pour un rendu propre à l'impression
        logging: false
      }).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        
        // Création du document au format Paysage A4
        const pdf = new jsPDF('l', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        // En-tête du document PDF
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(15);
        pdf.setTextColor(31, 41, 55);
        pdf.text("Export Cartographique Officiel", 15, 15);
        
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Généré le : ${new Date().toLocaleString()}`, 15, 20);

        // Insertion et calcul de la taille de la carte capturée
        const mapWidthMM = pdfWidth - 30; // Marges gauche/droite de 15mm
        let mapHeightMM = (canvas.height * mapWidthMM) / canvas.width;
        if (mapHeightMM > 115) mapHeightMM = 115; // Contrainte de hauteur max pour laisser de la place à la légende

        pdf.addImage(imgData, 'PNG', 15, 24, mapWidthMM, mapHeightMM);

        // Ajout de la Légende dynamique (uniquement les couches cochées visibles 👁️)
        let currentY = 24 + mapHeightMM + 12;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.setTextColor(31, 41, 55);
        pdf.text("Légende des couches visibles", 15, currentY);
        currentY += 6;

        const visibleLayers = layerControlList.filter(l => l.visible);

        if (visibleLayers.length === 0) {
          pdf.setFont("helvetica", "italic");
          pdf.setFontSize(9);
          pdf.setTextColor(156, 163, 175);
          pdf.text("Aucune couche active visible sur cette carte.", 15, currentY);
        } else {
          pdf.setFontSize(9.5);
          visibleLayers.forEach(lyr => {
            // Saut de page automatique si la liste des légendes dépasse la hauteur A4
            if (currentY > pdfHeight - 15) {
              pdf.addPage('l', 'mm', 'a4');
              currentY = 20;
            }

            // Conversion Hex -> RGB pour jsPDF
            const hex = lyr.color.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);

            // Dessin du rectangle de couleur indicateur
            pdf.setFillColor(r, g, b);
            pdf.rect(15, currentY - 3.5, 4, 4, 'F');

            // Intitulé et métadonnées de la couche
            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(55, 65, 81);
            let metaTxt = lyr.name;
            if (lyr.isFlux) metaTxt += ` (Ligne de flux - Max Weight: ${lyr.maxWeight})`;
            
            pdf.text(metaTxt, 22, currentY);
            currentY += 5.5;
          });
        }

        // Téléchargement du fichier PDF final
        pdf.save(`export_carto_${Date.now()}.pdf`);
        
        btn.disabled = false;
        btn.textContent = originalText;
      }).catch(err => {
        console.error(err);
        alert("Erreur technique survenue lors du rendu graphique de la carte.");
        btn.disabled = false;
        btn.textContent = originalText;
      });
    }).catch(() => {
      alert("Échec du chargement des utilitaires d'exportation PDF externes.");
      btn.disabled = false;
      btn.textContent = originalText;
    });
  };

  // ── SÉLECTION CLOUD PAR STRATE DE DOSSIERS INTERACTIFS (INALTERÉ) ──
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

        cloudFilesStorage = files;
        const groups = {};
        files.forEach((f, globalIdx) => {
          const rawFolder = f.folder || f.Folder || "";
          const folderName = rawFolder && String(rawFolder).trim() !== "" ? String(rawFolder).trim() : "Fichiers non classés";
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
                      <span id="c_icon_fold_c_fold_${fIdx}">📁</span>
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
    const icon = document.getElementById('c_icon_fold_' + id);
    if (el.classList.contains('hidden')) { 
      el.classList.remove('hidden'); 
      if (icon) icon.textContent = '📂'; 
    } else { 
      el.classList.add('hidden'); 
      if (icon) icon.textContent = '📁'; 
    }
  };

  window.loadCloudFileToMap = function (globalIndex) {
    try {
      const archive = cloudFilesStorage[globalIndex];
      const geojson = typeof archive.geojsonRaw === 'string' ? JSON.parse(archive.geojsonRaw) : archive.geojsonRaw;
      injectGeoJsonLayer(geojson, archive.fileName);
      fitMapBounds();
    } catch (e) { alert("Erreur lors de l'intégration de la couche."); }
  };

  window.loadCloudFolderToMap = function (encodedFolderName) {
    const targetFolder = decodeURIComponent(encodedFolderName);
    let loadedCount = 0;

    cloudFilesStorage.forEach(archive => {
      const rawFolder = archive.folder || archive.Folder || "";
      const fileFolder = rawFolder && String(rawFolder).trim() !== "" ? String(rawFolder).trim() : "Fichiers non classés";
      
      if (fileFolder === targetFolder) {
        try {
          const geojson = typeof archive.geojsonRaw === 'string' ? JSON.parse(archive.geojsonRaw) : archive.geojsonRaw;
          injectGeoJsonLayer(geojson, archive.fileName);
          loadedCount++;
        } catch(e) { console.warn(`Échec de chargement sur : ${archive.fileName}`); }
      }
    });

    if (loadedCount > 0) {
      fitMapBounds();
      alert(`Dossier "${targetFolder}" : ${loadedCount} calques intégrés.`);
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
