<route lang="json">
{
  "meta": {
    "file": "/webgl/04.vue"
  }
}
</route>

<script setup>
import { createBuffer, createProgram, randomColor } from './webgl-helper'

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

// 写入缓冲区
const positions = []
const colors = []

onMounted(() => {
  const gl = canvas.value.getContext('webgl')

  // 渲染函数
  gl.clearColor(0, 0, 0, 1.0)
  function render(gl) {
    // 用上一步设置的清空画布颜色清空画布。
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (positions.length <= 0) {
      return
    }
    // 因为我们要绘制 N 个点，所以执行 N 次顶点绘制操作。
    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 2)
  }

  const program = createProgram(gl, vertexShaderSource, fragmentShaderSource)

  // 使用程序对象
  gl.useProgram(program)

  const a_Position = gl.getAttribLocation(program, 'a_Position')
  const a_Color = gl.getAttribLocation(program, 'a_Color')

  const a_Screen_Size = gl.getAttribLocation(program, 'a_Screen_Size')
  gl.vertexAttrib2f(a_Screen_Size, canvas.value.width, canvas.value.height)

  // 绑定缓冲区
  const positionBuffer = createBuffer(gl, a_Position)
  const colorBuffer = createBuffer(gl, a_Color, { size: 4 })

  canvas.value.addEventListener('click', (e) => {
    const x = e.offsetX
    const y = e.offsetY
    positions.push(x, y)

    const color = randomColor()
    colors.push(color.r, color.g, color.b, color.a)

    if (positions.length % 6 === 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW)

      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW)

      render(gl)
    }
  })

  render(gl)
})
</script>

<template>
  <n-flex justify="center">
    <canvas ref="canvas" width="1000" height="1000" />
  </n-flex>
</template>

<style scoped>

</style>
