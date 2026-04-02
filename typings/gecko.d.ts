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
  function remove(path: string, options?: { recursive?: boolean; ignoreAbsent?: boolean }): Promise<void>;
  function stat(path: string): Promise<{ size: number; lastModified: number }>;
  function write(path: string, data: Uint8Array): Promise<void>;
  function copy(source: string, dest: string): Promise<void>;
  function getChildren(path: string): Promise<string[]>;
}

declare namespace PathUtils {
  function join(...parts: string[]): string;
  function filename(path: string): string;
  function parent(path: string): string | null;
  const profileDir: string;
  const tempDir: string;
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

// Components (XPCOM)
declare namespace Components {
  const classes: Record<string, any>;
  const interfaces: Record<string, any>;
  const utils: {
    import(module: string): any;
  };
}

// Zotero global namespace (runtime-injected, not importable)
declare namespace Zotero {
  function log(message: string, type?: string): void;

  const isMac: boolean;
  const DataDirectory: { dir: string };
  const Libraries: { userLibraryID: number };

  namespace Prefs {
    function get(pref: string, global?: boolean): string | number | boolean;
    function set(pref: string, value: string | number | boolean, global?: boolean): void;
  }

  namespace Notifier {
    function registerObserver(
      observer: { notify: (event: string, type: string, ids: number[], extraData: any) => void },
      types: string[],
      id: string
    ): string;
    function unregisterObserver(id: string): void;
  }

  interface Item {
    id: number;
    itemType: string;
    getField(field: string): string;
    getCreators(): Array<{ firstName: string; lastName: string; creatorType: string }>;
    getAttachments(): number[];
    getAnnotations?(): any[];
    getTags(): Array<{ tag: string }>;
    attachmentContentType?: string;
    getFilePath(): string | false;
    isRegularItem(): boolean;
    isAttachment(): boolean;
    isNote(): boolean;
  }

  interface Collection {
    id: number;
    name: string;
    getChildItems(): Item[];
  }

  namespace Items {
    function get(id: number): Item;
    function get(ids: number[]): Item[];
  }

  namespace Collections {
    function getByLibrary(libraryID: number): Collection[];
  }

  namespace Annotations {
    function getByParent(attachmentId: number): any[];
  }

  class Search {
    addCondition(condition: string, operator: string, value: string): void;
    search(): Promise<number[]>;
  }

  function getActiveZoteroPane(): {
    getSelectedItems(): any[];
  };

}

// Navigator global
declare const navigator: { platform: string };

// Services.prompt for tool approval dialogs
declare namespace Services {
  const io: {
    newURI(spec: string): any;
  };
  const scriptloader: {
    loadSubScript(url: string, scope?: object): void;
  };
  const prompt: {
    confirm(parent: any, title: string, message: string): boolean;
  };
}
