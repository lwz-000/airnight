import { defineConfig } from 'vite';

/**
 * 客户端构建配置。
 *
 * 【为什么用 Vite？】
 * 它负责三件事，都对我们很关键：
 *   1. 把 TypeScript 编译成浏览器能懂的 JavaScript
 *   2. 把多个源文件打包成一个（或几个）文件，浏览器直接加载
 *   3. 开发时提供热更新 —— 你改一行代码，浏览器立刻刷新，不用手动重启
 *
 * 【为什么 root 指向 apps/web？】
 * 这是 monorepo（一个仓库装多个包）的标准做法：
 * 每个包有自己的目录，Vite 只关心自己这个包。
 */
export default defineConfig({
  root: import.meta.dirname,
  /*
    【为什么是 './' 而不是默认的 '/'？】
    默认值 '/' 会把打包结果里的资源写成 `/assets/xxx.js` —— 这意味着
    **网站必须放在域名的根目录**。放到子路径（比如 `example.com/airnight/`）
    就全部 404，而且是一片空白页，看不出原因。

    改成 './' 之后资源路径是相对的，**放哪都能用**：
    根目录、子目录、甚至本地用个小服务器打开都没问题。
    我们没有前端路由（整个游戏就一个页面、靠切换视图），所以相对路径没有任何副作用。
  */
  base: './',
  server: {
    port: 5173,
    // 监听所有网卡，这样你的朋友在同一局域网里也能用你的 IP 访问
    host: true,
    watch: {
      /**
       * 【为什么必须忽略这些临时文件？】
       * 编辑器/AI 工具保存文件时用的是「原子写入」：
       * 先写一个临时文件（.main.ts.xxxx.tmpdir/main.ts.tmp），再改名覆盖目标。
       *
       * 在 Windows 上，Vite 的文件监视器会尝试 watch 这个临时文件，
       * 但它正被写入、处于锁定状态，于是抛出 EBUSY，
       * 而这个错误会让**整个开发服务器直接崩溃退出**（不是简单的警告）。
       *
       * 忽略掉这些临时产物，监视器就不会去碰它们。
       * 你正常改代码的热更新不受任何影响。
       */
      ignored: [
        '**/.*.tmpdir/**',
        '**/*.tmp',
        '**/.*.tmp',
        '**/node_modules/**',
        '**/dist/**',
        '**/.pnpm/**',
      ],
    },
  },
  build: {
    outDir: 'dist',
    // 打包时生成 sourcemap，出错了能定位到源码行（上线可以关掉）
    sourcemap: true,
    // 我们的主包大约 520 kB（绝大部分是 Three.js），
    // 默认 500 kB 的警告阈值会一直报警，调高到 800 kB 免得噪音干扰
    chunkSizeWarningLimit: 800,
  },
});
