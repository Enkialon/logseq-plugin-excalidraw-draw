import "@logseq/libs";
import "@excalidraw/excalidraw/index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createSourceBlock, EMPTY_EXCALIDRAW_SOURCE, parseSourceBlock } from "./excalidraw-source";
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

function registerRenderer(blockUuid: string) {
  if (registeredRenderers.has(blockUuid)) {
    return;
  }

  registeredRenderers.add(blockUuid);
  logseq.App.onBlockRendererSlotted(blockUuid, async (event: RendererBlock) => {
    const source = parseSourceBlock(event.content ?? "");
    if (!source) {
      return;
    }

    const imageUrl = await renderSourceToDataUrl(source);
    const safeImageUrl = escapeAttribute(imageUrl);
    const safeUuid = escapeAttribute(event.uuid ?? blockUuid);

    logseq.provideUI({
      key: `excalidraw-renderer-${blockUuid}`,
      slot: event.slot,
      reset: true,
      template: `
        <div class="logseq-excalidraw-renderer" data-on-click="openExcalidrawEditor" data-block-uuid="${safeUuid}" title="点击编辑 Excalidraw">
          <img src="${safeImageUrl}" alt="Excalidraw drawing" />
        </div>
      `,
    });
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
    if (block && parseSourceBlock(block.content)) {
      registerRenderer(block.uuid);
    }
  }
}

function installRenderer() {
  registerExistingRenderers();
  logseq.DB.onChanged(({ blocks }) => {
    for (const block of blocks ?? []) {
      if (block.uuid && block.content && parseSourceBlock(block.content)) {
        registerRenderer(block.uuid);
      }
    }
  });
}

function installCommands() {
  logseq.provideModel({
    openExcalidrawEditor(event: { dataset?: { blockUuid?: string } }) {
      const blockUuid = event.dataset?.blockUuid;
      if (blockUuid) {
        window.openExcalidrawEditor?.(blockUuid);
      }
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
}

function installStyles() {
  logseq.provideStyle(`
    .logseq-excalidraw-renderer {
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

    .logseq-excalidraw-renderer img {
      display: block;
      width: 100%;
      height: auto;
    }
  `);
}

logseq.ready(() => {
  installStyles();
  installCommands();
  installRenderer();
});
