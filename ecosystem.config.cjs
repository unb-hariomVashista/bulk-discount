module.exports = {
  apps: [
    {
      name: 'bulk-discount-app',
      script: './node_modules/@react-router/serve/bin.js',
      args: './build/server/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
