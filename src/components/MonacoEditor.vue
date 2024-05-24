<script setup lang="ts">
import * as monaco from 'monaco-editor'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

interface Props {
  width?: string
  height?: string
  language?: string
}

const props = withDefaults(defineProps<Props>(), {
  width: '100%',
  height: '100%',
  language: 'javascript',
})

let editor: monaco.editor.IStandaloneCodeEditor
const editorRef = ref()

const code = defineModel<string>('value')

function initEditor() {
  window.MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'json')
        return new JsonWorker()

      if (['css', 'scss', 'less'].includes(label))
        return new CssWorker()

      if (['html', 'handlebars', 'razor'].includes(label))
        return new HtmlWorker()

      if (['typescript', 'javascript'].includes(label))
        return new TsWorker()

      return new EditorWorker()
    },
  }

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  })
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2016,
    allowNonTsExtensions: true,
  })

  editor = monaco.editor.create(editorRef.value, {
    value: code.value,
    language: props.language,
    // Enable that the editor will install a ResizeObserver to check if its container dom node size has changed.
    automaticLayout: true,
    // Enable that scrolling can go one screen size after the last line.
    scrollBeyondLastLine: false,
    // 代码颜色主题
    theme: 'vs-dark',
    overviewRulerBorder: false, // 不要滚动条的边框
    renderLineHighlight: 'all', // 行亮
    cursorBlinking: 'expand',
    cursorSmoothCaretAnimation: 'on', // 光标动画
    tabSize: 2,
    // 缩略图
    minimap: {
      enabled: false,
    },
  })

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
    editor.getAction('editor.action.formatDocument')?.run()
  })

  // 监听值的变化
  editor.onDidChangeModelContent(() => {
    const value = editor.getValue() // 给父组件实时返回最新文本
    code.value = value
  })
}

watch(
  () => code.value,
  (newValue) => {
    if (editor) {
      const value = editor.getValue()
      if (newValue !== value)
        editor.setValue(newValue || '')
    }
  },
)

onMounted(() => {
  initEditor()
})
onBeforeUnmount(() => {
  editor.dispose()
})
</script>

<template>
  <div class="editor-container">
    <p>{{ props.language }}</p>
    <div ref="editorRef" class="editor" />
  </div>
</template>

<style scoped>
.editor-container{
  width: v-bind(width);
  height: v-bind(height);
  display: flex;
  flex-direction: column;
}
.editor{
  flex:1;
}
</style>
