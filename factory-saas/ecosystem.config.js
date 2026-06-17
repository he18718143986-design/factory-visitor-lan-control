module.exports = {
  apps: [{
    name:        'factory-saas',
    script:      'server.js',
    instances:   1,
    autorestart: true,
    watch:       false,
    max_memory_restart: '512M',
    kill_timeout:       8000,
    listen_timeout:     5000,
    shutdown_with_message: true,
    env_production: {
      NODE_ENV:  'production',
      PORT:      3000,
    },
    error_file:  './logs/err.log',
    out_file:    './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:  true,
  }, {
    name:        'db-backup',
    script:      'scripts/backup-db.js',
    cron_restart: '0 */6 * * *',   // 每 6 小时备份一次
    autorestart: false,
    watch:       false,
    env_production: {
      NODE_ENV:  'production',
    },
    error_file:  './logs/backup-err.log',
    out_file:    './logs/backup-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:  true,
  }, {
    name:        'expiry-reminder',
    script:      'scripts/expiry-reminder.js',
    cron_restart: '0 9 * * *',     // 每天上午 9:00 运行
    autorestart: false,
    watch:       false,
    env_production: {
      NODE_ENV:  'production',
    },
    error_file:  './logs/reminder-err.log',
    out_file:    './logs/reminder-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs:  true,
  }],
};
