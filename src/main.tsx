import "@logseq/libs";
import "@excalidraw/excalidraw/index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import {
  createAssetLinkBlock,
  createSourceBlock,
  EMPTY_EXCALIDRAW_SOURCE,
  appendRenderSizeAttrs,
  parseExcalidrawAssetLink,
  parseRenderSizeAttrs,
  parseSourceBlock,
  stripGeneratedPreviewDataUrl,
  stripRenderSizeAttrs,
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
const observedRendererSizes = new Map<string, { height: number; width: number }>();
const rendererSizeSaveTimers = new Map<string, number>();
const lastRenderedContentKeys = new Map<string, string>();
const assetsStorage = logseq.Assets.makeSandboxStorage();

function createRendererElementId(blockUuid: string) {
  return `logseq-excalidraw-renderer-${blockUuid.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function iconSvg(name: "edit" | "delete" | "source") {
  if (name === "edit") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5Z" />
      </svg>
    `;
  }

  if (name === "delete") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="m19 6-1 14H6L5 6" />
        <path d="M10 11v5" />
        <path d="M14 11v5" />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  `;
}

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

async function renderBlock(blockUuid: string, event: RendererBlock, options: { force?: boolean } = {}) {
  const content = event.content ?? "";
  const contentKey = stripRenderSizeAttrs(stripGeneratedPreviewDataUrl(content)).trim();
  if (!options.force && lastRenderedContentKeys.get(blockUuid) === contentKey && observedRendererSizes.has(blockUuid)) {
    return;
  }

  const resolved = await resolveBlockSource(content);
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
  const renderSize = observedRendererSizes.get(blockUuid) ?? parseRenderSizeAttrs(content);
  const safeImageUrl = escapeAttribute(imageUrl);
  const safeUuid = escapeAttribute(event.uuid ?? blockUuid);
  const safeAssetPath = resolved.assetPath ? escapeAttribute(resolved.assetPath) : "";
  const safeRendererId = escapeAttribute(createRendererElementId(event.uuid ?? blockUuid));
  const sizeClass = renderSize.width || renderSize.height ? " logseq-excalidraw-renderer-sized" : "";
  const sizeStyle = [
    renderSize.width ? `width: ${renderSize.width}px` : "",
    renderSize.height ? `height: ${renderSize.height}px` : "",
  ]
    .filter(Boolean)
    .join("; ");

  logseq.provideUI({
    key: `excalidraw-renderer-${blockUuid}`,
    slot: event.slot,
    reset: true,
    template: `
      <div
        id="${safeRendererId}"
        class="logseq-excalidraw-renderer${sizeClass}"
        data-block-uuid="${safeUuid}"
        data-asset-path="${safeAssetPath}"
        data-renderer-id="${safeRendererId}"
        style="${sizeStyle}"
      >
        <div class="logseq-excalidraw-actions">
          <button class="logseq-excalidraw-icon-button" data-on-click="editExcalidrawDrawing" data-block-uuid="${safeUuid}" data-asset-path="${safeAssetPath}" title="Edit" aria-label="Edit drawing">${iconSvg("edit")}</button>
          <button class="logseq-excalidraw-icon-button" data-on-click="showExcalidrawDrawingSource" data-block-uuid="${safeUuid}" data-renderer-id="${safeRendererId}" title="Source" aria-label="Edit source link">${iconSvg("source")}</button>
          <button class="logseq-excalidraw-icon-button" data-on-click="deleteExcalidrawDrawing" data-block-uuid="${safeUuid}" data-asset-path="${safeAssetPath}" title="Delete" aria-label="Delete drawing">${iconSvg("delete")}</button>
        </div>
        <button class="logseq-excalidraw-preview-button" data-on-click="previewExcalidrawDrawing" data-block-uuid="${safeUuid}" data-asset-path="${safeAssetPath}" title="Preview">
          <img src="${safeImageUrl}" alt="Excalidraw drawing" />
        </button>
      </div>
    `,
  });
  lastRenderedContentKeys.set(blockUuid, contentKey);
}

async function refreshRenderer(blockUuid: string) {
  const event = rendererSlots.get(blockUuid);
  const block = await logseq.Editor.getBlock(blockUuid);
  if (!event || !block?.content) {
    return;
  }

  await renderBlock(
    blockUuid,
    {
      ...event,
      uuid: blockUuid,
      content: block.content,
    },
    { force: true },
  );
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
  window.setInterval(() => {
    void saveChangedRendererSizes();
  }, 700);
  logseq.DB.onChanged(({ blocks }) => {
    for (const block of blocks ?? []) {
      if (block.uuid && block.content && isRenderableBlockContent(block.content)) {
        registerRenderer(block.uuid);
      }
    }
  });
}

async function saveChangedRendererSizes() {
  for (const [blockUuid] of rendererSlots) {
    const rendererId = createRendererElementId(blockUuid);
    const rect = await logseq.UI.queryElementRect(`#${rendererId}`);
    if (!rect?.width || !rect?.height) {
      observedRendererSizes.delete(blockUuid);
      clearPendingSizeSave(blockUuid);
      continue;
    }

    const width = Math.max(80, Math.round(rect.width));
    const height = Math.max(40, Math.round(rect.height));
    const previousSize = observedRendererSizes.get(blockUuid);
    if (!previousSize) {
      observedRendererSizes.set(blockUuid, { height, width });
      continue;
    }

    const sizeChanged = Math.abs(previousSize.width - width) > 2 || Math.abs(previousSize.height - height) > 2;
    if (!sizeChanged) {
      continue;
    }

    observedRendererSizes.set(blockUuid, { height, width });
    scheduleRendererSizeSave(blockUuid, rendererId);
  }
}

function scheduleRendererSizeSave(blockUuid: string, rendererId: string) {
  clearPendingSizeSave(blockUuid);
  const timer = window.setTimeout(() => {
    rendererSizeSaveTimers.delete(blockUuid);
    void saveExcalidrawDrawingSize(blockUuid, rendererId);
  }, 1600);
  rendererSizeSaveTimers.set(blockUuid, timer);
}

function clearPendingSizeSave(blockUuid: string) {
  const timer = rendererSizeSaveTimers.get(blockUuid);
  if (!timer) {
    return;
  }

  window.clearTimeout(timer);
  rendererSizeSaveTimers.delete(blockUuid);
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
        await logseq.Editor.removeBlock(blockUuid);
      }
      await logseq.UI.showMsg("Excalidraw deleted.", "success");
    },
    async showExcalidrawDrawingSource(event: { dataset?: { blockUuid?: string } }) {
      const blockUuid = event.dataset?.blockUuid;
      if (!blockUuid) {
        return;
      }

      const block = await logseq.Editor.getBlock(blockUuid);
      if (block?.content) {
        const cleanContent = stripGeneratedPreviewDataUrl(block.content);
        if (cleanContent !== block.content) {
          await logseq.Editor.updateBlock(blockUuid, cleanContent);
        }
      }

      logseq.provideUI({
        key: `excalidraw-renderer-${blockUuid}`,
        reset: true,
        template: "",
      });
      await logseq.Editor.editBlock(blockUuid);
    },
    async previewExcalidrawDrawing(event: { dataset?: { blockUuid?: string; assetPath?: string } }) {
      const blockUuid = event.dataset?.blockUuid;
      if (!blockUuid) {
        return;
      }

      const block = await logseq.Editor.getBlock(blockUuid);
      const resolved = block?.content ? await resolveBlockSource(block.content) : null;
      if (!resolved) {
        await logseq.UI.showMsg("Cannot read Excalidraw preview.", "warning");
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
    window.openExcalidrawEditor?.(currentBlock.uuid, EMPTY_EXCALIDRAW_SOURCE);
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

async function saveExcalidrawDrawingSize(blockUuid: string, rendererId: string) {
  const rect = await logseq.UI.queryElementRect(`#${rendererId}`);
  if (!rect?.width || !rect?.height) {
    return;
  }

  const width = Math.max(80, Math.round(rect.width));
  const height = Math.max(40, Math.round(rect.height));
  observedRendererSizes.set(blockUuid, { height, width });

  const block = await logseq.Editor.getBlock(blockUuid);
  if (!block?.content || !isRenderableBlockContent(block.content)) {
    return;
  }

  const cleanContent = stripGeneratedPreviewDataUrl(block.content);
  if (cleanContent !== block.content) {
    await logseq.Editor.updateBlock(blockUuid, cleanContent);
  }

  const currentSize = parseRenderSizeAttrs(cleanContent);
  if (currentSize.width === width && currentSize.height === height) {
    return;
  }

  await logseq.Editor.updateBlock(blockUuid, appendRenderSizeAttrs(cleanContent, { height, width }));
}

function installStyles() {
  logseq.provideStyle(`
    .logseq-excalidraw-renderer {
      position: relative;
      display: block;
      width: 100%;
      height: auto;
      max-width: 960px;
      margin: 8px 0;
      cursor: pointer;
      border: 1px solid var(--ls-border-color, #d1d5db);
      border-radius: 8px;
      box-sizing: border-box;
      overflow: hidden;
      resize: both;
      background: #ffffff;
      min-width: 120px;
      min-height: 80px;
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
      display: inline-grid;
      width: 30px;
      height: 30px;
      min-height: 30px;
      place-items: center;
      padding: 0;
      border: 1px solid var(--ls-border-color, #cbd5e1);
      border-radius: 8px;
      color: var(--ls-primary-text-color, #111827);
      background: rgba(255, 255, 255, 0.92);
      cursor: pointer;
    }

    .logseq-excalidraw-icon-button svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .logseq-excalidraw-preview-button {
      position: relative;
      display: block;
      width: 100%;
      height: auto;
      box-sizing: border-box;
      min-height: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      color: inherit;
      background: transparent;
      cursor: zoom-in;
    }

    .logseq-excalidraw-preview-button:hover {
      background: transparent;
    }

    .logseq-excalidraw-renderer img {
      display: block;
      width: 100%;
      height: auto;
    }

    .logseq-excalidraw-renderer-sized {
      height: var(--logseq-excalidraw-renderer-height, auto);
    }

    .logseq-excalidraw-renderer-sized .logseq-excalidraw-preview-button {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .logseq-excalidraw-renderer-sized img {
      position: absolute;
      top: 50%;
      left: 50%;
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 100%;
      transform: translate(-50%, -50%);
      object-fit: contain;
      object-position: center;
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
