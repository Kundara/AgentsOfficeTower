import { startWebServer } from "./server/server";

export { startWebServer };

if (require.main === module) {
  void startWebServer();
}
