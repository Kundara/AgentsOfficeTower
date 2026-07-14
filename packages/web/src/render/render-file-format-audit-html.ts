import { listHotFileFormats } from "@agents-tower/core";

import { CLIENT_RUNTIME_FILE_FORMATS_SOURCE } from "../client/runtime/file-formats-source";

const FAMILY_ORDER = [
  "code", "markup", "style", "data", "config", "docs", "image", "audio", "video",
  "font", "archive", "project", "binary", "other"
];

export function renderFileFormatAuditHtml(): string {
  const catalog = listHotFileFormats().sort((left, right) => {
    const familyDelta = FAMILY_ORDER.indexOf(left.fileFamily) - FAMILY_ORDER.indexOf(right.fileFamily);
    return familyDelta || left.extension.localeCompare(right.extension);
  });
  const catalogJson = JSON.stringify(catalog).replace(/</g, "\\u003c");
  const runtimeSource = CLIENT_RUNTIME_FILE_FORMATS_SOURCE.replace(/<\/script/gi, "<\\/script");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>File Format Icon Review · Agents Office Tower</title>
    <link rel="stylesheet" href="/client/app.css" />
    <style>
      :root {
        color-scheme: dark;
        --review-bg: #071116;
        --review-panel: #0d1c22;
        --review-panel-soft: #12262e;
        --review-ink: #eaf8f5;
        --review-muted: #88a5aa;
        --review-border: #23434b;
        --review-accent: #62e3bd;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-width: 320px;
        background:
          radial-gradient(circle at 12% -10%, rgba(41, 139, 142, 0.26), transparent 34rem),
          linear-gradient(180deg, #071116, #09171d 56%, #061014);
        color: var(--review-ink);
        font: 14px/1.45 "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      body.is-light {
        color-scheme: light;
        --review-bg: #eef4f1;
        --review-panel: #ffffff;
        --review-panel-soft: #e7f0ec;
        --review-ink: #142a30;
        --review-muted: #587078;
        --review-border: #bdd0cb;
        background: linear-gradient(180deg, #edf7f4, #e5efec);
      }

      button, input, select { font: inherit; }

      main {
        width: min(1520px, 100%);
        margin: 0 auto;
        padding: 28px clamp(16px, 3vw, 44px) 64px;
      }

      .review-hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 24px;
        align-items: end;
        padding: 26px;
        border: 1px solid var(--review-border);
        background: color-mix(in srgb, var(--review-panel) 92%, transparent);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
      }

      .review-kicker {
        margin: 0 0 8px;
        color: var(--review-accent);
        font: 700 12px/1.2 "IBM Plex Mono", monospace;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      h1, h2, p { margin-top: 0; }
      h1 { margin-bottom: 8px; font-size: clamp(27px, 4vw, 46px); line-height: 1; letter-spacing: -0.045em; }
      h2 { margin-bottom: 4px; font-size: 18px; letter-spacing: -0.015em; }
      p { color: var(--review-muted); }
      code { color: var(--review-accent); }

      .review-count {
        min-width: 132px;
        padding: 14px 18px;
        border-left: 3px solid var(--review-accent);
        background: var(--review-panel-soft);
      }

      .review-count strong { display: block; font-size: 26px; line-height: 1; }
      .review-count span { color: var(--review-muted); font-size: 12px; }

      .review-controls {
        position: sticky;
        top: 0;
        z-index: 20;
        display: grid;
        grid-template-columns: minmax(220px, 1fr) repeat(3, auto);
        gap: 10px;
        align-items: center;
        margin: 16px 0;
        padding: 12px;
        border: 1px solid var(--review-border);
        background: color-mix(in srgb, var(--review-bg) 88%, transparent);
        backdrop-filter: blur(18px);
      }

      .review-control,
      .review-button {
        height: 40px;
        border: 1px solid var(--review-border);
        border-radius: 0;
        background: var(--review-panel);
        color: var(--review-ink);
      }

      .review-control { padding: 0 12px; }
      .review-button { padding: 0 14px; cursor: pointer; }
      .review-button:hover { border-color: var(--review-accent); }

      .review-size-control {
        display: flex;
        align-items: center;
        gap: 9px;
        height: 40px;
        padding: 0 12px;
        border: 1px solid var(--review-border);
        background: var(--review-panel);
        white-space: nowrap;
      }

      .review-size-control input { width: 112px; accent-color: var(--review-accent); }

      .context-panel {
        margin-bottom: 16px;
        padding: 18px;
        border: 1px solid var(--review-border);
        background: var(--review-panel);
      }

      .context-head { margin-bottom: 14px; }
      .context-head p { margin-bottom: 0; }
      .context-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 18px; }
      .context-surface { padding: 18px; background: #0b1b21; border: 1px solid #31515a; color: #eaf8f5; }
      .context-surface.is-light { background: #d9e9ee; border-color: #a8c1c8; color: #18313a; }
      .context-row { display: flex; align-items: center; gap: 8px; min-height: 30px; font-family: "IBM Plex Mono", monospace; }
      .context-row .hot-file-format-icon { width: 14px; height: 14px; }
      .context-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .context-row em { margin-left: auto; color: #8aa4aa; font-size: 11px; font-style: normal; }
      .context-sizes { display: flex; align-items: end; flex-wrap: wrap; gap: 18px; padding-top: 10px; }
      .context-size { display: grid; justify-items: center; gap: 7px; color: var(--review-muted); font-size: 11px; }

      .family-section {
        margin-top: 16px;
        border: 1px solid var(--review-border);
        background: var(--review-panel);
      }

      .family-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--review-border);
      }

      .family-head h2 { margin: 0; text-transform: capitalize; }
      .family-head span { color: var(--review-muted); font: 12px "IBM Plex Mono", monospace; }

      .format-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
      }

      .format-card {
        position: relative;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        min-height: 82px;
        padding: 14px;
        border-right: 1px solid var(--review-border);
        border-bottom: 1px solid var(--review-border);
        background: color-mix(in srgb, var(--review-panel) 96%, var(--file-card-color, transparent));
      }

      .format-card:hover { z-index: 1; outline: 1px solid var(--file-card-color); outline-offset: -1px; }
      .format-card-icons { display: grid; grid-template-columns: auto 24px; gap: 8px; align-items: center; }
      .format-card-icons > .hot-file-format-icon { width: var(--icon-review-size, 30px); height: var(--icon-review-size, 30px); }
      .format-card-size-strip { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; align-items: center; justify-items: center; width: 24px; }
      .format-card-size-icon { display: flex; align-items: center; justify-content: center; }
      .format-card-size-icon:last-child { grid-column: 1 / -1; }
      .format-card-size-icon .hot-file-format-icon { width: 100%; height: 100%; }
      .format-copy { min-width: 0; }
      .format-name { overflow: hidden; text-overflow: ellipsis; font: 700 13px/1.25 "IBM Plex Mono", monospace; white-space: nowrap; }
      .format-meta { margin-top: 3px; color: var(--review-muted); font-size: 11px; text-transform: uppercase; }
      .format-swatch { display: inline-block; width: 7px; height: 7px; margin-right: 5px; background: var(--file-card-color); }

      .empty-state { padding: 42px; text-align: center; color: var(--review-muted); border: 1px solid var(--review-border); }

      @media (max-width: 800px) {
        .review-hero, .context-grid { grid-template-columns: 1fr; }
        .review-controls { grid-template-columns: 1fr 1fr; }
        .review-controls .review-search { grid-column: 1 / -1; }
      }

      @media (max-width: 520px) {
        main { padding: 14px 10px 40px; }
        .review-controls { position: static; grid-template-columns: 1fr; }
        .review-controls .review-search { grid-column: auto; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="review-hero">
        <div>
          <p class="review-kicker">Agents Office Tower · visual review</p>
          <h1>File format icons</h1>
          <p>Exact production SVG renderer, every recognized extension, all change states, and the actual 9–24px office sizes.</p>
        </div>
        <div class="review-count"><strong>${catalog.length}</strong><span>supported extensions</span></div>
      </header>

      <div class="review-controls" aria-label="Gallery controls">
        <input id="format-search" class="review-control review-search" type="search" placeholder="Filter extension, format, or family…" />
        <select id="change-kind" class="review-control" aria-label="Change state">
          <option value="modified">Modified</option>
          <option value="added">Added</option>
          <option value="deleted">Deleted</option>
          <option value="renamed">Renamed</option>
          <option value="mixed">Mixed</option>
        </select>
        <label class="review-size-control">Size <input id="icon-size" type="range" min="9" max="48" value="30" /><output id="icon-size-output">30px</output></label>
        <button id="theme-toggle" class="review-button" type="button">Light surface</button>
      </div>

      <section class="context-panel">
        <div class="context-head">
          <h2>Production-size check</h2>
          <p>The first group reproduces the wall-row context; the second exposes the same icon at every shipped size.</p>
        </div>
        <div class="context-grid">
          <div class="context-surface" id="context-rows"></div>
          <div class="context-surface is-light"><div class="context-sizes" id="context-sizes"></div></div>
        </div>
      </section>

      <div id="format-gallery"></div>
    </main>

    <script>
      function escapeHtml(value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

${runtimeSource}

      const fileFormatCatalog = ${catalogJson};
      const familyOrder = ${JSON.stringify(FAMILY_ORDER)};
      const gallery = document.getElementById("format-gallery");
      const searchInput = document.getElementById("format-search");
      const changeSelect = document.getElementById("change-kind");
      const sizeInput = document.getElementById("icon-size");
      const sizeOutput = document.getElementById("icon-size-output");
      const themeToggle = document.getElementById("theme-toggle");
      const initialSearch = new URLSearchParams(window.location.search).get("q");
      if (initialSearch) searchInput.value = initialSearch;

      function iconEntry(item, changeKind) {
        return {
          path: "review/sample." + item.extension,
          fileExtension: item.extension,
          fileFamily: item.fileFamily,
          fileFormat: item.fileFormat,
          formatColor: item.formatColor,
          changeKind
        };
      }

      function renderContext() {
        const state = changeSelect.value;
        const samples = ["ts", "json", "md", "png", "spriteatlas"]
          .map((extension) => fileFormatCatalog.find((entry) => entry.extension === extension))
          .filter(Boolean);
        document.getElementById("context-rows").innerHTML = samples.map((item) =>
          '<div class="context-row">' + renderHotFileIcon(iconEntry(item, state), "context-file-icon")
          + '<strong>example.' + escapeHtml(item.extension) + '</strong><em>' + escapeHtml(item.fileFormat) + '</em></div>'
        ).join("");

        const sample = fileFormatCatalog.find((entry) => entry.extension === "spriteatlas") || samples[0];
        document.getElementById("context-sizes").innerHTML = [9, 12, 14, 18, 24, 32].map((size) =>
          '<div class="context-size"><span style="display:flex;width:' + size + 'px;height:' + size + 'px">'
          + renderHotFileIcon(iconEntry(sample, state), "context-scale-icon")
          + '</span><span>' + size + 'px</span></div>'
        ).join("");
      }

      function renderGallery() {
        const query = searchInput.value.trim().toLowerCase();
        const state = changeSelect.value;
        const filtered = fileFormatCatalog.filter((item) =>
          !query || [item.extension, item.fileFormat, item.fileFamily].some((value) => String(value).toLowerCase().includes(query))
        );
        const sections = familyOrder.map((family) => {
          const entries = filtered.filter((item) => item.fileFamily === family);
          if (!entries.length) return "";
          return '<section class="family-section"><div class="family-head"><h2>' + escapeHtml(family)
            + '</h2><span>' + entries.length + ' format' + (entries.length === 1 ? '' : 's') + '</span></div><div class="format-grid">'
            + entries.map((item) => '<article class="format-card" style="--file-card-color:' + escapeHtml(item.formatColor) + '">'
              + '<div class="format-card-icons">' + renderHotFileIcon(iconEntry(item, state), "gallery-file-icon")
              + '<div class="format-card-size-strip" aria-label="9, 14, and 24 pixel previews">'
              + [9, 14, 24].map((size) => '<span class="format-card-size-icon" title="' + size + 'px" style="width:' + size + 'px;height:' + size + 'px">'
                + renderHotFileIcon(iconEntry(item, state), "gallery-size-icon") + '</span>').join("")
              + '</div></div>'
              + '<div class="format-copy"><div class="format-name">.' + escapeHtml(item.extension) + '</div>'
              + '<div class="format-meta"><span class="format-swatch"></span>' + escapeHtml(item.fileFormat) + ' · ' + escapeHtml(item.formatColor) + '</div></div></article>')
              .join("")
            + '</div></section>';
        }).join("");
        gallery.innerHTML = sections || '<div class="empty-state">No file formats match that filter.</div>';
        renderContext();
      }

      searchInput.addEventListener("input", renderGallery);
      changeSelect.addEventListener("change", renderGallery);
      sizeInput.addEventListener("input", () => {
        const size = sizeInput.value + "px";
        document.documentElement.style.setProperty("--icon-review-size", size);
        sizeOutput.value = size;
      });
      themeToggle.addEventListener("click", () => {
        document.body.classList.toggle("is-light");
        themeToggle.textContent = document.body.classList.contains("is-light") ? "Dark surface" : "Light surface";
      });

      renderGallery();
    </script>
  </body>
</html>`;
}
