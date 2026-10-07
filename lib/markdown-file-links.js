import { isLocalFileHref } from './file-links.js'

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
    const inactive = (local && !interactive)
      || (preview && !local && !/^(?:https?:|mailto:|#)/i.test(href))
    const stack = env.fileLinkStack || (env.fileLinkStack = [])
    stack.push(inactive)
    if (inactive) {
      return `<span class="markdown-relative-link" title="${markdown.utils.escapeHtml(href)}">`
    }
    if (local) {
      token.attrSet('data-local-file', href)
      token.attrSet('href', '#')
      token.attrSet('title', `Preview file: ${href}`)
    } else if (preview && !href.startsWith('#')) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    }
    return renderer.renderToken(tokens, index, options)
  }
  markdown.renderer.rules.link_close = (_tokens, _index, _options, env) => {
    return env.fileLinkStack?.pop() ? '</span>' : '</a>'
  }
}
