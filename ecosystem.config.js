module.exports = {
  apps: [
    {
      name: "wapi",
      script: "./index.js",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_memory_restart: "1024M",
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=1024",
      },
    },
  ],
};
