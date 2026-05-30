module.exports = {
  apps: [
    {
      name: "perito",
      script: "server.js",
      cwd: "/root/perito",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: "3100",
        HOSTNAME: "0.0.0.0",
        DATABASE_URL: "postgresql://perito:perito2026@localhost:5432/perito",
      },
    },
  ],
};
