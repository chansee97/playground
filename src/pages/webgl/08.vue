<route lang="json">
{
  "meta": {
    "file": "/webgl/08.vue"
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
// 接收JavaScript传递过来的顶点 uv 坐标。
attribute vec2 a_Uv;
// 将接收的uv坐标传递给片元着色器
varying vec2 v_Uv;
void main() {
  // 顶点坐标
  vec2 position = (a_Position / a_Screen_Size) * 2.0 - 1.0;
  position = position * vec2(1.0,-1.0);
  gl_Position = vec4(position, 0, 1);
  // 将接收到的uv坐标传递给片元着色器
  v_Uv = a_Uv;
}
`

// 片元着色器
const fragmentShaderSource = `
//设置浮点数精度为中等精度
precision mediump float;
// 接收顶点着色器传递过来的 uv 值。
varying vec2 v_Uv;
// 接收 JavaScript 传递过来的纹理
uniform sampler2D texture;
void main() {
  // 提取纹理对应uv坐标上的颜色，赋值给当前片元（像素）。
  gl_FragColor = texture2D(texture, vec2(v_Uv.x, v_Uv.y));
}
`

// 初始化webGL上下文
const canvas = useTemplateRef('canvas')

const positions = [
  30,
  30,
  0,
  0, // V0
  30,
  300,
  0,
  1, // V1
  300,
  300,
  1,
  1, // V2
  30,
  30,
  0,
  0, // V0
  300,
  300,
  1,
  1, // V2
  300,
  30,
  1,
  0, // V3
]

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
  // 找到着色器中的全局变量 u_Texture;
  const u_Texture = gl.getUniformLocation(program, 'u_Texture')
  const a_Uv = gl.getAttribLocation(program, 'a_Uv')

  gl.enableVertexAttribArray(a_Position)
  gl.enableVertexAttribArray(a_Uv)
  // 设置 a_Position 属性从缓冲区读取数据方式
  gl.vertexAttribPointer(a_Position, 2, gl.FLOAT, false, 16, 0)
  // 设置 a_Color 属性从缓冲区读取数据方式
  gl.vertexAttribPointer(a_Uv, 2, gl.FLOAT, false, 16, 8)

  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW)

  /* 渲染 */
  function render(gl) {
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (positions.length <= 0) {
      return
    }
    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 4)
  }

  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    gl.activeTexture(gl.TEXTURE0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.uniform1i(u_Texture, 0)
    render(gl)
  }
  img.src = 'https://picsum.photos/128'
})
</script>

<template>
  <n-flex justify="center">
    <canvas ref="canvas" width="800" height="800" />
  </n-flex>
</template>
