<route lang="json">
{
  "meta": {
    "file": "/webgl/01.vue"
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
//接收 canvas 的宽高尺寸
attribute vec2 a_Screen_Size;
void main() {
  // 顶点坐标
  //start 将屏幕坐标系转化为裁剪坐标（裁剪坐标系）
  vec2 position = (a_Position / a_Screen_Size) * 2.0 - 1.0;
  position = position * vec2(1.0, -1.0);
  gl_Position = vec4(position, 0, 1);
  // 顶点位置
  gl_PointSize = 20.0;
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

onMounted(() => {
  const gl = canvas.value.getContext('webgl')

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

  // 设置清空画布颜色为灰色
  gl.clearColor(0, 0, 0, 1.0)
  // 清空画布
  gl.clear(gl.COLOR_BUFFER_BIT)

  // 找到顶点着色器中的变量a_Position
  const a_Position = gl.getAttribLocation(program, 'a_Position')
  // 找到顶点着色器中的变量a_Screen_Size
  const a_Screen_Size = gl.getAttribLocation(program, 'a_Screen_Size')
  // 找到片元着色器中的变量u_Color
  const u_Color = gl.getUniformLocation(program, 'u_Color')
  // 为顶点着色器中的 a_Screen_Size 传递 canvas 的宽高信息
  gl.vertexAttrib2f(a_Screen_Size, canvas.value.width, canvas.value.height)
  // 存储点击位置的数组。
  const points = []
  canvas.value.addEventListener('click', (e) => {
    const x = e.offsetX
    const y = e.offsetY
    const color = randomColor()
    points.push({ x, y, color })
    // 用上一步设置的清空画布颜色清空画布。
    gl.clear(gl.COLOR_BUFFER_BIT)
    for (let i = 0; i < points.length; i++) {
      const color = points[i].color
      // 为片元着色器中的 u_Color 传递随机颜色
      gl.uniform4f(u_Color, color.r, color.g, color.b, color.a)
      // 为顶点着色器中的 a_Position 传递顶点坐标。
      gl.vertexAttrib2f(a_Position, points[i].x, points[i].y)
      // 绘制点
      gl.drawArrays(gl.POINTS, 0, 1)
    }
  })
})
</script>

<template>
  <n-flex justify="center">
    <canvas ref="canvas" width="1000" height="1000" />
  </n-flex>
</template>

<style scoped>

</style>
