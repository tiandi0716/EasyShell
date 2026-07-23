const CryptoJS = require('crypto-js')

class JavaRandom {
  constructor(seed) {
    this.seed = (BigInt(seed) ^ 0x5deece66dn) & 0xffffffffffffn
  }

  next(bits) {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & 0xffffffffffffn
    let value = this.seed >> (48n - BigInt(bits))
    const bitMask = 1n << (BigInt(bits) - 1n)
    if (value >= bitMask) value -= 1n << BigInt(bits)
    return Number(value)
  }

  nextLong() {
    const high = this.next(32)
    const low = this.next(32)
    return (BigInt(high) << 32n) + BigInt(low)
  }
}

const ILIST = [
  24, 54, 89, 120, 19, 49, 85, 115, 14, 44, 80, 110, 9, 40, 75, 106, 43, 73, 109, 12, 38, 68,
  104, 7, 33, 64, 99, 3, 28, 59, 94, 125, 112, 16, 51, 82, 107, 11, 46, 77, 103, 6, 41, 72,
  98, 1, 37, 67, 4, 35, 70, 101, 0, 30, 65, 96, 122, 25, 61, 91, 117, 20, 56, 86, 74, 104,
  13, 43, 69, 99, 8, 38, 64, 95, 3, 34, 59, 90, 125, 29, 93, 123, 32, 62, 88, 119, 27, 58,
  83, 114, 22, 53, 79, 109, 17, 48, 35, 66, 101, 5, 31, 61, 96, 0, 26, 56, 92, 122, 21, 51,
  87, 117, 55, 85, 120, 24, 50, 80, 116, 19, 45, 75, 111, 14, 40, 71, 106, 10, 50, 81, 116,
  20, 45, 76, 111, 15, 41, 71, 106, 10, 36, 66, 102, 5, 69, 100, 8, 39, 65, 95, 3, 34, 60,
  90, 126, 29, 55, 85, 121, 24, 12, 42, 78, 108, 7, 37, 73, 103, 2, 33, 68, 99, 124, 28, 63,
  94, 31, 61, 97, 0, 26, 57, 92, 123, 21, 52, 87, 118, 17, 47, 82, 113, 100, 4, 39, 70, 96,
  126, 34, 65, 91, 121, 30, 60, 86, 116, 25, 55, 120, 23, 58, 89, 115, 18, 54, 84, 110, 13,
  49, 79, 105, 9, 44, 75, 62, 92, 1, 31, 57, 88, 123, 27, 52, 83, 118, 22, 48, 78, 113, 17,
  81, 112, 20, 51, 76, 107, 15, 46, 72, 102, 10, 41, 67, 97, 6, 36,
]

function longToBeBytes(value) {
  let unsigned = value
  if (unsigned < 0n) unsigned = (1n << 64n) + unsigned
  const be = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    be[i] = Number((unsigned >> BigInt((7 - i) * 8)) & 0xffn)
  }
  return be
}

function randomKey(head) {
  const i = ILIST[head[5]]
  const ks = 3680984568597093857n / BigInt(i)
  const random = new JavaRandom(ks)
  const t = head[0]
  for (let j = 0; j < t; j++) random.nextLong()
  const n = random.nextLong()
  const r2 = new JavaRandom(n)
  const ld = [
    BigInt(head[4]),
    BigInt(r2.nextLong()),
    BigInt(head[7]),
    BigInt(head[3]),
    BigInt(r2.nextLong()),
    BigInt(head[1]),
    BigInt(random.nextLong()),
    BigInt(head[2]),
  ]

  const byteArray = new Uint8Array(64)
  let offset = 0
  for (const l of ld) {
    byteArray.set(longToBeBytes(l), offset)
    offset += 8
  }

  const wordArray = CryptoJS.lib.WordArray.create(byteArray)
  const md5Hash = CryptoJS.MD5(wordArray)
  const keyBytes = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    keyBytes[i] = (md5Hash.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
  }
  return CryptoJS.lib.WordArray.create(keyBytes)
}

function decryptFinalShellPassword(base64Input) {
  if (!base64Input || typeof base64Input !== 'string') return ''
  const decoded = CryptoJS.enc.Base64.parse(base64Input.trim())
  const bytes = []
  for (let i = 0; i < decoded.sigBytes; i++) {
    bytes.push((decoded.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff)
  }
  if (bytes.length < 8) throw new Error('密文过短')

  const head = bytes.slice(0, 8)
  const encryptedData = bytes.slice(8)
  const key = randomKey(head)

  const keyBytes = []
  for (let i = 0; i < key.sigBytes; i++) {
    keyBytes.push((key.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff)
  }

  const encryptedHex = encryptedData.map((b) => b.toString(16).padStart(2, '0')).join('')
  const keyHex = keyBytes.map((b) => b.toString(16).padStart(2, '0')).join('')

  const decrypted = CryptoJS.DES.decrypt(
    CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Hex.parse(encryptedHex),
    }),
    CryptoJS.enc.Hex.parse(keyHex),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  )

  if (!decrypted.sigBytes || decrypted.sigBytes <= 0) {
    throw new Error('DES 解密失败')
  }

  let result = ''
  try {
    result = decrypted.toString(CryptoJS.enc.Utf8)
  } catch {
    result = decrypted.toString(CryptoJS.enc.Latin1)
  }
  return result.replace(/[\x00-\x1F\x7F-\x9F]/g, '')
}

module.exports = { decryptFinalShellPassword }
