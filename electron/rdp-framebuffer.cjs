/**
 * 主进程侧 RDP 整帧 RGBA 缓冲：切标签后可整屏回放，不依赖增量图块。
 */

function allocFramebuffer(width, height) {
  const w = Math.max(1, Number(width) || 1)
  const h = Math.max(1, Number(height) || 1)
  return {
    width: w,
    height: h,
    data: Buffer.alloc(w * h * 4, 0),
  }
}

function asBuffer(data) {
  if (!data) return null
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
    return Buffer.from(data.data)
  }
  if (Array.isArray(data)) return Buffer.from(data)
  return null
}

function blitRgbaTile(fb, tile) {
  if (!fb?.data || !tile) return
  const tw = Number(tile.width) || 0
  const th = Number(tile.height) || 0
  let dx = Number(tile.destLeft) || 0
  let dy = Number(tile.destTop) || 0
  if (tw <= 0 || th <= 0) return

  const src = asBuffer(tile.data)
  if (!src || src.length < tw * th * 4) return

  for (let row = 0; row < th; row += 1) {
    const y = dy + row
    if (y < 0 || y >= fb.height) continue

    let srcX = 0
    let destX = dx
    let copyW = tw
    if (destX < 0) {
      srcX = -destX
      copyW -= srcX
      destX = 0
    }
    if (destX + copyW > fb.width) copyW = fb.width - destX
    if (copyW <= 0) continue

    const srcStart = (row * tw + srcX) * 4
    const dstStart = (y * fb.width + destX) * 4
    src.copy(fb.data, dstStart, srcStart, srcStart + copyW * 4)
  }
}

function snapshotFramebuffer(fb) {
  if (!fb?.data) return null
  return {
    width: fb.width,
    height: fb.height,
    // 拷贝一份，避免 IPC 期间被后续 blit 改写
    data: Buffer.from(fb.data),
  }
}

module.exports = {
  allocFramebuffer,
  blitRgbaTile,
  snapshotFramebuffer,
  asBuffer,
}
