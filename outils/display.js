/**
 * outils/display.js
 * Visualiseur cartographique multi-couches responsive propulsé par Deck.gl.
 * Supporte l'édition de symbologie (lignes, polygones et rayon des points), la gestion
 * dynamique des lignes de flux complexes (filtrage à 30%), l'arbre Cloud et l'export PDF.
 */

(function () {
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyl132O-cCNrE5H4AVHE2F7pCWO3bzq_r3Tz-MK562sOkd52XyS8auIga0p8h5Rrjkh/exec';

  // ── INJECTION SÉCURISÉE DE DECK.GL (VERSION STANDALONE STABLE) ──
  if (!window.deck) {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/deck.gl@8.9.35/dist.min.js';
    document.head.appendChild(s);
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
    if (mainMap) { mainMap.finalize(); mainMap = null; }
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
          <div id="deck-display-container" class="w-full h-full bg-gray-100 relative">
            <canvas id="deck-canvas" class="w-full h-full z-10 block"></canvas>
          </div>
          
          <button id="disp-export-pdf-btn" onclick="window.exportMapToPDF()" class="absolute bottom-4 right-4 z-[500] bg-red-600 text-white font-semibold px-3 py-2 rounded-xl shadow-lg hover:bg-red-700 transition-all flex items-center gap-1.5 text-[11px]">
            📄 Export PDF
          </button>
        </div>

      </div>
    `;

    setTimeout(() => {
      initDeckGLDisplay();
      setupDisplayDrop();
    }, 550);
  }

  function initDeckGLDisplay() {
    if (mainMap) return;
    if (!window.deck) { setTimeout(initDeckGLDisplay, 100); return; }

    mainMap = new deck.DeckGL({
      canvas: 'deck-canvas',
      container: 'deck-display-container',
      initialViewState: { longitude: 1.888334, latitude: 46.603354, zoom: 5.5, pitch: 0, bearing: 0 },
      controller: true,
      glOptions: { preserveDrawingBuffer: true },
      
      // Fermeture automatique de la popup d'infos si l'utilisateur déplace la carte
      onViewStateChange: () => {
        const popup = document.getElementById('deck-popup-info');
        if (popup) popup.style.display = 'none';
      },

      // GESTIONNAIRE DE CLIC INTERACTIF POUR LES COUCHES GEOJSON
      onClick: (info) => {
        let popup = document.getElementById('deck-popup-info');
        if (!popup) {
          popup = document.createElement('div');
          popup.id = 'deck-popup-info';
          popup.className = 'absolute z-[600] bg-white p-3 rounded-xl border border-gray-200 shadow-xl text-[10px] leading-snug font-sans max-h-44 overflow-y-auto text-gray-800 min-w-[160px] pointer-events-auto';
          document.getElementById('deck-display-container').appendChild(popup);
        }

        if (info && info.object && info.object.properties) {
          const props = info.object.properties;
          const description = Object.keys(props)
            .map(k => `<strong>${k}:</strong> ${props[k]}`)
            .join('<br/>');

          popup.innerHTML = `
            <div class="relative pt-2">
              <button onclick="document.getElementById('deck-popup-info').style.display='none'" class="absolute -top-1 right-0 text-gray-400 hover:text-gray-600 font-bold text-xs">✕</button>
              <div class="pr-3">${description || 'Aucun attribut disponible'}</div>
            </div>
          `;
          popup.style.left = `${info.x + 10}px`;
          popup.style.top = `${info.y + 10}px`;
          popup.style.display = 'block';
        } else {
          popup.style.display = 'none';
        }
      },
      layers: []
    });

    updateDeckLayers();
  }

  // Moteur centralisé de rafraîchissement des couches Deck.gl
  function updateDeckLayers() {
    if (!mainMap) return;

    // 1. Couche de base cartographique (Tuiles raster)
    const layers = [
      new deck.TileLayer({
        id: 'base-tiles',
        data: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        renderSubLayers: props => {
          const { bbox: { west, south, east, north } } = props.tile;
          return new deck.BitmapLayer(props, {
            data: null,
            image: props.data,
            bounds: [west, south, east, north]
          });
        }
      })
    ];

    // 2. Génération dynamique des couches vectorielles et textuelles
    layerControlList.forEach(lyr => {
      if (!lyr.visible) return;

      const rgb = hexToRgb(lyr.color);
      const alpha = Math.round(lyr.opacity * 255);

      // FILTRAGE DES ENTIÉS DE FLUX PASSÉ À 30% DU MAXIMUM DE LA COUCHE
      let featuresToRender = lyr.geojson.features || [];
      if (lyr.isFlux) {
        featuresToRender = featuresToRender.filter(f => {
          if (f.properties && typeof f.properties.weight !== 'undefined') {
            return parseFloat(f.properties.weight) >= (0.3 * lyr.maxWeight);
          }
          return true;
        });
      }

      // Ajout de la couche vectorielle GeoJSON principal
      layers.push(new deck.GeoJsonLayer({
        id: `geojson-layer-${lyr.id}`,
        data: { type: "FeatureCollection", features: featuresToRender },
        pickable: true,
        stroked: true,
        filled: true,
        lineWidthMinPixels: 1,
        getLineColor: [...rgb, alpha],
        getFillColor: [...rgb, Math.round(alpha * 0.3)],
        
        // Gestion de l'épaisseur des lignes et polylignes
        getLineWidth: f => {
          if (lyr.isFlux && f.properties && typeof f.properties.weight !== 'undefined') {
            const w = parseFloat(f.properties.weight);
            return lyr.computeFluxWidth(w) * (lyr.weight / 2);
          }
          return lyr.weight;
        },

        // GESTION DU CURSEUR DYNAMIQUE APPLIQUÉ DIRECTEMENT SUR LE RAYON DU POINT (GROSSIR/RÉTRÉCIR)
        getPointRadius: f => lyr.weight * 3, 
        pointRadiusMinPixels: 2
      }));

      // Ajout des étiquettes textuelles de flux
      if (lyr.isFlux) {
        const textData = [];
        let labelCounter = 0;

        featuresToRender.forEach(f => {
          if (f.properties && typeof f.properties.weight !== 'undefined') {
            const w = parseFloat(f.properties.weight);
            let showLabel = false;

            if (w === lyr.maxWeight) {
              showLabel = true;
            } else {
              labelCounter++;
              if (labelCounter % 3 === 0) showLabel = true;
            }

            if (showLabel) {
              const coords = f.geometry.coordinates;
              let midPos = null;

              if (f.geometry.type === 'LineString' && coords.length) {
                midPos = coords[Math.floor(coords.length / 2)];
              } else if (f.geometry.type === 'MultiLineString' && coords.length) {
                const firstLine = coords[0];
                if (firstLine && firstLine.length) {
                  midPos = firstLine[Math.floor(firstLine.length / 2)];
                }
              }

              if (midPos) {
                textData.push({ text: String(w), position: midPos });
              }
            }
          }
        });

        layers.push(new deck.TextLayer({
          id: `text-layer-${lyr.id}`,
          data: textData,
          getPosition: d => d.position,
          getText: d => d.text,
          getSize: 11,
          fontFamily: 'Arial, sans-serif',
          fontWeight: 'bold',
          getColor: [31, 41, 55, 255],
          getAlignmentBaseline: 'center',
          getJustifyHorizontal: 'center',
          background: true,
          getBackgroundColor: [255, 255, 255, 240],
          backgroundPadding: [3, 1, 3, 1]
        }));
      }
    });

    mainMap.setProps({ layers });
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

    layerControlList.push({
      id: 'layer_' + Date.now() + Math.random().toString(36).slice(2, 7),
      name: layerName,
      color: assignedColor,
      weight: isFlux ? 3 : 2, 
      opacity: 0.85,
      isFlux: isFlux,
      maxWeight: maxWeight,
      minWeight: minWeight,
      computeFluxWidth: computeFluxWidth,
      geojson: geojson,
      visible: true
    });

    refreshLegendPanel();
    updateDeckLayers();
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
            <label class="block text-[8px] text-gray-400 font-medium uppercase">${lyr.isFlux ? 'Échelle' : 'Taille / Rayon'}</label>
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

    if (property === 'color') lyr.color = value;
    else if (property === 'weight') lyr.weight = parseFloat(value);
    else if (property === 'opacity') lyr.opacity = parseFloat(value);

    const dot = document.querySelector(`.legend-color-dot-${id}`);
    if (dot) {
      dot.style.backgroundColor = lyr.color;
      dot.style.opacity = lyr.opacity;
    }

    updateDeckLayers();
  };

  window.toggleLayerVisibility = function (id) {
    const lyr = layerControlList.find(l => l.id === id);
    if (!lyr) return;
    lyr.visible = !lyr.visible;
    refreshLegendPanel();
    updateDeckLayers();
  };

  window.removeDisplayLayer = function (id) {
    const idx = layerControlList.findIndex(l => l.id === id);
    if (idx === -1) return;
    layerControlList.splice(idx, 1);
    refreshLegendPanel();
    updateDeckLayers();
    fitMapBounds();
  };

  function fitMapBounds() {
    const activeLayers = layerControlList.filter(l => l.visible);
    if (activeLayers.length === 0) return;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasCoords = false;

    activeLayers.forEach(lyr => {
      const features = lyr.geojson.features || [];
      features.forEach(f => {
        if (!f.geometry) return;
        const process = (arr) => {
          if (typeof arr[0] === 'number') {
            const [lon, lat] = arr;
            if (lon < minX) minX = lon; if (lon > maxX) maxX = lon;
            if (lat < minY) minY = lat; if (lat > maxY) maxY = lat;
            hasCoords = true;
          } else { arr.forEach(process); }
        };
        process(f.geometry.coordinates);
      });
    });

    if (hasCoords && mainMap) {
      const centerLon = (minX + maxX) / 2;
      const centerLat = (minY + maxY) / 2;
      const maxDiff = Math.max(Math.abs(maxY - minY), Math.abs(maxX - minX));
      
      let zoom = 11;
      if (maxDiff > 30) zoom = 3;
      else if (maxDiff > 12) zoom = 5;
      else if (maxDiff > 5) zoom = 6.5;
      else if (maxDiff > 2) zoom = 8;
      else if (maxDiff > 0.5) zoom = 10;

      mainMap.setProps({
        initialViewState: { longitude: centerLon, latitude: centerLat, zoom: zoom, pitch: 0, bearing: 0, transitionDuration: 500 }
      });
    }
  }

  // ── LOGIQUE EXPORT PDF DIRECT RECOUVREMENT PARFAIT WEBGL SANS HTML2CANVAS ──
  window.exportMapToPDF = function () {
    if (!mainMap) return;
    const btn = document.getElementById('disp-export-pdf-btn');
    const originalText = btn.textContent;
    btn.disabled = true; btn.textContent = '⌛ Génération PDF...';

    if (!window.jspdf) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = () => executePDFRender(btn, originalText);
      document.head.appendChild(script);
    } else {
      executePDFRender(btn, originalText);
    }
  };

  function executePDFRender(btn, originalText) {
    const canvas = document.getElementById('deck-canvas');
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('l', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.setTextColor(31, 41, 55);
    pdf.text("Export Cartographique", 15, 15);
    
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(107, 114, 128);
    pdf.text(`Généré le : ${new Date().toLocaleString()}`, 15, 20);

    const canvasRatio = canvas.width / canvas.height;
    let mapWidthMM = pdfWidth - 30;
    let mapHeightMM = mapWidthMM / canvasRatio;

    if (mapHeightMM > 118) {
      mapHeightMM = 118; mapWidthMM = mapHeightMM * canvasRatio;
    }

    const posX = (pdfWidth - mapWidthMM) / 2;
    pdf.addImage(imgData, 'JPEG', posX, 24, mapWidthMM, mapHeightMM);

    let currentY = 24 + mapHeightMM + 12;
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(31, 41, 55);
    pdf.text("Légende des couches visibles", 15, currentY);
    currentY += 6;

    const visibleLayers = layerControlList.filter(l => l.visible);
    if (visibleLayers.length === 0) {
      pdf.setFont("helvetica", "italic"); pdf.setFontSize(9); pdf.setTextColor(156, 163, 175);
      pdf.text("Aucune couche active visible.", 15, currentY);
    } else {
      pdf.setFontSize(9.5);
      visibleLayers.forEach(lyr => {
        if (currentY > pdfHeight - 15) { pdf.addPage('l', 'mm', 'a4'); currentY = 20; }
        const rgb = hexToRgb(lyr.color);
        pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
        pdf.rect(15, currentY - 3.5, 4, 4, 'F');
        pdf.setFont("helvetica", "normal"); pdf.setTextColor(55, 65, 81);
        
        let metaTxt = lyr.name;
        if (lyr.isFlux) metaTxt += ` (Ligne de flux - Max Weight: ${lyr.maxWeight})`;
        pdf.text(metaTxt, 22, currentY);
        currentY += 5.5;
      });
    }

    pdf.save(`export_carto_${Date.now()}.pdf`);
    btn.disabled = false; btn.textContent = originalText;
  }

  // ── SYNCHRONISATEUR DE DOSSIERS CLOUD INTERACTIFS (LOGIQUE COPIE CONFORME ORGA.JS) ──
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
              const folderItems = groups[folderName];
              return `
                <div class="border border-gray-200 bg-white rounded-lg overflow-hidden">
                  <div class="flex items-center justify-between px-2.5 py-1.5 bg-gray-100/70 select-none">
                    <div class="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0" onclick="window.toggleCloudDispFolderDOM('c_fold_${fIdx}')">
                      <span id="c_icon_fold_c_fold_${fIdx}">📁</span>
                      <span class="font-semibold text-gray-700 truncate text-[11px]">${folderName}</span>
                      <span class="bg-gray-200 text-gray-600 px-1 py-0.2 rounded-full text-[9px] font-medium">${folderItems.length}</span>
                    </div>
                    <button onclick="window.loadCloudFolderToMap('${encodeURIComponent(folderName)}')" class="text-[9px] bg-gray-900 text-white font-medium px-1.5 py-0.5 rounded hover:bg-gray-800 shrink-0 ml-1">
                      ⚡ charger tout
                    </button>
                  </div>
                  <div id="c_fold_${fIdx}" class="divide-y divide-gray-50 hidden bg-white">
                    ${folderItems.map(item => `
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
        
        btn.classList.add('hidden'); parent.appendChild(selectorWrap);
      })
      .catch(err => { alert(err.message); window.resetDisplayCloudBtn(); });
  };

  window.toggleCloudDispFolderDOM = function (id) {
    const el = document.getElementById(id);
    const icon = document.getElementById('c_icon_fold_' + id);
    if (el.classList.contains('hidden')) { el.classList.remove('hidden'); if (icon) icon.textContent = '📂'; }
    else { el.classList.add('hidden'); if (icon) icon.textContent = '📁'; }
  };

  window.loadCloudFileToMap = function (globalIndex) {
    if (globalIndex === -1 || !cloudFilesStorage[globalIndex]) return;
    try {
      const archive = cloudFilesStorage[globalIndex];
      const geojson = typeof archive.geojsonRaw === 'string' ? JSON.parse(archive.geojsonRaw) : archive.geojsonRaw;
      injectGeoJsonLayer(geojson, archive.fileName);
    } catch (e) { alert("Erreur lors de l'intégration de la couche."); }
  };

  window.loadCloudFolderToMap = function (encodedFolderName) {
    const targetFolder = decodeURIComponent(encodedFolderName);
    let loadedCount = 0;

    cloudFilesStorage.forEach(archive => {
      const currentFolder = archive.folder && archive.folder.trim() !== "" ? archive.folder.trim() : "Fichiers non classés";
      if (currentFolder === targetFolder) {
        try {
          const geojson = typeof archive.geojsonRaw === 'string' ? JSON.parse(archive.geojsonRaw) : archive.geojsonRaw;
          injectGeoJsonLayer(geojson, archive.fileName);
          loadedCount++;
        } catch(e) {}
      }
    });
    if (loadedCount > 0) alert(`Dossier "${targetFolder}" : ${loadedCount} calques intégrés.`);
  };

  window.resetDisplayCloudBtn = function () {
    const wrap = document.getElementById('disp-cloud-picker-wrap');
    const btn = document.getElementById('disp-cloud-btn');
    if (wrap) wrap.remove();
    if (btn) { btn.classList.remove('hidden'); btn.disabled = false; btn.textContent = '☁️ Importer depuis Google Sheets'; }
  };

  function hexToRgb(hex) {
    const normal = hex.replace('#', '');
    const r = parseInt(normal.substring(0, 2), 16);
    const g = parseInt(normal.substring(2, 4), 16);
    const b = parseInt(normal.substring(4, 6), 16);
    return [r, g, b];
  }

  setTimeout(() => { window.initDisplay(); }, 500);
})();
