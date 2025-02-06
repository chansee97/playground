export function createBuffer(gl, attribute, options = {}) {
  const buffer = gl.createBuffer()
  gl.enableVertexAttribArray(attribute)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  const {
    size = 2,
    type = gl.FLOAT,
    normalize = false,
    stride = 0,
    offset = 0,
  } = options
  gl.vertexAttribPointer(
    attribute,
    size,
    type,
    normalize,
    stride,
    offset,
  )

  return buffer
}

export function createShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
  if (success) {
    return shader
  }
  console.warn(gl.getShaderInfoLog(shader))
  gl.deleteShader(shader)
}

export function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram()
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  const success = gl.getProgramParameter(program, gl.LINK_STATUS)
  if (success) {
    return program
  }

  console.warn(gl.getProgramInfoLog(program))
  gl.deleteProgram(program)
}

export function randomColor() {
  return {
    r: Math.random() * 255,
    g: Math.random() * 255,
    b: Math.random() * 255,
    a: Math.random() * 1,
  }
}
