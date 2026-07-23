const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easyshell-verify-'))
const store = require('../electron/store.cjs')
store.__setUserDataForTest(tmp)

function ok(name) {
  console.log(`PASS  ${name}`)
}

try {
  store.ensureFolder('目录A')
  store.ensureFolder('目录B')
  let folders = store.readFolders()
  assert.ok(folders.includes('目录A'))
  assert.ok(folders.includes('目录B'))
  assert.ok(!folders.includes('未分组'))
  ok('创建目录且不含未分组')

  store.writeConnections([
    {
      id: 'c1',
      name: 'h1',
      host: '1.1.1.1',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'x',
      folder: '目录A',
    },
    {
      id: 'c2',
      name: 'h2',
      host: '2.2.2.2',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'x',
      folder: '目录A',
    },
  ])

  // 移动
  const list = store.readConnections()
  list[0].folder = store.ensureFolder('目录B')
  store.writeConnections(list)
  assert.strictEqual(store.readConnections().find((c) => c.id === 'c1').folder, '目录B')
  ok('移动到已有目录')

  // 删除目录（含连接）
  const result = store.deleteFolder('目录A', 'delete')
  assert.ok(!store.readFolders().includes('目录A'))
  assert.strictEqual(result.removedConnections, 1)
  assert.strictEqual(store.readConnections().length, 1)
  ok('删除目录及其中连接')

  // 选择列表模拟：不含未分组
  const options = store.readFolders().filter((f) => f !== '未分组')
  assert.deepStrictEqual(options, ['目录B'])
  ok('选择已有目录不含未分组')

  console.log('\n全部验证通过')
  process.exit(0)
} catch (err) {
  console.error('\nFAIL', err)
  process.exit(1)
}
