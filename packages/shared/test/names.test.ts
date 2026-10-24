/**
 * ============================================================
 *  ★★ 0.3 昵称规则：2~8 个字 + 字符白名单 + 重名判定
 * ============================================================
 *
 * 这些是纯函数，服务端和客户端**共用同一份**（judge 在服务端，客户端只做即时提示）。
 * 所以这里测出来的结论，两边都成立。
 */
import { describe, expect, it } from 'vitest';
import {
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  nameTakenIn,
  playerNameError,
  playerNameKey,
  playerNameLength,
  sanitizePlayerName,
} from '../src/index.js';

describe('★ 0.3 昵称清洗', () => {
  it('去掉首尾空白（输入框里多打几个空格是常事）', () => {
    expect(sanitizePlayerName('  小红  ')).toBe('小红');
  });

  it('白名单之外的字符被洗掉：尖括号、反斜杠、控制字符', () => {
    expect(sanitizePlayerName('<script>')).toBe('script');
    expect(sanitizePlayerName('a\\b')).toBe('ab');
    expect(sanitizePlayerName('a\u0000b')).toBe('ab');
  });

  it('常用符号保留：下划线 / 连字符 / 中点 / 井号 / @ / 叹号问号', () => {
    expect(sanitizePlayerName('A_B-C')).toBe('A_B-C');
    expect(sanitizePlayerName('博士#1')).toBe('博士#1');
    expect(sanitizePlayerName('a@b!?')).toBe('a@b!?');
  });

  it('★ 全角字母数字先压成半角（NFKC），否则全角打一遍就能绕过重名', () => {
    expect(sanitizePlayerName('Ａｌｉｃｅ')).toBe('Alice');
    expect(sanitizePlayerName('１２３')).toBe('123');
  });

  it('超长按"字"截到 8 个（不是按 UTF-16 码元）', () => {
    expect(sanitizePlayerName('一二三四五六七八九十')).toBe('一二三四五六七八');
    expect(playerNameLength(sanitizePlayerName('一二三四五六七八九十'))).toBe(NAME_MAX_LENGTH);
  });

  it('全是不合法的字符 -> 空串（调用方再判空）', () => {
    expect(sanitizePlayerName('<<<>>>')).toBe('');
    expect(sanitizePlayerName('')).toBe('');
    expect(sanitizePlayerName(null)).toBe('');
  });
});

describe('★ 0.3 昵称长度校验（2~8）', () => {
  it('合法长度不报错', () => {
    expect(playerNameError('小红')).toBeNull();
    expect(playerNameError('一二三四五六七八')).toBeNull();
  });

  it('太短 / 太长 / 空 都要报错，而且文案能直接给玩家看', () => {
    expect(playerNameError('')).toContain('不能是空的');
    expect(playerNameError('甲')).toBe(`昵称至少要 ${NAME_MIN_LENGTH} 个字`);
    expect(playerNameError('一二三四五六七八九')).toBe(`昵称最多 ${NAME_MAX_LENGTH} 个字`);
  });
});

describe('★ 0.3 重名判定', () => {
  const players = [
    { id: 'p1', name: 'Alice99' },
    { id: 'p2', name: '博士' },
  ];

  it('归一化键：大小写 / 全角 / 空白 都不影响比对', () => {
    expect(playerNameKey('Ａlice 99')).toBe(playerNameKey('alice99'));
  });

  it('同名算撞，不同名不算', () => {
    expect(nameTakenIn(players, 'Alice99')).toBe(true);
    expect(nameTakenIn(players, 'alice99'), '大小写不同也是同一个人').toBe(true);
    expect(nameTakenIn(players, 'Alice98')).toBe(false);
  });

  it('★ 排除自己：改成自己原来的名字不该被自己挡住', () => {
    expect(nameTakenIn(players, 'Alice99', 'p1')).toBe(false);
    expect(nameTakenIn(players, 'Alice99', 'p2'), '排除别人没用，该撞还是撞').toBe(true);
  });

  it('空名字不算撞（空名字由长度校验去拒）', () => {
    expect(nameTakenIn(players, '')).toBe(false);
  });
});
