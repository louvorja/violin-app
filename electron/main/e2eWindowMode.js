"use strict";

// Only an isolated Playwright profile may request non-intrusive native windows.
const backgroundWindows =
  !!process.env.LJ_E2E_USER_DATA && process.env.LJ_E2E_BACKGROUND_WINDOWS === "1";

function prepareWindow(win) {
  if (!backgroundWindows || !win || win.isDestroyed()) return;
  // Keep the real BrowserWindow and renderer visible to Electron/media tests,
  // while its pixels and mouse target stay out of the user's desktop workflow.
  try {
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    win.setFocusable(false);
  } catch (error) {
    win.hide();
    throw error;
  }
}

module.exports = { backgroundWindows, prepareWindow };
