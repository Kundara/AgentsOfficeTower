export const CLIENT_RUNTIME_FILE_FORMATS_SOURCE = `      const HOT_FILE_FAMILIES = new Set([
        "code", "markup", "style", "data", "config", "docs", "image", "audio", "video",
        "font", "archive", "project", "binary", "other"
      ]);

      const HOT_FILE_FORMAT_MARKS = {
        cs: "C#", cc: "C++", cpp: "C++", hpp: "H++", html: "HTM", htm: "HTM", uxml: "UX",
        java: "JAV", swift: "SW", yml: "YML", yaml: "YML", toml: "TOM", gitignore: "GIT",
        gitattributes: "GIT", editorconfig: "CFG", npmrc: "NPM", nvmrc: "NOD", md: "MD", mdx: "MDX",
        docx: "DOC", xlsx: "XLS", pptx: "PPT", asmdef: "ASM", csproj: "C#", shader: "SHD",
        compute: "GPU", spriteatlas: "", spriteatlasv2: "", shadergraph: "", shadersubgraph: "",
        rendertexture: "", terrainlayer: "", sh: "", bash: "", zsh: "", fish: "", ps1: "", bat: "", cmd: ""
      };

      const HOT_FILE_LABEL_COLORS = {
        md: "#2f6f9f"
      };

      const HOT_FILE_ICON_KINDS = {
        svg: "vector", ai: "vector", fig: "vector",
        aseprite: "pixel-image", gif: "pixel-image", psd: "layers", sketch: "layers",
        csv: "table", tsv: "table", xls: "table", xlsx: "table",
        db: "database", sqlite: "database", sql: "database",
        json: "json", jsonl: "json", graphql: "graph-data", gql: "graph-data",
        sh: "terminal", bash: "terminal", zsh: "terminal", fish: "terminal", ps1: "terminal", bat: "terminal", cmd: "terminal",
        spriteatlas: "atlas", spriteatlasv2: "atlas", rendertexture: "image",
        anim: "animation", controller: "animation", overridecontroller: "animation", playable: "animation",
        shadergraph: "shader", shadersubgraph: "shader", vfx: "shader", shader: "document", compute: "document",
        unity: "scene", prefab: "prefab", asset: "asset", mat: "material", terrainlayer: "terrain",
        lighting: "lighting", inputactions: "input", guiskin: "ui", meta: "metadata", asmdef: "document",
        csproj: "document", sln: "solution", dll: "library", exe: "executable", bin: "binary"
      };

      function hotFileFamilyMeta(value) {
        const family = HOT_FILE_FAMILIES.has(value) ? value : "other";
        const entries = {
          code: ["Code", "#4f9df5"], markup: ["Markup", "#f07845"], style: ["Styles", "#d86797"],
          data: ["Data", "#e0b84d"], config: ["Config", "#93a4b8"], docs: ["Docs", "#57b8c9"],
          image: ["Images", "#63c174"], audio: ["Audio", "#a778d4"], video: ["Video", "#e15f86"],
          font: ["Fonts", "#e6a25c"], archive: ["Archives", "#d9b44a"], project: ["Project", "#4bd6c5"],
          binary: ["Binary", "#8995a3"], other: ["Other", "#8a9ba8"]
        };
        const entry = entries[family] || entries.other;
        return { family, label: entry[0], color: entry[1] };
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
        if (Object.prototype.hasOwnProperty.call(HOT_FILE_FORMAT_MARKS, formatKey)) {
          return HOT_FILE_FORMAT_MARKS[formatKey];
        }
        return String(fileFormat || "")
          .replace(/[^a-z0-9+#{}.-]/gi, "")
          .toUpperCase()
          .slice(0, 3);
      }

      function hotFileIconKind(formatKey, family) {
        if (HOT_FILE_ICON_KINDS[formatKey]) return HOT_FILE_ICON_KINDS[formatKey];
        if (["code", "markup", "style", "docs"].includes(family)) return "document";
        if (family === "data") return "data-document";
        if (family === "config") return "config";
        if (family === "image") return "image";
        if (family === "audio") return "audio";
        if (family === "video") return "video";
        if (family === "font") return "font";
        if (family === "archive") return "archive";
        if (family === "project") return "project";
        if (family === "binary") return "binary";
        return "other";
      }

      function hotFileInkForColor(color) {
        const value = String(color || "").replace("#", "");
        if (!/^[0-9a-f]{6}$/i.test(value)) return "#ffffff";
        const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
          .map((channel) => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
        const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        return luminance > 0.18 ? "#071018" : "#ffffff";
      }

      function hotFileRelativeLuminance(color) {
        const value = String(color || "").replace("#", "");
        if (!/^[0-9a-f]{6}$/i.test(value)) return 0;
        const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
          .map((channel) => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      }

      function hotFileContrastRatio(firstColor, secondColor) {
        const first = hotFileRelativeLuminance(firstColor);
        const second = hotFileRelativeLuminance(secondColor);
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
      }

      function hotFileTextInkForColor(color) {
        return hotFileContrastRatio(color, "#ffffff") >= hotFileContrastRatio(color, "#000000")
          ? "#ffffff"
          : "#000000";
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
        const formatLabelColor = HOT_FILE_LABEL_COLORS[formatKey] || formatColor;
        const allowedKinds = ["added", "modified", "deleted", "renamed", "mixed"];
        const changeKind = allowedKinds.includes(entry && entry.changeKind) ? entry.changeKind : "modified";
        return {
          ...family,
          fileFormat,
          formatKey,
          formatMark: hotFileFormatMark(formatKey, fileFormat),
          formatColor,
          formatInk: hotFileInkForColor(formatColor),
          formatLabelColor,
          formatLabelInk: hotFileTextInkForColor(formatLabelColor),
          iconKind: hotFileIconKind(formatKey, family.family),
          changeKind
        };
      }

      function hotFileDocumentIconSvg(presentation, dataDocument) {
        const mark = presentation.formatMark;
        const markLength = Math.min(4, Math.max(1, mark.length));
        return '<path class="hot-file-icon-paper-shadow" d="M3 1.5h6.7l3.3 3.3v9.7H3z" transform="translate(.45 .55)"/>'
          + '<path class="hot-file-icon-paper" d="M3 1.5h6.7l3.3 3.3v9.7H3z"/>'
          + '<path class="hot-file-icon-fold" d="M9.7 1.7v3.2h3.1"/>'
          + (dataDocument ? '<path class="hot-file-icon-data-brace" d="M5.1 6.3c-.8 0-.8.5-.8 1.1v.5c0 .6-.2.8-.7.9.5.1.7.3.7.9v.5c0 .6 0 1.1.8 1.1M10.9 6.3c.8 0 .8.5.8 1.1v.5c0 .6.2.8.7.9-.5.1-.7.3-.7.9v.5c0 .6 0 1.1-.8 1.1"/>' : '')
          + (mark ? '<rect class="hot-file-icon-label" x="3.75" y="8.05" width="8.5" height="4.45" rx=".65"/><text class="hot-file-format-mark is-length-' + markLength + '" x="8" y="11.35" text-anchor="middle">' + escapeHtml(mark) + '</text>' : '<path class="hot-file-icon-paper-lines" d="M4.5 7h6.8M4.5 9h5.3M4.5 11h6"/>');
      }

      function hotFileIconBodySvg(presentation) {
        if (presentation.iconKind === "document") return hotFileDocumentIconSvg(presentation, false);
        if (presentation.iconKind === "data-document") return hotFileDocumentIconSvg(presentation, true);
        if (presentation.iconKind === "terminal") {
          return '<path class="hot-file-icon-paper-shadow" d="M3 1.5h6.7l3.3 3.3v9.7H3z" transform="translate(.45 .55)"/><path class="hot-file-icon-paper" d="M3 1.5h6.7l3.3 3.3v9.7H3z"/><path class="hot-file-icon-fold" d="M9.7 1.7v3.2h3.1"/><rect class="hot-file-icon-terminal" x="3.9" y="6.2" width="8.2" height="6.2" rx=".7"/><path class="hot-file-icon-terminal-prompt" d="m5.2 8 1.4 1.2-1.4 1.2M7.6 10.5h2.5"/>';
        }
        if (presentation.iconKind === "json") {
          return '<path class="hot-file-icon-paper-shadow" d="M3 1.5h6.7l3.3 3.3v9.7H3z" transform="translate(.45 .55)"/><path class="hot-file-icon-paper" d="M3 1.5h6.7l3.3 3.3v9.7H3z"/><path class="hot-file-icon-fold" d="M9.7 1.7v3.2h3.1"/><path class="hot-file-icon-json-braces" d="M6.4 5.7c-1 0-1 .7-1 1.4v.5c0 .7-.2 1-.9 1.1.7.1.9.4.9 1.1v.5c0 .7 0 1.4 1 1.4M9.6 5.7c1 0 1 .7 1 1.4v.5c0 .7.2 1 .9 1.1-.7.1-.9.4-.9 1.1v.5c0 .7 0 1.4-1 1.4"/>'
            + (presentation.formatKey === "jsonl" ? '<text class="hot-file-icon-jsonl" x="8" y="10">L</text>' : '');
        }
        if (presentation.iconKind === "graph-data") {
          return '<path class="hot-file-icon-paper-shadow" d="M3 1.5h6.7l3.3 3.3v9.7H3z" transform="translate(.45 .55)"/><path class="hot-file-icon-paper" d="M3 1.5h6.7l3.3 3.3v9.7H3z"/><path class="hot-file-icon-fold" d="M9.7 1.7v3.2h3.1"/><path class="hot-file-icon-graph-link" d="m5.2 10.8 2.6-4.2 3.1 3.5M5.2 10.8l5.7-.7"/><circle class="hot-file-icon-graph-node" cx="5.2" cy="10.8" r="1.1"/><circle class="hot-file-icon-graph-node" cx="7.8" cy="6.6" r="1.1"/><circle class="hot-file-icon-graph-node" cx="10.9" cy="10.1" r="1.1"/>';
        }
        if (presentation.iconKind === "config") {
          return '<path class="hot-file-icon-paper-shadow" d="M3 1.5h6.7l3.3 3.3v9.7H3z" transform="translate(.45 .55)"/><path class="hot-file-icon-paper" d="M3 1.5h6.7l3.3 3.3v9.7H3z"/><path class="hot-file-icon-fold" d="M9.7 1.7v3.2h3.1"/><path class="hot-file-icon-semantic-stroke" d="M4.4 7h7.2M4.4 9.5h7.2M4.4 12h7.2"/><circle class="hot-file-icon-accent" cx="6" cy="7" r="1"/><circle class="hot-file-icon-accent" cx="9.8" cy="9.5" r="1"/><circle class="hot-file-icon-accent" cx="7.3" cy="12" r="1"/>';
        }
        if (presentation.iconKind === "image") {
          return '<rect class="hot-file-icon-frame-shadow" x="1.8" y="2.2" width="12.2" height="11.1" rx="1.45" transform="translate(.35 .5)"/><rect class="hot-file-icon-frame" x="1.8" y="2.2" width="12.2" height="11.1" rx="1.45"/><rect class="hot-file-icon-photo-sky" x="3.1" y="3.5" width="9.6" height="7.8" rx=".65"/><circle class="hot-file-icon-photo-sun" cx="10.5" cy="5.6" r="1.25"/><path class="hot-file-icon-photo-land" d="M3.1 10.8 6.2 7.4l2.1 2 1.45-1.35 2.95 2.75v.5H3.1Z"/>';
        }
        if (presentation.iconKind === "pixel-image") {
          return '<rect class="hot-file-icon-frame-shadow" x="1.8" y="2.2" width="12.2" height="11.1" rx="1" transform="translate(.35 .5)"/><rect class="hot-file-icon-frame" x="1.8" y="2.2" width="12.2" height="11.1" rx="1"/><path class="hot-file-icon-pixels" d="M3.4 4h2.1v2.1H3.4zm2.1 2.1h2.1v2.1H5.5zm2.1-2.1h2.1v2.1H7.6zm2.1 4.2h2.1v2.1H9.7zm-6.3 2.1h2.1v2.1H3.4z"/>';
        }
        if (presentation.iconKind === "vector") {
          return '<rect class="hot-file-icon-frame-shadow" x="1.8" y="2.2" width="12.2" height="11.1" rx="1.45" transform="translate(.35 .5)"/><rect class="hot-file-icon-frame" x="1.8" y="2.2" width="12.2" height="11.1" rx="1.45"/><path class="hot-file-icon-vector-path" d="M4 10.7c.8-4.4 2.8-5.8 7.7-5.5M4.2 10.5l7.4-5.2"/><path class="hot-file-icon-vector-handle" d="M4.1 8.6V12M2.4 10.3h3.4M11.6 3.5V7M9.9 5.2h3.4"/><circle class="hot-file-icon-vector-node" cx="4.1" cy="10.3" r="1.2"/><circle class="hot-file-icon-vector-node" cx="11.6" cy="5.2" r="1.2"/>';
        }
        if (presentation.iconKind === "layers") {
          return '<path class="hot-file-icon-layer back" d="m8 2.2 6 3.1-6 3.1-6-3.1Z"/><path class="hot-file-icon-layer middle" d="m2 8 6 3.1L14 8"/><path class="hot-file-icon-layer front" d="m2 10.7 6 3.1 6-3.1"/>';
        }
        if (presentation.iconKind === "audio") {
          return '<rect class="hot-file-icon-media" x="1.5" y="2" width="13" height="12" rx="3"/><path class="hot-file-icon-media-mark" d="M3.5 8h1.3M6 5.5v5M8 3.8v8.4M10 5v6M12.2 6.7v2.6"/>';
        }
        if (presentation.iconKind === "video") {
          return '<rect class="hot-file-icon-media" x="1.5" y="2.3" width="13" height="11.4" rx="1.6"/><path class="hot-file-icon-film-holes" d="M2.7 4.2h1.5M2.7 7.2h1.5M2.7 10.2h1.5M11.8 4.2h1.5M11.8 7.2h1.5M11.8 10.2h1.5"/><path class="hot-file-icon-play" d="m6.5 5.3 4.1 2.7-4.1 2.7Z"/>';
        }
        if (presentation.iconKind === "font") {
          return '<path class="hot-file-icon-paper-shadow" d="M3 1.5h6.7l3.3 3.3v9.7H3z" transform="translate(.45 .55)"/><path class="hot-file-icon-paper" d="M3 1.5h6.7l3.3 3.3v9.7H3z"/><path class="hot-file-icon-fold" d="M9.7 1.7v3.2h3.1"/><text class="hot-file-icon-font-big" x="4.1" y="12">A</text><text class="hot-file-icon-font-small" x="9.1" y="12">a</text>';
        }
        if (presentation.iconKind === "archive") {
          return '<path class="hot-file-icon-archive-lid" d="M2 3h12v3H2Z"/><path class="hot-file-icon-archive-box" d="M2.7 6h10.6v7.7H2.7Z"/><path class="hot-file-icon-archive-zip" d="M7 3h2v2H7v2h2v2H7v2h2"/>';
        }
        if (presentation.iconKind === "database") {
          return '<path class="hot-file-icon-database" d="M2.2 4.2C2.2 2.9 4.8 2 8 2s5.8.9 5.8 2.2v7.6C13.8 13.1 11.2 14 8 14s-5.8-.9-5.8-2.2Z"/><path class="hot-file-icon-database-lines" d="M2.3 4.2C2.3 5.5 4.8 6.4 8 6.4s5.7-.9 5.7-2.2M2.3 8c0 1.3 2.5 2.2 5.7 2.2s5.7-.9 5.7-2.2"/>';
        }
        if (presentation.iconKind === "table") {
          return '<path class="hot-file-icon-paper-shadow" d="M2.3 1.7h11.4v12.6H2.3z" transform="translate(.4 .5)"/><path class="hot-file-icon-table" d="M2.3 1.7h11.4v12.6H2.3z"/><path class="hot-file-icon-table-head" d="M2.8 2.2h10.4v3H2.8Z"/><path class="hot-file-icon-table-grid" d="M2.8 7h10.4M2.8 10.4h10.4M6.3 5.2v8.5M10 5.2v8.5"/>';
        }
        if (presentation.iconKind === "atlas") {
          return '<rect class="hot-file-icon-atlas-back" x="4" y="1.6" width="9.8" height="9" rx="1"/><rect class="hot-file-icon-atlas-front" x="2" y="4.4" width="9.8" height="9" rx="1"/><path class="hot-file-icon-atlas-grid" d="M5.3 4.4v9M8.5 4.4v9M2 7.4h9.8M2 10.4h9.8"/>';
        }
        if (presentation.iconKind === "animation") {
          return '<rect class="hot-file-icon-media" x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path class="hot-file-icon-timeline" d="M3.2 5.3h9.6M3.2 8h9.6M3.2 10.7h9.6"/><path class="hot-file-icon-keyframe" d="m6.1 6.6 1.4 1.4-1.4 1.4L4.7 8Zm4.1-2.7 1.4 1.4-1.4 1.4-1.4-1.4Z"/>';
        }
        if (presentation.iconKind === "shader") {
          return '<rect class="hot-file-icon-node" x="1.6" y="2.1" width="4.2" height="3.2" rx=".65"/><rect class="hot-file-icon-node" x="9.9" y="6.4" width="4.2" height="3.2" rx=".65"/><rect class="hot-file-icon-node" x="2.6" y="10.7" width="4.2" height="3.2" rx=".65"/><path class="hot-file-icon-node-link" d="M5.8 3.7c2.6 0 1.4 4.3 4.1 4.3M6.8 12.3C9 12.3 8 8 9.9 8"/>';
        }
        if (presentation.iconKind === "scene") {
          return '<rect class="hot-file-icon-scene-frame" x="1.7" y="2" width="12.6" height="12" rx="1.4"/><path class="hot-file-icon-scene-ground" d="M2.8 11.4 5.8 8l2.1 1.8 1.5-1.3 3.7 3.1"/><path class="hot-file-icon-scene-cube" d="m8.3 3.7 2.5 1.3v2.7L8.3 9 5.8 7.7V5Z"/><path class="hot-file-icon-scene-cube-lines" d="M5.9 5.1 8.3 6.4l2.4-1.3M8.3 6.4v2.5"/>';
        }
        if (presentation.iconKind === "prefab") {
          return '<path class="hot-file-icon-cube" d="M7 1.8 12.4 4.7v5.8L7 13.4l-5.4-2.9V4.7Z"/><path class="hot-file-icon-cube-lines" d="M2 4.9 7 7.6l5-2.7M7 7.6v5.5"/><path class="hot-file-icon-prefab-link" d="M11.2 10.8h2.4v2.4h-2.4zm-1.4 1.2H8.6"/>';
        }
        if (presentation.iconKind === "asset") {
          return '<path class="hot-file-icon-asset-box" d="M2 4.2h12v9.5H2Z"/><path class="hot-file-icon-asset-tab" d="M2 4.2V2.5h4l1.5 1.7"/><path class="hot-file-icon-asset-gem" d="m8 6 2.3 1.4v2.8L8 11.6l-2.3-1.4V7.4Z"/>';
        }
        if (presentation.iconKind === "material") {
          return '<circle class="hot-file-icon-material-sphere" cx="8" cy="8" r="6"/><path class="hot-file-icon-material-shade" d="M8 2a6 6 0 0 1 0 12c2.2-2.8 2.2-9.2 0-12Z"/><circle class="hot-file-icon-material-shine" cx="5.7" cy="5.2" r="1.2"/>';
        }
        if (presentation.iconKind === "terrain") {
          return '<path class="hot-file-icon-terrain" d="M1.6 12.8 4.6 6l2 2.3L9.2 3l5.2 9.8Z"/><path class="hot-file-icon-terrain-grid" d="M3 10.1h10M2.2 12h11.6M5.5 8.4l-1.3 4.4M9.1 6.4l1.7 6.4"/>';
        }
        if (presentation.iconKind === "lighting") {
          return '<circle class="hot-file-icon-light-sun" cx="8" cy="8" r="3.1"/><path class="hot-file-icon-light-rays" d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"/>';
        }
        if (presentation.iconKind === "input") {
          return '<path class="hot-file-icon-controller" d="M4.5 5.1h7c1 0 1.5.7 1.8 1.6l1.1 3.6c.5 1.7-1.6 2.6-2.6 1.2l-1.1-1.6H5.3l-1.1 1.6c-1 1.4-3.1.5-2.6-1.2l1.1-3.6c.3-.9.8-1.6 1.8-1.6Z"/><path class="hot-file-icon-controller-mark" d="M4.1 7.7h2.5M5.35 6.45V9M10.6 7.1h.1M12 8.4h.1"/>';
        }
        if (presentation.iconKind === "ui") {
          return '<rect class="hot-file-icon-ui-window" x="1.8" y="2.3" width="12.4" height="11.4" rx="1"/><path class="hot-file-icon-ui-head" d="M1.8 5h12.4M4.2 2.6v2.1"/><path class="hot-file-icon-ui-panels" d="M3.2 6.5h3.2v5.7H3.2zm4.7 0h4.8v2H7.9zm0 3.3h4.8v2.4H7.9z"/>';
        }
        if (presentation.iconKind === "metadata") {
          return '<path class="hot-file-icon-paper-shadow" d="M3 1.5h6.7l3.3 3.3v9.7H3z" transform="translate(.45 .55)"/><path class="hot-file-icon-paper" d="M3 1.5h6.7l3.3 3.3v9.7H3z"/><path class="hot-file-icon-fold" d="M9.7 1.7v3.2h3.1"/><path class="hot-file-icon-tag" d="M4.2 7h4.4l2.7 2.7-3.7 3.7-3.4-3.4Z"/><circle class="hot-file-icon-tag-hole" cx="5.7" cy="8.5" r=".65"/>';
        }
        if (presentation.iconKind === "solution") {
          return '<path class="hot-file-icon-solution-link" d="M5.2 5.1h5.6M5.2 10.9h5.6M4 6.2v3.6M12 6.2v3.6"/><rect class="hot-file-icon-solution-block" x="1.6" y="2.1" width="4.4" height="4" rx=".7"/><rect class="hot-file-icon-solution-block" x="10" y="2.1" width="4.4" height="4" rx=".7"/><rect class="hot-file-icon-solution-block" x="1.6" y="9.9" width="4.4" height="4" rx=".7"/><rect class="hot-file-icon-solution-block" x="10" y="9.9" width="4.4" height="4" rx=".7"/>';
        }
        if (presentation.iconKind === "project") {
          return '<path class="hot-file-icon-cube" d="M8 1.6 14 4.8v6.4L8 14.4l-6-3.2V4.8Z"/><path class="hot-file-icon-cube-lines" d="M2.4 5 8 8l5.6-3M8 8v6"/>';
        }
        if (presentation.iconKind === "executable") {
          return '<rect class="hot-file-icon-app-window" x="1.7" y="2.2" width="12.6" height="11.6" rx="1.4"/><path class="hot-file-icon-app-head" d="M1.8 5h12.4M4.2 2.6v2.1"/><path class="hot-file-icon-app-play" d="m6.3 6.6 4.2 2.4-4.2 2.4Z"/>';
        }
        if (presentation.iconKind === "library") {
          return '<path class="hot-file-icon-library-back" d="M4 1.8h8v10H4Z"/><path class="hot-file-icon-library-front" d="M2 4.2h8v10H2Z"/><path class="hot-file-icon-library-link" d="M4.1 8.2h3.8M4.1 10.2h3.8"/>';
        }
        if (presentation.iconKind === "binary") {
          return '<path class="hot-file-icon-chip" d="M4 2h8v2h2v8h-2v2H4v-2H2V4h2Z"/><path class="hot-file-icon-chip-lines" d="M5.2 5.2h2v5.6h-2M9 5.2h2v5.6H9"/>';
        }
        return '<path class="hot-file-icon-paper-shadow" d="M3 1.5h6.7l3.3 3.3v9.7H3z" transform="translate(.45 .55)"/><path class="hot-file-icon-paper" d="M3 1.5h6.7l3.3 3.3v9.7H3z"/><path class="hot-file-icon-fold" d="M9.7 1.7v3.2h3.1"/><path class="hot-file-icon-paper-lines" d="M4.5 7h6.8M4.5 9h5.3M4.5 11h6"/>';
      }

      function hotFileChangeBadgeSvg(changeKind) {
        if (changeKind === "added") return '<circle class="hot-file-change-badge is-added" cx="14" cy="14" r="1.85"/><path class="hot-file-change-mark" d="M14 13v2M13 14h2"/>';
        if (changeKind === "deleted") return '<circle class="hot-file-change-badge is-deleted" cx="14" cy="14" r="1.85"/><path class="hot-file-change-mark" d="M13 14h2"/>';
        if (changeKind === "renamed") return '<circle class="hot-file-change-badge is-renamed" cx="14" cy="14" r="1.85"/><path class="hot-file-change-mark" d="M13 14h2m-.8-.8.8.8-.8.8"/>';
        if (changeKind === "mixed") return '<circle class="hot-file-change-badge is-mixed" cx="14" cy="14" r="1.85"/><path class="hot-file-change-mark" d="m13.3 13.3 1.4 1.4m0-1.4-1.4 1.4"/>';
        return '<circle class="hot-file-change-badge is-modified" cx="14" cy="14" r="1.85"/><path class="hot-file-change-mark" d="m13.2 14.6.2-.8 1-1 .6.6-1 1z"/>';
      }

      function renderHotFileIcon(entry, className) {
        const presentation = hotChangePresentation(entry);
        const classes = ["hot-file-format-icon", "is-" + presentation.family, "is-" + presentation.iconKind, className || ""].filter(Boolean).join(" ");
        return '<svg class="' + escapeHtml(classes) + '" viewBox="0 0 16 16" focusable="false" aria-hidden="true" data-file-family="' + escapeHtml(presentation.family) + '" data-file-format="' + escapeHtml(presentation.fileFormat) + '" data-icon-kind="' + escapeHtml(presentation.iconKind) + '" style="--file-format-color:' + escapeHtml(presentation.formatColor) + ';--file-format-ink:' + escapeHtml(presentation.formatInk) + ';--file-format-label-color:' + escapeHtml(presentation.formatLabelColor) + ';--file-format-label-ink:' + escapeHtml(presentation.formatLabelInk) + ';--file-family-color:' + escapeHtml(presentation.color) + '">'
          + hotFileIconBodySvg(presentation)
          + hotFileChangeBadgeSvg(presentation.changeKind)
          + '</svg>';
      }
`;
