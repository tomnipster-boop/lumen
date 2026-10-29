export function formatPlaytime(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? "< 1 min played" : "Not played yet";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min played`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h played` : `${hours}h ${remainder}m played`;
}

export function formatLastPlayed(value?: string): string {
  if (!value) return "Never played";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Played recently";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startPlayed = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startToday - startPlayed) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(date);
}
