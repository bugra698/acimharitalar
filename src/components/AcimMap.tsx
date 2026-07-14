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

const escapeHtml = (text: string) => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const formatDistance = (m: number) => {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
};

const formatArea = (sqm: number) => {
  if (sqm >= 1000000) return `${(sqm / 1000000).toFixed(2)} km²`;
  return `${Math.round(sqm)} m²`;
};

const computeArea = (pts: L.LatLng[]) => {
  let area = 0;
  const numPoints = pts.length;
  for (let i = 0; i < numPoints; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % numPoints];
    area += p1.lng * p2.lat - p2.lng * p1.lat;
  }
  return Math.abs(area / 2) * 111300 * 111300 * Math.cos((pts[0].lat * Math.PI) / 180);
};

// CSS stilini derleyicinin hata vermeyeceği düz bir string olarak dışarıda tanımlıyoruz
const mapStyles = `
  .leaflet-tile-pane .leaflet-layer:not(.acim-labels-wrap) .leaflet-tile,
  .acim-custom-overlay {
    filter: var(--acim-tile-filter, contrast(1.25) brightness(0.9) saturate(1.15));
  }
  .acim-labels-layer { 
    filter: drop-shadow(0 0 3px rgba(0,0,0,0.9)) brightness(1.4) contrast(1.1); 
    mix-blend-mode: screen; 
  }
  .leaflet-container { 
    background: #05060a; 
    font-family: inherit; 
  }
  .leaflet-control-zoom {
    margin-bottom: 24px !important;
    margin-right: 12px !important;
  }
  .leaflet-control-zoom a {
    background: rgba(15,23,42,0.85) !important;
    color: #e2e8f0 !important;
    border: 1px solid rgba(34,211,238,0.25) !important;
    backdrop-filter: blur(8px);
    width: 38px !important;
    height: 38px !important;
    line-height: 38px !important;
    font-size: 16px !important;
    border-radius: 8px !important;
    margin-bottom: 4px;
  }
  .leaflet-control-zoom a:hover { 
    background: rgba(34,211,238,0.3) !important; 
    color: #22d3ee !important; 
  }
  .leaflet-control-attribution {
    background: rgba(2,6,23,0.7) !important;
    color: #94a3b8 !important;
    font-size: 9px !important;
    backdrop-filter: blur(6px);
    padding: 2px 6px !important;
    border-radius: 4px;
  }
  .leaflet-popup-content-wrapper { 
    background: rgba(15, 23, 42, 0.95); 
    border: 1px solid rgba(34, 211, 238, 0.3); 
    border-radius: 12px; 
    backdrop-filter: blur(8px); 
  }
  .leaflet-popup-tip { 
    background: rgba(15, 23, 42, 0.95); 
    border: 1px solid rgba(34, 211, 238, 0.3); 
  }
  .acim-scan::before {
    content: "";
    position: absolute; 
    inset: 0;
    background: linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.04) 50%, transparent 100%);
    pointer-events: none;
    mix-blend-mode: screen;
  }
  .custom-scrollbar::-webkit-scrollbar { 
    width: 4px; 
  }
  .custom-scrollbar::-webkit-scrollbar-track { 
    background: transparent; 
  }
  .custom-scrollbar::-webkit-scrollbar-thumb { 
    background: rgba(34,211,238,0.2); 
    border-radius: 10px; 
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { 
    background: rgba(34,211,238,0.4); 
  }
`;

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
  const [mouseCoords, setMouseCoords] = useState<{ lat: number; lng: number } | null>(null);

  const toolRef = useRef(tool);
  const awaitingMarkerRef = useRef(awaitingMarker);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { awaitingMarkerRef.current = awaitingMarker; }, [awaitingMarker]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSavedMarkers(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(savedMarkers)); } catch {}
  }, [savedMarkers]);

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
      { 
        maxZoom: 22, 
        maxNativeZoom: 18, 
        attribution: "Esri World Imagery" 
      },
    ).addTo(m);

    labelsLayer.current = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 22,
        maxNativeZoom: 18,
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
    
    m.on("mousemove", (e: L.LeafletMouseEvent) => {
      setMouseCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    m.on("zoomend", () => {
      const currentZoom = m.getZoom();
      if (!labelsLayer.current) return;
      
      if (labelsOn) {
        if (currentZoom < 4) {
          m.removeLayer(labelsLayer.current);
        } else if (!m.hasLayer(labelsLayer.current)) {
          labelsLayer.current.addTo(m);
        }
      }
    });

    map.current = m;

    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelsOn]);

  useEffect(() => {
    const filter = `contrast(${contrast}) brightness(${brightness}) saturate(${saturate})`;
    document.documentElement.style.setProperty("--acim-tile-filter", filter);
  }, [contrast, brightness, saturate]);

  useEffect(() => {
    if (!map.current || !labelsLayer.current) return;
    const currentZoom = map.current.getZoom();
    
    if (labelsOn) {
      if (currentZoom >= 4 && !map.current.hasLayer(labelsLayer.current)) {
        labelsLayer.current.addTo(map.current);
      }
    } else {
      if (map.current.hasLayer(labelsLayer.current)) {
        map.current.removeLayer(labelsLayer.current);
      }
    }
  }, [labelsOn]);

  useEffect(() => {
    if (!markersLayer.current || !map.current) return;
    markersLayer.current.clearLayers();
    savedMarkers.forEach((sm) => {
      const color = TYPE_COLORS[sm.type];
      const marker = L.marker([sm.lat, sm.lng], {
        icon: L.divIcon({
          className: "acim-marker",
          html: `<div style="background:${color};box-shadow:0 0 12px ${color};" class="h-3 w-3 rounded-full border-2 border-white animate-pulse"></div>`,
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
    if (window.innerWidth < 768) {
      setPanelOpen(false);
    }
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
        if (window.innerWidth < 768) {
          setPanelOpen(false);
        }
      } else {
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
        if (window.innerWidth < 768) {
          setPanelOpen(false);
        }
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
      if (window.innerWidth < 768) {
        setPanelOpen(false);
      }
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
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Hata veren dinamik şablon dizisini kaldırıp, 
        doğrudan React 'dangerouslySetInnerHTML' ile statik string geçiriyoruz. 
        Böylece derleyici (vite:oxc) asla hata veremez.
      */}
      <style dangerouslySetInnerHTML={{ __html: mapStyles }} />

      <div ref={mapRef} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-0 z-10 acim-scan" />

      <div className="absolute left-0 right-0 top-0 z-20 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 p-3 bg-gradient-to-b from-slate-950/80 to-transparent">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-slate-950/80 px-3 py-2 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee]" />
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-300/70 leading-none">Acım</div>
              <div className="text-xs font-semibold tracking-wider">HARİTALAR</div>
   