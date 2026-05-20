import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const inputPath = process.env.VIDEO_INPUT || 'screenshots/walkthrough.webm'
const outputPath = process.env.VIDEO_MP4_PATH || 'screenshots/walkthrough.mp4'

await fs.mkdir(path.dirname(outputPath), { recursive: true })

const args = [
  '-y',
  '-i',
  inputPath,
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  outputPath,
]

const ffmpeg = spawn('ffmpeg', args, { stdio: 'inherit' })

const code = await new Promise((resolve, reject) => {
  ffmpeg.on('error', reject)
  ffmpeg.on('close', resolve)
})

if (code !== 0) process.exit(code)

console.log(`Saved ${outputPath}`)
