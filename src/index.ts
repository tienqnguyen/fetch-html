const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/i;

export default {
  async fetch(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      const incoming = new URL(request.url);
      const target = incoming.searchParams.get("url");
      if (!target) {
        return new Response("Missing required `url` query parameter", { status: 400 });
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
        if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error();
      } catch {
        return new Response("Invalid `url` parameter", { status: 400 });
      }

      // SSRF protection
      if (BLOCKED_HOSTS.test(targetUrl.hostname)) {
        return new Response("Forbidden target", { status: 403 });
      }

      // Strip problematic headers
      const forwardHeaders = new Headers(request.headers);
      for (const h of ["host", "cf-connecting-ip", "cf-ray", "cf-ipcountry", "cf-visitor"]) {
        forwardHeaders.delete(h);
      }

      const remoteResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body as BodyInit,
        redirect: "follow",
      });

      const headers = new Headers(remoteResponse.headers);
      headers.set("Access-Control-Allow-Origin", "*");

      return new Response(remoteResponse.body, {
        status: remoteResponse.status,
        statusText: remoteResponse.statusText,
        headers,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Proxy error: ${msg}`, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
