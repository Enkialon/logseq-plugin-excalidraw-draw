# Logseq Excalidraw Draw

一个用于在 Logseq 页面中创建、渲染、预览和编辑 Excalidraw 绘图的插件。

插件会保留原始 Excalidraw 源格式。页面中只显示渲染后的绘图预览，不直接展示大段 JSON；编辑时会打开独立的浮动编辑窗口。

## 功能

- 通过 Logseq 斜杠命令创建 Excalidraw 绘图。
- 支持将绘图保存在当前块中，也支持保存为 `.excalidraw` 资源文件。
- 保留原始 Excalidraw JSON 文件格式。
- 在页面中显示清爽的绘图预览。
- 点击 `Edit` 打开独立编辑窗口。
- 点击绘图本体打开大图预览窗口。
- 在预览窗口中使用鼠标滚轮缩放。
- 使用 `Close` 或 `Esc` 关闭预览窗口。
- 删除绘图时同时删除 Logseq 中的引用块。

## 命令

在 Logseq 中使用斜杠命令：

- `Excalidraw 绘图`：创建块内 Excalidraw 源内容。
- `Excalidraw 文件绘图`：创建基于 `.excalidraw` 文件的绘图。

## 文件绘图

文件绘图会保存为图谱 assets 目录下的普通 `.excalidraw` 文件。Logseq 块中保留源文件链接，例如：

```markdown
[draw-2026-04-20T08-57-36-130Z.excalidraw](../assets/excalidraw/draw-2026-04-20T08-57-36-130Z.excalidraw)
```

插件会读取这个文件，在页面中渲染绘图预览，并在编辑时继续写回同一个源文件。

## 编辑

点击渲染图右上角的 `Edit` 打开 Excalidraw 编辑器。保存后，插件会把最新的 Excalidraw JSON 写回原始位置，并刷新页面中的预览图。

## 预览

点击绘图本体会打开更大的预览窗口。可以使用鼠标滚轮放大或缩小。点击 `Close` 或按 `Esc` 可以关闭预览。

## 删除

点击 `Delete` 会尽可能删除对应的绘图文件，并删除当前 Logseq 块引用。

## 开发

安装依赖：

```bash
pnpm install
```

构建插件：

```bash
pnpm build
```

然后在 Logseq 中将当前项目目录作为本地插件加载。

## 说明

本插件只使用 Logseq 官方插件 API，不依赖 Logseq 私有 DOM 行为，也不自造 Logseq API。
