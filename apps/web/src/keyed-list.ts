/**
 * ============================================================
 *  ★★ 0.3 修「界面抽搐 / 买牌卡顿」：按 key 复用 DOM 的列表渲染
 * ============================================================
 *
 * 【问题是什么？】
 * 以前这些列表都是 `container.innerHTML = ''` 再一条条 append：
 * `#shop-slots`（商店 5 张卡）· `#bench-slots`（备战席 9 格）·
 * `#trait-list`（羁绊 20 行）· `#player-strip-list` · 藏品栏 …
 * 而 `renderAll()` 会被几十个地方调用（买牌、花钱、房间广播、每秒一次的
 * 倒计时刷新…）。于是**每次**都把这些节点整个丢掉重建。
 *
 * 重建带来的三个真实后果（用户报的就是这三个）：
 *
 * ① **卡面抽搐**：`.shop-slot` / `.bench-slot` `:hover` 有 `translateY(-3px)`，
 *    而且带 `transition: transform .1s`。鼠标正悬在卡上时点一下买牌 ->
 *    节点被换成新的 -> 新节点从 `translateY(0)` 开始过渡到 `-3px`
 *    ⇒ 卡片肉眼可见地"掉下去再弹回来"。羁绊列表同理
 *    （`.trait-row:hover` 是 `translateX(2px)`，所以整列会左右抖一下）。
 * ② **图片闪一下**：每张卡的 `<img>` 都是新建的，浏览器要重新解码/上屏，
 *    快速连点时就会看到立绘闪白。
 * ③ **滚动位置被清零**：`#shop-slots` 有 `overflow-x: auto`，
 *    `innerHTML = ''` 一旦把内容清空，`scrollLeft` 就回到 0 ——
 *    玩家往右翻过之后，随便点一下又跳回最左边。
 *
 * 【解决思路】
 * 不重建，**就地更新**：按 key 找到旧节点，签名没变就整个跳过（连属性都不碰），
 * 变了才重建那一个；顺序变了用 `insertBefore` 挪；不要的删掉。
 * 这样 hover 状态、transition、`<img>`、滚动位置全都保住了。
 *
 * 【为什么用「签名」而不是逐字段 diff？】
 * 卡片的内容是拼出来的 HTML 字符串，逐字段写 diff 等于给每张卡写第二份渲染逻辑
 * —— 两处一定会走散（这个项目在别处已经吃过同样的亏）。
 * 签名就是"把影响外观的输入拼起来"，变了才重建。简单、不会漏。
 */

interface KeyedEntry {
  node: HTMLElement;
  sig: string;
}

/** 每个容器自己的缓存（WeakMap：容器被丢掉时缓存跟着回收，不用手动清） */
const cacheByContainer = new WeakMap<HTMLElement, Map<string, KeyedEntry>>();

/** 容器上记录"上一次是按哪个命名空间渲染的"（同一容器切换数据源时要整体重置） */
const nsByContainer = new WeakMap<HTMLElement, string>();

export interface KeyedRenderOptions<T> {
  /** 稳定标识（同一个东西每次渲染必须一样） */
  key: (item: T) => string;
  /**
   * 外观签名：**把所有会影响长相的输入都拼进来**。
   * 一样就跳过这个节点（一个属性都不写），不一样才重建。
   */
  sig: (item: T) => string;
  /** 新建一个节点 */
  build: (item: T) => HTMLElement;
  /**
   * ★ 换了"这一栏显示谁的东西"（比如从自己的羁绊切到观战对象的羁绊）时，
   * 传一个不同的命名空间 —— 缓存会被丢掉、整块重建。
   * 不传 = 所有情况共用一个命名空间。
   */
  ns?: string;
}

/**
 * 按 key 就地更新 `container` 的子节点。
 *
 * @returns 实际**重建**了几个节点（测试/诊断用；正常情况下应该接近 0）
 */
export function renderKeyed<T>(
  container: HTMLElement,
  items: readonly T[],
  options: KeyedRenderOptions<T>,
): number {
  const ns = options.ns ?? '';
  let cache = cacheByContainer.get(container);
  if (!cache || nsByContainer.get(container) !== ns) {
    // 换了数据源：把旧的清干净再重来（这是"真的该重建"的唯一情形）
    container.replaceChildren();
    cache = new Map();
    cacheByContainer.set(container, cache);
    nsByContainer.set(container, ns);
  }

  let rebuilt = 0;
  const live = new Set<string>();

  for (const item of items) {
    const key = options.key(item);
    const sig = options.sig(item);
    live.add(key);

    const old = cache.get(key);
    if (old && old.sig === sig && old.node.isConnected) {
      // ★ 一样就什么都不做 —— 连 style 都不碰，hover/transition 完全不受影响
      continue;
    }
    const node = options.build(item);
    if (old) {
      // 就地替换：位置不变，只是这一个节点重建（其余卡片的 hover 不受影响）
      if (old.node.parentNode === container) old.node.replaceWith(node);
    }
    cache.set(key, { node, sig });
    rebuilt++;
  }

  // 先把该在的都按顺序摆好（insertBefore 已经在正确位置时是空操作）
  let cursor = 0;
  for (const item of items) {
    const entry = cache.get(options.key(item));
    if (!entry) continue;
    const want = container.children[cursor] ?? null;
    if (want !== entry.node) {
      container.insertBefore(entry.node, want);
    }
    cursor++;
  }

  // 再删掉这一轮没出现的（放最后：先摆好再删，避免中途错位）
  for (const [key, entry] of cache) {
    if (live.has(key)) continue;
    entry.node.remove();
    cache.delete(key);
  }

  return rebuilt;
}

/**
 * 清空某个容器的 keyed 缓存（**不需要**在正常渲染里调用）。
 *
 * 什么时候才需要？—— "这个容器的内容被别的地方直接改过"的时候。
 * 现在代码里没有这种地方；留着是为了以后有人手写 `innerHTML` 时不至于
 * 缓存和真实 DOM 对不上（对不上会表现为"该在的不见了 / 重复出现"）。
 */
export function resetKeyed(container: HTMLElement): void {
  cacheByContainer.delete(container);
  nsByContainer.delete(container);
}
