<route lang="json">
{
  "meta": {
    "file": "/webgl/07.vue"
  }
}
</route>

<script setup>
import { createProgram, createShader, randomColor } from './webgl-helper'

// 顶点着色器
const vertexShaderSource = `
//设置浮点数精度为中等精度
precision mediump float;
//接收点在 canvas 坐标系上的坐标 (x, y)
attribute vec2 a_Position;
// 接收 canvas 的尺寸(width, height)
attribute vec2 a_Screen_Size;
attribute vec4 a_Color;
varying vec4 v_Color;
void main() {
  // 顶点坐标
  vec2 position = (a_Position / a_Screen_Size) * 2.0 - 1.0;
  position = position * vec2(1.0,-1.0);
  gl_Position = vec4(position, 0, 1);
  v_Color = a_Color;
}
`

// 片元着色器
const fragmentShaderSource = `
//设置浮点数精度为中等精度
precision mediump float;
//接收 JavaScript 传过来的颜色值（RGBA）。
varying vec4 v_Color;
void main() {
  //将普通的颜色表示转化为 WebGL 需要的表示方式，即将【0-255】转化到【0,1】之间。
  vec4 color = v_Color / vec4(255, 255, 255, 1);
  gl_FragColor = color;
}
`

// 初始化webGL上下文
const canvas = useTemplateRef('canvas')

function createRingVertex(x, y, innerRadius, outerRadius, n) {
  const positions = []
  let color = randomColor()
  for (let i = 0; i <= n; i++) {
    if (i % 2 === 0) {
      color = randomColor()
    }
    const angle = (i * Math.PI * 2) / n
    positions.push(
      x + innerRadius * Math.sin(angle),
      y + innerRadius * Math.cos(angle),
      color.r,
      color.g,
      color.b,
      1,
    )
    positions.push(
      x + outerRadius * Math.sin(angle),
      y + outerRadius * Math.cos(angle),
      color.r,
      color.g,
      color.b,
      1,
    )
  }
  const indices = []
  for (let i = 0; i < n; i++) {
    const p0 = i * 2
    const p1 = i * 2 + 1
    let p2 = (i + 1) * 2 + 1
    let p3 = (i + 1) * 2
    if (i === n - 1) {
      p2 = 1
      p3 = 0
    }
    indices.push(p0, p1, p2, p2, p3, p0)
  }
  return { positions, indices }
}

const vertex = createRingVertex(100, 100, 20, 80, 100)
const positions = vertex.positions

onMounted(() => {
  const gl = canvas.value.getContext('webgl')

  gl.clearColor(0, 0, 0, 1.0)

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

  const program = createProgram(gl, vertexShader, fragmentShader)

  gl.useProgram(program)

  const a_Screen_Size = gl.getAttribLocation(program, 'a_Screen_Size')
  gl.vertexAttrib2f(a_Screen_Size, canvas.value.width, canvas.value.height)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)

  const a_Position = gl.getAttribLocation(program, 'a_Position')
  const a_Color = gl.getAttribLocation(program, 'a_Color')
  gl.enableVertexAttribArray(a_Position)
  gl.enableVertexAttribArray(a_Color)
  // 设置 a_Position 属性从缓冲区读取数据方式
  gl.vertexAttribPointer(a_Position, 2, gl.FLOAT, false, 24, 0)
  // 设置 a_Color 属性从缓冲区读取数据方式
  gl.vertexAttribPointer(a_Color, 4, gl.FLOAT, false, 24, 8)

  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW)

  // 定义绘制索引数组
  const indices = vertex.indices
  // 创建索引缓冲区
  const indicesBuffer = gl.createBuffer()
  // 绑定索引缓冲区
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indicesBuffer)
  // 向索引缓冲区传递索引数据
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW)

  /* 渲染 */
  function render(gl) {
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0)
  }
  render(gl)
})
</script>

<template>
  <n-flex justify="center">
    <canvas ref="canvas" width="800" height="800" />
  </n-flex>
</template>
