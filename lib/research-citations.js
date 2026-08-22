import MarkdownIt from 'markdown-it'
import { canonicalResearchSourceKey } from './research-state.js'

const markdown = new MarkdownIt({ html: false, linkify: false })

export function auditResearchReportCitations(text, sources) {
  const ids = new Set()
  let invalid = 0
  for (const link of numericMarkdownLinks(text)) {
    const source = (sources || []).find((item) => item.id === link.id)
    const key = /^https?:\/\//i.test(link.href)
      ? canonicalResearchSourceKey({ url: link.href })
      : canonicalResearchSourceKey({ path: normalizedPath(link.href) })
    if (!source || source.status === 'excluded' || !key || key !== source.key) {
      invalid++
      continue
    }
    ids.add(link.id)
  }
  return { ids: [...ids], invalid }
}

function numericMarkdownLinks(text) {
  const links = []
  for (const token of markdown.parse(text || '', {})) {
    if (token.type !== 'inline' || !token.children) continue
    for (let index = 0; index < token.children.length; index++) {
      const child = token.children[index]
      if (child.type !== 'link_open') continue
      const href = child.attrGet('href') || ''
      let label = ''
      for (let cursor = index + 1; cursor < token.children.length; cursor++) {
        const nested = token.children[cursor]
        if (nested.type === 'link_close') break
        if (nested.type === 'text' || nested.type === 'code_inline') {
          label += nested.content
        }
      }
      const match = label.trim().match(/^\[?(\d+)\]?$/)
      if (match) links.push({ id: Number(match[1]), href })
    }
  }
  return links
}

function normalizedPath(path) {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}
