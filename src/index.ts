export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const incoming = new URL(request.url);
      const target = incoming.searchParams.get("url");
      if (!target) {
        return new Response("Missing required `url` query parameter", { status: 400 });
      }

      // Validate URL (basic)
      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
        if (!["http:", "https:"].includes(targetUrl.protocol)) {
          throw new Error("Invalid protocol");
        }
      } catch {
        return new Response("Invalid `url` parameter", { status: 400 });
      }

      console.log("Proxying to target:", targetUrl.toString());

      // Forward method, headers and body as-appropriate
      const init: RequestInit = {
        method: request.method,
        // Passing request.headers is usually fine; some runtimes restrict certain headers.
        headers: request.headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      };

      const remoteResponse = await fetch(targetUrl.toString(), init);
      console.log("Remote status:", remoteResponse.status);

      // Copy headers so Content-Type (image/png, etc.) is preserved
      const headers = new Headers(remoteResponse.headers);
      // Optional: allow cross-origin image use (if you need canvas access or cross-site loads)
      headers.set("Access-Control-Allow-Origin", "*");

      // Stream binary/text response back unchanged (do NOT call .text() for images)
      return new Response(remoteResponse.body, {
        status: remoteResponse.status,
        statusText: remoteResponse.statusText,
        headers,
      });
    } catch (err) {
      console.error("Proxy error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Proxy error: ${msg}`, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
