/**
 * 联机地址相关的纯逻辑测试。
 *
 * 【为什么单独测这两个函数？】
 * 因为它们决定"朋友的浏览器到底往哪儿连"，而且**行为依赖当前页面的协议**
 * （http 还是 https），是最容易"我这边好好的、朋友那边连不上"的一块。
 * 尤其是下面这条：
 *
 *   **HTTPS 页面不许连 ws://**（浏览器的 Mixed Content 规定，直接拦掉，
 *   一个字节都不会发出去）。而免费静态托管（Cloudflare Pages / Vercel）
 *   清一色是 HTTPS —— 也就是说"把网页挂到免费托管 + 用 ws:// 隧道"
 *   这个组合**注定连不上**，但现象和"服务器没开"一模一样。
 *
 * 所以这里把"该补 ws 还是 wss"和"要不要报警"都钉死。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeServerInput, serverUrlProblem } from '../src/net/netplay-client.js';

/**
 * 换掉"当前页面地址"。
 *
 * 这两个函数只读 `location.protocol`，所以给个最小替身就够了 ——
 * 不用像 dom-ui 那组测试一样把整个 jsdom 搭起来（那套是为了测真实 DOM）。
 * 测试环境默认是 Node，没有 window/location，所以必须显式 stub。
 */
function withPageUrl(url: string): void {
  vi.stubGlobal('location', new URL(url));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('服务器地址的补全', () => {
  it('写了协议就原样保留', () => {
    withPageUrl('http://localhost/');
    expect(normalizeServerInput('ws://a.com:1')).toBe('ws://a.com:1');
    expect(normalizeServerInput('wss://a.com:1')).toBe('wss://a.com:1');
  });

  it('空输入返回空（让调用方去提示"不能为空"）', () => {
    expect(normalizeServerInput('   ')).toBe('');
  });

  it('★ 普通网页（http）补 ws://', () => {
    withPageUrl('http://192.168.1.5:5173/');
    expect(normalizeServerInput('frp.example.com:23456')).toBe('ws://frp.example.com:23456');
  });

  it('★ HTTPS 网页必须补 wss://（补 ws:// 等于注定连不上）', () => {
    withPageUrl('https://airnight.pages.dev/');
    expect(normalizeServerInput('frp.example.com:23456')).toBe('wss://frp.example.com:23456');
  });

  it('前后空格会被清掉（从聊天软件里复制粘贴经常带尾巴）', () => {
    withPageUrl('http://localhost/');
    expect(normalizeServerInput('  frp.example.com:23456  ')).toBe('ws://frp.example.com:23456');
  });
});

describe('★ 连不上时能不能给出真正的原因', () => {
  it('http 页面 + ws:// 没问题（绝大多数情况）', () => {
    withPageUrl('http://localhost:5173/');
    expect(serverUrlProblem('ws://127.0.0.1:8787')).toBeNull();
  });

  it('https 页面 + wss:// 没问题', () => {
    withPageUrl('https://airnight.pages.dev/');
    expect(serverUrlProblem('wss://frp.example.com:23456')).toBeNull();
  });

  it('★ https 页面 + ws:// 必须报出"混合内容"这个真原因', () => {
    withPageUrl('https://airnight.pages.dev/');
    const problem = serverUrlProblem('ws://frp.example.com:23456');
    expect(problem, '这种组合是浏览器直接拦掉的，一定要说出来').not.toBeNull();
    // 说明里要让人能照做：关键词是"HHTTPS"和"wss"
    expect(problem!).toContain('HTTPS');
    expect(problem!).toContain('wss://');
  });
});
