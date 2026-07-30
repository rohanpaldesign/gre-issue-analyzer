/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // nspell and dictionary-en ship data files that must resolve at runtime,
    // so they stay external to the server bundle.
    serverComponentsExternalPackages: ['nspell', 'dictionary-en'],
  },
};

module.exports = nextConfig;
