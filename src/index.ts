const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/i;

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, c) => strip(c).trim() + "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => "\n" + strip(c) + "\n")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => "\n> " + strip(c) + "\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => "`" + strip(c) + "`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n```\n" + strip(c) + "\n```\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractWithSelector(html: string, selector: string): Promise<string[]> {
  const results: string[] = [];
  let current = "";

  const fakeResponse = new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await new HTMLRewriter()
    .on(selector, {
      text(chunk) {
        current += chunk.text;
        if (chunk.lastInTextNode) {
          const trimmed = current.trim();
          if (trimmed) results.push(trimmed);
          current = "";
        }
      },
    })
    .transform(fakeResponse)
    .text();

  return results.filter(Boolean);
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
      const target        = searchParams.get("url");
      const regexParam    = searchParams.get("regex");
      const selectorParam = searchParams.get("selector");  // NEW
      const format        = searchParams.get("format") ?? "markdown";

      // ── Validate params ──────────────────────────────────────────────
      if (!target) {
        return new Response("Missing `url` param", { status: 400 });
      }

      if (!["markdown", "json"].includes(format)) {
        return new Response("`format` must be: markdown or json", { status: 400 });
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
        if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error();
      } catch {
        return new Response("Invalid `url` param", { status: 400 });
      }

      if (BLOCKED_HOSTS.test(targetUrl.hostname)) {
        return new Response("Forbidden target", { status: 403 });
      }

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

      const contentType = remoteResponse.headers.get("content-type") ?? "";

      // ── No regex/selector → plain proxy pass-through ─────────────────
      if (!regexParam && !selectorParam) {
        const headers = new Headers(remoteResponse.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(remoteResponse.body, {
          status: remoteResponse.status,
          statusText: remoteResponse.statusText,
          headers,
        });
      }

      const body = await remoteResponse.text();

      // ── selector → HTMLRewriter (priority over regex) ─────────────────
      if (selectorParam) {
        if (!contentType.includes("text/html")) {
          return new Response("CSS selector requires an HTML response", { status: 415 });
        }

        const items = await extractWithSelector(body, selectorParam);

        if (items.length === 0) {
          return new Response("No matches found for selector", { status: 404 });
        }

        if (format === "json") {
          return new Response(
            JSON.stringify({ total: items.length, items }, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        return new Response(items.join("\n"), {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ── regex → extract + convert ─────────────────────────────────────
      let filterRegex: RegExp;
      try {
        filterRegex = new RegExp(regexParam!, "gis");
      } catch {
        return new Response("Invalid `regex` param: not a valid regular expression", { status: 400 });
      }

      const isTextBased =
        contentType.includes("text/html") ||
        contentType.includes("xml") ||
        contentType.includes("text/plain");

      if (!isTextBased) {
        return new Response("Target did not return text-based content", { status: 415 });
      }

      const matches = [...body.matchAll(filterRegex)];

      if (matches.length === 0) {
        return new Response("No matches found for the provided regex", { status: 404 });
      }

      const extracted = matches
        .map((m) => (m[1] !== undefined ? m[1] : m[0]).trim())
        .filter(Boolean);

      if (format === "json") {
        return new Response(
          JSON.stringify({ total: extracted.length, items: extracted }, null, 2),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      const joined = extracted.join("\n");
      const isHtml = contentType.includes("text/html");
      const markdown = isHtml ? htmlToPlainMarkdown(joined) : joined;

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
