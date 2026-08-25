/** PM2 — helm-v2 (dev HMR)
 *  API :7926 + Vite :7923
 */
const appRoot = __dirname;

const shared = {
  cwd: appRoot,
  autorestart: true,
  max_restarts: 20,
  min_uptime: '5s',
  restart_delay: 3000,
  merge_logs: true,
  time: true,
  env: { NODE_ENV: 'development' },
};

const viteHmrEnv = {
  VITE_HMR_HOST: process.env.VITE_HMR_HOST || '127.0.0.1',
  VITE_HMR_CLIENT_PORT: process.env.VITE_HMR_CLIENT_PORT || '443',
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
      args: '--host 127.0.0.1 --port 7923 --strictPort',
      watch: false,
      env: { ...shared.env, ...viteHmrEnv },
    },
  ],
};
