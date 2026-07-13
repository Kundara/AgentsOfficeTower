export const CLIENT_RUNTIME_FILE_FORMATS_SOURCE = `      const HOT_FILE_FAMILIES = new Set([
        "code", "markup", "style", "data", "config", "docs", "image", "audio", "video",
        "font", "archive", "project", "binary", "other"
      ]);

      const HOT_FILE_FORMAT_MARKS = {
        jsx: "JX", tsx: "TX", mjs: "MJ", cjs: "CJ", cs: "C#", cpp: "C+", cc: "C+", hpp: "H+",
        java: "JV", swift: "SW", php: "PH", bash: "SH", zsh: "ZH", fish: "FI", ps1: "PS", graphql: "GQ",
        html: "HT", htm: "HT", xml: "XM", uxml: "UX", svelte: "SV", astro: "AS", scss: "SC", sass: "SA",
        json: "{}", jsonl: "JL", csv: "CV", tsv: "TV", sqlite: "SQ", yaml: "YA", yml: "YA", toml: "TO",
        gitignore: "GI", gitattributes: "GA", editorconfig: "EC", npmrc: "NP", nvmrc: "NV", mdx: "MX",
        adoc: "AD", docx: "DX", xlsx: "XL", pptx: "PX", jpeg: "JP", webp: "WP", avif: "AV", aseprite: "AE",
        sketch: "SK", woff: "WF", woff2: "W2", spriteatlas: "AT", spriteatlasv2: "AT", unity: "SC",
        prefab: "PF", asset: "UA", controller: "AC", overridecontroller: "OC", rendertexture: "RT",
        terrainlayer: "TL", inputactions: "IA", playable: "TM", guiskin: "UI", shadergraph: "SG",
        shadersubgraph: "SS", compute: "GPU", asmdef: "AD", csproj: "CP", lighting: "LI"
      };

      function hotFileFamilyMeta(value) {
        const family = HOT_FILE_FAMILIES.has(value) ? value : "other";
        const entries = {
          code: ["Code", "#4f9df5", "M2 2h9l3 3v9H2Z", "M10.8 2.2V5h2.8"],
          markup: ["Markup", "#f07845", "M4 2h8l2 6-2 6H4L2 8Z", "M4.2 8 6 6.2M11.8 8 10 9.8"],
          style: ["Styles", "#d86797", "M8 1.6c3.6 2.5 5.7 5.1 5.7 8A5.7 5.7 0 1 1 2.3 10c0-2.9 2.1-5.5 5.7-8.4Z", "M4.2 10.2c2.2-3.1 4.7-4.7 7.7-5.2"],
          data: ["Data", "#e0b84d", "M2.2 4.2C2.2 2.9 4.8 2 8 2s5.8.9 5.8 2.2v7.6C13.8 13.1 11.2 14 8 14s-5.8-.9-5.8-2.2Z", "M2.3 4.2C2.3 5.5 4.8 6.4 8 6.4s5.7-.9 5.7-2.2M2.3 8c0 1.3 2.5 2.2 5.7 2.2s5.7-.9 5.7-2.2"],
          config: ["Config", "#93a4b8", "M5 2h6l3 3v6l-3 3H5l-3-3V5Z", "M4.5 5.2h7M4.5 8h7M4.5 10.8h7"],
          docs: ["Docs", "#57b8c9", "M2.5 2h7.8l3.2 3.2V14h-11Z", "M10.2 2.2v3.1h3.1M4.4 8h7.1M4.4 10.6h5.1"],
          image: ["Images", "#63c174", "M3 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z", "M3.6 11.8 6.8 8.5l2.1 2 1.5-1.5 2.2 2.8M10.8 5.2h.1"],
          audio: ["Audio", "#a778d4", "M8 1.7A6.3 6.3 0 1 1 8 14.3 6.3 6.3 0 0 1 8 1.7Z", "M4.2 8h1.2M6.7 5.7v4.6M9.3 4.4v7.2M11.8 6.2v3.6"],
          video: ["Video", "#e15f86", "M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z", "m6.5 5.3 3.8 2.7-3.8 2.7Z"],
          font: ["Fonts", "#e6a25c", "M4 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z", "M4.6 11.5 8 4.2l3.4 7.3M5.8 9h4.4"],
          archive: ["Archives", "#d9b44a", "M2 4h12v9.2a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8ZM3 2h10l1 2H2Z", "M7 4h2v2H7v2h2v2H7v2h2"],
          project: ["Project", "#4bd6c5", "M8 1.6 14 4.8v6.4L8 14.4l-6-3.2V4.8Z", "M2.4 5 8 8l5.6-3M8 8v6"],
          binary: ["Binary", "#8995a3", "M4 2h8v2h2v8h-2v2H4v-2H2V4h2Z", "M5.2 5.2h2v5.6h-2M9 5.2h2v5.6H9"],
          other: ["Other", "#8a9ba8", "M3 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z", "M5 5h6M5 8h6M5 11h4"]
        };
        const entry = entries[family] || entries.other;
        return { family, label: entry[0], color: entry[1], tile: entry[2], detail: entry[3] };
      }

      function hotFileFormatKey(entry, path) {
        const explicit = String(entry && (entry.fileExtension || entry.extension) || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (explicit) return explicit;
        const label = String(path || "").toLowerCase().split(/[\\/]/).pop() || "";
        if (label.startsWith(".") && label.indexOf(".", 1) < 0) return label.slice(1).replace(/[^a-z0-9]/g, "");
        const match = label.match(/\.([^.]+)$/);
        return match ? match[1].replace(/[^a-z0-9]/g, "") : "";
      }

      function hotFileFormatMark(formatKey, fileFormat) {
        const preferred = HOT_FILE_FORMAT_MARKS[formatKey];
        if (preferred) return preferred;
        return String(fileFormat || "F")
          .replace(/[^a-z0-9+#{}.-]/gi, "")
          .toUpperCase()
          .slice(0, 3) || "F";
      }

      function hotFileInkForColor(color) {
        const value = String(color || "").replace("#", "");
        if (!/^[0-9a-f]{6}$/i.test(value)) return "#ffffff";
        const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
          .map((channel) => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
        const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        return luminance > 0.18 ? "#071018" : "#ffffff";
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
        const formatKey = hotFileFormatKey(entry, path);
        const formatColor = /^#[0-9a-f]{6}$/i.test(String(entry && entry.formatColor || ""))
          ? String(entry.formatColor)
          : family.color;
        const allowedKinds = ["added", "modified", "deleted", "renamed", "mixed"];
        const changeKind = allowedKinds.includes(entry && entry.changeKind) ? entry.changeKind : "modified";
        return {
          ...family,
          fileFormat,
          formatKey,
          formatMark: hotFileFormatMark(formatKey, fileFormat),
          formatColor,
          formatInk: hotFileInkForColor(formatColor),
          changeKind
        };
      }

      function hotFileChangeBadgeSvg(changeKind) {
        if (changeKind === "added") {
          return '<circle class="hot-file-change-badge is-added" cx="13" cy="13" r="2.45"/><path class="hot-file-change-mark" d="M13 11.7v2.6M11.7 13h2.6"/>';
        }
        if (changeKind === "deleted") {
          return '<circle class="hot-file-change-badge is-deleted" cx="13" cy="13" r="2.45"/><path class="hot-file-change-mark" d="M11.7 13h2.6"/>';
        }
        if (changeKind === "renamed") {
          return '<circle class="hot-file-change-badge is-renamed" cx="13" cy="13" r="2.45"/><path class="hot-file-change-mark" d="M11.6 13h2.6m-1-1 1 1-1 1"/>';
        }
        if (changeKind === "mixed") {
          return '<circle class="hot-file-change-badge is-mixed" cx="13" cy="13" r="2.45"/><path class="hot-file-change-mark" d="m12 12 2 2m0-2-2 2"/>';
        }
        return '<circle class="hot-file-change-badge is-modified" cx="13" cy="13" r="2.45"/><path class="hot-file-change-mark" d="m11.9 13.8.3-1.2 1.4-1.4.8.8-1.4 1.4z"/>';
      }

      function renderHotFileIcon(entry, className) {
        const presentation = hotChangePresentation(entry);
        const classes = ["hot-file-format-icon", "is-" + presentation.family, className || ""].filter(Boolean).join(" ");
        const markLength = Math.min(3, Math.max(1, presentation.formatMark.length));
        return '<svg class="' + escapeHtml(classes) + '" viewBox="0 0 16 16" focusable="false" aria-hidden="true" data-file-family="' + escapeHtml(presentation.family) + '" data-file-format="' + escapeHtml(presentation.fileFormat) + '" style="--file-format-color:' + escapeHtml(presentation.formatColor) + ';--file-format-ink:' + escapeHtml(presentation.formatInk) + ';--file-family-color:' + escapeHtml(presentation.color) + '">'
          + '<path class="hot-file-format-shadow" d="' + escapeHtml(presentation.tile) + '" transform="translate(.5 .7)"/>'
          + '<path class="hot-file-format-surface" d="' + escapeHtml(presentation.tile) + '"/>'
          + '<path class="hot-file-family-detail" d="' + escapeHtml(presentation.detail) + '"/>'
          + '<text class="hot-file-format-mark is-length-' + markLength + '" x="8" y="9.65" text-anchor="middle">' + escapeHtml(presentation.formatMark) + '</text>'
          + hotFileChangeBadgeSvg(presentation.changeKind)
          + '</svg>';
      }
`;
