export default {
  async fetch(request: Request): Promise<Response> {
    // Replace with the host you wish to proxy to (no trailing slash)
    const remoteOrigin = "https://example.com";

    // Build the remote URL by combining the remote origin with the incoming path+query
    const incoming = new URL(request.url);
    const remoteUrl = remoteOrigin.replace(/\/$/, "") + incoming.pathname + incoming.search;

    // Forward method, headers, and body (for non-GET/HEAD)
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    };

    const remoteResponse = await fetch(remoteUrl, init);

    // Copy headers from remote response and optionally add CORS so browser can load images
    const headers = new Headers(remoteResponse.headers);
    headers.set("Access-Control-Allow-Origin", "*"); // optional: change to your origin if needed

    // Stream the remote response back to the client (works for HTML, images, CSS, JS, etc.)
    return new Response(remoteResponse.body, {
      status: remoteResponse.status,
      statusText: remoteResponse.statusText,
      headers,
    });
  },
};
