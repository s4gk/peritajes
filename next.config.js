/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "puppeteer",
      "qrcode",
      "@whiskeysockets/baileys",
      "pino",
    ],
  },
};

module.exports = nextConfig;
