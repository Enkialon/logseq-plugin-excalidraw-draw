# Logseq Excalidraw Draw

A Logseq plugin for creating, rendering, previewing, and editing Excalidraw drawings inside Logseq pages.

The plugin keeps the original Excalidraw source format intact. Pages display a rendered drawing preview instead of the raw JSON source, and editing opens in a dedicated floating editor window.

![操作](./操作.gif)

## Features

- Create Excalidraw drawings from Logseq slash commands.
- Store drawings either inline in a Logseq block or as `.excalidraw` asset files.
- Preserve the original Excalidraw JSON file format.
- Render drawings as clean previews in the page.
- Open a separate editor window for editing.
- Preview drawings in a larger plugin window.
- Use mouse wheel zoom in the preview window.
- Close the preview window with `Close` or `Esc`.
- Delete a drawing together with its Logseq block reference.

## Commands

Use Logseq slash commands:

- `Excalidraw 绘图`: create an inline Excalidraw source block.
- `Excalidraw 文件绘图`: create an asset-backed `.excalidraw` drawing file.

## Asset-Backed Drawings

Asset-backed drawings are stored as normal `.excalidraw` files under the graph assets directory. The Logseq block keeps a Markdown link to the source file, for example:

```markdown
[draw-2026-04-20T08-57-36-130Z.excalidraw](../assets/excalidraw/draw-2026-04-20T08-57-36-130Z.excalidraw)
```

The plugin reads that file, renders the drawing preview in the page, and opens the same source file for editing.

## Editing

Click `Edit` on a rendered drawing to open the Excalidraw editor. Saving writes the updated Excalidraw JSON back to the original source location and refreshes the rendered preview.

## Preview

Click the rendered drawing image to open a larger preview window. Use the mouse wheel to zoom in or out. Use `Close` or press `Esc` to close the preview.

## Delete

Click `Delete` to remove the drawing file when possible and delete the Logseq block reference.

## Development

Install dependencies:

```bash
pnpm install
```

Build the plugin:

```bash
pnpm build
```

Load the project directory as a local plugin in Logseq.

## Notes

This plugin uses Logseq plugin APIs only. It does not rely on private Logseq DOM behavior or custom Logseq APIs.
