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

export function createProgram(gl, vertexShaderSource, fragmentShaderSource) {
  const vertexShader = gl.createShader(gl.VERTEX_SHADER)
  gl.shaderSource(vertexShader, vertexShaderSource)
  gl.compileShader(vertexShader)
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
  gl.shaderSource(fragmentShader, fragmentShaderSource)
  gl.compileShader(fragmentShader)

  const program = gl.createProgram()
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Could not link program: ${gl.getProgramInfoLog(program)}`)
  }

  return program
}

export function randomColor() {
  return {
    r: Math.random() * 255,
    g: Math.random() * 255,
    b: Math.random() * 255,
    a: Math.random() * 1,
  }
}
