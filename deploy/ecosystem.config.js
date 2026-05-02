// PM2 process file. Start: `pm2 start deploy/ecosystem.config.js`
// Persist on reboot: `pm2 save && pm2 startup` (run the printed command).

module.exports = {
  apps: [
    {
      name: 'raps-api',
      cwd: '/var/www/raps/server',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      max_memory_restart: '500M',
      error_file: '/var/log/pm2/raps-api.error.log',
      out_file: '/var/log/pm2/raps-api.out.log',
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
    },
  ],
};
