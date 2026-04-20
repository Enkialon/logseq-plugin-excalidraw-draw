import "@logseq/libs";
import "@excalidraw/excalidraw/index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import {
  createAssetLinkBlock,
  createSourceBlock,
  EMPTY_EXCALIDRAW_SOURCE,
  parseExcalidrawAssetLink,
  parseSourceBlock,
} from "./excalidraw-source";
import { escapeAttribute, renderSourceToDataUrl } from "./render";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

type RendererBlock = {
  uuid?: string;
  content?: string;
  slot: string;
};

const registeredRenderers = new Set<string>();
const rendererSlots = new Map<string, RendererBlock>();
const assetsStorage = logseq.Assets.makeSandboxStorage();

function getPulledBlockValue(block: Record<string, unknown>, key: string) {
  return block[key] ?? block[`block/${key}`];
}

function normalizePulledBlock(value: unknown) {
  const block = Array.isArray(value) ? value[0] : value;
  if (!block || typeof block !== "object") {
    return null;
  }

  const pulled = block as Record<string, unknown>;
  const uuid = getPulledBlockValue(pulled, "uuid");
  const content = getPulledBlockValue(pulled, "content");

  if (typeof uuid !== "string" || typeof content !== "string") {
    return null;
  }

  return { uuid, content };
}

async function resolveBlockSource(content: string) {
  const inlineSource = parseSourceBlock(content);
  if (inlineSource) {
    return {
      kind: "inline" as const,
      source: inlineSource,
      assetPath: null,
    };
  }

  const assetLink = parseExcalidrawAssetLink(content);
  if (!assetLink) {
    return null;
  }

  const fileContent = await readAssetFile(assetLink.assetPath);
  if (typeof fileContent !== "string") {
    return null;
  }

  const source = parseSourceBlock(fileContent);
  if (!source) {
    return null;
  }

  return {
    kind: "asset" as const,
    source,
    assetPath: assetLink.assetPath,
  };
}

async function readAssetFile(assetPath: string) {
  try {
    const assetUrl = await logseq.Assets.makeUrl(assetPath);
    const response = await fetch(assetUrl);
    if (response.ok) {
      return await response.text();
    }
  } catch {
    // Fall through to sandbox storage for files created by older plugin builds.
  }

  try {
    const sandboxContent = await assetsStorage.getItem(assetPath);
    return typeof sandboxContent === "string" ? sandboxContent : null;
  } catch {
    return null;
  }
}

function isRenderableBlockContent(content: string) {
  return Boolean(parseSourceBlock(content) || parseExcalidrawAssetLink(content));
}

function registerRenderer(blockUuid: string) {
  if (registeredRenderers.has(blockUuid)) {
    return;
  }

  registeredRenderers.add(blockUuid);
  logseq.App.onBlockRendererSlotted(blockUuid, async (event: RendererBlock) => {
    rendererSlots.set(blockUuid, event);
    await renderBlock(blockUuid, event);
  });
}

async function renderBlock(blockUuid: string, event: RendererBlock) {
  const resolved = await resolveBlockSource(event.content ?? "");
  if (!resolved) {
    logseq.provideUI({
      key: `excalidraw-renderer-${blockUuid}`,
      slot: event.slot,
      reset: true,
      template: `
        <div class="logseq-excalidraw-renderer logseq-excalidraw-error">
          无法读取 Excalidraw 文件
        </div>
      `,
    });
    return;
  }

  const imageUrl = await renderSourceToDataUrl(resolved.source);
  const safeImageUrl = escapeAttribute(imageUrl);
  const safeUuid = escapeAttribute(event.uuid ?? blockUuid);
  const safeAssetPath = resolved.assetPath ? escapeAttribute(resolved.assetPath) : "";

  logseq.provideUI({
    key: `excalidraw-renderer-${blockUuid}`,
    slot: event.slot,
    reset: true,
    template: `
      <div class="logseq-excalidraw-renderer" data-block-uuid="${safeUuid}" data-asset-path="${safeAssetPath}">
        <div class="logseq-excalidraw-actions">
          <button data-on-click="editExcalidrawDrawing" data-block-uuid="${safeUuid}" data-asset-path="${safeAssetPath}">编辑</button>
          <button data-on-click="deleteExcalidrawDrawing" data-block-uuid="${safeUuid}" data-asset-path="${safeAssetPath}">删除</button>
        </div>
        <button class="logseq-excalidraw-preview-button" data-on-click="previewExcalidrawDrawing" data-block-uuid="${safeUuid}" data-asset-path="${safeAssetPath}" title="点击放大">
        <img src="${safeImageUrl}" alt="Excalidraw drawing" />
        </button>
      </div>
    `,
  });
}

async function refreshRenderer(blockUuid: string) {
  const event = rendererSlots.get(blockUuid);
  const block = await logseq.Editor.getBlock(blockUuid);
  if (!event || !block?.content) {
    return;
  }

  await renderBlock(blockUuid, {
    ...event,
    uuid: blockUuid,
    content: block.content,
  });
}

async function registerExistingRenderers() {
  const rows = await logseq.DB.datascriptQuery(`
    [:find (pull ?b [:block/uuid :block/content])
     :where
     [?b :block/content ?content]]
  `);

  for (const row of rows as unknown[]) {
    const block = normalizePulledBlock(row);
    if (block && isRenderableBlockContent(block.content)) {
      registerRenderer(block.uuid);
    }
  }
}

function installRenderer() {
  window.refreshExcalidrawRenderer = refreshRenderer;
  registerExistingRenderers();
  logseq.DB.onChanged(({ blocks }) => {
    for (const block of blocks ?? []) {
      if (block.uuid && block.content && isRenderableBlockContent(block.content)) {
        registerRenderer(block.uuid);
      }
    }
  });
}

function installCommands() {
  logseq.provideModel({
    editExcalidrawDrawing(event: { dataset?: { blockUuid?: string; assetPath?: string } }) {
      const assetPath = event.dataset?.assetPath;
      const blockUuid = event.dataset?.blockUuid;
      if (assetPath) {
        window.openExcalidrawAssetEditor?.(assetPath, blockUuid);
      } else if (blockUuid) {
        window.openExcalidrawEditor?.(blockUuid);
      }
    },
    async deleteExcalidrawDrawing(event: { dataset?: { blockUuid?: string; assetPath?: string } }) {
      const assetPath = event.dataset?.assetPath;
      const blockUuid = event.dataset?.blockUuid;
      if (assetPath) {
        await assetsStorage.removeItem(assetPath);
      }
      if (blockUuid) {
        await logseq.Editor.updateBlock(blockUuid, "");
      }
      await logseq.UI.showMsg("Excalidraw 已删除。", "success");
    },
    async previewExcalidrawDrawing(event: { dataset?: { blockUuid?: string; assetPath?: string } }) {
      const blockUuid = event.dataset?.blockUuid;
      if (!blockUuid) {
        return;
      }

      const block = await logseq.Editor.getBlock(blockUuid);
      const resolved = block?.content ? await resolveBlockSource(block.content) : null;
      if (!resolved) {
        await logseq.UI.showMsg("无法读取 Excalidraw 预览。", "warning");
        return;
      }
      const imageUrl = await renderSourceToDataUrl(resolved.source);
      window.openExcalidrawPreview?.(imageUrl);
    },
  });

  logseq.Editor.registerSlashCommand("Excalidraw 绘图", async () => {
    const currentBlock = await logseq.Editor.getCurrentBlock();
    if (!currentBlock?.uuid) {
      await logseq.UI.showMsg("请先把光标放在要插入绘图的块里。", "warning");
      return;
    }

    await logseq.Editor.updateBlock(currentBlock.uuid, createSourceBlock(EMPTY_EXCALIDRAW_SOURCE));
    registerRenderer(currentBlock.uuid);
    window.openExcalidrawEditor?.(currentBlock.uuid);
  });

  logseq.Editor.registerSlashCommand("Excalidraw 文件绘图", async () => {
    const currentBlock = await logseq.Editor.getCurrentBlock();
    if (!currentBlock?.uuid) {
      await logseq.UI.showMsg("请先把光标放在要插入绘图的块里。", "warning");
      return;
    }

    const fileName = `draw-${new Date().toISOString().replace(/[:.]/g, "-")}.excalidraw`;
    const assetPath = `excalidraw/${fileName}`;
    const source = {
      ...EMPTY_EXCALIDRAW_SOURCE,
      source: `file://${assetPath}`,
    };

    await assetsStorage.setItem(assetPath, JSON.stringify(source, null, 2));
    await logseq.Editor.updateBlock(currentBlock.uuid, createAssetLinkBlock(assetPath));
    registerRenderer(currentBlock.uuid);
    window.openExcalidrawAssetEditor?.(assetPath, currentBlock.uuid);
  });
}

function installStyles() {
  logseq.provideStyle(`
    .logseq-excalidraw-renderer {
      position: relative;
      display: block;
      width: 100%;
      max-width: 960px;
      margin: 8px 0;
      cursor: pointer;
      border: 1px solid var(--ls-border-color, #d1d5db);
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
    }

    .logseq-excalidraw-actions {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 1;
      display: flex;
      gap: 6px;
    }

    .logseq-excalidraw-actions button {
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid var(--ls-border-color, #cbd5e1);
      border-radius: 8px;
      color: var(--ls-primary-text-color, #111827);
      background: rgba(255, 255, 255, 0.92);
      cursor: pointer;
    }

    .logseq-excalidraw-preview-button {
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      cursor: zoom-in;
    }

    .logseq-excalidraw-renderer img {
      display: block;
      width: 100%;
      height: auto;
    }

    .logseq-excalidraw-error {
      padding: 16px;
      color: var(--ls-secondary-text-color, #64748b);
      cursor: default;
    }
  `);
}

logseq.ready(() => {
  installStyles();
  installCommands();
  installRenderer();
});
