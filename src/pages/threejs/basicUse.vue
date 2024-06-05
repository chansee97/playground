<script setup lang="ts">
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

const threeRef = ref<HTMLElement>()

onMounted(() => {
  const { width, height } = threeRef.value!.getBoundingClientRect()

  const scene = new Scene()

  const camera = new PerspectiveCamera(75, width / height, 0.1, 1000)
  camera.position.z = 5

  const renderer = new WebGLRenderer()
  renderer.setSize(width, height)

  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshBasicMaterial({ color: 0x00FF00 })
  const cube = new Mesh(geometry, material)
  scene.add(cube)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 0) // 设定中心点
  controls.update(0) // 重新设置轨道，相当于刷新

  function animate() {
    requestAnimationFrame(animate)
    cube.rotation.x += 0.01
    cube.rotation.y += 0.01
    renderer.render(scene, camera)
  }
  threeRef.value!.appendChild(renderer.domElement)
  animate()
})

onUnmounted(() => {
  renderer.dispose()
})
</script>

<template>
  <div ref="threeRef" class="flex-col-center gap-2em">
    <!-- <div class="h-full" /> -->
  </div>
</template>

<route lang="json">
{
  "meta": {
    "file": "/threejs/basicUse.vue"
  }
}
</route>
