/**
 * CodeMirror 语言包的按需加载。
 *
 * 这些语言包（11 个 `@codemirror/lang-*` + 20 多个 legacy mode）曾经被静态 import：
 * 一行代码都没有的文档也会把它们打进主 chunk；而 `core/index.ts` 是 barrel 全量导出，
 * 任何 `import { milkupSchema } from "@playground/demo-markdown/core"` 都会一并拖进来。
 * 改成动态 `import()` 之后每个语言各自成 chunk，用到才下载。
 *
 * 由于 CodeMirror 的语言是编译期扩展（`Compartment.reconfigure`），加载天然是异步的：
 * 调用方先挂空扩展，加载完成后在下一轮 reconfigure（并自行做「语言已变」的竞态保护）。
 */
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

const loadJs = () => import("@codemirror/lang-javascript").then((m) => m.javascript());
const loadTs = () =>
  import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true }));
const loadJsx = () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true }));
const loadTsx = () =>
  import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true }));
const loadPython = () => import("@codemirror/lang-python").then((m) => m.python());
const loadHtml = () => import("@codemirror/lang-html").then((m) => m.html());
const loadCss = () => import("@codemirror/lang-css").then((m) => m.css());
const loadJson = () => import("@codemirror/lang-json").then((m) => m.json());
const loadMarkdown = () => import("@codemirror/lang-markdown").then((m) => m.markdown());
const loadGo = () => import("@codemirror/lang-go").then((m) => m.go());
const loadJava = () => import("@codemirror/lang-java").then((m) => m.java());
const loadCpp = () => import("@codemirror/lang-cpp").then((m) => m.cpp());
const loadPhp = () => import("@codemirror/lang-php").then((m) => m.php());
const loadRust = () => import("@codemirror/lang-rust").then((m) => m.rust());
const loadSql = () => import("@codemirror/lang-sql").then((m) => m.sql());
const loadXml = () => import("@codemirror/lang-xml").then((m) => m.xml());
const loadYaml = () => import("@codemirror/lang-yaml").then((m) => m.yaml());

/** legacy mode 一律包成 StreamLanguage */
const legacy = <State>(load: () => Promise<StreamParser<State>>) => () =>
  load().then((mode) => StreamLanguage.define(mode));

/** 语言名（含别名）→ 按需加载器 */
const languageLoaders: Record<string, () => Promise<Extension>> = {
  javascript: loadJs,
  js: loadJs,
  typescript: loadTs,
  ts: loadTs,
  jsx: loadJsx,
  tsx: loadTsx,
  python: loadPython,
  py: loadPython,
  html: loadHtml,
  css: loadCss,
  json: loadJson,
  markdown: loadMarkdown,
  md: loadMarkdown,
  go: loadGo,
  golang: loadGo,
  java: loadJava,
  cpp: loadCpp,
  "c++": loadCpp,
  c: loadCpp,
  php: loadPhp,
  rust: loadRust,
  rs: loadRust,
  sql: loadSql,
  xml: loadXml,
  yaml: loadYaml,
  yml: loadYaml,
  ruby: legacy(() => import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby)),
  rb: legacy(() => import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby)),
  shell: legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell)),
  bash: legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell)),
  sh: legacy(() => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell)),
  csharp: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp)),
  "c#": legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp)),
  cs: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp)),
  kotlin: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.kotlin)),
  kt: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.kotlin)),
  scala: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.scala)),
  "objective-c": legacy(() =>
    import("@codemirror/legacy-modes/mode/clike").then((m) => m.objectiveC)
  ),
  objc: legacy(() => import("@codemirror/legacy-modes/mode/clike").then((m) => m.objectiveC)),
  swift: legacy(() => import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift)),
  dockerfile: legacy(() =>
    import("@codemirror/legacy-modes/mode/dockerfile").then((m) => m.dockerFile)
  ),
  toml: legacy(() => import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml)),
  r: legacy(() => import("@codemirror/legacy-modes/mode/r").then((m) => m.r)),
  lua: legacy(() => import("@codemirror/legacy-modes/mode/lua").then((m) => m.lua)),
  matlab: legacy(() => import("@codemirror/legacy-modes/mode/octave").then((m) => m.octave)),
  m: legacy(() => import("@codemirror/legacy-modes/mode/octave").then((m) => m.octave)),
  octave: legacy(() => import("@codemirror/legacy-modes/mode/octave").then((m) => m.octave)),
  perl: legacy(() => import("@codemirror/legacy-modes/mode/perl").then((m) => m.perl)),
  pl: legacy(() => import("@codemirror/legacy-modes/mode/perl").then((m) => m.perl)),
  powershell: legacy(() =>
    import("@codemirror/legacy-modes/mode/powershell").then((m) => m.powerShell)
  ),
  ps1: legacy(() => import("@codemirror/legacy-modes/mode/powershell").then((m) => m.powerShell)),
};

/** 语言扩展加载中的 Promise（同一语言只加载一次；promise 本身也当缓存） */
const languagePromises = new Map<string, Promise<Extension>>();
/** 已解析完成的语言扩展，供同步路径直接命中 */
const resolvedLanguageExtensions = new Map<string, Extension>();

/**
 * 按需加载语言扩展。
 *
 * 未知语言 / 加载失败都退化为「无扩展」，不影响编辑器本身可用。
 */
export function loadLanguageExtension(language: string): Promise<Extension> {
  const key = language.toLowerCase();
  const loader = languageLoaders[key];
  if (!loader) return Promise.resolve([]);

  let pending = languagePromises.get(key);
  if (!pending) {
    pending = loader()
      .catch(() => [] as Extension)
      .then((extension) => {
        resolvedLanguageExtensions.set(key, extension);
        return extension;
      });
    languagePromises.set(key, pending);
  }
  return pending;
}

/** 已经加载完成的语言扩展；未加载时返回 null（避免重复 import） */
export function peekLanguageExtension(language: string): Extension | null {
  return resolvedLanguageExtensions.get(language.toLowerCase()) ?? null;
}
