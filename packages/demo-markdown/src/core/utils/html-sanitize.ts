/**
 * HTML 块预览的**白名单式**清理策略。
 *
 * 为什么是白名单：之前是黑名单（危险标签 + `on*` + 少数几个 URL 属性），
 * 黑名单天然可绕过、而且补一个漏一个（`srcdoc` / `srcset` / `poster` / `background`
 * 当时就没在清单里）。白名单反过来：默认不可信，明确允许的才留下。
 *
 * 这里的决策全是纯函数，node 环境可直接单测；DOM 遍历与摘除在 `html-block.ts` 里做。
 *
 * 注意：这里的策略只作用于**预览渲染**，文档里的原文不受影响 ——
 * 编辑态的行内 HTML 走 schema 的 `SAFE_INLINE_TAGS` + `parseHtmlAttrs`，是另一条路径。
 */

/** 整块丢弃的标签（连内容一起：script/style 的内容不该以文本形式泄漏出来） */
const DROP_TAGS = new Set([
  // 脚本与样式
  "script",
  "style",
  "link",
  "meta",
  "base",
  "title",
  "head",
  // 嵌入与插件
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  // 表单控件（预览里没有提交语义）
  "form",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "fieldset",
  "legend",
  "label",
  "datalist",
  "output",
  "progress",
  "meter",
  // 其它可执行 / 可脱离文档流的
  "template",
  "slot",
  "noscript",
  "svg",
  "math",
  "canvas",
]);

/** 允许保留的标签；不在这里、也不在 DROP_TAGS 里的（未知/自定义标签）拆壳保内容 */
const ALLOWED_TAGS = new Set([
  // 结构
  "p",
  "div",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "br",
  "wbr",
  "blockquote",
  // 行内文本
  "a",
  "b",
  "i",
  "em",
  "strong",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "small",
  "sub",
  "sup",
  "code",
  "pre",
  "kbd",
  "var",
  "samp",
  "q",
  "cite",
  "abbr",
  "dfn",
  "time",
  "data",
  "bdi",
  "bdo",
  "ruby",
  "rt",
  "rp",
  "font",
  // 列表
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  // 表格
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "col",
  "colgroup",
  // 媒体
  "img",
  "picture",
  "source",
  "figure",
  "figcaption",
  "video",
  "audio",
  "track",
  // 交互披露
  "details",
  "summary",
]);

/** 允许保留的属性（URL 类属性另做协议检查） */
const ALLOWED_ATTRS = new Set([
  "class",
  "id",
  "style",
  "title",
  "lang",
  "dir",
  "align",
  "width",
  "height",
  "colspan",
  "rowspan",
  "span",
  "start",
  "reversed",
  "type",
  "href",
  "src",
  "srcset",
  "poster",
  "background",
  "cite",
  "alt",
  "target",
  "rel",
  "datetime",
  "open",
  "controls",
  "loop",
  "muted",
  "preload",
  "autoplay",
  "playsinline",
  "loading",
]);

/** 值是 URL 的属性：协议需要检查 */
const URL_ATTRS = new Set(["href", "src", "srcset", "poster", "background", "cite"]);

/** 危险协议 */
const DANGEROUS_URL_RE = /^(javascript|vbscript|data)\s*:/i;

/**
 * 判断 URL 是否危险。
 *
 * 浏览器会忽略 scheme 里的空白与控制字符（`java\tscript:` 是合法的 javascript: URL），
 * 所以先归一化再比对。`data:image/*` 放行 —— 那是行内图片的常见写法；
 * `data:image/svg+xml` 例外，SVG 可以内嵌脚本。
 */
export function isDangerousUrl(value: string): boolean {
  const normalized = value.replace(/[\s\u0000-\u0020]/g, "");
  if (/^data:image\/(?!svg)/i.test(normalized)) return false;
  return DANGEROUS_URL_RE.test(normalized);
}

/** 标签的处理策略 */
export type TagPolicy = "keep" | "drop" | "unwrap";

/**
 * 标签分类：
 *   - `drop`   整块丢弃（含内容）
 *   - `keep`   保留并过滤属性
 *   - `unwrap` 拆壳保内容（未知 / 自定义标签：预览里不渲染，但内容不丢）
 */
export function classifyTag(tag: string): TagPolicy {
  const key = tag.toLowerCase();
  if (DROP_TAGS.has(key)) return "drop";
  return ALLOWED_TAGS.has(key) ? "keep" : "unwrap";
}

export interface RawAttribute {
  name: string;
  value: string;
}

/**
 * 过滤一个元素的属性：
 *   - 不在白名单里的一律移除（`srcdoc` / `on*` / `formaction` … 因此天然被挡掉）
 *   - URL 属性做协议检查
 *   - `target` 非 `_self` 时强制补 `noopener noreferrer`（防 reverse tabnabbing）
 *
 * 属性名统一小写返回（HTML 属性名大小写不敏感，DOM 里本来就是小写）。
 */
export function sanitizeAttributes(attrs: RawAttribute[]): RawAttribute[] {
  const out: RawAttribute[] = [];
  let hasTarget = false;

  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;
    if (URL_ATTRS.has(name) && isDangerousUrl(attr.value)) continue;
    if (name === "target" && attr.value && attr.value !== "_self") hasTarget = true;
    out.push({ name, value: attr.value });
  }

  if (hasTarget) {
    const rel = out.find((attr) => attr.name === "rel");
    if (rel) {
      const tokens = rel.value.split(/\s+/).filter(Boolean);
      for (const token of ["noopener", "noreferrer"]) {
        if (!tokens.includes(token)) tokens.push(token);
      }
      rel.value = tokens.join(" ");
    } else {
      out.push({ name: "rel", value: "noopener noreferrer" });
    }
  }

  return out;
}
