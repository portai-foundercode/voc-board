import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { createApi } from "./api/app";

const api = createApi();

export default createServerEntry({
  fetch(request) {
    const { pathname } = new URL(request.url);
    return pathname.startsWith("/api/") ? api.fetch(request) : handler.fetch(request);
  },
});
