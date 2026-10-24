/**
 * ============================================================
 *  ★★ 0.3：`renderKeyed` —— 列表"就地更新"的唯一实现
 * ============================================================
 *
 * 【为什么要专门测它？】
 * 它是"买牌卡顿 / 卡面抽搐 / 羁绊列表抽搐"这三个 bug 的**根治手段**：
 * 以前所有列表都是 `innerHTML = ''` 重建，于是
 *   ① `.shop-slot:hover { translateY(-3px) }` 这类带 transition 的位移
 *      会在新节点上从 0 重新过渡 ⇒ 肉眼抽搐；
 *   ② `<img>` 被重建 ⇒ 立绘闪一下；
 *   ③ `#shop-slots` 的横向滚动位置被清零。
 * 换成"按 key 复用节点"之后，这些就都不发生了 ——
 * 但前提是"复用"这件事本身没写错。写错的后果很隐蔽：
 * 卡面显示的还是**上一格**的数据，玩家买了 A 却看到 B 被买走。
 *
 * 所以这一组把四条规则钉死：
 *   · 签名没变 -> **同一个节点对象**（不是"长得一样的新节点"）
 *   · 签名变了 -> 只换那一个
 *   · key 消失 -> 删掉
 *   · 顺序变了 -> 用 insertBefore 挪，不重建
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { renderKeyed, resetKeyed } from '../src/keyed-list.js';

const dom = new JSDOM('<!doctype html><div id="box"></div>');
const doc = dom.window.document;
// `renderKeyed` 里用了 `isConnected` / `replaceWith` / `insertBefore`，jsdom 都有

interface Item {
  id: string;
  text: string;
}

function makeBox(): HTMLElement {
  const box = doc.createElement('div');
  doc.body.appendChild(box);
  return box;
}

const OPTS = {
  key: (item: Item) => item.id,
  sig: (item: Item) => item.text,
  build: (item: Item) => {
    const node = doc.createElement('div');
    node.className = 'row';
    node.dataset.id = item.id;
    node.textContent = item.text;
    return node;
  },
};

describe('renderKeyed', () => {
  it('★ 第一次渲染：全部新建，顺序和传入一致', () => {
    const box = makeBox();
    const items: Item[] = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ];
    const rebuilt = renderKeyed(box, items, OPTS);
    expect(rebuilt).toBe(2);
    expect([...box.children].map((n) => (n as HTMLElement).dataset.id)).toEqual(['a', 'b']);
  });

  /**
   * ★★ 这条是"不抽搐"的核心：必须是**同一个对象**。
   * 如果实现偷偷换成了新节点（哪怕长得一样），hover 的 transition 就会重来。
   */
  it('★★ 内容没变 -> 复用同一个 DOM 节点（不是"长得一样的新节点"）', () => {
    const box = makeBox();
    const items: Item[] = [{ id: 'a', text: 'A' }];
    renderKeyed(box, items, OPTS);
    const first = box.children[0]!;
    // 打个标记：重建过的话标记一定丢
    (first as unknown as Record<string, unknown>)['__mark'] = 'kept';

    const rebuilt = renderKeyed(box, [{ id: 'a', text: 'A' }], OPTS);
    expect(rebuilt).toBe(0);
    expect(box.children[0]).toBe(first);
    expect((box.children[0] as unknown as Record<string, unknown>)['__mark']).toBe('kept');
  });

  it('★ 只有内容变的那一条被重建，别的不动', () => {
    const box = makeBox();
    renderKeyed(
      box,
      [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
      ],
      OPTS,
    );
    const [a, b, c] = [...box.children];
    const rebuilt = renderKeyed(
      box,
      [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B2' }, // 只有这一条变了
        { id: 'c', text: 'C' },
      ],
      OPTS,
    );
    expect(rebuilt).toBe(1);
    expect(box.children[0]).toBe(a);
    expect(box.children[1]).not.toBe(b);
    expect(box.children[1]!.textContent).toBe('B2');
    expect(box.children[2]).toBe(c);
    // ★ 位置也不能变（replaceWith 是就地替换）
    expect([...box.children].map((n) => (n as HTMLElement).dataset.id)).toEqual(['a', 'b', 'c']);
  });

  it('★ key 消失了 -> 节点被删掉', () => {
    const box = makeBox();
    renderKeyed(
      box,
      [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      OPTS,
    );
    renderKeyed(box, [{ id: 'a', text: 'A' }], OPTS);
    expect([...box.children].map((n) => (n as HTMLElement).dataset.id)).toEqual(['a']);
  });

  /**
   * ★ 顺序变了要"挪"而不是"重建"：
   * 羁绊列表是按人数排序的，买一个棋子就可能换位 —— 如果重建，
   * 整列又会闪一下（正是要修的东西）。
   */
  it('★ 顺序变了 -> 复用节点 + insertBefore 挪位置（不重建）', () => {
    const box = makeBox();
    renderKeyed(
      box,
      [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      OPTS,
    );
    const [a, b] = [...box.children];
    const rebuilt = renderKeyed(
      box,
      [
        { id: 'b', text: 'B' },
        { id: 'a', text: 'A' },
      ],
      OPTS,
    );
    expect(rebuilt).toBe(0);
    expect([...box.children]).toEqual([b, a]);
  });

  it('★ 换了数据源（ns 变了）-> 整块重建 + 旧的全部清掉', () => {
    const box = makeBox();
    renderKeyed(box, [{ id: 'a', text: 'A' }], { ...OPTS, ns: 'me' });
    const first = box.children[0]!;
    renderKeyed(box, [{ id: 'a', text: 'A' }], { ...OPTS, ns: 'watched' });
    expect(box.children).toHaveLength(1);
    expect(box.children[0]).not.toBe(first);
    expect(box.children[0]!.textContent).toBe('A');
  });

  it('★ 空列表 -> 全部清掉（不会留下一堆孤儿节点）', () => {
    const box = makeBox();
    renderKeyed(
      box,
      [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      OPTS,
    );
    renderKeyed(box, [], OPTS);
    expect(box.children).toHaveLength(0);
  });

  it('★ 换完再换回来：不会保留"上一轮"的残留', () => {
    const box = makeBox();
    const listA: Item[] = [{ id: 'a', text: 'A' }];
    const listB: Item[] = [{ id: 'x', text: 'X' }];
    renderKeyed(box, listA, OPTS);
    renderKeyed(box, listB, OPTS);
    renderKeyed(box, listA, OPTS);
    expect([...box.children].map((n) => (n as HTMLElement).dataset.id)).toEqual(['a']);
  });

  it('★ resetKeyed 之后下一次一定重建（给"手写过 innerHTML"的地方兜底）', () => {
    const box = makeBox();
    renderKeyed(box, [{ id: 'a', text: 'A' }], OPTS);
    const first = box.children[0]!;
    // 模拟"别处直接改了 DOM"：把节点换掉，但缓存里还记着旧的
    box.innerHTML = '';
    resetKeyed(box);
    const rebuilt = renderKeyed(box, [{ id: 'a', text: 'A' }], OPTS);
    expect(rebuilt).toBe(1);
    expect(box.children[0]).not.toBe(first);
  });
});
