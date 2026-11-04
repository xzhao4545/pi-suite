# 当前项目文档

本目录记录当前实现和稳定规则；需求及未完成专项维护在 [待办索引](../todo/index.md)，已完成专项归入 [完成索引](../finished/index.md)。

## 项目状态

- 项目是单个 pnpm 包，包名为 pi-suite，package.json 设置 private: true。
- Node.js 要求为 24 或更高，包管理器固定为 pnpm 12.6.0。
- 源码使用 TypeScript 和 ESM；Pi 通过 package.json 的 pi.extensions 加载 src/index.ts。
- src/index.ts 导出扩展函数，函数体为占位注释。
- 源码目录按 ui、runtime、ask、tasks、jobs/backends、goal、agents 划分；上游来源登记位于 third-party/UPSTREAM.md。
- Pi 开发依赖固定为 1.5.0，依赖解析记录在 pnpm-lock.yaml。

## 开发与检查

从包根目录运行：

```sh
pnpm install
pnpm typecheck
```

开发入口：

```sh
pi -e ./src/index.ts
```

Pi 直接加载 TypeScript 扩展；类型检查使用 tsc --noEmit。
