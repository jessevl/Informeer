import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { Button, Input, Panel } from '@frameer/components/ui';

function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, serverUrl } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [backendUrl] = useState(serverUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const success = await login(username, password, backendUrl);
    if (success) {
      navigate({ to: '/' });
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface-app)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/icons/app-icon-small.svg" alt="Informeer" className="w-32 h-32 mb-6" />
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Informeer
          </h1>
          <p className="text-[var(--color-text-secondary)] mt-1">
            Sign in to continue
          </p>
        </div>

        {/* Login Form */}
        <Panel padding="lg" className="rounded-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              autoComplete="username"
            />

            {/* Password */}
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              autoComplete="current-password"
            />

            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isLoading}
              variant="primary"
              size="lg"
              className="w-full"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/login')({
  component: LoginPage,
});
