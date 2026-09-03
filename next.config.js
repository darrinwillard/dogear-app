const { version } = require('./package.json')
const { execSync } = require('child_process')

let commitSha = process.env.VERCEL_GIT_COMMIT_SHA || ''
if (!commitSha) {
  try {
    commitSha = execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    commitSha = 'local'
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_COMMIT_SHA: commitSha.slice(0, 7),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'covers.openlibrary.org',
        pathname: '/b/id/**',
      },
      {
        protocol: 'https',
        hostname: 'm.media-amazon.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'img.audible.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images-na.ssl-images-amazon.com',
        pathname: '/**',
      },
    ],
  },
}

module.exports = nextConfig
