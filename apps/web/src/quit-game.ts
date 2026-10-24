/**
 * ============================================================
 *  「退出游戏」—— 网页这边唯一的实现
 * ============================================================
 *
 * 【为什么网页需要这个东西？】
 * 0.3.2 起启动器会把那个黑框（cmd 窗口）藏起来。以前"关掉黑窗口"就是退出，
 * 现在没有窗口可关了 —— 玩家必须有一个能**真正停掉后台进程**的入口。
 * 浏览器杀不了进程，只能请服务器自己退，所以走 `POST /__airnight/quit`。
 *
 * 【谁能用？】
 * 只有"拿着令牌的那一页"。令牌由启动器随机生成，只写进**本机**那条地址：
 *
 *     http://localhost:5173/?server=localhost:5173&quit=<令牌>
 *
 * 局域网里朋友拿到的链接没有 `quit=`，他们的界面上根本不会出现这个按钮
 * （就算他们手动去 POST，服务端还会再查一次来源是不是本机）。
 *
 * 【为什么这个文件这么小还要单独放一个模块？】
 * 因为"从地址里读令牌"和"发请求"是这个动作的**唯一定义**。
 * 散在 main.ts 里的话，以后想加"退出前先保存"之类的东西要改两处。
 */

const QUIT_ROUTE = '/__airnight/quit';

/**
 * 从 `location.search` 里取退出令牌。
 * 没有（或不是个正常字符串）就返回空串 —— 调用方据此决定要不要显示按钮。
 */
export function quitTokenFrom(search: string): string {
  try {
    const token = new URLSearchParams(search).get('quit') ?? '';
    // 只接受启动器那种 16 位十六进制；别的一律当没有（地址被手改过也不至于崩）
    return /^[0-9a-f]{8,64}$/i.test(token) ? token : '';
  } catch {
    return '';
  }
}

/**
 * 请后台退出。
 *
 * @returns 服务器确实答应了才算 true。
 *   false 的两种常见原因：① 不是用启动器打开的（接口没开）；
 *   ② 后台已经先一步退掉了（连接被拒）。两种情况前端都只要提示一句就够。
 */
export async function requestQuit(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(QUIT_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}
