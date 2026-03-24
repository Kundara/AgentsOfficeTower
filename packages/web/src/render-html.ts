import { renderClientScript } from "./client-script";
import { CLIENT_STYLES } from "./client-styles";
import { PIXEL_OFFICE_EVENT_ICON_URLS, PIXEL_OFFICE_MANIFEST, PIXEL_OFFICE_THREAD_ITEM_ICON_URLS } from "./pixel-office";
import type { ServerOptions } from "./server-types";

export function renderHtml(options: ServerOptions): string {
  const projectsJson = JSON.stringify(options.projects);
  const pixelOfficeJson = JSON.stringify(PIXEL_OFFICE_MANIFEST);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Codex Agents Office</title>
    <style>${CLIENT_STYLES}</style>
  </head>
  <body>
    <div class="page">
      <section class="hero">
        <div class="hero-top">
          <div class="hero-copy">
            <div class="muted">Codex activity observer</div>
            <div class="hero-title-row">
              <h1>Codex Agents Office</h1>
              <div id="hero-summary" class="hero-summary"></div>
            </div>
            <div id="stamp" class="muted">Loading…</div>
          </div>
          <div class="hero-actions">
            <div class="view-toggle">
              <button id="map-view-button" data-view="map">Map</button>
              <button id="terminal-view-button" data-view="terminal">Terminal</button>
            </div>
            <button id="refresh-button">Refresh</button>
            <button id="preview-toasts-button">Preview Toasts</button>
            <button id="scaffold-button">Scaffold Rooms XML</button>
            <div id="connection-pill" class="status-pill state-connecting">Connecting</div>
          </div>
        </div>
        <div class="tabs-shell">
          <div class="tabs-head">
            <strong>Workspaces</strong>
            <div class="tabs-actions">
              <span class="muted" id="project-count"></span>
            </div>
          </div>
          <div id="project-tabs" class="project-tabs"></div>
        </div>
      </section>

      <section class="layout">
        <main id="workspace-panel" class="panel workspace-panel">
          <div class="panel-header">
            <strong id="center-title">Fleet</strong>
            <div class="panel-actions">
              <button id="workspace-focus-button" class="toggle-button" type="button" hidden aria-pressed="false" title="Expand selected workspace (F)">[] Expand</button>
            </div>
          </div>
          <div class="panel-body">
            <div id="center-content"></div>
          </div>
        </main>

        <aside id="session-panel" class="panel">
          <div class="panel-header">
            <strong>Sessions</strong>
            <span id="rooms-path" class="muted"></span>
          </div>
          <div id="session-list" class="panel-body session-list"></div>
        </aside>
      </section>
    </div>

    <script>${renderClientScript({
      projectsJson,
      pixelOfficeJson,
      eventIconUrlsJson: JSON.stringify(PIXEL_OFFICE_EVENT_ICON_URLS),
      threadItemIconUrlsJson: JSON.stringify(PIXEL_OFFICE_THREAD_ITEM_ICON_URLS)
    })}</script>
  </body>
</html>`;
}
