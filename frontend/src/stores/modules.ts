/**
 * Module Status Store
 *
 * Fetches module enabled/disabled status from the /health endpoint.
 * Used to conditionally show module-specific UI (e.g., MagazineLib tab).
 */

import { create } from 'zustand';
import { api } from '@/api/client';

interface ModuleStatus {
  nrc: boolean;
  magazinelib: boolean;
  books: boolean;
  booksZlib: boolean;
}

interface ModulesState {
  modules: ModuleStatus;
  loaded: boolean;
  fetchModules: () => Promise<void>;
}

export const useModulesStore = create<ModulesState>((set) => ({
  modules: { nrc: false, magazinelib: false, books: false, booksZlib: false },
  loaded: false,

  fetchModules: async () => {
    try {
      const health = await api.getHealth();
      set({
        modules: {
          nrc: health.modules.nrc.enabled,
          magazinelib: health.modules.magazinelib.enabled,
          books: health.modules.books.enabled,
          booksZlib: health.modules.books.zlib_enabled ?? false,
        },
        loaded: true,
      });
    } catch {
      // Silently fail — modules defaults to all disabled
      set({ loaded: true });
    }
  },
}));
