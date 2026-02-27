const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/i;

function strip(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function htmlToPlainMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => "\n" + "#".repeat(+l) + " " + strip(t) + "\n")
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `**${strip(c)}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `_${strip(c)}_`)
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => `[${strip(t)}](${h})`)
    .replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, (_, a) => a ? `_${a}_` : "")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${strip(c)}\n`)
    .replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, (_, c) => `**${strip(c)}**  `)
    .replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, (_, c) => strip(c) + "  ")
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, c) => strip(c).replace(/\s+/g, " ").trim() + "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => "\n" + strip(c) + "\n")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => "\n> " + strip(c) + "\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => "`" + strip(c) + "`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n```\n" + strip(c) + "\n```\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default {
  async fetch(request: Request): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      const { searchParams } = new URL(request.url);
      const target = searchParams.get("url");
      const regexParam = searchParams.get("regex");

      // Validate `url`
      if (!target) {
        return new Response("Missing `url` param", { status: 400 });
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
        if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error();
      } catch {
        return new Response("Invalid `url` param", { status: 400 });
      }

      // SSRF protection
      if (BLOCKED_HOSTS.test(targetUrl.hostname)) {
        return new Response("Forbidden target", { status: 403 });
      }

      // Strip CF/proxy headers before forwarding
      const forwardHeaders = new Headers(request.headers);
      for (const h of ["host", "cf-connecting-ip", "cf-ray", "cf-ipcountry", "cf-visitor"]) {
        forwardHeaders.delete(h);
      }

      // Fetch remote page
      const remoteResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body as BodyInit,
        redirect: "follow",
      });

      // ── No regex → plain proxy pass-through ─────────────────────────────
      if (!regexParam) {
        const headers = new Headers(remoteResponse.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(remoteResponse.body, {
          status: remoteResponse.status,
          statusText: remoteResponse.statusText,
          headers,
        });
      }

      // ── regex present → extract HTML + convert to Markdown ───────────────
      let filterRegex: RegExp;
      try {
        filterRegex = new RegExp(regexParam, "gis");
      } catch {
        return new Response("Invalid `regex` param: not a valid regular expression", { status: 400 });
      }

      const contentType = remoteResponse.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return new Response("Target did not return HTML", { status: 415 });
      }

      const html = await remoteResponse.text();
      const matches = [...html.matchAll(filterRegex)];

      if (matches.length === 0) {
        return new Response("No matches found for the provided regex", { status: 404 });
      }

      const matchedHtml = matches.map((m) => m[0]).join("\n");
      const markdown = htmlToPlainMarkdown(matchedHtml);

      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
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
