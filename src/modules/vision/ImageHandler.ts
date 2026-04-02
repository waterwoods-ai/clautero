/**
 * ImageHandler — Manages image input from drag-and-drop, clipboard paste,
 * and file path references.
 *
 * Validates images (type, size), saves them to the workspace directory,
 * and invokes the onImage callback with the saved file path.
 */

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface ImageHandlerOptions {
  readonly inputArea: HTMLElement;
  readonly workspaceDir: string;
  readonly onImage: (path: string) => void;
  readonly doc: Document;
}

function isAllowedType(mimeType: string): boolean {
  return ALLOWED_TYPES.has(mimeType);
}

function generateFilename(original: string): string {
  const timestamp = Date.now();
  const safe = original.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${timestamp}-${safe}`;
}

async function ensureImagesDir(workspaceDir: string): Promise<string> {
  const imagesDir = PathUtils.join(workspaceDir, "images");
  await IOUtils.makeDirectory(imagesDir, { ignoreExisting: true });
  return imagesDir;
}

async function saveArrayBufferToWorkspace(
  data: ArrayBuffer,
  filename: string,
  workspaceDir: string
): Promise<string> {
  const imagesDir = await ensureImagesDir(workspaceDir);
  const destPath = PathUtils.join(imagesDir, generateFilename(filename));
  const uint8 = new Uint8Array(data);
  await IOUtils.write(destPath, uint8);
  return destPath;
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

async function copyFileToWorkspace(
  sourcePath: string,
  workspaceDir: string
): Promise<string> {
  const imagesDir = await ensureImagesDir(workspaceDir);
  const basename = sourcePath.split("/").pop() || sourcePath.split("\\").pop() || "image";
  const destPath = PathUtils.join(imagesDir, generateFilename(basename));
  await IOUtils.copy(sourcePath, destPath);
  return destPath;
}

function validateFile(file: File): string | null {
  if (!isAllowedType(file.type)) {
    return `Unsupported image type: ${file.type}`;
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `Image too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`;
  }
  return null;
}

async function processFile(
  file: File,
  workspaceDir: string
): Promise<string> {
  const error = validateFile(file);
  if (error) {
    throw new Error(error);
  }
  const buffer = await readFileAsArrayBuffer(file);
  const name = file.name || "pasted-image.png";
  return saveArrayBufferToWorkspace(buffer, name, workspaceDir);
}

function handleDragover(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function createDropHandler(
  workspaceDir: string,
  onImage: (path: string) => void
): (event: DragEvent) => void {
  return async (event: DragEvent) => {
    const dt = event.dataTransfer;
    if (!dt || dt.files.length === 0) {
      return;
    }
    event.preventDefault();
    for (const file of Array.from(dt.files)) {
      if (!isAllowedType(file.type)) {
        continue;
      }
      try {
        const mozPath = (file as unknown as { mozFullPath?: string }).mozFullPath;
        const savedPath = mozPath
          ? await copyFileToWorkspace(mozPath, workspaceDir)
          : await processFile(file, workspaceDir);
        onImage(savedPath);
      } catch (err) {
        Zotero.log(`[Clautero] Image drop failed: ${err}`, "warning");
      }
    }
  };
}

function createPasteHandler(
  workspaceDir: string,
  onImage: (path: string) => void
): (event: ClipboardEvent) => void {
  return async (event: ClipboardEvent) => {
    const cd = event.clipboardData;
    if (!cd) {
      return;
    }
    const imageFiles = extractImageFiles(cd);
    if (imageFiles.length === 0) {
      return;
    }
    for (const file of imageFiles) {
      try {
        const savedPath = await processFile(file, workspaceDir);
        onImage(savedPath);
      } catch (err) {
        Zotero.log(`[Clautero] Image paste failed: ${err}`, "warning");
      }
    }
  };
}

function extractImageFiles(cd: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(cd.items)) {
    if (item.kind === "file" && isAllowedType(item.type)) {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  return files;
}

export async function handleFilePath(
  filePath: string,
  workspaceDir: string
): Promise<string> {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const typeMap: Readonly<Record<string, string>> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  const mimeType = typeMap[ext];
  if (!mimeType) {
    throw new Error(`Unsupported image extension: .${ext}`);
  }
  const info = await IOUtils.stat(filePath);
  if (info.size > MAX_SIZE_BYTES) {
    throw new Error(`Image too large: ${(info.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
  }
  return copyFileToWorkspace(filePath, workspaceDir);
}

export function createImageHandler(options: ImageHandlerOptions): {
  cleanup(): void;
} {
  const { inputArea, workspaceDir, onImage, doc } = options;

  const textarea = inputArea.querySelector("textarea");
  const dropTarget = inputArea;

  const handleDrop = createDropHandler(workspaceDir, onImage);
  const handlePaste = createPasteHandler(workspaceDir, onImage);

  dropTarget.addEventListener("dragover", handleDragover);
  dropTarget.addEventListener("drop", handleDrop);
  if (textarea) {
    textarea.addEventListener("paste", handlePaste);
  }

  function cleanup(): void {
    dropTarget.removeEventListener("dragover", handleDragover);
    dropTarget.removeEventListener("drop", handleDrop);
    if (textarea) {
      textarea.removeEventListener("paste", handlePaste);
    }
  }

  return { cleanup };
}
