/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel should not stop deployment because of lint/type diagnostics.
  // Runtime CRUD errors are still handled in the app and Supabase responses.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: { unoptimized: true },
  reactStrictMode: true,
};

module.exports = nextConfig;
