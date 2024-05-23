<script setup lang="ts">
const { count } = storeToRefs(useStore())

const message = useMessage()
const name = ref()

function add() {
  message.success(count.value)
  count.value++
}

const router = useRouter()
function go() {
  router.push(`/hi/${encodeURIComponent(name.value)}`)
}
</script>

<template>
  <div class="flex-col-center gap-2em">
    this is threejs page
    <div>
      <input v-model="name" type="text" placeholder="Enter your name" @keydown.enter="go">
      <button :disabled="!name" @click="go">
        Go
      </button>
    </div>

    <div>
      <span>
        account : {{ count }}
      </span>
      <button @click="add">
        Add
      </button>
    </div>
  </div>
</template>
