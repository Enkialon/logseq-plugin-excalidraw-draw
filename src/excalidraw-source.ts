export type ExcalidrawSource = {
  type: "excalidraw";
  version: number;
  source: string;
  elements: readonly Record<string, unknown>[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

export const FENCE_LANGUAGE = "excalidraw";

export type RenderSize = {
  height?: number;
  width?: number;
};

const SIZE_ATTR_PATTERN = /\s*\{:[^}]*\}\s*$/;
const GENERATED_PREVIEW_DATA_URL_PATTERN = /^\s*data:image\/svg\+xml;charset=utf-8,/m;

export const EMPTY_EXCALIDRAW_SOURCE: ExcalidrawSource = {
  type: "excalidraw",
  version: 2,
  source: "logseq-plugin-excalidraw",
  elements: [],
  appState: {
    viewBackgroundColor: "#ffffff",
  },
  files: {},
};

export function createSourceBlock(source: ExcalidrawSource = EMPTY_EXCALIDRAW_SOURCE) {
  return `\`\`\`${FENCE_LANGUAGE}\n${JSON.stringify(source, null, 2)}\n\`\`\``;
}

export function createAssetLinkBlock(assetPath: string) {
  const pathParts = assetPath.split("/");
  const fileName = pathParts[pathParts.length - 1] || "draw.excalidraw";
  return `[${fileName}](../assets/${assetPath})`;
}

export function parseSourceBlock(content: string): ExcalidrawSource | null {
  const trimmed = stripRenderSizeAttrs(stripGeneratedPreviewDataUrl(content)).trim();
  const fenced = trimmed.match(/^```(?:excalidraw|excalidraw-json)\s*\n([\s\S]*?)\n```$/);
  const raw = fenced?.[1] ?? trimmed;

  try {
    const parsed = JSON.parse(raw) as Partial<ExcalidrawSource>;
    if (parsed.type !== "excalidraw" || !Array.isArray(parsed.elements)) {
      return null;
    }

    return {
      type: "excalidraw",
      version: typeof parsed.version === "number" ? parsed.version : 2,
      source: typeof parsed.source === "string" ? parsed.source : "logseq-plugin-excalidraw",
      elements: parsed.elements,
      appState: parsed.appState ?? {},
      files: parsed.files ?? {},
    };
  } catch {
    return null;
  }
}

export type ExcalidrawAssetLink = {
  label: string;
  href: string;
  assetPath: string;
};

export function parseExcalidrawAssetLink(content: string): ExcalidrawAssetLink | null {
  const match = stripRenderSizeAttrs(stripGeneratedPreviewDataUrl(content))
    .trim()
    .match(/^\[([^\]]+\.excalidraw)\]\(([^)]+\.excalidraw)\)$/i);
  if (!match) {
    return null;
  }

  const [, label, href] = match;
  const assetPath = normalizeAssetPath(href);
  if (!assetPath) {
    return null;
  }

  return { label, href, assetPath };
}

export function normalizeAssetPath(href: string) {
  const decoded = decodeURIComponent(href.trim());
  const normalized = decoded.replace(/\\/g, "/").replace(/^file:\/\//, "");
  const assetsIndex = normalized.lastIndexOf("/assets/");

  if (assetsIndex >= 0) {
    return normalized.slice(assetsIndex + "/assets/".length);
  }

  const relativeAssetPath = normalized
    .replace(/^\.?\/*assets\//, "")
    .replace(/^(\.\.\/)+assets\//, "")
    .replace(/^\/+/, "");

  return relativeAssetPath;
}

export function parseRenderSizeAttrs(content: string): RenderSize {
  const match = content.match(SIZE_ATTR_PATTERN);
  if (!match) {
    return {};
  }

  const size: RenderSize = {};
  for (const [, key, rawValue] of match[0].matchAll(/:(height|width)\s+(\d+)/g)) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > 0) {
      size[key as keyof RenderSize] = value;
    }
  }

  return size;
}

export function stripRenderSizeAttrs(content: string) {
  const match = content.match(SIZE_ATTR_PATTERN);
  if (!match || !/:(?:height|width)\s+\d+/.test(match[0])) {
    return content;
  }

  return content.slice(0, match.index).trimEnd();
}

export function appendRenderSizeAttrs(content: string, size: Required<RenderSize>) {
  const base = stripRenderSizeAttrs(stripGeneratedPreviewDataUrl(content)).trimEnd();
  return `${base}{:height ${size.height}, :width ${size.width}}`;
}

export function stripGeneratedPreviewDataUrl(content: string) {
  const match = content.match(GENERATED_PREVIEW_DATA_URL_PATTERN);
  if (!match || typeof match.index !== "number") {
    return content;
  }

  return content.slice(0, match.index).trimEnd();
}
