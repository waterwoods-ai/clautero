// Gecko/XPCOM type declarations for Zotero plugin development
// These supplement zotero-types with Gecko-specific APIs

declare namespace IOUtils {
  function readJSON(path: string): Promise<any>;
  function writeJSON(path: string, data: any): Promise<void>;
  function readUTF8(path: string): Promise<string>;
  function writeUTF8(path: string, data: string): Promise<void>;
  function makeDirectory(
    path: string,
    options?: { ignoreExisting?: boolean }
  ): Promise<void>;
  function exists(path: string): Promise<boolean>;
  function remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  function stat(path: string): Promise<{ size: number; lastModified: number }>;
}

declare namespace PathUtils {
  function join(...parts: string[]): string;
  function filename(path: string): string;
  function parent(path: string): string | null;
  const profileDir: string;
  const tempDir: string;
}

declare namespace Services {
  const io: {
    newURI(spec: string): any;
  };
  const scriptloader: {
    loadSubScript(url: string, scope?: object): void;
  };
}

declare namespace ChromeUtils {
  function importESModule(module: string): any;
  function defineESModuleGetters(target: object, modules: Record<string, string>): void;
}

// Subprocess.jsm types
declare interface SubprocessOptions {
  command: string;
  arguments?: string[];
  environment?: Record<string, string>;
  workdir?: string;
  stderr?: "pipe" | "stdout";
  discardStderr?: boolean;
}

declare interface SubprocessInstance {
  stdin: {
    write(data: string): Promise<void>;
    close(): Promise<void>;
  };
  stdout: {
    readString(): Promise<string>;
    readUint8Array(): Promise<Uint8Array>;
  };
  stderr?: {
    readString(): Promise<string>;
  };
  kill(timeout?: number): void;
  wait(): Promise<{ exitCode: number }>;
}

declare namespace Subprocess {
  function call(options: SubprocessOptions): Promise<SubprocessInstance>;
  function pathSearch(name: string): Promise<string | null>;
}

// APP_SHUTDOWN constant used in bootstrap.js
declare const APP_SHUTDOWN: number;
