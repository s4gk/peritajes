/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: [
      "puppeteer",
      "qrcode",
      "@whiskeysockets/baileys",
      "pino",
    ],
  },
};

module.exports = nextConfig;
