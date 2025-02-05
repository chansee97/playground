<route lang="json">
{
  "meta": {
    "file": "/webgl/03.vue"
  }
}
</route>

<script setup>
function randomColor() {
  return {
    r: Math.random() * 255,
    g: Math.random() * 255,
    b: Math.random() * 255,
    a: Math.random() * 1,
  }
}

// 顶点着色器
const vertexShaderSource = `
//设置浮点数精度为中等精度
precision mediump float;
//接收点在 canvas 坐标系上的坐标 (x, y)
attribute vec2 a_Position;
// 接收 canvas 的尺寸(width, height)
attribute vec2 a_Screen_Size;
void main() {
  // 顶点坐标
  vec2 position = (a_Position / a_Screen_Size) * 2.0 - 1.0;
  position = position * vec2(1.0,-1.0);
  gl_Position = vec4(position, 0, 1);
  // 点的大小。
  gl_PointSize = 10.0;
}
`

// 片元着色器
const fragmentShaderSource = `
//设置浮点数精度为中等精度
precision mediump float;
//接收 JavaScript 传过来的颜色值（RGBA）。
uniform vec4 u_Color;
void main() {
  //将普通的颜色表示转化为 WebGL 需要的表示方式，即将【0-255】转化到【0,1】之间。
  vec4 color = u_Color / vec4(255, 255, 255, 1);
  gl_FragColor = color;
}
`

// 初始化webGL上下文
const canvas = useTemplateRef('canvas')

// 写入缓冲区
const positions = []

const lineType = ref('LINES')

let gl = null

function clearCanvas() {
  gl.clear(gl.COLOR_BUFFER_BIT)
  positions.length = 0
}
onMounted(() => {
  gl = canvas.value.getContext('webgl')

  // 渲染函数
  gl.clearColor(0, 0, 0, 1.0)
  function render(gl) {
    // 用上一步设置的清空画布颜色清空画布。
    gl.clear(gl.COLOR_BUFFER_BIT)
    // 因为我们要绘制 N 个点，所以执行 N 次顶点绘制操作。
    gl.drawArrays(gl[lineType.value], 0, positions.length / 2)
  }

  // 创建顶点着色器对象
  const vertexShader = gl.createShader(gl.VERTEX_SHADER)
  // 设置顶点着色器源码
  gl.shaderSource(vertexShader, vertexShaderSource)
  // 编译顶点着色器
  gl.compileShader(vertexShader)

  // 创建片元着色器对象
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
  // 设置片元着色器源码
  gl.shaderSource(fragmentShader, fragmentShaderSource)
  // 编译片元着色器
  gl.compileShader(fragmentShader)

  // 创建着色器程序对象
  const program = gl.createProgram()
  // 挂载顶点着色器
  gl.attachShader(program, vertexShader)
  // 挂载片元着色器
  gl.attachShader(program, fragmentShader)
  // 链接程序对象
  gl.linkProgram(program)

  // 使用程序对象
  gl.useProgram(program)

  const a_Position = gl.getAttribLocation(program, 'a_Position')
  const a_Screen_Size = gl.getAttribLocation(program, 'a_Screen_Size')
  const u_Color = gl.getUniformLocation(program, 'u_Color')

  gl.vertexAttrib2f(a_Screen_Size, canvas.value.width, canvas.value.height)

  // 绑定缓冲区
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  // 启用a_Position变量
  gl.enableVertexAttribArray(a_Position)

  // 每次取两个数据
  const size = 2
  // 每个数据的类型是32位浮点型
  const type = gl.FLOAT
  // 不需要归一化数据
  const normalize = false
  // 每次迭代运行需要移动数据数 * 每个数据所占内存 到下一个数据开始点。
  const stride = 0
  // 从缓冲起始位置开始读取
  const offset = 0
  // 将 a_Position 变量获取数据的缓冲区指向当前绑定的 buffer。
  gl.vertexAttribPointer(
    a_Position,
    size,
    type,
    normalize,
    stride,
    offset,
  )

  canvas.value.addEventListener('click', (e) => {
    const x = e.offsetX
    const y = e.offsetY
    positions.push(x, y)

    if (positions.length > 0) {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW)

      const color = randomColor()
      gl.uniform4f(u_Color, color.r, color.g, color.b, color.a)

      render(gl)
    }
  })

  render(gl)
})
</script>

<template>
  <n-flex justify="center" vertical>
    <n-radio-group v-model:value="lineType" name="radiogroup" @update:value="clearCanvas">
      <n-space>
        <n-radio value="LINES">
          基本线段
        </n-radio>
        <n-radio value="LINE_STRIP">
          带状线段
        </n-radio>
        <n-radio value="LINE_LOOP">
          环状线段
        </n-radio>
      </n-space>
    </n-radio-group>
    <canvas ref="canvas" width="1000" height="1000" />
  </n-flex>
</template>

<style scoped>

</style>
