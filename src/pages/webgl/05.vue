<route lang="json">
{
  "meta": {
    "file": "/webgl/05.vue"
  }
}
</route>

<script setup>
import { createProgram, createShader } from './webgl-helper'

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

// 存储顶点信息的数组
const positions = [
  // V0
  30,
  30,
  255,
  0,
  0,
  1,
  // V1
  30,
  300,
  0,
  255,
  0,
  1,
  // V2
  300,
  300,
  0,
  255,
  0,
  1,
  // V3
  300,
  30,
  0,
  0,
  255,
  1,
]
// 存储顶点索引的数组
const indices = [
  0,
  1,
  2, // 第一个三角形
  0,
  2,
  3, // 第二个三角形
]

onMounted(() => {
  const gl = canvas.value.getContext('webgl')

  gl.clearColor(0, 0, 0, 1.0)

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

  const program = createProgram(gl, vertexShader, fragmentShader)

  // 使用程序对象
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

  const indicesBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indicesBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW)

  /* 渲染 */
  function render(gl) {
    gl.clear(gl.COLOR_BUFFER_BIT)
    // 利用索引方式进行绘制
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
