/**
 * ============================================================
 *  ★★ 0.3.3 「我在这局有座位」的多槽索引（resume-index）
 * ============================================================
 *
 * 用户口径："掉了线也可以进已开局的房间" —— 列表里那颗「回到对局」靠它。
 *
 * 它和 `machine-session`（单槽：本机**现在**在玩哪一局）是**两件事**：
 * 这里记的是"我今晚在哪几局里留下过座位"，所以必须支持多条、按地址隔离。
 * 这一组钉住的就是"多条 / 隔离 / 过期 / 忘掉"四件事 ——
 * 任何一条错了都不会报错，只会表现为"列表里那颗按钮该有的时候没有"。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESUME_INDEX_MAX,
  findResumeTarget,
  forgetResumeTarget,
  rememberResumeTarget,
  resumeTargets,
} from '../src/net/resume-index.js';

/** 一个够用的 localStorage 替身（模块只用到 getItem/setItem） */
function installStorage(): void {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string): string | null => map.get(key) ?? null,
      setItem: (key: string, value: string): void => void map.set(key, value),
      removeItem: (key: string): void => void map.delete(key),
      clear: (): void => void map.clear(),
    },
  });
}

const URL_A = 'ws://192.168.1.5:8787';
const URL_B = 'ws://192.168.1.6:8787';

describe('★★ 0.3.3 重连索引：我在这局有座位', () => {
  beforeEach(() => {
    installStorage();
  });

  it('记下来就能按 地址 + 房间号 查回来', () => {
    rememberResumeTarget({ url: URL_A, code: 'a7k2m9', token: 'tok-a' });
    // 房间号不分大小写、地址抹掉多余斜杠 —— 查的时候不用先归一化一遍
    expect(findResumeTarget('ws://192.168.1.5:8787/', 'A7K2M9')).toBe('tok-a');
    expect(findResumeTarget(URL_A, 'a7k2m9')).toBe('tok-a');
  });

  it('★ 按地址隔离：同一间房号在两台机器上是两局，不能串', () => {
    rememberResumeTarget({ url: URL_A, code: 'AAA111', token: 'tok-a' });
    rememberResumeTarget({ url: URL_B, code: 'AAA111', token: 'tok-b' });
    expect(findResumeTarget(URL_A, 'AAA111')).toBe('tok-a');
    expect(findResumeTarget(URL_B, 'AAA111')).toBe('tok-b');
    // 没去过的那台机器：查不到
    expect(findResumeTarget('ws://192.168.1.9:8787', 'AAA111')).toBe('');
  });

  it('★ 同一个房间再记一次是"更新"，不是新插一条（否则一晚重连几次就把名额占满）', () => {
    rememberResumeTarget({ url: URL_A, code: 'AAA111', token: 'old' });
    rememberResumeTarget({ url: URL_A, code: 'AAA111', token: 'new' });
    expect(resumeTargets()).toHaveLength(1);
    expect(findResumeTarget(URL_A, 'AAA111')).toBe('new');
  });

  it('最多记 5 条：超了就把最旧的挤掉', () => {
    for (let i = 0; i < RESUME_INDEX_MAX + 2; i++) {
      rememberResumeTarget({ url: `ws://10.0.0.${i}:8787`, code: `ROOM${i}`, token: `tok${i}` });
    }
    expect(resumeTargets()).toHaveLength(RESUME_INDEX_MAX);
    // 最近记的还在，最早的那两条已经挤掉
    expect(findResumeTarget('ws://10.0.0.0:8787', 'ROOM0')).toBe('');
    expect(findResumeTarget(`ws://10.0.0.${RESUME_INDEX_MAX + 1}:8787`, `ROOM${RESUME_INDEX_MAX + 1}`)).toBe(
      `tok${RESUME_INDEX_MAX + 1}`,
    );
  });

  it('★ 忘掉一条（服务器说令牌失效了）不会误删别的', () => {
    rememberResumeTarget({ url: URL_A, code: 'AAA111', token: 'tok-a' });
    rememberResumeTarget({ url: URL_B, code: 'BBB222', token: 'tok-b' });
    forgetResumeTarget(URL_A, 'AAA111');
    expect(findResumeTarget(URL_A, 'AAA111')).toBe('');
    expect(findResumeTarget(URL_B, 'BBB222'), '别人的那条不能被顺手删掉').toBe('tok-b');
  });

  it('★ 超过 12 小时的记录自动作废（服务器一重启令牌就全废了，留着只会点了报错）', () => {
    const old = Date.now() - 13 * 60 * 60 * 1000;
    globalThis.localStorage.setItem(
      'airnight.resume.index.v1',
      JSON.stringify([{ url: URL_A, code: 'AAA111', token: 'stale', at: old }]),
    );
    expect(findResumeTarget(URL_A, 'AAA111'), '过期的要当成没有').toBe('');
  });

  it('存档里是垃圾数据也不能崩（隐私模式 / 被别的版本改过）', () => {
    globalThis.localStorage.setItem('airnight.resume.index.v1', '{ not json');
    expect(resumeTargets()).toEqual([]);
    globalThis.localStorage.setItem('airnight.resume.index.v1', '{"a":1}');
    expect(resumeTargets()).toEqual([]);
    // 写一条之后还能正常工作
    rememberResumeTarget({ url: URL_A, code: 'AAA111', token: 'tok-a' });
    expect(findResumeTarget(URL_A, 'AAA111')).toBe('tok-a');
  });
});
