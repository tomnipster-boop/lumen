import type { ActiveLaunch } from "../hooks/useLaunchLifecycle";

export function RunningGameIndicator({ launch }: { launch?: ActiveLaunch }) {
  if (!launch) return null;
  return (
    <div className="running-indicator" role="status">
      <span aria-hidden="true" />
      <div><strong>{launch.phase === "launching" ? "Starting game" : launch.phase === "paused" ? "Game paused" : "Game running"}</strong><small>{launch.title}</small></div>
    </div>
  );
}
