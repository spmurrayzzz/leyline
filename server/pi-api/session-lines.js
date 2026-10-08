import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

let unicodeLineEndings = false
const probe = createInterface({
  input: Readable.from(['\u2028']),
  crlfDelay: Infinity,
})
for await (const line of probe) unicodeLineEndings = line === ''

export async function* byteLines(input) {
  const parts = []
  const decoder = new StringDecoder('utf8')
  let skipLf = false

  for await (const chunk of input) {
    if (!chunk.length) continue
    let start = skipLf && chunk[0] === 10 ? 1 : 0
    skipLf = false
    let lf = chunk.indexOf(10, start)
    let cr = chunk.indexOf(13, start)

    while (start < chunk.length) {
      const end = lf === -1 ? cr : cr === -1 ? lf : Math.min(lf, cr)
      if (end === -1) {
        parts.push(decoder.write(chunk.subarray(start)))
        break
      }

      const tail = decoder.end(chunk.subarray(start, end))
      if (parts.length) parts.push(tail)
      const line = parts.length ? parts.join('') : tail
      parts.length = 0

      start = end + 1
      if (chunk[end] === 13) {
        if (start === chunk.length) skipLf = true
        else if (chunk[start] === 10) start++
      }
      if (lf !== -1 && lf < start) lf = chunk.indexOf(10, start)
      if (cr !== -1 && cr < start) cr = chunk.indexOf(13, start)
      if (unicodeLineEndings && (line.includes('\u2028') || line.includes('\u2029'))) {
        for (const fragment of line.split(/[\u2028\u2029]/)) yield fragment
      } else {
        yield line
      }
    }
  }

  const tail = decoder.end()
  if (tail) parts.push(tail)
  const line = parts.join('')
  parts.length = 0
  if (line) {
    if (unicodeLineEndings && (line.includes('\u2028') || line.includes('\u2029'))) {
      const fragments = line.split(/[\u2028\u2029]/)
      if (fragments.at(-1) === '') fragments.pop()
      for (const fragment of fragments) yield fragment
    } else {
      yield line
    }
  }
}
