<script setup lang="ts">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const threeRef = ref<HTMLElement>()
const modelUrl = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/models/gltf/Soldier.glb'
const progress = ref(0)

// 全局变量
let scene, camera, renderer
let model, skeleton, mixer
const animations = ref()

const clock = new THREE.Clock()

function startAnimation(animationName) {
  const m_mixer = new THREE.AnimationMixer(model)
  const clip = animations.value.find(clip => clip.name === animationName)
  if (clip) {
    const action = m_mixer.clipAction(clip)
    action.play()
  }
  mixer = m_mixer
}
function init() {
  const { width, height } = threeRef.value!.getBoundingClientRect()

  // 创建相机
  camera = new THREE.PerspectiveCamera(45, width / height, 1, 100)
  camera.position.set(1, 2, -3)
  camera.lookAt(0, 1, 0)

  // 创建场景
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xA0A0A0)
  scene.fog = new THREE.Fog(0xA0A0A0, 10, 50)

  const hemiLight = new THREE.HemisphereLight(0xFFFFFF, 0x8D8D8D, 3)
  hemiLight.position.set(0, 20, 0)
  scene.add(hemiLight)

  const dirLight = new THREE.DirectionalLight(0xFFFFFF, 3)
  dirLight.position.set(3, 10, 10)
  dirLight.castShadow = true
  dirLight.shadow.camera.top = 2
  dirLight.shadow.camera.bottom = -2
  dirLight.shadow.camera.left = -2
  dirLight.shadow.camera.right = 2
  dirLight.shadow.camera.near = 0.1
  dirLight.shadow.camera.far = 40
  scene.add(dirLight)

  // 添加ground
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshPhongMaterial({ color: 0xCBCBCB, depthWrite: false }))
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  scene.add(mesh)

  // 创建渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  renderer.setSize(width, height)

  threeRef.value!.appendChild(renderer.domElement)

  const loader = new GLTFLoader()
  loader.load(modelUrl, (gltf: any) => {
    model = gltf.scene
    scene.add(model)

    model.traverse((object) => {
      if (object.isMesh)
        object.castShadow = true
    })

    skeleton = new THREE.SkeletonHelper(model)
    skeleton.visible = false
    scene.add(skeleton)

    animations.value = gltf.animations
    startAnimation('Idle')
  }, (xhr: ProgressEvent) => {
    progress.value = (xhr.loaded / xhr.total) * 100
  }, (error: any) => {
    console.error('An error happened', error)
  })

  function animate() {
    requestAnimationFrame(animate)
    renderer?.render(scene, camera)
    if (mixer)
      mixer.update(clock.getDelta())
  }
  animate()
}

const { x } = useMouse()

watch(x, (cur, pre) => {
  model?.rotateY((pre - cur) * 0.004)
})

onMounted(() => {
  init()
})

const showSkeleton = ref(false)
watch(showSkeleton, (val) => {
  skeleton.visible = val
})
</script>

<template>
  <div>
    <div class="flex wh-full gap-2">
      <div class="w-60">
        <n-flex vertical>
          <n-progress type="line" :percentage="progress" :show-indicator="false" />
          <n-checkbox v-model:checked="showSkeleton">
            显示骨架
          </n-checkbox>
          <n-button v-for="item in animations" :key="item.uuid" @click="startAnimation(item.name)">
            {{ item.name }}
          </n-button>
        </n-flex>
      </div>
      <div ref="threeRef" class="flex-1" />
    </div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "file": "/threejs/model.vue"
  }
}
</route>
