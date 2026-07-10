import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Tool = "none" | "distance" | "area";
type MarkerType = "Ev" | "Askeri Üs" | "Kurgusal Nokta" | "Favori Mekan";

type SavedMarker = {
  id: string;
  name: string;
  note: string;
  type: MarkerType;
  lat: number;
  lng: number;
  createdAt: number;
};

type InfoData = {
  name: string;
  lat: number;
  lng: number;
  population?: string;
  elevation?: string;
  description?: string;
};

type DraftMarker = { lat: number; lng: number };

const STORAGE_KEY = "acim_saved_markers_v1";
const MARKER_TYPES: MarkerType[] = ["Ev", "Askeri Üs", "Kurgusal Nokta", "Favori Mekan"];
const TYPE_COLORS: Record<MarkerType, string> = {
  Ev: "#22d3ee",
  "Askeri Üs": "#f87171",
  "Kurgusal Nokta": "#a78bfa",
  "Favori Mekan": "#facc15",
};

export default function AcimMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const satLayer = useRef<L.TileLayer | null>(null);
  const labelsLayer = useRef<L.TileLayer | null>(null);
  const imageOverlay = useRef<L.ImageOverlay | null>(null);
  const measureLayer = useRef<L.LayerGroup | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const boundaryLayer = useRef<L.GeoJSON | null>(null);
  const measurePoints = useRef<L.LatLng[]>([]);

  const [tool, setTool] = useState<Tool>("none");
  const [contrast, setContrast] = useState(1.25);
  const [brightness, setBrightness] = useState(0.9);
  const [saturate, setSaturate] = useState(1.15);
  const [measureText, setMeasureText] = useState<string>("");
  const [info, setInfo] = useState<InfoData | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [labelsOn, setLabelsOn] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [savedMarkers, setSavedMarkers] = useState<SavedMarker[]>([]);
  const [draft, setDraft] = useState<DraftMarker | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [draftType, setDraftType] = useState<MarkerType>("Favori Mekan");
  const [awaitingMarker, setAwaitingMarker] = useState(false);
  const [locating, setLocating] = useState(false);

  const toolRef = useRef(tool);
  const awaitingMarkerRef = useRef(awaitingMarker);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { awaitingMarkerRef.current = awaitingMarker; }, [awaitingMarker]);

  // Load saved markers
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSavedMarkers(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(savedMarkers)); } catch {}
  }, [savedMarkers]);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || map.current) return;

    const m = L.map(mapRef.current, {
      center: [39.925, 32.866],
      zoom: 6,
      zoomControl: false,
      attributionControl: false,
      doubleClickZoom: false,
    });

    satLayer.current = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Esri World Imagery" },
    ).addTo(m);

    labelsLayer.current = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        attribution: "© CartoDB",
        subdomains: "abcd",
        pane: "overlayPane",
        className: "acim-labels-layer",
      },
    ).addTo(m);

    L.control.zoom({ position: "bottomright", zoomInTitle: "Yakınlaştır", zoomOutTitle: "Uzaklaştır" }).addTo(m);
    L.control.attribution({ position: "bottomleft", prefix: false }).addAttribution("Acım Haritalar © Esri · CartoDB").addTo(m);

    measureLayer.current = L.layerGroup().addTo(m);
    markersLayer.current = L.layerGroup().addTo(m);

    m.on("click", handleMapClick);
    m.on("dblclick", handleMapDblClick);

    map.current = m;

    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CSS filter update
  useEffect(() => {
    const filter = `contrast(${contrast}) brightness(${brightness}) saturate(${saturate})`;
    document.documentElement.style.setProperty("--acim-tile-filter", filter);
  }, [contrast, brightness, saturate]);

  // Toggle labels
  useEffect(() => {
    if (!map.current || !labelsLayer.current) return;
    if (labelsOn && !map.current.hasLayer(labelsLayer.current)) labelsLayer.current.addTo(map.current);
    if (!labelsOn && map.current.hasLayer(labelsLayer.current)) map.current.removeLayer(labelsLayer.current);
  }, [labelsOn]);

  // Redraw saved markers
  useEffect(() => {
    if (!markersLayer.current || !map.current) return;
    markersLayer.current.clearLayers();
    savedMarkers.forEach((sm) => {
      const color = TYPE_COLORS[sm.type];
      const marker = L.marker([sm.lat, sm.lng], {
        icon: L.divIcon({
          className: "acim-marker",
          html: `<div style="background:${color};box-shadow:0 0 12px ${color};" class="h-3 w-3 rounded-full border-2 border-white"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
      });
      marker.bindPopup(
        `<div style="min-width:180px;font-family:inherit">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:${color};margin-bottom:4px">${sm.type}</div>
          <div style="font-weight:600;font-size:14px;color:#0f172a;margin-bottom:4px">${escapeHtml(sm.name)}</div>
          ${sm.note ? `<div style="font-size:12px;color:#334155;margin-bottom:6px">${escapeHtml(sm.note)}</div>` : ""}
          <div style="font-family:monospace;font-size:10px;color:#64748b">${sm.lat.toFixed(4)}°, ${sm.lng.toFixed(4)}°</div>
        </div>`,
      );
      marker.addTo(markersLayer.current!);
    });
  }, [savedMarkers]);

  const handleMapClick = async (e: L.LeafletMouseEvent) => {
    if (awaitingMarkerRef.current) {
      openDraft(e.latlng);
      setAwaitingMarker(false);
      return;
    }
    const activeTool = toolRef.current;
    if (activeTool === "distance" || activeTool === "area") {
      measurePoints.current.push(e.latlng);
      redrawMeasurement();
    } else {
      await openInfoCard(e.latlng);
    }
  };

  const handleMapDblClick = (e: L.LeafletMouseEvent) => {
    openDraft(e.latlng);
  };

  const openDraft = (latlng: L.LatLng) => {
    setDraft({ lat: latlng.lat, lng: latlng.lng });
    setDraftName("");
    setDraftNote("");
    setDraftType("Favori Mekan");
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draftName.trim() || "İsimsiz Etiket";
    const newMarker: SavedMarker = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      note: draftNote.trim(),
      type: draftType,
      lat: draft.lat,
      lng: draft.lng,
      createdAt: Date.now(),
    };
    setSavedMarkers((prev) => [newMarker, ...prev]);
    setDraft(null);
  };

  const deleteMarker = (id: string) => {
    setSavedMarkers((prev) => prev.filter((m) => m.id !== id));
  };

  const flyToMarker = (m: SavedMarker) => {
    map.current?.flyTo([m.lat, m.lng], 14, { duration: 1.4 });
  };

  const redrawMeasurement = () => {
    if (!measureLayer.current) return;
    measureLayer.current.clearLayers();
    const pts = measurePoints.current;
    pts.forEach((p) =>
      L.circleMarker(p, { radius: 5, color: "#22d3ee", fillColor: "#0ea5b7", fillOpacity: 1, weight: 2 }).addTo(measureLayer.current!),
    );

    if (toolRef.current === "distance" && pts.length >= 2) {
      L.polyline(pts, { color: "#22d3ee", weight: 3, dashArray: "6 6" }).addTo(measureLayer.current);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += pts[i - 1].distanceTo(pts[i]);
      setMeasureText(formatDistance(total));
    } else if (toolRef.current === "area" && pts.length >= 3) {
      L.polygon(pts, { color: "#22d3ee", weight: 2, fillColor: "#22d3ee", fillOpacity: 0.15 }).addTo(measureLayer.current);
      setMeasureText(formatArea(computeArea(pts)));
    } else if (pts.length === 1) {
      setMeasureText("İkinci noktayı seçin…");
    }
  };

  const clearMeasurement = () => {
    measurePoints.current = [];
    measureLayer.current?.clearLayers();
    setMeasureText("");
  };

  const selectTool = (t: Tool) => {
    clearMeasurement();
    setTool(t);
    if (t === "distance") setMeasureText("İlk noktayı seçin…");
    if (t === "area") setMeasureText("En az 3 nokta seçin…");
  };

  const clearBoundary = () => {
    if (boundaryLayer.current && map.current) {
      map.current.removeLayer(boundaryLayer.current);
      boundaryLayer.current = null;
    }
  };

  const drawBoundary = async (osmId: number, osmType: string) => {
    try {
      const typePrefix = osmType === "relation" ? "R" : osmType === "way" ? "W" : "N";
      const res = await fetch(
        `https://nominatim.openstreetmap.org/lookup?osm_ids=${typePrefix}${osmId}&format=json&polygon_geojson=1&accept-language=tr`,
      ).then((r) => r.json());
      const item = Array.isArray(res) ? res[0] : null;
      if (!item?.geojson || !map.current) return;
      clearBoundary();
      boundaryLayer.current = L.geoJSON(item.geojson, {
        style: {
          color: "#22d3ee",
          weight: 2.5,
          fillColor: "#22d3ee",
          fillOpacity: 0.08,
          dashArray: "4 4",
        },
      }).addTo(map.current);
      try {
        map.current.fitBounds(boundaryLayer.current.getBounds(), { padding: [40, 40], maxZoom: 12 });
      } catch {}
    } catch {}
  };

  const openInfoCard = async (latlng: L.LatLng) => {
    if (customMode) {
      setInfo({
        name: "Kurgusal Konum",
        lat: latlng.lat,
        lng: latlng.lng,
        description: "Yüklediğiniz kurgusal harita üzerinde seçilen nokta.",
      });
      return;
    }
    setLoadingInfo(true);
    setInfo({ name: "Yükleniyor…", lat: latlng.lat, lng: latlng.lng });
    try {
      const [geoRes, elevRes] = await Promise.all([
        fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&accept-language=tr&zoom=10`,
        ).then((r) => r.json()),
        fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${latlng.lat},${latlng.lng}`)
          .then((r) => r.json())
          .catch(() => null),
      ]);
      const addr = geoRes.address ?? {};
      const name =
        addr.city || addr.town || addr.village || addr.county || addr.state || addr.country || geoRes.display_name || "Bilinmeyen";
      const region = [addr.state, addr.country].filter(Boolean).join(", ");
      const elevation = elevRes?.results?.[0]?.elevation;
      setInfo({
        name,
        lat: latlng.lat,
        lng: latlng.lng,
        population: addr.country ? "Bilgi mevcut değil" : undefined,
        elevation: typeof elevation === "number" ? `${Math.round(elevation)} m` : "Bilinmiyor",
        description: geoRes.display_name || region || "Konum verisi bulundu.",
      });
      if (geoRes.osm_id && geoRes.osm_type) {
        drawBoundary(Number(geoRes.osm_id), String(geoRes.osm_type));
      }
    } catch {
      setInfo({
        name: "Konum",
        lat: latlng.lat,
        lng: latlng.lng,
        description: "Bilgi alınamadı. İnternet bağlantınızı kontrol edin.",
      });
    } finally {
      setLoadingInfo(false);
    }
  };

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = searchQuery.trim();
    if (!q || !map.current) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&accept-language=tr&limit=1&polygon_geojson=1`,
      ).then((r) => r.json());
      const hit = Array.isArray(res) ? res[0] : null;
      if (hit) {
        const lat = parseFloat(hit.lat);
        const lon = parseFloat(hit.lon);
        map.current.flyTo([lat, lon], 12, { duration: 1.6 });
        setInfo({
          name: hit.display_name?.split(",")[0] || q,
          lat,
          lng: lon,
          description: hit.display_name,
        });
        if (hit.osm_id && hit.osm_type) {
          drawBoundary(Number(hit.osm_id), String(hit.osm_type));
        }
      } else {
        setMeasureText("");
        alert("Konum bulunamadı.");
      }
    } catch {
      alert("Arama sırasında hata oluştu.");
    } finally {
      setSearching(false);
    }
  };

  const locateMe = () => {
    if (!navigator.geolocation || !map.current) {
      alert("Tarayıcınız konum servisini desteklemiyor.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.current?.flyTo([pos.coords.latitude, pos.coords.longitude], 14, { duration: 1.6 });
        setLocating(false);
      },
      () => {
        alert("Konum alınamadı. Tarayıcı izinlerini kontrol edin.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleCustomUpload = (file: File) => {
    if (!map.current) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const m = map.current!;
      if (satLayer.current) m.removeLayer(satLayer.current);
      if (labelsLayer.current && m.hasLayer(labelsLayer.current)) m.removeLayer(labelsLayer.current);
      if (imageOverlay.current) m.removeLayer(imageOverlay.current);

      const aspect = w / h;
      const latSpan = 120;
      const lngSpan = latSpan * aspect;
      const bounds: L.LatLngBoundsLiteral = [
        [-latSpan / 2, -lngSpan / 2],
        [latSpan / 2, lngSpan / 2],
      ];

      imageOverlay.current = L.imageOverlay(url, bounds, { className: "acim-custom-overlay" }).addTo(m);
      m.fitBounds(bounds);
      setCustomMode(true);
      clearMeasurement();
      clearBoundary();
    };
    img.src = url;
  };

  const exitCustom = () => {
    if (!map.current) return;
    if (imageOverlay.current) {
      map.current.removeLayer(imageOverlay.current);
      imageOverlay.current = null;
    }
    if (satLayer.current) satLayer.current.addTo(map.current);
    if (labelsOn && labelsLayer.current) labelsLayer.current.addTo(map.current);
    map.current.setView([39.925, 32.866], 6);
    setCustomMode(false);
    clearMeasurement();
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <style>{`
        .leaflet-tile-pane .leaflet-layer:not(.acim-labels-wrap) .leaflet-tile,
        .acim-custom-overlay {
          filter: var(--acim-tile-filter, contrast(1.25) brightness(0.9) saturate(1.15));
        }
        .acim-labels-layer { filter: drop-shadow(0 0 3px rgba(0,0,0,0.9)) brightness(1.4) contrast(1.1); mix-blend-mode: screen; }
        .leaflet-container { background: #05060a; font-family: inherit; }
        .leaflet-control-zoom a {
          background: rgba(15,23,42,0.75) !important;
          color: #e2e8f0 !important;
          border: 1px solid rgba(34,211,238,0.25) !important;
          backdrop-filter: blur(8px);
        }
        .leaflet-control-zoom a:hover { background: rgba(34,211,238,0.2) !important; }
        .leaflet-control-attribution {
          background: rgba(2,6,23,0.6) !important;
          color: #94a3b8 !important;
          font-size: 10px !important;
          backdrop-filter: blur(6px);
        }
        .leaflet-popup-content-wrapper { background: rgba(226,232,240,0.97); border-radius: 10px; }
        .leaflet-popup-tip { background: rgba(226,232,240,0.97); }
        .acim-scan::before {
          content: "";
          position: absolute; inset: 0;
          background: linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.06) 50%, transparent 100%);
          pointer-events: none;
          mix-blend-mode: screen;
        }
      `}</style>

      <div ref={mapRef} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-0 z-10 acim-scan" />

      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-slate-950/60 px-4 py-2 backdrop-blur-xl">
          <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee]" />
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">Acım</div>
            <div className="text-sm font-semibold tracking-wider">HARİTALAR · TAKTİK MOD</div>
          </div>
        </div>

        {/* Search bar */}
        <form
          onSubmit={runSearch}
          className="pointer-events-auto flex flex-1 max-w-xl items-center gap-2 rounded-xl border border-cyan-400/25 bg-slate-950/65 px-3 py-2 backdrop-blur-xl focus-within:border-cyan-400/60 focus-within:shadow-[0_0_20px_rgba(34,211,238,0.2)]"
        >
          <span className="text-cyan-300/70">🔍</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Konum ara: Tuzla, Konya, Ankara…"
            className="w-full bg-transparent text-sm text-cyan-50 placeholder-cyan-300/40 outline-none"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
          >
            {searching ? "Aranıyor…" : "Ara"}
          </button>
        </form>

        <div className="flex items-center gap-2">
          <button
            onClick={locateMe}
            disabled={locating}
            title="Mevcut Konumum"
            className="pointer-events-auto rounded-lg border border-cyan-400/20 bg-slate-950/60 px-3 py-2 text-lg backdrop-blur-xl hover:bg-cyan-400/10 disabled:opacity-50"
          >
            {locating ? "…" : "📍"}
          </button>
          <button
            onClick={() => setLabelsOn((v) => !v)}
            title={labelsOn ? "Yazıları Gizle" : "Yazıları Göster"}
            className={`pointer-events-auto rounded-lg border px-3 py-2 text-lg backdrop-blur-xl transition ${
              labelsOn
                ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-100"
                : "border-slate-500/30 bg-slate-950/60 text-slate-400"
            }`}
          >
            {labelsOn ? "👁️" : "🚫"}
          </button>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="pointer-events-auto rounded-lg border border-cyan-400/20 bg-slate-950/60 px-3 py-2 text-xs uppercase tracking-widest text-cyan-200 backdrop-blur-xl hover:bg-cyan-400/10"
          >
            {panelOpen ? "Gizle" : "Panel"}
          </button>
        </div>
      </div>

      {/* Left control panel */}
      {panelOpen && (
        <aside className="absolute left-4 top-20 bottom-4 z-20 flex w-[320px] flex-col overflow-y-auto rounded-2xl border border-cyan-400/20 bg-slate-950/55 p-4 shadow-[0_0_40px_rgba(34,211,238,0.08)] backdrop-blur-2xl">
          <Section title="Ölçüm Araçları">
            <div className="grid grid-cols-2 gap-2">
              <ToolButton active={tool === "distance"} onClick={() => selectTool(tool === "distance" ? "none" : "distance")}>
                📏 Mesafe
              </ToolButton>
              <ToolButton active={tool === "area"} onClick={() => selectTool(tool === "area" ? "none" : "area")}>
                📐 Alan
              </ToolButton>
            </div>
            {tool !== "none" && (
              <div className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-xs">
                <div className="mb-1 uppercase tracking-widest text-cyan-300/70">Sonuç</div>
                <div className="font-mono text-sm text-cyan-100">{measureText || "Haritaya tıklayın…"}</div>
                <button
                  onClick={clearMeasurement}
                  className="mt-2 w-full rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] uppercase tracking-widest text-red-200 hover:bg-red-500/20"
                >
                  Ölçümü Temizle
                </button>
              </div>
            )}
          </Section>

          <Section title="Yer Etiketleri">
            <button
              onClick={() => setAwaitingMarker((v) => !v)}
              className={`w-full rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition ${
                awaitingMarker
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-100"
                  : "border-cyan-400/25 bg-cyan-400/5 text-cyan-200 hover:bg-cyan-400/15"
              }`}
            >
              {awaitingMarker ? "İptal · Nokta Seçin" : "📍 Etiket Ekle (veya çift tıkla)"}
            </button>

            <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-cyan-300/60">
                Kayıtlı Etiketlerim ({savedMarkers.length})
              </div>
              {savedMarkers.length === 0 && (
                <div className="rounded border border-white/5 bg-white/5 p-2 text-[11px] text-slate-400">
                  Henüz etiket yok. Haritaya çift tıklayarak ekleyin.
                </div>
              )}
              {savedMarkers.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-center justify-between gap-2 rounded-md border border-white/5 bg-slate-900/40 p-2 hover:border-cyan-400/30"
                >
                  <button onClick={() => flyToMarker(m)} className="flex flex-1 items-center gap-2 text-left">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: TYPE_COLORS[m.type], boxShadow: `0 0 8px ${TYPE_COLORS[m.type]}` }}
                    />
                    <span className="flex-1 truncate">
                      <span className="block truncate text-xs text-cyan-50">{m.name}</span>
                      <span className="block truncate text-[10px] uppercase tracking-widest text-slate-400">{m.type}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => deleteMarker(m.id)}
                    className="rounded border border-red-400/20 px-1.5 py-0.5 text-[10px] text-red-300 opacity-0 hover:bg-red-500/20 group-hover:opacity-100"
                    aria-label="Sil"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Anlık Görüntü Ayarları">
            <Slider label="Kontrast" value={contrast} min={0.5} max={2.5} step={0.05} onChange={setContrast} />
            <Slider label="Parlaklık" value={brightness} min={0.3} max={1.8} step={0.05} onChange={setBrightness} />
            <Slider label="Doygunluk" value={saturate} min={0} max={3} step={0.05} onChange={setSaturate} />
            <button
              onClick={() => { setContrast(1.25); setBrightness(0.9); setSaturate(1.15); }}
              className="mt-1 w-full rounded-md border border-cyan-400/25 bg-cyan-400/5 px-2 py-1 text-[11px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/15"
            >
              Varsayılana Dön
            </button>
          </Section>

          <Section title="Özel Harita Motoru">
            <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
              Kurgusal dünya veya şehir haritanızı (PNG/JPG) yükleyin. Ölçüm ve keskinleştirme filtreleri bu harita üzerinde de çalışır.
            </p>
            <label className="block cursor-pointer rounded-lg border border-dashed border-cyan-400/40 bg-cyan-400/5 p-3 text-center text-xs text-cyan-200 hover:bg-cyan-400/10">
              📁 Görsel Seç ve Yükle
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCustomUpload(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {customMode && (
              <button
                onClick={exitCustom}
                className="mt-2 w-full rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[11px] uppercase tracking-widest text-amber-200 hover:bg-amber-500/20"
              >
                Gerçek Dünyaya Dön
              </button>
            )}
          </Section>

          <Section title="Kullanım">
            <ul className="space-y-1 text-[11px] text-slate-400">
              <li>• Şehir yazısına tıklayın → sınır çizilir.</li>
              <li>• Çift tıklayın → yer etiketi ekleyin.</li>
              <li>• Göz simgesi → yazıları gizler/gösterir.</li>
              <li>• Etiketler cihazınızda kalıcı saklanır.</li>
            </ul>
          </Section>

          <div className="mt-auto pt-4 text-center text-[10px] uppercase tracking-[0.3em] text-cyan-400/40">
            Acım Haritalar · v1.1
          </div>
        </aside>
      )}

      {/* Info card */}
      {info && (
        <div className="absolute right-4 top-20 z-20 w-[340px] overflow-hidden rounded-2xl border border-cyan-400/25 bg-slate-950/70 shadow-[0_0_40px_rgba(34,211,238,0.15)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-cyan-400/15 bg-cyan-400/5 px-4 py-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-300/70">Konum Analizi</span>
            <button
              onClick={() => { setInfo(null); clearBoundary(); }}
              className="text-cyan-300/60 hover:text-cyan-200"
              aria-label="Kapat"
            >
              ✕
            </button>
          </div>
          <div className="p-4">
            <h3 className="text-lg font-semibold text-white">{info.name}</h3>
            {loadingInfo && <p className="mt-1 text-xs text-cyan-300/70 animate-pulse">Veri çekiliyor…</p>}
            <dl className="mt-3 space-y-2 text-xs">
              <Row label="Koordinatlar" value={`${info.lat.toFixed(4)}°, ${info.lng.toFixed(4)}°`} mono />
              {info.elevation && <Row label="Rakım (Yükseklik)" value={info.elevation} />}
              {info.population && <Row label="Nüfus" value={info.population} />}
            </dl>
            {info.description && (
              <p className="mt-3 border-t border-white/5 pt-3 text-[11px] leading-relaxed text-slate-300">
                {info.description}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Draft marker modal */}
      {draft && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
          <div className="w-[380px] max-w-[92vw] overflow-hidden rounded-2xl border border-cyan-400/30 bg-slate-950/95 shadow-[0_0_50px_rgba(34,211,238,0.2)]">
            <div className="flex items-center justify-between border-b border-cyan-400/20 bg-cyan-400/10 px-4 py-3">
              <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-300/80">Yeni Yer Etiketi</span>
              <button onClick={() => setDraft(null)} className="text-cyan-300/60 hover:text-cyan-200">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">Etiket Adı</label>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Örn: Ev, Gizli Üs, Nirvana"
                  className="w-full rounded-md border border-cyan-400/25 bg-slate-900/60 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-400/60"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">Özel Not</label>
                <textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  rows={2}
                  placeholder="İsteğe bağlı açıklama…"
                  className="w-full resize-none rounded-md border border-cyan-400/25 bg-slate-900/60 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-400/60"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">Etiket Türü</label>
                <div className="grid grid-cols-2 gap-2">
                  {MARKER_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setDraftType(t)}
                      className={`rounded-md border px-2 py-1.5 text-xs transition ${
                        draftType === t
                          ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-50"
                          : "border-white/10 bg-slate-900/40 text-slate-300 hover:border-cyan-400/30"
                      }`}
                      style={draftType === t ? { boxShadow: `0 0 12px ${TYPE_COLORS[t]}55` } : undefined}
                    >
                      <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: TYPE_COLORS[t] }} />
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="font-mono text-[10px] text-slate-500">
                {draft.lat.toFixed(4)}°, {draft.lng.toFixed(4)}°
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setDraft(null)}
                  className="flex-1 rounded-md border border-white/10 bg-slate-900/60 px-3 py-2 text-xs uppercase tracking-widest text-slate-300 hover:bg-slate-800"
                >
                  Vazgeç
                </button>
                <button
                  onClick={saveDraft}
                  className="flex-1 rounded-md border border-cyan-400/50 bg-cyan-400/20 px-3 py-2 text-xs uppercase tracking-widest text-cyan-100 hover:bg-cyan-400/30"
                >
                  Kaydet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {awaitingMarker && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-full border border-amber-400/50 bg-amber-500/20 px-4 py-1.5 text-xs uppercase tracking-widest text-amber-100 backdrop-blur-xl">
          Etiket eklemek için haritaya tıklayın
        </div>
      )}

      {/* Corner crosshairs */}
      <div className="pointer-events-none absolute inset-6 z-10">
        {(["tl", "tr", "bl", "br"] as const).map((c) => (
          <div
            key={c}
            className={`absolute h-6 w-6 border-cyan-400/40 ${
              c === "tl" ? "left-0 top-0 border-l-2 border-t-2" : ""
            } ${c === "tr" ? "right-0 top-0 border-r-2 border-t-2" : ""} ${
              c === "bl" ? "bottom-0 left-0 border-b-2 border-l-2" : ""
            } ${c === "br" ? "bottom-0 right-0 border-b-2 border-r-2" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-cyan-400/40 to-transparent" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300/80">{title}</span>
        <div className="h-px flex-1 bg-gradient-to-l from-cyan-400/40 to-transparent" />
      </div>
      {children}
    </div>
  );
}

function ToolButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-xs font-medium uppercase tracking-wider transition ${
        active
          ? "border-cyan-400/70 bg-cyan-400/20 text-white shadow-[0_0_15px_rgba(34,211,238,0.4)]"
          : "border-cyan-400/20 bg-slate-900/40 text-cyan-100 hover:bg-cyan-400/10"
      }`}
    >
      {children}
    </button>
  );
}

function Slider({
  label, value, min, max, step, onChange,
}: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="uppercase tracking-widest text-slate-300">{label}</span>
        <span className="font-mono text-cyan-300">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-400"
      />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[10px] uppercase tracking-widest text-slate-400">{label}</dt>
      <dd className={`text-right text-slate-100 ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function formatDistance(m: number) {
  if (m < 1000) return `${m.toFixed(1)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatArea(m2: number) {
  if (m2 < 1_000_000) return `${m2.toFixed(0)} m²`;
  return `${(m2 / 1_000_000).toFixed(3)} km²`;
}

function computeArea(points: L.LatLng[]) {
  const R = 6378137;
  const rad = (d: number) => (d * Math.PI) / 180;
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    area += rad(p2.lng - p1.lng) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((area * R * R) / 2);
}
