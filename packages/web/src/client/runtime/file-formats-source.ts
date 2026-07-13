export const CLIENT_RUNTIME_FILE_FORMATS_SOURCE = `      const HOT_FILE_FAMILIES = new Set([
        "code", "markup", "style", "data", "config", "docs", "image", "audio", "video",
        "font", "archive", "project", "binary", "other"
      ]);

      function hotFileFamilyMeta(value) {
        const family = HOT_FILE_FAMILIES.has(value) ? value : "other";
        const entries = {
          code: ["Code", "M4 5.5 1.8 8 4 10.5M8 4l-2 8M12 5.5 14.2 8 12 10.5", "#4f9df5"],
          markup: ["Markup", "M5 5.5 2.5 8 5 10.5M11 5.5 13.5 8 11 10.5", "#f07845"],
          style: ["Styles", "M3 10.5c2.2-4.8 5.6-6.1 9.8-6.9-1 4.4-3.1 8-7.5 8.5L3 10.5Z", "#d86797"],
          data: ["Data", "M3 4.5c0-1 2.2-1.8 5-1.8s5 .8 5 1.8-2.2 1.8-5 1.8-5-.8-5-1.8Zm0 0v6c0 1 2.2 1.8 5 1.8s5-.8 5-1.8v-6M3 7.5c0 1 2.2 1.8 5 1.8s5-.8 5-1.8", "#e0b84d"],
          config: ["Config", "M3 4h10M5 8h8M3 12h10M6 2.8v2.4M10 6.8v2.4M7 10.8v2.4", "#93a4b8"],
          docs: ["Docs", "M4 4h8M4 7h8M4 10h6M4 13h5", "#57b8c9"],
          image: ["Images", "M2.5 12.5 6.2 8.8l2.2 2.1 1.7-1.7 3.4 3.3M10.8 5.2h.1", "#63c174"],
          audio: ["Audio", "M6.5 11.5V5l5-1.2v6.4M6.5 11.5c0 1-1 1.7-2.2 1.7S2.2 12.5 2.2 11.5s1-1.7 2.2-1.7 2.1.7 2.1 1.7Zm5-1.3c0 1-1 1.7-2.2 1.7s-2.1-.7-2.1-1.7 1-1.7 2.1-1.7 2.2.7 2.2 1.7Z", "#a778d4"],
          video: ["Video", "M4 3.5h6.5v9H4zM10.5 6l3-1.5v7l-3-1.5", "#e15f86"],
          font: ["Fonts", "M4 12 8 3l4 9M5.4 9h5.2", "#e6a25c"],
          archive: ["Archives", "M4 3h8v10H4zM7 3h2v2H7zm0 4h2v2H7zm0 4h2v2H7z", "#d9b44a"],
          project: ["Project", "M8 2.5 13 5v6L8 13.5 3 11V5zM3 5l5 2.5L13 5M8 7.5v6", "#4bd6c5"],
          binary: ["Binary", "M4 4h2v8H4zM10 4h2v8h-2zM7.5 5.5h1v1h-1zm0 4h1v1h-1z", "#8995a3"],
          other: ["Other", "M4 5h8M4 8h8M4 11h5", "#8a9ba8"]
        };
        const entry = entries[family] || entries.other;
        return { family, label: entry[0], glyph: entry[1], color: entry[2] };
      }

      function hotChangePresentation(entry) {
        const legacyFamily = entry && entry.fileType === "doc" ? "docs"
          : entry && entry.fileType === "media" ? "image"
          : "code";
        const requestedFamily = entry && (entry.fileFamily || entry.family || entry.column);
        const family = hotFileFamilyMeta(HOT_FILE_FAMILIES.has(requestedFamily) ? requestedFamily : legacyFamily);
        const path = String(entry && (entry.path || entry.label) || "");
        const extensionMatch = path.toLowerCase().match(/\.([^.\\/]+)$/);
        const fileFormat = String(entry && entry.fileFormat || (extensionMatch ? extensionMatch[1] : "file"))
          .replace(/[^a-z0-9+#.-]/gi, "")
          .slice(0, 10)
          .toUpperCase() || "FILE";
        const formatColor = /^#[0-9a-f]{6}$/i.test(String(entry && entry.formatColor || ""))
          ? String(entry.formatColor)
          : family.color;
        const allowedKinds = ["added", "modified", "deleted", "renamed", "mixed"];
        const changeKind = allowedKinds.includes(entry && entry.changeKind) ? entry.changeKind : "modified";
        return { ...family, fileFormat, formatColor, changeKind };
      }

      function hotFileChangeBadgeSvg(changeKind) {
        if (changeKind === "added") {
          return '<circle class="hot-file-change-badge is-added" cx="12.5" cy="12.5" r="3"/><path class="hot-file-change-mark" d="M12.5 10.8v3.4M10.8 12.5h3.4"/>';
        }
        if (changeKind === "deleted") {
          return '<circle class="hot-file-change-badge is-deleted" cx="12.5" cy="12.5" r="3"/><path class="hot-file-change-mark" d="M10.8 12.5h3.4"/>';
        }
        if (changeKind === "renamed") {
          return '<circle class="hot-file-change-badge is-renamed" cx="12.5" cy="12.5" r="3"/><path class="hot-file-change-mark" d="M10.6 12.5h3.5m-1.3-1.3 1.3 1.3-1.3 1.3"/>';
        }
        if (changeKind === "mixed") {
          return '<circle class="hot-file-change-badge is-mixed" cx="12.5" cy="12.5" r="3"/><path class="hot-file-change-mark" d="m11.2 11.2 2.6 2.6m0-2.6-2.6 2.6"/>';
        }
        return '<circle class="hot-file-change-badge is-modified" cx="12.5" cy="12.5" r="3"/><path class="hot-file-change-mark" d="m11 13.6.4-1.5 2-2 .9.9-2 2z"/>';
      }

      function renderHotFileIcon(entry, className) {
        const presentation = hotChangePresentation(entry);
        const classes = ["hot-file-format-icon", className || ""].filter(Boolean).join(" ");
        return '<svg class="' + escapeHtml(classes) + '" viewBox="0 0 16 16" focusable="false" aria-hidden="true" style="--file-format-color:' + escapeHtml(presentation.formatColor) + ';--file-family-color:' + escapeHtml(presentation.color) + '">'
          + '<path class="hot-file-format-sheet" d="M2.5 1.5h7l4 4v9h-11z"/>'
          + '<path class="hot-file-format-fold" d="M9.5 1.5v4h4"/>'
          + '<path class="hot-file-family-glyph" d="' + escapeHtml(presentation.glyph) + '"/>'
          + hotFileChangeBadgeSvg(presentation.changeKind)
          + '</svg>';
      }
`;
