import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CLIENT_STYLES = readFileSync(resolve(__dirname, "client/styles.css"), "utf8");
