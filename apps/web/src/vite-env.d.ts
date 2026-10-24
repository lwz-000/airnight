/// <reference types="vite/client" />

/*
  引入 vite 的环境类型，让 `import.meta.env`（BASE_URL / DEV / PROD 等）通过类型检查。
  tsconfig 里 `types: ["node"]` 只带了 node 的类型，所以需要这个文件补上 ——
  这是 vite 官方模板的标准做法。

  本项目用到的地方：main.ts 里给音乐播放器传 `import.meta.env.BASE_URL`，
  这样打包产物放在根目录或子目录都能找到 public/music/ 下的曲子。
*/
