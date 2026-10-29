import { useEffect, useState, type CSSProperties } from "react";

interface BackgroundProps {
  source: string;
  blur: number;
  vignette: number;
}

interface BackgroundLayer {
  id: number;
  source: string;
}

export function Background({ source, blur, vignette }: BackgroundProps) {
  const [layers, setLayers] = useState<BackgroundLayer[]>([
    { id: 0, source },
  ]);

  useEffect(() => {
    let stale = false;
    let cleanup: number | undefined;
    const image = new Image();
    image.onload = () => {
      if (stale) return;
      setLayers(current => current[current.length - 1]?.source === source
        ? current : [...current.slice(-1), { id: Date.now(), source }]);
      cleanup = window.setTimeout(() => setLayers(current => current.slice(-1)), 850);
    };
    // Keep the previous valid artwork if loading fails; never fade into black.
    image.src = source;
    return () => { stale = true; image.onload = null; window.clearTimeout(cleanup); };
  }, [source]);

  const style = {
    "--background-blur": `${blur}px`,
    "--vignette-color": `rgba(0, 0, 0, ${vignette / 100})`,
  } as CSSProperties;

  return (
    <div className="background" style={style} aria-hidden="true">
      <div className="background__canvas">
        {layers.map((layer, index) => (
          <img
            className={`background__image ${
              index === layers.length - 1 ? "background__image--current" : ""
            }`}
            key={`${layer.id}-${layer.source}`}
            src={layer.source}
            alt=""
            onError={(event) => {
              event.currentTarget.style.opacity = "0";
            }}
          />
        ))}
      </div>
      <div className="background__wash" />
      <div className="background__vignette" />
      <div className="background__grain" />
    </div>
  );
}
