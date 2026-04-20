import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawSource } from "./excalidraw-source";

export async function renderSourceToDataUrl(source: ExcalidrawSource) {
  const svg = await exportToSvg({
    elements: source.elements as never,
    appState: {
      viewBackgroundColor: "#ffffff",
      exportBackground: true,
      ...(source.appState ?? {}),
    } as never,
    files: (source.files ?? {}) as never,
  });

  const serialized = new XMLSerializer().serializeToString(svg);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}

export function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
