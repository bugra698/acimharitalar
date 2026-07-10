import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Tool = "none" | "distance" | "area";

type InfoData = {
  name: string;
  lat: number;
  lng: number;
  population?: string;
  elevation?: string;
  description?: string;
};

export default function AcimMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const satLayer = useRef<L.TileLayer | null>(null);
  const imageOverlay = useRef<L.ImageOverlay | null>(null);
  const measureLayer = useRef<L.LayerGroup | null>(null);
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

  const toolRef = useRef(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || map.current) return;

    const m = L.map(mapRef.current, {
      center: [39.925, 32.866],
      zoom: 6,
      zoomControl: false,
      attributionControl: false,
    });

    satLayer.current = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Esri World Imagery",
      },
    ).addTo(m);

    L.control.zoom({ position: "bottomright", zoomInTitle: "Yakınlaştır", zoomOutTitle: "Uzaklaştır" }).addTo(m);
    L.control.attribution({ position: "bottomleft", prefix: false }).addAttribution("Acım Haritalar © Esri").addTo(m);

    measureLayer.current = L.layerGroup().addTo(m);

    m.on("click", handleMapClick);

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

  const handleMapClick = async (e: L.LeafletMouseEvent) => {
    const activeTool = toolRef.current;
    if (activeTool === "distance" || activeTool === "area") {
      measurePoints.current.push(e.latlng);
      redrawMeasurement();
    } else {
      await openInfoCard(e.latlng);
    }
  };

  const redrawMeasurement = () => {
    if (!measureLayer.current) return;
    measureLayer.current.clearLayers();
    const pts = measurePoints.current;
    pts.forEach((p) =>
      L.circleMarker(p, {
        radius: 5,
        color: "#22d3ee",
        fillColor: "#0ea5b7",
        fillOpacity: 1,
        weight: 2,
      }).addTo(measureLayer.current!),
    );

    if (toolRef.current === "distance" && pts.length >= 2) {
      L.polyline(pts, { color: "#22d3ee", weight: 3, dashArray: "6 6" }).addTo(measureLayer.current);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += pts[i - 1].distanceTo(pts[i]);
      setMeasureText(formatDistance(total));
    } else if (toolRef.current === "area" && pts.length >= 3) {
      L.polygon(pts, {
        color: "#22d3ee",
        weight: 2,
        fillColor: "#22d3ee",
        fillOpacity: 0.15,
      }).addTo(measureLayer.current);
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

  const handleCustomUpload = (file: File) => {
    if (!map.current) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      // Fit image into arbitrary bounds using pixel coords via CRS.Simple would need
      // a separate map. Instead, drop it on top of current map using imageOverlay
      // spanning a synthetic bound near map center.
      const m = map.current!;
      // Remove existing satellite for immersion
      if (satLayer.current) m.removeLayer(satLayer.current);
      if (imageOverlay.current) m.removeLayer(imageOverlay.current);

      // Use plain lat/lng bounds; pick a large area so measurement still returns meters.
      const bounds: L.LatLngBoundsLiteral = [
        [-60, -80],
        [60, 80],
      ];
      // Preserve aspect ratio
      const aspect = w / h;
      const latSpan = 120;
      const lngSpan = latSpan * aspect;
      bounds[0] = [-latSpan / 2, -lngSpan / 2];
      bounds[1] = [latSpan / 2, lngSpan / 2];

      imageOverlay.current = L.imageOverlay(url, bounds, { className: "acim-custom-overlay" }).addTo(m);
      m.fitBounds(bounds);
      setCustomMode(true);
      clearMeasurement();
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
    map.current.setView([39.925, 32.866], 6);
    setCustomMode(false);
    clearMeasurement();
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <style>{`
        .leaflet-tile, .acim-custom-overlay {
          filter: var(--acim-tile-filter, contrast(1.25) brightness(0.9) saturate(1.15));
        }
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
        .acim-scan::before {
          content: "";
          position: absolute; inset: 0;
          background: linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.06) 50%, transparent 100%);
          pointer-events: none;
          mix-blend-mode: screen;
        }
      `}</style>

      <div ref={mapRef} className="absolute inset-0 z-0" />

      {/* HUD overlay */}
      <div className="pointer-events-none absolute inset-0 z-10 acim-scan" />

      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-slate-950/60 px-4 py-2 backdrop-blur-xl">
          <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee]" />
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">Acım</div>
            <div className="text-sm font-semibold tracking-wider">HARİTALAR · TAKTİK MOD</div>
          </div>
        </div>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="pointer-events-auto rounded-lg border border-cyan-400/20 bg-slate-950/60 px-3 py-2 text-xs uppercase tracking-widest text-cyan-200 backdrop-blur-xl hover:bg-cyan-400/10"
        >
          {panelOpen ? "Paneli Gizle" : "Paneli Aç"}
        </button>
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

          <Section title="Anlık Görüntü Ayarları">
            <Slider label="Kontrast" value={contrast} min={0.5} max={2.5} step={0.05} onChange={setContrast} />
            <Slider label="Parlaklık" value={brightness} min={0.3} max={1.8} step={0.05} onChange={setBrightness} />
            <Slider label="Doygunluk" value={saturate} min={0} max={3} step={0.05} onChange={setSaturate} />
            <button
              onClick={() => {
                setContrast(1.25);
                setBrightness(0.9);
                setSaturate(1.15);
              }}
              className="mt-1 w-full rounded-md border border-cyan-400/25 bg-cyan-400/5 px-2 py-1 text-[11px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/15"
            >
              Varsayılana Dön
            </button>
          </Section>

          <Section title="Özel Harita Motoru">
            <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
              Kurgusal dünya veya şehir haritanızı (PNG/JPG) yükleyin. Ölçüm ve keskinleştirme filtreleri bu harita üzerinde de çalışmaya devam eder.
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
              <li>• Haritaya tıklayın → Bilgi kartı açılır.</li>
              <li>• Mesafe/Alan aracı aktifken tıklamalar ölçüm yapar.</li>
              <li>• Kaydırıcılar uydu görüntüsünü anlık işler.</li>
            </ul>
          </Section>

          <div className="mt-auto pt-4 text-center text-[10px] uppercase tracking-[0.3em] text-cyan-400/40">
            Acım Haritalar · v1.0
          </div>
        </aside>
      )}

      {/* Info card */}
      {info && (
        <div className="absolute right-4 top-20 z-20 w-[340px] overflow-hidden rounded-2xl border border-cyan-400/25 bg-slate-950/70 shadow-[0_0_40px_rgba(34,211,238,0.15)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-cyan-400/15 bg-cyan-400/5 px-4 py-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-300/70">Konum Analizi</span>
            <button
              onClick={() => setInfo(null)}
              className="text-cyan-300/60 hover:text-cyan-200"
              aria-label="Kapat"
            >
              ✕
            </button>
          </div>
          <div className="p-4">
            <h3 className="text-lg font-semibold text-white">{info.name}</h3>
            {loadingInfo && (
              <p className="mt-1 text-xs text-cyan-300/70 animate-pulse">Veri çekiliyor…</p>
            )}
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

function ToolButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="uppercase tracking-widest text-slate-300">{label}</span>
        <span className="font-mono text-cyan-300">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
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

function formatDistance(m: number) {
  if (m < 1000) return `${m.toFixed(1)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatArea(m2: number) {
  if (m2 < 1_000_000) return `${m2.toFixed(0)} m²`;
  return `${(m2 / 1_000_000).toFixed(3)} km²`;
}

// Spherical polygon area using Leaflet's own algorithm (approx)
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
