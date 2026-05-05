module.exports = {
  apps: [{
    name: 'raps-api',
    cwd: '/var/www/raps/server',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 4000,
    },
    max_memory_restart: '400M',
    error_file: '/var/log/pm2/raps-error.log',
    out_file: '/var/log/pm2/raps-out.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
  }],
};
