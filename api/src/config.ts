// Boot-time environment configuration.
// Everything mutable lives in the settings table — these are infra-only.

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

const isDev = process.env.NODE_ENV !== 'production';

export const config = {
  port: parseInt(env('PORT', '3011'), 10),
  host: env('HOST', '0.0.0.0'),
  databasePath: env('DATABASE_PATH', './data/informeer.db'),
  dataDir: env('DATA_DIR', './data'),
  frontendDir: env('FRONTEND_DIR', './public'),
  secretKey: env('SECRET_KEY', isDev ? 'dev-secret-do-not-use-in-production' : undefined),
  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: env('ADMIN_PASSWORD', isDev ? 'changeme' : undefined),
} as const;

// Safety: refuse to start in production with insecure defaults
if (!isDev && config.secretKey === 'dev-secret-do-not-use-in-production') {
  throw new Error('SECRET_KEY must be set in production. Generate one with: openssl rand -hex 32');
}
