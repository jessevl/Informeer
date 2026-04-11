// OPML generation and parsing

interface OPMLFeed {
  title: string;
  feedUrl: string;
  siteUrl: string;
  category: string;
}

/** Generate OPML XML from a list of feeds */
export function generateOPML(feeds: OPMLFeed[]): string {
  const categories = new Map<string, OPMLFeed[]>();
  for (const feed of feeds) {
    const cat = feed.category || 'Uncategorized';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(feed);
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head><title>Informeer Feeds</title></head>',
    '  <body>',
  ];

  for (const [category, catFeeds] of categories) {
    lines.push(`    <outline text="${escapeXml(category)}" title="${escapeXml(category)}">`);
    for (const feed of catFeeds) {
      lines.push(
        `      <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.feedUrl)}" htmlUrl="${escapeXml(feed.siteUrl)}" />`
      );
    }
    lines.push('    </outline>');
  }

  lines.push('  </body>', '</opml>');
  return lines.join('\n');
}

/** Parse OPML XML into a list of feeds with categories.
 *  Uses a nesting-aware parser to correctly handle both self-closing
 *  (`<outline ... />`) and paired (`<outline ...>...</outline>`) tags. */
export function parseOPML(xml: string): OPMLFeed[] {
  const feeds: OPMLFeed[] = [];

  // Extract the <body> content
  const bodyMatch = /<body>([\s\S]*)<\/body>/i.exec(xml);
  if (!bodyMatch) return feeds;
  const body = bodyMatch[1];

  // Build a tree of outline nodes by tracking open/close/self-closing tags
  interface OutlineNode { attrs: string; children: OutlineNode[] }

  const tagRegex = /<outline\b([^>]*?)\/\s*>|<outline\b([^>]*?)>|<\/outline\s*>/gi;
  const stack: OutlineNode[] = [];
  const topLevel: OutlineNode[] = [];
  let m: RegExpExecArray | null;

  while ((m = tagRegex.exec(body)) !== null) {
    if (m[1] !== undefined) {
      // Self-closing: <outline ... />
      const node: OutlineNode = { attrs: m[1], children: [] };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        topLevel.push(node);
      }
    } else if (m[2] !== undefined) {
      // Opening: <outline ...>
      const node: OutlineNode = { attrs: m[2], children: [] };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        topLevel.push(node);
      }
      stack.push(node);
    } else {
      // Closing: </outline>
      stack.pop();
    }
  }

  // Walk the tree: top-level nodes with xmlUrl are standalone feeds,
  // top-level nodes with children are categories.
  for (const node of topLevel) {
    const xmlUrl = extractAttr(node.attrs, 'xmlUrl');
    if (xmlUrl) {
      feeds.push({
        title: unescapeXml(extractAttr(node.attrs, 'title') || extractAttr(node.attrs, 'text') || ''),
        feedUrl: unescapeXml(xmlUrl),
        siteUrl: unescapeXml(extractAttr(node.attrs, 'htmlUrl') || ''),
        category: '',
      });
    } else if (node.children.length > 0) {
      const category = unescapeXml(extractAttr(node.attrs, 'text') || extractAttr(node.attrs, 'title') || '');
      for (const child of node.children) {
        const childXmlUrl = extractAttr(child.attrs, 'xmlUrl');
        if (childXmlUrl) {
          feeds.push({
            title: unescapeXml(extractAttr(child.attrs, 'title') || extractAttr(child.attrs, 'text') || ''),
            feedUrl: unescapeXml(childXmlUrl),
            siteUrl: unescapeXml(extractAttr(child.attrs, 'htmlUrl') || ''),
            category,
          });
        }
      }
    }
  }

  return feeds;
}

function extractAttr(tag: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`, 'i');
  const m = re.exec(tag);
  return m ? m[1] : '';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
