<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DIFFS_TAG_NAME, File, FileDiff, parsePatchFiles } from '@pierre/diffs'

const props = defineProps({
  preview: { type: Object, default: null },
  clipped: { type: Boolean, default: true },
})

const emit = defineEmits(['ready'])
const container = ref(null)
const error = ref('')
let instance
let diffContainer
let renderTimer

const options = {
  theme: 'pierre-dark',
  themeType: 'dark',
  overflow: 'wrap',
  tokenizeMaxLineLength: 20000,
  onPostRender: handlePostRender,
  unsafeCSS: `
    [data-diffs] {
      --diffs-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco,
        Consolas, "Liberation Mono", "Courier New", monospace;
      --diffs-font-size: 12px;
      --diffs-line-height: 18px;
    }
  `,
}

const visiblePreview = computed(() => {
  if (!props.clipped) return props.preview
  if (props.preview?.kind !== 'file') return props.preview

  const lines = props.preview.content.split('\n')
  if (lines.length <= 400) return props.preview

  return {
    ...props.preview,
    content: [
      ...lines.slice(0, 400),
      '',
      `… clipped ${lines.length - 400} more lines. Open full screen to view all.`,
    ].join('\n'),
  }
})

onMounted(renderPreview)
onBeforeUnmount(cleanup)
watch(() => [visiblePreview.value, props.clipped], renderPreview, { deep: true })

function handlePostRender(_node, renderedInstance) {
  if (renderedInstance !== instance) return
  clearTimeout(renderTimer)
  renderTimer = undefined
  emit('ready')
}

function cleanup() {
  clearTimeout(renderTimer)
  renderTimer = undefined
  instance?.cleanUp?.()
  instance = undefined
  diffContainer = undefined
  if (container.value) container.value.innerHTML = ''
}

function failPreview(message) {
  cleanup()
  error.value = message
  emit('ready')
}

function renderPreview() {
  cleanup()
  error.value = ''
  if (!container.value || !visiblePreview.value) return

  try {
    diffContainer = document.createElement(DIFFS_TAG_NAME)
    diffContainer.className = 'pierre-diffs-container'
    container.value.appendChild(diffContainer)
    renderTimer = window.setTimeout(() => {
      failPreview('Preview rendering timed out')
    }, 10000)

    const preview = visiblePreview.value
    if (preview.kind === 'file') renderFile(preview)
    else if (preview.kind === 'diff') renderDiff(preview)
    else if (preview.kind === 'patch') renderPatch(preview)
  } catch (err) {
    failPreview(err?.message || 'Could not render preview')
  }
}

function renderFile(preview) {
  instance = new File(options)
  instance.render({
    fileContainer: diffContainer,
    file: {
      name: preview.path || 'tool-output.txt',
      contents: preview.content || '',
    },
  })
}

function renderDiff(preview) {
  instance = new FileDiff({
    ...options,
    diffStyle: 'unified',
    hunkSeparators: 'metadata',
  })
  instance.render({
    fileContainer: diffContainer,
    oldFile: {
      name: preview.path || 'before.txt',
      contents: preview.oldText || '',
    },
    newFile: {
      name: preview.path || 'after.txt',
      contents: preview.newText || '',
    },
  })
}

function renderPatch(preview) {
  const parsed = parsePatchFiles(preview.patch || '')
  const fileDiff = parsed.flatMap((patch) => patch.files || [])[0]
  if (!fileDiff) throw new Error('No diff found in tool output')

  instance = new FileDiff({
    ...options,
    diffStyle: 'unified',
    hunkSeparators: 'metadata',
  })
  instance.render({ fileContainer: diffContainer, fileDiff })
}
</script>

<template>
  <div class="pierre-preview">
    <div ref="container" class="pierre-preview-inner"></div>
    <pre v-if="error" class="tool-output">{{ error }}</pre>
  </div>
</template>
