---
title: 所见即所得 Markdown 编辑器
tags: [markdown, prosemirror, editor]
author: Playground
---

# 一级标题

## 二级标题

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

Setext 一级标题
===============

Setext 二级标题
---------------

## 段落与换行

这一段演示软换行：源码里写成两行，
渲染后属于同一个段落。

这一段演示硬换行，行尾两个空格会强制换行，
所以这一行是新的视觉行。

行尾反斜杠同样可以强制换行，\
所以这一行也是新的视觉行。

## 引用

> 普通引用块的第一段。
>
> 引用块里的第二段。

> 嵌套引用：
> > 内层引用的内容。

> [!NOTE]
> NOTE 类型的告示块。

> [!TIP]
> TIP 类型的告示块。

> [!IMPORTANT]
> IMPORTANT 类型的告示块。

> [!WARNING]
> WARNING 类型的告示块。

> [!CAUTION]
> CAUTION 类型的告示块。

## 列表

> 注意：CommonMark 里空行不会终止列表，只会让列表变「松散」。
> 因此下面每段列表之间都用一段说明文字隔开，避免被合并成同一个列表。

用 `-` 作为符号的无序列表：

- 无序列表第一项
- 无序列表第二项

用 `*` 作为符号的无序列表：

* 星号作为列表符号

用 `+` 作为符号的无序列表：

+ 加号作为列表符号

有序列表：

1. 有序列表第一项
2. 有序列表第二项

自定义起始序号与右括号分隔符：

3) 右括号分隔符与自定义起始序号

嵌套列表：

- 一级列表项
  - 二级列表项
    - 三级列表项
- 回到一级

松散列表（项之间有空行）：

- 松散列表第一项

- 松散列表第二项

任务列表：

- [x] 已完成的任务
- [ ] 待办的任务

松散任务列表：

- [x] 已完成的任务

- [ ] 待办的任务

## 行内格式

- **粗体** 与 __下划线粗体__
- *斜体* 与 _下划线斜体_
- ***粗斜体***
- ~~删除线~~ 与 ~单波浪删除线~
- ==高亮==
- `行内代码` 与 ``含反引号 ` 的代码``
- [双引号标题链接](https://prosemirror.net "结构化文档编辑框架")
- [单引号标题链接](https://prosemirror.net '结构化文档编辑框架')
- 自动链接 <https://example.com> 与裸链接 https://example.com
- 下标 H<sub>2</sub>O，上标 x<sup>2</sup>
- 行内 HTML：<span style="color:#c41d7f;font-weight:600">这一段由 HTML 标签渲染</span>
- HTML 实体：&copy; &amp; &lt; &gt; &quot; &#169; &#x2764; &nbsp; &hearts; &Delta;
- 转义字符：\* \_ \# \% \& \$ \~ \= \` \[ \] \< \>

## 数学公式

行内公式 $E = mc^2$ 与 $\sum_{i=1}^{n} i$ 都支持。

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

## 表格

| 左对齐 | 居中 | 右对齐 | 默认 |
| :--- | :---: | ---: | --- |
| 内容 | 内容 | 内容 | 内容 |
| 单元格内换行 | 第一行<br>第二行 | 转义竖线 a \| b | 行内格式 **粗体** |

## 代码块

```typescript
interface Editor {
  getMarkdown(): string
  setMarkdown(markdown: string): void
}

export function createEditor(host: HTMLElement): Editor {
  return new MilkupEditor(host)
}
```

```js title=demo.js
console.log('带 info string 的围栏代码块')
```

~~~python
print("波浪围栏代码块")
~~~

    // 缩进式代码块（4 个空格）
    const answer = 42

```mermaid
graph LR
  A[Markdown 文本] --> B[结构判定]
  B --> C[标记切分]
  C --> D[即时渲染]
```

## 分隔线

下面是三种等价写法：

---

***

___

## HTML 块

<div class="callout">
  <strong>原始 HTML 块</strong>会原样保留，
  不会污染 Markdown 的块级结构。
</div>

## 图片

![独立图片](https://placehold.co/720x200/png?text=Markdown+Editor "图片标题")

[![链接图片](https://placehold.co/260x90/png?text=Linked+Image)](https://prosemirror.net)

![连续图片一](https://placehold.co/140x60/png?text=1)![连续图片二](https://placehold.co/140x60/png?text=2)

图片是行内块，可以和文字混排：文字 ![混排小图](https://placehold.co/90x40/png?text=Inline) 之后还能继续写，前后都不会断行。

## 引用与脚注

引用式链接：[ProseMirror 官网][prosemirror] 与 [内核文档][docs]。
脚注引用：Markdown 规范见 CommonMark[^spec]。

[prosemirror]: https://prosemirror.net "结构化文档编辑框架"
[docs]: https://prosemirror.net/docs/
[^spec]: CommonMark 规范：https://commonmark.org
