import { isLocalFileHref } from './file-links.js'

const FILE_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'json', 'jsonc', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'fs', 'php', 'swift', 'scala',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'sql', 'vue', 'svelte',
  'css', 'scss', 'html', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf',
])
function fileExtension(value) {
  return value.match(/\.([a-z\d]+)(?::\d+(?::\d+)?)?$/i)?.[1]?.toLowerCase()
}

function suppressFuzzyFileLink(href, label) {
  // Only undo linkify's own "http://" + label expansion, never an explicit URL.
  if (!label || href !== `http://${label}`) return false
  if (!FILE_EXTENSIONS.has(fileExtension(label))) return false
  const segments = label.split(/[\\/]/)
  if (segments.length === 1) return true
  // Do not guess whether a dotted first segment is a domain. Only suppress
  // an obvious relative file path such as setup.py/requirements.txt.
  return FILE_EXTENSIONS.has(fileExtension(segments[0]))
}

export function configureMarkdownLinks(markdown, { preview = false, interactive = true } = {}) {
  const validateLink = markdown.validateLink
  markdown.validateLink = (href) => validateLink(href)
    || (/^file:/i.test(href) && isLocalFileHref(href))

  const renderImage = markdown.renderer.rules.image
  markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const token = tokens[index]
    if (/^file:/i.test(token.attrGet('src') || '')) {
      return `<span class="markdown-image-reference">Image: ${markdown.utils.escapeHtml(token.content || 'Untitled')}</span>`
    }
    return renderImage(tokens, index, options, env, renderer)
  }

  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index]
    const href = token.attrGet('href') || ''
    const local = isLocalFileHref(href)
    const label = tokens[index + 1]?.type === 'text' ? tokens[index + 1].content : ''
    const suppress = env.autolinkBareFilenames !== true && !local && suppressFuzzyFileLink(href, label)
    const inactive = suppress || (local && !interactive)
      || (preview && !local && !/^(?:https?:|mailto:|#)/i.test(href))
    const stack = env.fileLinkStack || (env.fileLinkStack = [])
    stack.push(inactive)
    if (inactive) {
      if (suppress) return '<span>'
      return `<span class="markdown-relative-link" title="${markdown.utils.escapeHtml(href)}">`
    }
    if (local) {
      token.attrSet('data-local-file', href)
      token.attrSet('href', '#')
      token.attrSet('title', `Preview file: ${href}`)
    } else if (/^(?:https?:)?\/\//i.test(href) || (preview && !href.startsWith('#'))) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    }
    return renderer.renderToken(tokens, index, options)
  }
  markdown.renderer.rules.link_close = (_tokens, _index, _options, env) => {
    return env.fileLinkStack?.pop() ? '</span>' : '</a>'
  }
}
