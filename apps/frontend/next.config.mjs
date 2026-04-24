/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: false
  },
  async redirects() {
    return [
      {
        source: "/settings/modeling",
        destination: "/modeling",
        permanent: true
      }
    ];
  }
};

export default nextConfig;
