import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Acım Haritalar · Taktik Uydu Görüntüleme" },
      {
        name: "description",
        content:
          "Sinematik uydu haritası, mesafe ve alan ölçüm araçları, anlık görüntü işleme ve kurgusal harita yükleme motoru. Tamamen Türkçe.",
      },
      { property: "og:title", content: "Acım Haritalar" },
      { property: "og:description", content: "Taktik uydu haritası ve ölçüm araçları." },
    ],
  }),
  component: Index,
});

function Index() {
  const [Map, setMap] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    let mounted = true;
    import("../components/AcimMap").then((m) => {
      if (mounted) setMap(() => m.default);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!Map) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-cyan-300">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <div className="text-xs uppercase tracking-[0.4em]">Uydu bağlantısı kuruluyor…</div>
        </div>
      </div>
    );
  }

  return <Map />;
}
