/**
 * Authentication Store
 * Manages Informeer authentication state using username/password (HTTP Basic Auth)
 * and a persisted server origin.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/api/client';
import { getConfiguredServerUrl, normalizeServerUrl, setStoredServerUrl } from '@/api/base-url';
import { isNetworkError } from '@/frameer/src/lib/errors';
import type { User } from '@/types/api';

interface AuthState {
  // State
  user: User | null;
  username: string;
  password: string;
  serverUrl: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (username: string, password: string, serverUrl: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      username: '',
      password: '',
      serverUrl: getConfiguredServerUrl(),
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Login with username and password
      login: async (username: string, password: string, serverUrl: string) => {
        set({ isLoading: true, error: null });

        try {
          const normalizedServerUrl = normalizeServerUrl(serverUrl);
          setStoredServerUrl(normalizedServerUrl);

          // Configure the API client with Basic Auth
          api.setCredentials(username, password);

          // Test the connection by fetching user info
          const user = await api.getCurrentUser();

          set({
            user,
            username,
            password,
            serverUrl: normalizedServerUrl,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });

          return true;
        } catch (error) {
          api.clearCredentials();
          set({
            user: null,
            serverUrl,
            isAuthenticated: false,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to authenticate',
          });
          return false;
        }
      },

      // Logout
      logout: () => {
        api.clearCredentials();
        set({
          user: null,
          username: '',
          password: '',
          serverUrl: get().serverUrl,
          isAuthenticated: false,
          error: null,
        });
      },

      // Check if stored credentials are still valid
      checkAuth: async () => {
        const { username, password, serverUrl, user } = get();

        if (!username || !password) {
          return false;
        }

        set({ isLoading: true });

        try {
          api.setCredentials(username, password);
          const user = await api.getCurrentUser();

          set({
            user,
            serverUrl,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });

          return true;
        } catch (error) {
          if (isNetworkError(error) && user) {
            set({
              user,
              serverUrl,
              isAuthenticated: true,
              isLoading: false,
              error: null,
            });
            return true;
          }

          api.clearCredentials();
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
          return false;
        }
      },
    }),
    {
      name: 'informeer-auth',
      partialize: (state) => ({
        user: state.user,
        username: state.username,
        password: state.password,
        serverUrl: state.serverUrl,
      }),
    }
  )
);
