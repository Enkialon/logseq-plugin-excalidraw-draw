import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSourceBlock, EMPTY_EXCALIDRAW_SOURCE, parseSourceBlock, type ExcalidrawSource } from "./excalidraw-source";

type EditorState =
  | { status: "idle" }
  | { status: "loading"; title: string }
  | { status: "preview"; imageUrl: string }
  | { status: "ready"; target: EditorTarget; source: ExcalidrawSource }
  | { status: "error"; message: string };

type EditorTarget =
  | { kind: "block"; blockUuid: string }
  | { kind: "asset"; assetPath: string; blockUuid?: string };

declare global {
  interface Window {
    openExcalidrawEditor?: (blockUuid: string) => void;
    openExcalidrawAssetEditor?: (assetPath: string, blockUuid?: string) => void;
    openExcalidrawPreview?: (imageUrl: string) => void;
    refreshExcalidrawRenderer?: (blockUuid: string) => void;
  }
}

export function App() {
  const [state, setState] = useState<EditorState>({ status: "idle" });
  const [previewScale, setPreviewScale] = useState(1);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const assetsStorage = useMemo(() => logseq.Assets.makeSandboxStorage(), []);

  const openMainUI = useCallback(async (title: string) => {
    await logseq.setMainUIAttrs({ title });
    logseq.setMainUIInlineStyle({
      zIndex: 11,
      position: "fixed",
      inset: "24px",
      width: "calc(100vw - 48px)",
      height: "calc(100vh - 48px)",
      borderRadius: "8px",
      boxShadow: "0 20px 55px rgba(15, 23, 42, 0.35)",
      background: "var(--ls-primary-background-color)",
    });
    logseq.showMainUI();
  }, []);

  useEffect(() => {
    window.openExcalidrawEditor = async (blockUuid: string) => {
      setState({ status: "loading", title: "正在打开块内绘图..." });
      await openMainUI("编辑 Excalidraw");

      const block = await logseq.Editor.getBlock(blockUuid);
      const source = block?.content ? parseSourceBlock(block.content) : null;
      if (!source) {
        setState({ status: "error", message: "这个块不是有效的 Excalidraw 源格式。" });
        return;
      }
      setState({ status: "ready", target: { kind: "block", blockUuid }, source });
    };

    window.openExcalidrawAssetEditor = async (assetPath: string, blockUuid?: string) => {
      setState({ status: "loading", title: "正在打开文件绘图..." });
      await openMainUI("编辑 Excalidraw");

      const content = await readAssetFile(assetPath);
      const source = typeof content === "string" ? parseSourceBlock(content) : null;
      if (!source) {
        setState({ status: "error", message: "这个文件不是有效的 Excalidraw 源格式。" });
        return;
      }
      setState({ status: "ready", target: { kind: "asset", assetPath, blockUuid }, source });
    };

    window.openExcalidrawPreview = async (imageUrl: string) => {
      setPreviewScale(1);
      setState({ status: "preview", imageUrl });
      await openMainUI("查看 Excalidraw");
    };

    return () => {
      delete window.openExcalidrawEditor;
      delete window.openExcalidrawAssetEditor;
      delete window.openExcalidrawPreview;
    };
  }, [assetsStorage, openMainUI]);

  const readAssetFile = useCallback(
    async (assetPath: string) => {
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
    },
    [assetsStorage],
  );

  const initialData = useMemo(() => {
    if (state.status !== "ready") {
      return undefined;
    }

    return {
      elements: state.source.elements,
      appState: {
        viewBackgroundColor: "#ffffff",
        ...(state.source.appState ?? {}),
      },
      files: state.source.files ?? {},
    };
  }, [state]);

  const close = useCallback(() => {
    logseq.hideMainUI();
    setState({ status: "idle" });
    setPreviewScale(1);
  }, []);

  const zoomPreview = useCallback((event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setPreviewScale((scale) => Math.min(4, Math.max(0.5, scale + direction * 0.15)));
  }, []);

  const save = useCallback(async () => {
    if (state.status !== "ready") {
      return;
    }

    const api = excalidrawApiRef.current;
    if (!api) {
      await logseq.UI.showMsg("编辑器还没有准备好。", "warning");
      return;
    }

    const serialized = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
    const source = JSON.parse(serialized) as ExcalidrawSource;

    if (state.target.kind === "block") {
      await logseq.Editor.updateBlock(state.target.blockUuid, createSourceBlock(source));
    } else {
      await assetsStorage.setItem(state.target.assetPath, JSON.stringify(source, null, 2));
      if (state.target.blockUuid) {
        window.refreshExcalidrawRenderer?.(state.target.blockUuid);
      }
    }

    await logseq.UI.showMsg("Excalidraw 已保存。", "success");
    close();
  }, [assetsStorage, close, state]);

  const createEmptyDrawing = useCallback(async () => {
    const currentBlock = await logseq.Editor.getCurrentBlock();
    if (!currentBlock?.uuid) {
      await logseq.UI.showMsg("请先把光标放在要插入绘图的块里。", "warning");
      return;
    }

    await logseq.Editor.updateBlock(currentBlock.uuid, createSourceBlock(EMPTY_EXCALIDRAW_SOURCE));
    window.openExcalidrawEditor?.(currentBlock.uuid);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

  if (state.status === "idle") {
    return (
      <div className="empty-panel">
        <button type="button" className="primary-button" onClick={createEmptyDrawing}>
          New Excalidraw
        </button>
      </div>
    );
  }

  if (state.status === "loading") {
    return <div className="status-panel">{state.title}</div>;
  }

  if (state.status === "error") {
    return (
      <div className="status-panel">
        <p>{state.message}</p>
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    );
  }

  if (state.status === "preview") {
    return (
      <main className="preview-window">
        <header className="editor-toolbar">
          <strong>Excalidraw</strong>
          <span>Preview: scroll to zoom</span>
          <button type="button" onClick={close}>
            Close
          </button>
        </header>
        <section className="preview-canvas" onWheel={zoomPreview}>
          <div className="preview-stage" onClick={(event) => event.stopPropagation()}>
            <img
              src={state.imageUrl}
              alt="Excalidraw preview"
              style={{
                maxWidth: previewScale === 1 ? "100%" : "none",
                width: `${previewScale * 100}%`,
              }}
            />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="editor-window">
      <header className="editor-toolbar">
        <strong>Excalidraw</strong>
        <span>{state.target.kind === "asset" ? `源文件：${state.target.assetPath}` : "源内容仍保存在当前 Logseq 块中。"}</span>
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="primary-button" onClick={save}>
          Save
        </button>
      </header>
      <section className="editor-canvas">
        <Excalidraw
          excalidrawAPI={(api) => {
            excalidrawApiRef.current = api;
          }}
          initialData={initialData as never}
        />
      </section>
    </main>
  );
}
