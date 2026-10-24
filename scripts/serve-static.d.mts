/**
 * `scripts/serve-static.mjs` 的类型声明。
 *
 * 【为什么要有这个文件？】
 * 那个脚本是 `.mjs`（纯 JS，带完整中文注释，你也能直接看懂），
 * 但测试是用 TypeScript 写的 —— TS 默认不认识 `.mjs` 的导出，
 * 会报"找不到声明文件"。写一份最小的声明就够了：
 * 只描述**测试会用到的那一个函数**，不用把整个脚本的类型都写一遍。
 */
import type { Server } from 'node:http';

export interface CombinedServerOptions {
  /** 网页文件所在目录（默认 apps/web/dist） */
  distDir?: string;
  /** 游戏服务器端口，WebSocket 会转发到这里（默认 8787） */
  gamePort?: number;
  /** 静默模式（测试用，不打印启动信息） */
  quiet?: boolean;
  /** ★ 0.1.2：本机对局会话的落盘位置（测试指向临时文件，免得污染仓库） */
  sessionFile?: string;
  /** ★ 0.1.2：占用者心跳超时（测试可以压到几十毫秒） */
  ownerTtlMs?: number;
  /**
   * ★ 0.3.2：「退出游戏」令牌。空 = 不开放 `POST /__airnight/quit`。
   * 由启动器随机生成，只写进**本机**那条地址的 `?quit=`。
   */
  quitToken?: string;
  /** 令牌校验通过时怎么退（启动器传 `() => stop()`） */
  onQuit?: (() => void) | null;
}

/**
 * 造一个"网页 + WebSocket 转发"的服务器。
 * 返回的就是普通的 http.Server —— 用 `listen()` 起它，用 `close()` 关它。
 */
export function createCombinedServer(options?: CombinedServerOptions): Server;
