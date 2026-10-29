import { useEffect, useState } from "react";

function clockValue(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer = 0;
    const update = () => {
      setNow(new Date());
      timer = window.setTimeout(update, 60_000 - (Date.now() % 60_000) + 25);
    };
    update();
    return () => window.clearTimeout(timer);
  }, []);

  const value = clockValue(now);
  return (
    <time className="topbar__clock" dateTime={value} aria-label={`Current time ${value}`} data-tauri-drag-region>
      {value}
    </time>
  );
}
