/* eslint-disable no-undef */
/* global ChromeUtils, Services, Zotero, Components, APP_SHUTDOWN */

var chromeHandle;

function install(_data, _reason) {}

async function startup({ id, version, resourceURI, rootURI }, _reason) {
  try {
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
      ["locale", "clautero", "en-US", rootURI + "locale/en-US/"],
    ]);

    // Fluent FTL files in locale/ are auto-registered by Zotero via chrome manifest.

    // Set rootURI on Zotero global so the bundled IIFE can access it
    Zotero.__clauteroRootURI = rootURI;

    Services.scriptloader.loadSubScript(
      rootURI + "content/clautero.js"
    );

    // Register preference pane (Zotero 8 guide format)
    try {
      Zotero.PreferencePanes.register({
        pluginID: "clautero@zotero-plugin",
        src: rootURI + "content/preferences.xhtml",
      });
      Zotero.log("[Clautero] Preference pane registered", "info");
    } catch (e) {
      Zotero.logError("[Clautero] Failed to register preference pane: " + e);
    }

    await Zotero.Clautero.hooks.onStartup();

    // If main windows are already open (runtime install/enable), trigger manually
    if (typeof Zotero.getMainWindows === "function") {
      var windows = Zotero.getMainWindows();
      for (var i = 0; i < windows.length; i++) {
        var win = windows[i];
        if (win && !win.closed) {
          try {
            onMainWindowLoad({ window: win });
          } catch (e) {
            Zotero.logError("[Clautero] Error in manual window load: " + e);
          }
        }
      }
    }
  } catch (e) {
    if (typeof Zotero !== "undefined") {
      Zotero.logError("[Clautero] Startup error: " + e);
    }
  }
}

function onMainWindowLoad({ window }) {
  try {
    // Load Fluent localization file into this window
    window.MozXULElement.insertFTLIfNeeded("addon.ftl");

    if (Zotero && Zotero.Clautero && Zotero.Clautero.hooks) {
      Zotero.Clautero.hooks.onMainWindowLoad(window);
    }
  } catch (e) {
    Zotero.logError("[Clautero] onMainWindowLoad error: " + e);
  }
}

function onMainWindowUnload({ window }) {
  try {
    if (Zotero && Zotero.Clautero && Zotero.Clautero.hooks) {
      Zotero.Clautero.hooks.onMainWindowUnload(window);
    }
  } catch (e) {
    Zotero.logError("[Clautero] onMainWindowUnload error: " + e);
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  try {
    if (typeof Zotero !== "undefined" && Zotero.Clautero) {
      Zotero.Clautero.hooks.onShutdown();
    }
  } catch (e) {
    // ignore shutdown errors
  }
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(_data, _reason) {}
