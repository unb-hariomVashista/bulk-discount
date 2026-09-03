module.exports = {
  apps: [
    {
      name: 'bulk-discount-app',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
