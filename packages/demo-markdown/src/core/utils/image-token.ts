/**
 * 图片 Markdown token 解析（`![alt](src "title")` 与 `[![alt](src)](href "linkTitle")`）。
 *
 * 消费方：syntax-detector —— 打字 / 粘贴时给这些文本区间打上 image mark。
 */

/** 文本里的一个图片 token */
export interface ImageToken {
  /** 在源文本中的起点（字符偏移） */
  from: number;
  /** 在源文本中的终点（不含） */
  to: number;
  alt: string;
  src: string;
  title: string;
  linkHref: string;
  linkTitle: string;
}

const LINKED_IMAGE_PATTERN =
  /\[!\[([^\]]*)\]\((.+?)(?:\s+"([^"]*)")?\)\]\((.+?)(?:\s+"([^"]*)")?\)/y;
const NORMAL_IMAGE_PATTERN = /!\[([^\]]*)\]\((.+?)(?:\s+"([^"]*)")?\)/y;

/**
 * 扫出文本里的所有图片 token。
 *
 * 链接图片优先于普通图片匹配，避免 `[![a](1)](2)` 被拆成 `[` + `![a](1)` 两半。
 */
export function findImageTokens(text: string): ImageToken[] {
  const tokens: ImageToken[] = [];
  let index = 0;

  while (index < text.length) {
    LINKED_IMAGE_PATTERN.lastIndex = index;
    const linked = LINKED_IMAGE_PATTERN.exec(text);
    if (linked) {
      tokens.push({
        from: index,
        to: LINKED_IMAGE_PATTERN.lastIndex,
        alt: linked[1] || "",
        src: linked[2] || "",
        title: linked[3] || "",
        linkHref: linked[4] || "",
        linkTitle: linked[5] || "",
      });
      index = LINKED_IMAGE_PATTERN.lastIndex;
      continue;
    }

    NORMAL_IMAGE_PATTERN.lastIndex = index;
    const normal = NORMAL_IMAGE_PATTERN.exec(text);
    if (normal) {
      tokens.push({
        from: index,
        to: NORMAL_IMAGE_PATTERN.lastIndex,
        alt: normal[1] || "",
        src: normal[2] || "",
        title: normal[3] || "",
        linkHref: "",
        linkTitle: "",
      });
      index = NORMAL_IMAGE_PATTERN.lastIndex;
      continue;
    }

    index++;
  }

  return tokens;
}
