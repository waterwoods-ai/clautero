/* eslint-disable no-undef */
/* global ChromeUtils, Services */

var chromeHandle;

function install(_data, _reason) {}

async function startup({ id, version, resourceURI, rootURI }, _reason) {
  await Zotero.initializationPromise;

  if (typeof rootURI === "undefined") {
    rootURI = resourceURI.spec;
  }

  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);

  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "clautero", rootURI + "content/"],
  ]);

  // Set rootURI on Zotero global so the bundled IIFE can access it
  Zotero.__clauteroRootURI = rootURI;

  Services.scriptloader.loadSubScript(
    rootURI + "content/clautero.js"
  );

  Zotero.Clautero.hooks.onStartup();

  // If the main window is already open (e.g., plugin installed/enabled at runtime),
  // onMainWindowLoad won't fire automatically. Trigger it manually.
  var windows = Zotero.getMainWindows();
  if (windows && windows.length > 0) {
    for (var win of windows) {
      if (win && !win.closed) {
        onMainWindowLoad({ window: win });
      }
    }
  }
}

function onMainWindowLoad({ window }) {
  if (!Zotero.Clautero) {
    return;
  }
  Zotero.Clautero.hooks.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  Zotero.Clautero.hooks.onMainWindowUnload(window);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  if (typeof Zotero !== "undefined" && Zotero.Clautero) {
    Zotero.Clautero.hooks.onShutdown();
  }
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(_data, _reason) {}
