/**
 * 探测 prts.wiki 的图片接口（一次性小工具）。
 *
 * 目的：确认两件事
 *  1. 这台机器能不能在 Node 里直接访问外网（要批量下载 50 张图）
 *  2. prts.wiki 的头像文件到底叫什么名字（命名规则）
 */

const API = 'https://prts.wiki/api.php';

async function get(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AIRNIGHT-local-fan-game/0.1 (personal use, not published)' },
  });
  return { status: res.status, body: await res.text() };
}

// 1) 网络通不通
try {
  const { status, body } = await get({ action: 'query', meta: 'siteinfo', siprop: 'general' });
  console.log(`siteinfo: HTTP ${status}`);
  console.log(body.slice(0, 300));
} catch (error) {
  console.error('❌ Node 访问外网失败：', error.message);
  process.exit(1);
}

// 2) 头像文件的命名规则：列出以「头像」开头的文件
try {
  const { status, body } = await get({
    action: 'query',
    list: 'allimages',
    aiprefix: '头像',
    ailimit: '8',
    aiprop: 'url',
  });
  console.log(`\nallimages(头像*): HTTP ${status}`);
  const data = JSON.parse(body);
  for (const img of data?.query?.allimages ?? []) {
    console.log(`  ${img.name}  ->  ${img.url}`);
  }
  if (!data?.query?.allimages?.length) console.log('  （没有结果）', body.slice(0, 400));
} catch (error) {
  console.error('allimages 出错：', error.message);
}
