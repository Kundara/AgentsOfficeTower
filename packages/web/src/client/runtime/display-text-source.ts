export const CLIENT_RUNTIME_DISPLAY_TEXT_SOURCE = `
      function relativeLocation(projectRoot, location) {
        if (!location) return "";
        if (/^https?:\\/\\//.test(location)) return location;
        const root = String(projectRoot || "").split("\\\\").join("/").replace(/\\/+$/, "");
        const normalizedLocation = String(location).split("\\\\").join("/");
        const windowsRoot = (
          root.length >= 3 && root[1] === ":" && root[2] === "/"
        ) || root.startsWith("//");
        const comparableRoot = windowsRoot ? root.toLowerCase() : root;
        const comparableLocation = windowsRoot ? normalizedLocation.toLowerCase() : normalizedLocation;
        if (comparableLocation === comparableRoot) return ".";
        if (root && comparableLocation.startsWith(comparableRoot + "/")) {
          return normalizedLocation.slice(root.length + 1);
        }
        return normalizedLocation;
      }

      function wslToWindowsPath(location) {
        const normalized = String(location || "").trim();
        if (!normalized.startsWith("/mnt/") || normalized.length < 6) return normalized;
        const drive = normalized[5];
        const lowerDrive = drive.toLowerCase();
        if (lowerDrive < "a" || lowerDrive > "z") return normalized;
        const rest = normalized.startsWith("/mnt/" + drive + "/")
          ? normalized.slice(7)
          : normalized.length === 6 ? "" : null;
        if (rest === null) return normalized;
        const restWindows = String(rest).replaceAll("/", "\\\\");
        return restWindows ? drive.toUpperCase() + ":\\\\" + restWindows : drive.toUpperCase() + ":\\\\";
      }

      function stripDisplayMarkdown(value) {
        return String(value || "")
          .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, "$1")
          .replace(/(^|[\\s(>])(\\*\\*|__)(\\S(?:[\\s\\S]*?\\S)?)\\2(?=[\\s).,!?:;]|$)/g, "$1$3")
          .replace(/(^|[\\s(>])(\\*|_)(\\S(?:[\\s\\S]*?\\S)?)\\2(?=[\\s).,!?:;]|$)/g, "$1$3")
          .split(String.fromCharCode(96)).join("")
          .replace(/^#{1,6}\\s+/gm, "")
          .replace(/[ \\t]+/g, " ")
          .trim();
      }

      function replaceGoalCommandLabel(value) {
        return String(value || "").replace(/(^|[\\s(\\x5B\\x7B<"'])\\/goal(?=$|[\\s)\\]\\x7D,.!?:;"'>])/g, "$1🎯");
      }

      function normalizeDisplayText(projectRoot, value) {
        const normalized = String(value || "").trim();
        if (!normalized) return "";
        let displayText = replaceGoalCommandLabel(stripDisplayMarkdown(normalized));
        if (!displayText) return "";
        const isPathBoundary = (character) => {
          if (!character) return true;
          const code = character.charCodeAt(0);
          return (
            code === 32 || code === 9 || code === 10 || code === 13 ||
            code === 34 || code === 39 || code === 40 || code === 41 ||
            code === 44 || code === 58 || code === 59 || code === 60 ||
            code === 62 || code === 63 || code === 91 || code === 92 ||
            code === 93 || code === 123 || code === 124 || code === 125 || code === 33
          );
        };
        let root = String(projectRoot || "").trim();
        while (root.length > 1 && (root.endsWith("/") || root.endsWith("\\\\"))) root = root.slice(0, -1);
        if (root.length > 1) {
          const windowsRoot = (
            root.length >= 3 && root[1] === ":" && (root[2] === "/" || root[2] === "\\\\")
          ) || root.startsWith("\\\\\\\\");
          const rootVariants = Array.from(new Set([
            root,
            root.split("\\\\").join("/"),
            root.split("/").join("\\\\")
          ])).sort((left, right) => right.length - left.length);
          const stripRootVariant = (text, rootVariant) => {
            const separator = rootVariant.includes("\\\\") ? "\\\\" : "/";
            const needle = rootVariant + separator;
            const searchableText = windowsRoot ? text.toLowerCase() : text;
            const searchableNeedle = windowsRoot ? needle.toLowerCase() : needle;
            let output = "";
            let cursor = 0;
            while (cursor < text.length) {
              const next = searchableText.indexOf(searchableNeedle, cursor);
              if (next === -1) {
                output += text.slice(cursor);
                break;
              }
              if (!isPathBoundary(next > 0 ? text[next - 1] : "")) {
                output += text.slice(cursor, next + 1);
                cursor = next + 1;
                continue;
              }
              output += text.slice(cursor, next);
              cursor = next + needle.length;
            }
            return output;
          };
          const comparableDisplayText = windowsRoot ? displayText.toLowerCase() : displayText;
          if (rootVariants.some((variant) => comparableDisplayText === (windowsRoot ? variant.toLowerCase() : variant))) {
            displayText = ".";
          } else {
            rootVariants.forEach((variant) => { displayText = stripRootVariant(displayText, variant); });
          }
        }
        let output = "";
        let index = 0;
        while (index < displayText.length) {
          const next = displayText.indexOf("/mnt/", index);
          if (next === -1) {
            output += displayText.slice(index);
            break;
          }
          const previousChar = next > 0 ? displayText[next - 1] : "";
          if (!isPathBoundary(previousChar)) {
            output += displayText.slice(index, next + 5);
            index = next + 5;
            continue;
          }
          let end = next + 5;
          while (end < displayText.length && !isPathBoundary(displayText[end])) end += 1;
          const candidate = displayText.slice(next, end);
          const cleaned = cleanReportedPath(projectRoot, candidate);
          output += displayText.slice(index, next) + (cleaned || wslToWindowsPath(candidate));
          index = end;
        }
        return output;
      }`;
