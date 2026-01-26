import adapter from '@sveltejs/adapter-static';
import path from 'path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true,
    }),
    alias: {
      '@heatsync/backend/*': path.resolve('../backend/src/*'),
      '@heatsync/shared/*': path.resolve('../shared/src/*'),
      '@heatsync/webapp/*': path.resolve('./src/*'),
    },
  },
};

export default config;
