import { Addon } from "./addon";
import { createHooks } from "./hooks";

// rootURI is set by bootstrap.js on the Zotero global before loading this script.
// loadSubScript scope properties are NOT accessible inside esbuild's IIFE closure.
const rootURI = (Zotero as any).__clauteroRootURI as string;

if (!rootURI) {
  Zotero.log("[Clautero] FATAL: rootURI not set by bootstrap.js", "error");
}

const addon = new Addon(rootURI || "");
const hooks = createHooks(addon);

// Inject into Zotero global namespace for bootstrap.js access
(Zotero as any).Clautero = {
  addon,
  hooks,
};
