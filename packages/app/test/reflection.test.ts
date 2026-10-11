import assert from 'node:assert/strict'
import test from 'node:test'
import { reflectionQuad } from '../src/game/webgl-tile-layer.js'
import { WET_REFLECTION } from '../src/game/post-process.js'

/**
 * 倒影几何：关于贴地线上下翻转 → 按离贴地线的距离压扁 → 整体抬高 `lift`。
 * UI 测试只能判"开了看得见"（压扁渐隐之后差异像素本来就少），
 * 位置与朝向这一类判据放在这里：纯函数，不需要浏览器。
 */
const lift = 4
/** 单位贴图的典型比例：40 像素高，贴地线在顶边下方 30 像素处 */
const sprite = { originY: 100, groundY: 130, height: 40 }
/** 贴图上第 v 行（v 从顶边算）在倒影里落到哪个世界 y */
const mirroredY = (quad: { top: number; height: number }, spriteHeight: number, v: number): number =>
  quad.top + (v / spriteHeight) * quad.height

test('贴地点在镜像后位置不动，只按 lift 抬高', () => {
  const quad = reflectionQuad(sprite, lift)
  const groundRow = sprite.groundY - sprite.originY
  assert.equal(mirroredY(quad, sprite.height, groundRow), sprite.groundY - lift)
  // 换一个更高的贴图（贴地线在顶边下方 50 像素），贴地点同样必须落回同一条线
  const taller = { originY: 60, groundY: 110, height: 90 }
  const tallerQuad = reflectionQuad(taller, lift)
  assert.equal(mirroredY(tallerQuad, taller.height, taller.groundY - taller.originY), taller.groundY - lift)
})

test('倒影整体在物体下方，且上下是真的翻转了', () => {
  const quad = reflectionQuad(sprite, lift)
  // 贴图上边（v = 0）镜像后落到最远处，必须在贴地线下方
  assert.ok(mirroredY(quad, sprite.height, 0) > sprite.groundY, '倒影远端应落在贴地线下方')
  // 近端比远端更靠近贴地线：上下翻转了才叫镜像
  assert.ok(mirroredY(quad, sprite.height, sprite.height) < mirroredY(quad, sprite.height, 0), '倒影没有上下翻转')
})

test('倒影按 squash 压扁，不与本体等高', () => {
  const quad = reflectionQuad(sprite, lift)
  assert.equal(Math.abs(quad.height), sprite.height * WET_REFLECTION.squash)
  assert.ok(Math.abs(quad.height) < sprite.height, '压扁后才不会被读成"另一个物体"')
  assert.ok(quad.height < 0, 'height 取负才是上下翻转')
})

test('倒影只跟贴地线与贴图尺寸有关，随物体整体平移', () => {
  const quad = reflectionQuad(sprite, lift)
  // 贴图整体上移 20 像素（顶边更高）⇒ 倒影远端在贴地线下方再远 20 × squash
  const raised = reflectionQuad({ ...sprite, originY: sprite.originY - 20 }, lift)
  assert.equal(raised.top - quad.top, 20 * WET_REFLECTION.squash)
  // 贴地线不变时，只压下贴图顶边，贴地点仍然不动
  assert.equal(mirroredY(raised, sprite.height, sprite.groundY - (sprite.originY - 20)), sprite.groundY - lift)
})
