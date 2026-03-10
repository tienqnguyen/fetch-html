const BLOCKED_HOSTS =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1|::ffff:127\.|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// ── Helpers ───────────────────────────────────────────────────────────────────

function strip(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/ {2,}/g, " ")
    .trim();
}

function htmlToPlainMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, l, t) => "\n" + "#".repeat(+l) + " " + strip(t) + "\n"
    )
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `**${strip(c)}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `_${strip(c)}_`)
    .replace(
      /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, h, t) => `[${strip(t)}](${h})`
    )
    .replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, (_, a) => (a ? `_${a}_` : ""))
    // ── Table → aligned markdown table ───────────────────────────────
    .replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
      const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      if (rows.length === 0) return "";

      const isHeader = (rowHtml: string) => /<th[^>]*>/i.test(rowHtml);

      const parsed: { cells: string[]; header: boolean }[] = rows.map((row) => {
        const cells = [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)];
        return {
          cells: cells.map((c) => strip(c[1])),
          header: isHeader(row[1]),
        };
      });

      const colCount = Math.max(...parsed.map((r) => r.cells.length));

      const normalized = parsed.map((r) => {
        const padded = [...r.cells];
        while (padded.length < colCount) padded.push("");
        return { cells: padded, header: r.header };
      });

      const widths = Array.from({ length: colCount }, (_, i) =>
        Math.max(...normalized.map((r) => (r.cells[i] ?? "").length), 3)
      );

      const formatRow = (cells: string[]) =>
        "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";

      const separator = "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";

      const lines: string[] = ["\n"];
      let separatorInserted = false;

      for (const row of normalized) {
        lines.push(formatRow(row.cells));
        // Insert separator after first header row (or after first row if no headers)
        if (!separatorInserted && (row.header || normalized.indexOf(row) === 0)) {
          lines.push(separator);
          separatorInserted = true;
        }
      }

      lines.push("\n");
      return lines.join("\n");
    })
    // ── Lists ─────────────────────────────────────────────────────────
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${strip(c)}\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => "\n" + strip(c) + "\n")
    .replace(
      /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_, c) => "\n> " + strip(c) + "\n"
    )
    // pre before code to avoid double-wrapping
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n```\n" + strip(c) + "\n```\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => "`" + strip(c) + "`")
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

function htmlTableToCsv(html: string): string {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [html];
  const allTables: string[] = [];

  for (const table of tables) {
    const rows: string[] = [];

    const captionMatch = table.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
    if (captionMatch) {
      rows.push(`# ${strip(captionMatch[1])}`);
    }

    const rowMatches = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (const row of rowMatches) {
      const cells: string[] = [];
      const cellMatches = [...row[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t[hd]>/gi)];

      for (const cell of cellMatches) {
        const isHeader = cell[1] === "h";
        let text = strip(cell[2]).replace(/"/g, '""');
        if (isHeader) text = text.toUpperCase();
        cells.push(`"${text}"`);
      }

      if (cells.length > 0) rows.push(cells.join(","));
    }

    if (rows.length > 0) allTables.push(rows.join("\n"));
  }

  return allTables.join("\n\n").trim();
}

async function extractWithSelector(html: string, selector: string): Promise<string[]> {
  const results: string[] = [];
  let current = "";

  const fakeResponse = new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await new HTMLRewriter()
    .on(selector, {
      element(el) {
        el.onEndTag(() => {
          const trimmed = current.trim();
          if (trimmed) results.push(trimmed);
          current = "";
        });
      },
      text(chunk) {
        current += chunk.text;
      },
    })
    .transform(fakeResponse)
    .text();

  return results.filter(Boolean);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function respond(
  body: string | null,
  status: number,
  contentType: string,
  extra: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      ...corsHeaders(),
      ...extra,
    },
  });
}

// ── Main Handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request): Promise<Response> {

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(),
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      const { searchParams } = new URL(request.url);
      const target        = searchParams.get("url");
      const regexParam    = searchParams.get("regex");
      const selectorParam = searchParams.get("selector");
      const format        = searchParams.get("format") ?? "markdown";

      // ── Validate params ──────────────────────────────────────────────────
      if (!target) {
        return respond("Missing `url` param", 400, "text/plain; charset=utf-8");
      }

      if (!["markdown", "json", "html", "csv"].includes(format)) {
        return respond(
          "`format` must be: markdown, json, html, or csv",
          400,
          "text/plain; charset=utf-8"
        );
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
        if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error();
      } catch {
        return respond("Invalid `url` param", 400, "text/plain; charset=utf-8");
      }

      if (BLOCKED_HOSTS.test(targetUrl.hostname)) {
        return respond("Forbidden target", 403, "text/plain; charset=utf-8");
      }

      // ── Forward request ──────────────────────────────────────────────────
      const forwardHeaders = new Headers(request.headers);
      for (const h of ["host", "cf-connecting-ip", "cf-ray", "cf-ipcountry", "cf-visitor"]) {
        forwardHeaders.delete(h);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      let remoteResponse: Response;
      try {
        remoteResponse = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: forwardHeaders,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body as BodyInit,
          redirect: "follow",
          signal: controller.signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return respond(`Fetch failed: ${msg}`, 502, "text/plain; charset=utf-8");
      } finally {
        clearTimeout(timer);
      }

      const contentType = remoteResponse.headers.get("content-type") ?? "";
      const isHtml = contentType.includes("text/html");

      // ── Pass-through (no regex, no selector) ─────────────────────────────
      if (!regexParam && !selectorParam) {
        const headers = new Headers(remoteResponse.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(remoteResponse.body, {
          status: remoteResponse.status,
          statusText: remoteResponse.statusText,
          headers,
        });
      }

      // ── Body size guard ──────────────────────────────────────────────────
      const buffer = await remoteResponse.arrayBuffer();
      if (buffer.byteLength > MAX_BYTES) {
        return respond("Response too large (limit: 5MB)", 413, "text/plain; charset=utf-8");
      }
      const body = new TextDecoder().decode(buffer);

      // ── Selector branch ──────────────────────────────────────────────────
      if (selectorParam) {
        if (!isHtml) {
          return respond(
            "CSS selector requires an HTML response",
            415,
            "text/plain; charset=utf-8"
          );
        }

        const items = await extractWithSelector(body, selectorParam);

        if (items.length === 0) {
          return respond("No matches found for selector", 404, "text/plain; charset=utf-8");
        }

        switch (format) {
          case "json":
            return respond(
              JSON.stringify({ total: items.length, items }, null, 2),
              200,
              "application/json; charset=utf-8"
            );

          case "csv": {
            const csv = items.map((v) => `"${v.replace(/"/g, '""')}"`).join("\n");
            return respond(csv, 200, "text/csv; charset=utf-8", {
              "Content-Disposition": 'attachment; filename="data.csv"',
            });
          }

          case "html":
            return respond(items.join("\n"), 200, "text/html; charset=utf-8");

          default: // markdown
            return respond(items.join("\n"), 200, "text/markdown; charset=utf-8");
        }
      }

      // ── Regex branch ─────────────────────────────────────────────────────
      let filterRegex: RegExp;
      try {
        filterRegex = new RegExp(regexParam!, "gis");
      } catch {
        return respond(
          "Invalid `regex` param: not a valid regular expression",
          400,
          "text/plain; charset=utf-8"
        );
      }

      const isTextBased =
        isHtml ||
        contentType.includes("xml") ||
        contentType.includes("text/plain");

      if (!isTextBased) {
        return respond(
          "Target did not return text-based content",
          415,
          "text/plain; charset=utf-8"
        );
      }

      const matches = [...body.matchAll(filterRegex)];

      if (matches.length === 0) {
        return respond(
          "No matches found for the provided regex",
          404,
          "text/plain; charset=utf-8"
        );
      }

      const extracted = matches
        .map((m) => (m[1] !== undefined ? m[1] : m[0]).trim())
        .filter(Boolean);

      const joined = extracted.join("\n");

      switch (format) {
        case "json":
          return respond(
            JSON.stringify({ total: extracted.length, items: extracted }, null, 2),
            200,
            "application/json; charset=utf-8"
          );

        case "html":
          return respond(joined, 200, "text/html; charset=utf-8");

        case "csv": {
          if (!isHtml) {
            return respond(
              "CSV format requires an HTML response",
              415,
              "text/plain; charset=utf-8"
            );
          }
          const csv = htmlTableToCsv(joined);
          if (!csv) {
            return respond("No table found in response", 404, "text/plain; charset=utf-8");
          }
          return respond(csv, 200, "text/csv; charset=utf-8", {
            "Content-Disposition": 'attachment; filename="table.csv"',
          });
        }

        default: { // markdown
          const markdown = isHtml ? htmlToPlainMarkdown(joined) : joined;
          return respond(markdown, 200, "text/markdown; charset=utf-8");
        }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return respond(`Proxy error: ${msg}`, 502, "text/plain; charset=utf-8");
    }
  },
};
