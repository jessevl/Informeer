/**
 * Authentication Store
 * Manages Miniflux authentication state using username/password (HTTP Basic Auth)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { miniflux } from '@/api/miniflux';
import type { User } from '@/types/miniflux';

interface AuthState {
  // State
  user: User | null;
  serverUrl: string;
  username: string;
  password: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (serverUrl: string, username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      serverUrl: '',
      username: '',
      password: '',
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Login with server URL, username and password
      login: async (serverUrl: string, username: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          // Configure the API client with Basic Auth
          miniflux.setCredentials(serverUrl, username, password);

          // Test the connection by fetching user info
          const user = await miniflux.getCurrentUser();

          set({
            user,
            serverUrl,
            username,
            password,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });

          return true;
        } catch (error) {
          miniflux.clearCredentials();
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to authenticate',
          });
          return false;
        }
      },

      // Logout
      logout: () => {
        miniflux.clearCredentials();
        set({
          user: null,
          serverUrl: '',
          username: '',
          password: '',
          isAuthenticated: false,
          error: null,
        });
      },

      // Check if stored credentials are still valid
      checkAuth: async () => {
        const { serverUrl, username, password } = get();

        if (!serverUrl || !username || !password) {
          return false;
        }

        set({ isLoading: true });

        try {
          miniflux.setCredentials(serverUrl, username, password);
          const user = await miniflux.getCurrentUser();

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });

          return true;
        } catch (error) {
          miniflux.clearCredentials();
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
        serverUrl: state.serverUrl,
        username: state.username,
        password: state.password,
      }),
    }
  )
);
