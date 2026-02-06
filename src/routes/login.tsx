import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { Button, Input, Panel } from '@frameer/components/ui';
import { Rss } from 'lucide-react';

function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error } = useAuthStore();
  
  const [serverUrl, setServerUrl] = useState('http://newton.lan:8001');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const success = await login(serverUrl, username, password);
    if (success) {
      navigate({ to: '/' });
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface-app)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--color-accent-primary)] text-white mb-4">
            <Rss size={32} />
          </div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Informeer
          </h1>
          <p className="text-[var(--color-text-secondary)] mt-1">
            Connect to your Miniflux server
          </p>
        </div>

        {/* Login Form */}
        <Panel padding="lg" className="rounded-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Server URL */}
            <Input
              label="Server URL"
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://miniflux.example.com"
              required
            />

            {/* Username */}
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your Miniflux username"
              required
              autoComplete="username"
            />

            {/* Password */}
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your Miniflux password"
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
              {isLoading ? 'Connecting...' : 'Connect'}
            </Button>
          </form>
        </Panel>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-[var(--color-text-tertiary)]">
          Informeer is a Miniflux client. You need a running Miniflux server to use this app.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/login')({
  component: LoginPage,
});
