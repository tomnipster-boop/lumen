export interface Game {
  id: string;
  title: string;
  launchScript: string;
  coverPath?: string;
  backgroundPath?: string;
  sortOrder: number;
  scriptAvailable: boolean;
  coverAvailable: boolean;
  backgroundAvailable: boolean;
  totalPlaytimeSeconds: number;
  lastPlayed?: string;
}

export interface GameDraft {
  title: string;
  launchScript: string;
  coverPath?: string;
  backgroundPath?: string;
}

export interface LibraryResponse {
  version: number;
  games: Game[];
  warning?: string;
}

export interface DiscoveredScript {
  path: string;
  title: string;
}

export interface LaunchState {
  gameId: string;
  title: string;
  startedAt: string;
  phase: "launching" | "running" | "paused";
}

export interface LaunchExited {
  gameId: string;
  title: string;
  started: boolean;
  exitCode?: number;
  elapsedSeconds: number;
  totalPlaytimeSeconds?: number;
  lastPlayed: string;
  waitError?: string;
  persistenceError?: string;
}
