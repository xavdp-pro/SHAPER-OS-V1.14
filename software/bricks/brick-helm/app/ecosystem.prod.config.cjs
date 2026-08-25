/** PM2 prod — helm-v2 vite preview (stable mobile) */
const appRoot = __dirname;

const shared = {
  cwd: appRoot,
  autorestart: true,
  max_restarts: 20,
  min_uptime: '5s',
  restart_delay: 3000,
  merge_logs: true,
  time: true,
  env: { NODE_ENV: 'production' },
};

module.exports = {
  apps: [
    {
      ...shared,
      name: 'helm-v2-api',
      script: 'server/index.js',
      watch: false,
      env: { ...shared.env, PORT: '7926' },
    },
    {
      ...shared,
      name: 'helm-v2-vite',
      script: 'node_modules/.bin/vite',
      args: 'preview --host 127.0.0.1 --port 7923 --strictPort',
      watch: false,
      env: { ...shared.env },
    },
  ],
};
