/**
 * ============================================================
 *  ★★ 0.3.2：头像 id 的白名单（现在有两种）
 * ============================================================
 *
 * 背景：主界面头像墙除了 55 个干员，还接进了**官方「个人头像」**（玩家头像，
 * 203 张，见 PRTS「个人头像一览」）。它们用 `pa:` 前缀和干员的 `opNN` 区分。
 *
 * 这条白名单决定"别人看到你是谁"：
 *   · 放进来的是**空串** ⇒ 服务端当成"没选"，别人看到默认头像（静默丢失，不报错）；
 *   · 放进来的是奇怪的长字符串 ⇒ 它会进房间广播、显示给全房间。
 * 所以既要放行新格式，也要把形状卡死。
 */
import { describe, expect, it } from 'vitest';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
const { sanitizeAvatarId } = await import('../src/main.js');

describe('★ 头像 id 白名单', () => {
  it('干员头像照旧', () => {
    expect(sanitizeAvatarId('op01')).toBe('op01');
    expect(sanitizeAvatarId(' op55 ')).toBe('op55');
  });

  it('★★ 官方个人头像：pa: 前缀放行（以前会被当成"没选"丢掉）', () => {
    expect(sanitizeAvatarId('pa:avatar_def_01')).toBe('pa:avatar_def_01');
    expect(sanitizeAvatarId('pa:avatar_activity_RL1_1')).toBe('pa:avatar_activity_RL1_1');
    expect(sanitizeAvatarId('pa:avatar_special_MissC')).toBe('pa:avatar_special_MissC');
  });

  it('★ 形状不对的一律清空（不会带着奇怪的东西进房间广播）', () => {
    expect(sanitizeAvatarId('pa:')).toBe('');
    expect(sanitizeAvatarId('pa:../../etc/passwd')).toBe('');
    expect(sanitizeAvatarId('pa:avatar_def_01; rm -rf /')).toBe('');
    expect(sanitizeAvatarId('pa:' + 'a'.repeat(60))).toBe('');
    expect(sanitizeAvatarId('op999')).toBe('op999'); // 形状对就放行，存不存在由客户端查表
    expect(sanitizeAvatarId('op9999')).toBe(''); // 干员 id 最多 3 位数字
    expect(sanitizeAvatarId(undefined)).toBe('');
    expect(sanitizeAvatarId(123 as unknown)).toBe('');
  });
});
