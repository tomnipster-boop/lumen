import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type {
  DiscoveredScript,
  GameDraft,
  LibraryResponse,
} from "../types/game";

function messageFrom(error: unknown): string {
  return typeof error === "string" ? error : "Lumen could not complete that action.";
}

export function useLibrary() {
  const [library, setLibrary] = useState<LibraryResponse>({ version: 2, games: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const applyResponse = useCallback((response: LibraryResponse) => {
    setLibrary({
      ...response,
      games: [...response.games].sort((left, right) => left.sortOrder - right.sortOrder),
    });
    setError("");
    return response;
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      setLibrary({
        version: 2,
        games: [],
        warning: "The real library is available in the Tauri desktop app.",
      });
      return;
    }
    setLoading(true);
    try {
      applyResponse(await invoke<LibraryResponse>("get_library"));
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setLoading(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (command: string, args: Record<string, unknown>) => {
      try {
        return applyResponse(await invoke<LibraryResponse>(command, args));
      } catch (reason) {
        throw new Error(messageFrom(reason));
      }
    },
    [applyResponse],
  );

  const addGame = useCallback(
    (draft: GameDraft) => mutate("add_game", { draft }),
    [mutate],
  );
  const updateGame = useCallback(
    (id: string, draft: GameDraft) => mutate("update_game", { id, draft }),
    [mutate],
  );
  const removeGame = useCallback(
    (id: string) => mutate("remove_game", { id }),
    [mutate],
  );
  const reorderGames = useCallback(
    (orderedIds: string[]) => mutate("reorder_games", { orderedIds }),
    [mutate],
  );
  const scanFolder = useCallback(async (directory: string) => {
    try {
      return await invoke<DiscoveredScript[]>("scan_script_folder", { directory });
    } catch (reason) {
      throw new Error(messageFrom(reason));
    }
  }, []);
  const registerAsset = useCallback(async (path: string) => {
    try {
      await invoke("register_asset_path", { path });
    } catch (reason) {
      throw new Error(messageFrom(reason));
    }
  }, []);

  return {
    games: library.games,
    version: library.version,
    warning: library.warning,
    error,
    loading,
    refresh,
    addGame,
    updateGame,
    removeGame,
    reorderGames,
    scanFolder,
    registerAsset,
  };
}
