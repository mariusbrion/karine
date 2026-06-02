/**
 * outils/display.js
 * Visualiseur cartographique multi-couches responsive avec édition de symbologie,
 * gestion dynamique des lignes de flux complexes, synchronisation stricte des dossiers
 * et moteur d'exportation JPEG isolé par clone virtuel (correction de superposition).
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyl132O-cCNrE5H4AVHE2F7pCWO3bzq_r3Tz-MK562sOkd52XyS8auIga0p8h5Rrjkh/exec';

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
  let cloudFolderKeys = [];
  const layerColors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6366F1', '#1a1a1a'];
  let colorIndex = 0;

  window.initDisplay = function () {
    layerControlList = [];
    cloudFilesStorage = [];
    cloudFolderKeys = [];
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

    let computeFluxWidth = function (w) { return 2.0; };
    if (isFlux && maxWeight !== -Infinity) {
      if (minWeight === Infinity || minWeight === maxWeight) minWeight = maxWeight * 0.1;
      const baseMin = 1.5;
      computeFluxWidth = function (w) {
        if (maxWeight === minWeight) return baseMin;
        return baseMin + (9 * baseMin) * ((w - minWeight) / (maxWeight - minWeight));
      };
    }

    let labelCounter = 0;

    const leafletGeoLayer = L.geoJSON(geojson, {
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
        if (feature.properties) {
          const description = Object.keys(feature.properties)
            .map(k => `<strong>${k}:</strong> ${feature.properties[k]}`)
            .join('<br/>');
          layer.bindPopup(`<div class="text-[10px] leading-snug font-sans max-h-36 overflow-y-auto">${description || 'Aucun attribut'}</div>`);
        }

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
      weight: isFlux ? 2 : 1.8, 
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

  window.toggleLayerStyleConfig = function (id) {
    const panel = document.getElementById(`style-panel-${id}`);
    if (panel) panel.classList.toggle('hidden');
  };

  window.updateLayerSymbology = function (id, property, value) {
    const lyr = layerControlList.find(l => l.id === id);
    if (!lyr) return;

    if (property === 'color') {
      lyr.color = value;
      lyr.leafletLayer.setStyle({ color: value, fillColor: value });
      lyr.leafletLayer.eachLayer(sub => { if (sub.setStyle) sub.setStyle({ color: value, fillColor: value }); });
    } 
    else if (property === 'weight') {
      const numVal = parseFloat(value);
      lyr.weight = numVal;
      if (lyr.isFlux) {
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

  // ── HELPERS : DÉCODAGE DES TRANSFORMS CSS (matrix ET matrix3d) ──
  function getTranslateFromTransform(transformStr) {
    if (!transformStr || transformStr === 'none') return { x: 0, y: 0 };

    // matrix3d(a,b,c,d, e,f,g,h, i,j,k,l, tx,ty,tz,tw)
    const m3 = transformStr.match(/^matrix3d\((.+)\)$/);
    if (m3) {
      const v = m3[1].split(',').map(s => parseFloat(s.trim()));
      return { x: v[12] || 0, y: v[13] || 0 };
    }

    // matrix(a,b,c,d,tx,ty)
    const m2 = transformStr.match(/^matrix\((.+)\)$/);
    if (m2) {
      const v = m2[1].split(',').map(s => parseFloat(s.trim()));
      return { x: v[4] || 0, y: v[5] || 0 };
    }

    // translate(x, y) ou translate3d(x, y, z)
    const t3 = transformStr.match(/translate3d\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);
    if (t3) return { x: parseFloat(t3[1]), y: parseFloat(t3[2]) };

    const t2 = transformStr.match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);
    if (t2) return { x: parseFloat(t2[1]), y: parseFloat(t2[2]) };

    return { x: 0, y: 0 };
  }

  // ── NORMALISATION COMPLÈTE DE TOUS LES PANES LEAFLET DANS LE CLONE ──
  // Stratégie : récupérer les transforms calculés DANS LE DOCUMENT LIVE,
  // puis les convertir en top/left absolus dans le clone (qui n'a pas le JS Leaflet actif).
  function normalizeLeafletClone(clonedDoc, liveDoc) {
    const clonedMapEl = clonedDoc.getElementById('leaflet-display-map');
    if (!clonedMapEl) return;

    // 1. Neutraliser overflow:hidden sur le conteneur de la carte pour que html2canvas
    //    capture tout ce qui déborde (tooltips, etc.)
    clonedMapEl.style.overflow = 'visible';

    // 2. Résoudre le pane principal (leaflet-map-pane) — il porte le translate3d global
    const liveMapPane = liveDoc.querySelector('#leaflet-display-map .leaflet-map-pane');
    const clonedMapPane = clonedMapEl.querySelector('.leaflet-map-pane');

    if (liveMapPane && clonedMapPane) {
      const liveTransform = window.getComputedStyle(liveMapPane).transform;
      const { x: px, y: py } = getTranslateFromTransform(liveTransform);

      const baseLeft = parseFloat(clonedMapPane.style.left) || 0;
      const baseTop  = parseFloat(clonedMapPane.style.top)  || 0;

      clonedMapPane.style.transform = 'none';
      clonedMapPane.style.left = (baseLeft + px) + 'px';
      clonedMapPane.style.top  = (baseTop  + py) + 'px';
    }

    // 3. Traiter TOUS les panes enfants (tile-pane, overlay-pane, marker-pane,
    //    tooltip-pane, shadow-pane, etc.) qui peuvent avoir leur propre transform
    const liveChildPanes  = liveDoc.querySelectorAll('#leaflet-display-map .leaflet-map-pane > *');
    const clonedChildPanes = clonedMapEl.querySelectorAll('.leaflet-map-pane > *');

    liveChildPanes.forEach((livePaneChild, idx) => {
      const clonedPaneChild = clonedChildPanes[idx];
      if (!clonedPaneChild) return;

      const t = window.getComputedStyle(livePaneChild).transform;
      if (t && t !== 'none') {
        const { x, y } = getTranslateFromTransform(t);
        if (x !== 0 || y !== 0) {
          const bl = parseFloat(clonedPaneChild.style.left) || 0;
          const bt = parseFloat(clonedPaneChild.style.top)  || 0;
          clonedPaneChild.style.transform = 'none';
          clonedPaneChild.style.left = (bl + x) + 'px';
          clonedPaneChild.style.top  = (bt + y) + 'px';
        }
      }
    });

    // 4. Forcer visibilité des tooltips permanents
    clonedMapEl.querySelectorAll('.leaflet-tooltip').forEach(t => {
      t.style.opacity      = '1';
      t.style.visibility   = 'visible';
      t.style.display      = 'block';
      t.style.pointerEvents = 'none';
    });

    // 5. S'assurer que le SVG overlay n'est pas décalé
    clonedMapEl.querySelectorAll('.leaflet-overlay-pane svg').forEach(svg => {
      svg.style.transform = 'none';
      svg.style.position  = 'absolute';
      svg.style.left = '0';
      svg.style.top  = '0';
    });
  }

  // ── LOGIQUE EXPORT PDF — CORRECTION COMPLÈTE DES DÉCALAGES LEAFLET ──
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
    if (!window.jspdf)       loaders.push(loadDependency('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'));

    Promise.all(loaders).then(() => {
      const mapElement = document.getElementById('leaflet-display-map');

      // Garder une référence au document live AVANT que html2canvas ne clone
      const liveDoc = document;

      html2canvas(mapElement, {
        useCORS:     true,
        allowTaint:  false,
        scale:       2,
        logging:     false,
        // Désactiver la détection automatique de foreignObject pour éviter les doubles passes
        foreignObjectRendering: false,

        onclone: function (clonedDoc) {
          // Déléguer toute la correction au helper dédié
          normalizeLeafletClone(clonedDoc, liveDoc);
        }
      }).then(canvas => {
        // Encodage JPEG
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const { jsPDF } = window.jspdf;
        
        const pdf = new jsPDF('l', 'mm', 'a4');
        const pdfWidth  = pdf.internal.pageSize.getWidth();   // 297mm
        const pdfHeight = pdf.internal.pageSize.getHeight();  // 210mm

        // En-tête textuel
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(14);
        pdf.setTextColor(31, 41, 55);
        pdf.text("Export Cartographique", 15, 15);
        
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Généré le : ${new Date().toLocaleString()}`, 15, 20);

        // Calcul aspect ratio strict pour éviter les étirements
        const canvasRatio = canvas.width / canvas.height;
        let mapWidthMM  = pdfWidth - 30;
        let mapHeightMM = mapWidthMM / canvasRatio;

        if (mapHeightMM > 118) {
          mapHeightMM = 118;
          mapWidthMM  = mapHeightMM * canvasRatio;
        }

        const posX = (pdfWidth - mapWidthMM) / 2;
        const posY = 24;

        pdf.addImage(imgData, 'JPEG', posX, posY, mapWidthMM, mapHeightMM);

        // Légende dynamique
        let currentY = posY + mapHeightMM + 12;
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
            if (currentY > pdfHeight - 15) {
              pdf.addPage('l', 'mm', 'a4');
              currentY = 20;
            }

            const hex = lyr.color.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);

            pdf.setFillColor(r, g, b);
            pdf.rect(15, currentY - 3.5, 4, 4, 'F');

            pdf.setFont("helvetica", "normal");
            pdf.setTextColor(55, 65, 81);
            let metaTxt = lyr.name;
            if (lyr.isFlux) metaTxt += ` (Ligne de flux - Max Weight: ${lyr.maxWeight})`;
            
            pdf.text(metaTxt, 22, currentY);
            currentY += 5.5;
          });
        }

        pdf.save(`export_carto_${Date.now()}.pdf`);
        btn.disabled = false;
        btn.textContent = originalText;
      }).catch(err => {
        console.error(err);
        alert("Erreur technique lors de la capture de la carte.");
        btn.disabled = false;
        btn.textContent = originalText;
      });
    }).catch(() => {
      alert("Échec du téléchargement des librairies d'exportation.");
      btn.disabled = false;
      btn.textContent = originalText;
    });
  };

  // ── LOGIQUE CLOUD ET EXTRACTION DU DOSSIER HARMONISÉE DEPUIS L'URL EXACTE ──
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
        files.forEach(f => {
          const folderName = f.folder && f.folder.trim() !== "" ? f.folder.trim() : "Fichiers non classés";
          if (!groups[folderName]) groups[folderName] = [];
          groups[folderName].push(f);
        });

        cloudFolderKeys = Object.keys(groups);

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
            ${cloudFolderKeys.map((folderName, fIdx) => {
              const folderItems = groups[folderName];
              return `
                <div class="border border-gray-200 bg-white rounded-lg overflow-hidden">
                  <div class="flex items-center justify-between px-2.5 py-1.5 bg-gray-100/70 select-none">
                    <div class="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0" onclick="window.toggleCloudDispFolderDOM('c_fold_${fIdx}')">
                      <span id="c_icon_fold_c_fold_${fIdx}">📁</span>
                      <span class="font-semibold text-gray-700 truncate text-[11px]">${folderName}</span>
                      <span class="bg-gray-200 text-gray-600 px-1 py-0.2 rounded-full text-[9px] font-medium">${folderItems.length}</span>
                    </div>
                    <button onclick="window.loadCloudFolderToMap(${fIdx})" class="text-[9px] bg-gray-900 text-white font-medium px-1.5 py-0.5 rounded hover:bg-gray-800 shrink-0 ml-1">
                      ⚡ charger tout
                    </button>
                  </div>
                  <div id="c_fold_${fIdx}" class="divide-y divide-gray-50 hidden bg-white">
                    ${folderItems.map(item => {
                      const globalIndex = cloudFilesStorage.findIndex(c => c.fileName === item.fileName && c.sentAt === item.sentAt);
                      return `
                        <div class="p-2 flex items-center justify-between gap-2 hover:bg-gray-50/60">
                          <div class="min-w-0">
                            <p class="font-medium text-gray-800 text-[10px] truncate" title="${item.fileName}">${item.fileName}</p>
                            <p class="text-[9px] text-gray-400">${item.featureCount} entités</p>
                          </div>
                          <button onclick="window.loadCloudFileToMap(${globalIndex})" class="text-[10px] text-blue-600 font-medium hover:underline shrink-0">
                            ➕ ajouter
                          </button>
                        </div>
                      `;
                    }).join('')}
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
    if (globalIndex === -1 || !cloudFilesStorage[globalIndex]) return;
    try {
      const archive = cloudFilesStorage[globalIndex];
      const geojson = typeof archive.geojsonRaw === 'string' ? JSON.parse(archive.geojsonRaw) : archive.geojsonRaw;
      injectGeoJsonLayer(geojson, archive.fileName);
      fitMapBounds();
    } catch (e) { alert("Erreur lors de l'intégration de la couche."); }
  };

  window.loadCloudFolderToMap = function (folderIndex) {
    const targetFolder = cloudFolderKeys[folderIndex];
    if (!targetFolder) return;

    let loadedCount = 0;
    cloudFilesStorage.forEach(archive => {
      const currentFolder = archive.folder && archive.folder.trim() !== "" ? archive.folder.trim() : "Fichiers non classés";
      
      if (currentFolder === targetFolder) {
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
