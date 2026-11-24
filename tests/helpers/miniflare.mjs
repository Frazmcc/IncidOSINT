import { Miniflare as CloudflareMiniflare, convertV4MiniflareOptions } from "miniflare";
export { WebSocketPair, Response } from "miniflare";

// Miniflare 5 uses worker configs. Keep the integration fixtures on Cloudflare's
// supported v4 adapter, including their real D1, Durable Object and fetch hooks.
export class Miniflare extends CloudflareMiniflare {
  constructor(options) {
    super(convertV4MiniflareOptions(options));
  }
}
