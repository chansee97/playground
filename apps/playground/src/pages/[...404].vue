<script setup lang="ts">
import { NButton, NH1 } from 'naive-ui'
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="flex-col-center gap-2em">
    <span class="text-7xl">
      😵
    </span>
    <n-h1 class="text-4xl">
      404 | <span>Not Found</span>
    </n-h1>
    <router-link to="/">
      <n-button>
        返回首页
      </n-button>
    </router-link>
  </div>
</template>
