/**
 * Authentication Store
 * Manages Informeer authentication state using username/password (HTTP Basic Auth)
 * The API is always served from the same origin — no server URL needed.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/api/client';
import type { User } from '@/types/api';

interface AuthState {
  // State
  user: User | null;
  username: string;
  password: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (username: string, password: string) => Promise<boolean>;
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
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Login with username and password
      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          // Configure the API client with Basic Auth
          api.setCredentials(username, password);

          // Test the connection by fetching user info
          const user = await api.getCurrentUser();

          set({
            user,
            username,
            password,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });

          return true;
        } catch (error) {
          api.clearCredentials();
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
        api.clearCredentials();
        set({
          user: null,
          username: '',
          password: '',
          isAuthenticated: false,
          error: null,
        });
      },

      // Check if stored credentials are still valid
      checkAuth: async () => {
        const { username, password } = get();

        if (!username || !password) {
          return false;
        }

        set({ isLoading: true });

        try {
          api.setCredentials(username, password);
          const user = await api.getCurrentUser();

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });

          return true;
        } catch (error) {
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
        username: state.username,
        password: state.password,
      }),
    }
  )
);
