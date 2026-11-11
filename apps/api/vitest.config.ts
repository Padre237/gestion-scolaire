import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { GS_SCRYPT_N: '1024' },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
