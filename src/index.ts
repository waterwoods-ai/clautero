import { Addon } from "./addon";
import { createHooks } from "./hooks";

declare const rootURI: string;

const addon = new Addon(rootURI);
const hooks = createHooks(addon);

// Inject into Zotero global namespace for bootstrap.js access
(Zotero as any).Clautero = {
  addon,
  hooks,
};
