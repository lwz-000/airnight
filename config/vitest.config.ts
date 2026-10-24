import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Vitest 配置。
 *
 * 两处关键设置：
 *
 * 1. resolve.alias —— 让测试能直接 import '@airnight/shared'。
 *    把包名指向它的 TypeScript 源码（而不是编译产物），
 *    这样改了内核代码后测试立刻生效，不需要先 build 一次。
 *
 * 2. pool: 'threads' —— Vitest 默认用「子进程」跑测试，
 *    父子进程之间靠管道通信，本机沙箱禁止管道（会报 spawn EPERM）。
 *    改成线程池就不需要管道，测试结果完全一样。
 *
 * 用法： node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: {
    alias: {
      '@airnight/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    pool: 'threads',
    // 三个包都可能有测试：内核、联机服务、客户端
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    testTimeout: 30000,
  },
});
