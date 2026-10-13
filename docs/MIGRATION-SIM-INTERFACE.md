# GDScript 仿真接口文档（P1 移植规格，2026-10-13）

给战斗线（P2）与渲染线（P0）的对接面。**本文件是接口冻结件**：改名/改签名先在总工处过账。
TS 参考实现 = `ra2web-engine/packages/sim/src/*`，**逐测试移植**（先移测试、跑绿、再移实现；
每个模块的对照测试清单见文末）。行为口径唯一来源仍是原版证据（ENGINE-MAP / fn-*.c），
TS 与 GDScript 不一致时停下来核证据，不许猜。

## 0. 全局约定（所有模块共用，移植时先立这份）

| 约定 | 值/规则 | 来源 |
| --- | --- | --- |
| 定点 | 1 格 = **256**（`FIXED_SHIFT=8`，`ONE=256`）；位置/速度/路径全整数 | `fixed.ts` |
| 坐标 | `x/y` 是 lepton 整数（1 格 = 256 lepton）；`z` 是 lepton（1 级高 = **90**） | ENGINE-MAP |
| 帧率 | **15 tick/秒**（`TICKS_PER_SECOND`） | 原版口径 |
| 角度 | 16 位角，**顺时针、0 = 北**，45° = **8192**，整圈 = 65536 | `direction.ts`（表 0x851a70/0x851ac0） |
| 随机 | 只准用 `rng`（xorshift128）；**禁 `randf()/randi()` 与一切全局随机** | `rng.ts` |
| 浮点 | 状态路径禁止浮点运算；距离比较用 `isqrt`（整数平方根） | `fixed.ts` |
| 除法 | 向零截断（TS `Math.trunc`）。GDScript `int` 除法同为向零截断——**仍要写测试钉住负数行为** | 移植注意 |
| uint32 | RNG/哈希全程 uint32 回绕：GDScript 里每步 `& 0xFFFFFFFF`（64 位有符号 int 不会自动回绕） | 移植注意 |
| 自定项 | 注释必须写"本项目自定"（如炮塔追随速率、A* 软惩罚） | AGENTS.md |

## 1. 模块接口（GDScript class_name 建议）

### 1.1 `Direction`（`direction.ts`）

```gdscript
const FACING_PER_STEP := 8192          # 45°
const FACING_FULL := 65536
const DIRECTION_COUNT := 8
# 八方向格步（顺时针从北）：(0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1)
const CELL_STEPS: Array[Vector2i]      # 证据 0x851a70
# 八方向 lepton 步（斜向 (±256,±256)）：证据 0x851ac0
const LEPTON_STEPS: Array[Vector2i]

static func dir_from_facing(facing: int) -> int   # ((facing>>12)+1)>>1 & 7 —— 原版式子
static func facing_from_dir(dir: int) -> int      # dir % 8 * 8192
static func dir_from_delta(dx: int, dy: int) -> int  # 按符号取 0..7；零向量=0
```

### 1.2 `Facing`（`facing.ts`，双 FacingClass——车体 @+0x2e0、炮塔 @+0x2f8）

```gdscript
class FacingState:
    var current: int    # 16 位角
    var target: int
    var start_tick: int # −1 = 静止（起始帧语义）
    var duration: int   # 时长帧 = ceil(|Δ最短| / rate)
    var rate: int       # 每 tick 转量

const TURRET_FOLLOW_RATE := 4096   # 炮塔无目标追随速率（本项目自定；原版 TurretRate 键不存在）

static func create_facing(facing := 0, rate := 0) -> FacingState
static func set_facing_target(state, target, rate, tick) -> void  # 0x4b8a30 起步打点
static func advance_facing(state, tick) -> void                    # 0x4b8b10 推进，到点静止化
static func facing_delta(from: int, to: int) -> int                # 最短带符号差 (−32768, 32768]
static func facing_radians(facing: int) -> float                   # 仅渲染用
```

**对齐信号（战斗线依赖）**：`turret.current == turret.target` 即"已对齐可开火"，
开火方不需要新增接口；瞄准方每 tick `set_facing_target(unit.turret, 目标角, AIM_RATE, tick)`。

### 1.3 `Grid`（`grid.ts`）

```gdscript
const CARDINAL_DIRECTIONS := [Vector2i(1,0), Vector2i(0,1), Vector2i(-1,0), Vector2i(0,-1)]  # 东南西北（边判定口径）
class Grid:
    var width: int; var height: int
    var blocked: Dictionary            # 索引集合（y*width+x）
    var blocked_indices: PackedInt32Array   # 升序（哈希用，与创建顺序无关）
    var blocked_steps: PackedByteArray      # 长度 w*h*4；1=朝该方向不能走；静态数据不进哈希
static func create_grid(width, height, blocked_cells, blocked_steps := PackedByteArray()) -> Grid
```

### 1.4 `Pathfinding`（`path.ts`，八方向 A*，防切角+高度边）

```gdscript
const COST_STRAIGHT := 256
const COST_DIAGONAL := 362         # ceil(256√2)
const DIAGONAL_CORNER_PENALTY := 10  # 斜步软惩罚（原版 0x79c4c8 口径；本项目自定落地）
static func find_path(grid: Grid, from: Vector2i, to: Vector2i,
                      extra_blocked: Dictionary = {}) -> Array[Vector2i]
# 启发 = octile：256*max(dx,dy) + 106*min(dx,dy)；斜步要求两正交邻格可走（防切角），
# 且正交边高度检查（|Δ级|≥2 的边不可迈）由调用方经 extra_blocked/边表提供。
```

### 1.5 `Unit`（`unit.ts`）

```gdscript
class Unit:
    var id: int; var owner: int
    var x: int; var y: int; var z: int      # 定点/lepton
    var health: int; var max_health: int
    var speed: int                          # 每 tick 定点位移（lepton）
    var sight: int
    var hull: FacingState                   # 车体（@+0x2e0）
    var turret: FacingState                 # 炮塔（@+0x2f8）
    var turret_spins: bool
    var turn_rate: int                      # DEFAULT_TURN_RATE = 8192（自定，ROT 换算未核）
    var slope_class: String                 # "track" | "other"
    var path: Array[Vector2i]; var path_index: int
    var target: Variant                     # 目的地（Vector2i 或 null）
    var blocked_ticks: int
    var attack_target_id: int               # −1 = 无（P2）
    var cooldown: int                       # P2

static func create_unit(...) -> Unit
static func unit_cell(unit) -> Vector2i                       # 截断取格
static func advance_along_path(unit, effective_speed, z_of: Callable, tick: int) -> void
# 转向时序（fn-4a2670）：朝向未对齐本步方向 → 本 tick 只转不走（set+advance 后 return）
```

### 1.6 `World`（`world.ts`）

```gdscript
class WorldOptions:  # width/height/blocked/blocked_steps/terrain_speed/heights/crippled/slope_factors/units/seed
class World:
    var tick: int
    var grid: Grid
    var units: Array[Unit]
    var shroud: Shroud
    var rng: RngState
    var pending: Array               # 指令队列（按 tick 应用）
    var shells: Array                # P2

static func create_world(options) -> World
static func enqueue_command(world, tick, command) -> void
static func step(world) -> void
```

**step 的每 tick 次序（移植必须逐条对齐）**：
1. `tick += 1` → 应用到期指令；
2. 逐单位（按数组序，**确定性**）：地表系数 → 坡度乘数 → 兜底 0（→0.5）→ 伤车 ×0.75 →
   `advance_along_path(...)` → 炮塔独立推进（无目标追随 hull，TurretSpins 不追随）；
3. 战斗段（P2：瞄准→对齐→开火→弹体）；
4. `update_shroud`。
被挡碰撞：逐格占位表；`blocked_ticks ≥ 15`（本项目自定）后按占用重规划。

### 1.7 其余

- `MovementScale`：`TICKS_PER_SECOND=15`、`LEPTONS_PER_CELL=256`、
  `speed_to_movement_per_tick(s) = min(round(min(s,100)*256/100), 255)`（整数化写法：(min(s,100)*256+50)/100 截断）。
- `Rng`：`create_rng(seed)`（splitmix32 展开）、`next_uint32(rng)`（xorshift128）、`next_below(rng, bound)`（拒绝采样）。
- `Command`：`{kind:"move", unit_id, target}` / `{kind:"stop", unit_id}` / `{kind:"attack", unit_id, target_unit_id}`。
- `Shroud`：`explored`（永久，0/2）与 `visible`（每 tick 重算）；`sight` 缺省 1、上限 11。
- **Hash（跨实现判定的总闸）**：FNV-1a（offset `0x811c9dc5`、prime `0x01000193`，逐字节），
  字段顺序**逐行照抄** `hash.ts`（tick→rng×4→单位段[id,owner,x,y,health,attackTargetId(−1),cooldown,pathIndex,path.length,path…]
  →pending 段→shells 段→shroud 段）。移植对齐后**同一场景必须跑出同一个 8 位 hex**——
  这是两套实现逐 tick 等价的最终证据。

## 2. 对照测试清单（先移测试，后移实现）

**测试跑法（已实测定型，2026-10-13）**——零依赖、无 GUT、可 CI、**免 --import**：

```bash
Godot_v4.7.2-stable_win64_console.exe --headless --path <项目> --quit-after 600 --script res://tests/test_xxx.gd
```

- 测试脚本 `extends SceneTree`，`_init()` 逐条断言、末尾 `quit(0/1)`；
- **加载用 preload 链、sim 文件不写 `class_name`**：全局类缓存（--import）对 headless 是负担且有坑
  （缓存过期报 `Identifier "X" not declared`；headless 编辑器实例会挂住不退出）。preload 零依赖直达。
- **`--quit-after 600` 是保险丝**：脚本编译/运行中途出错时 SceneTree 会空转不退——有它必退，
  CI 不会挂死（代价是编译错误要自己看日志，退出码不保真）。
- **移植坑（已实测踩过并排除）**：
  ① GDScript int 是 64 位有符号、不回绕 uint32——每步 `& 0xFFFFFFFF`（RNG/哈希第一坑）；
  ② **无两参 `ceili()`**——整数上取整手工写 `(a + b - 1) / b`（b>0、a≥0）；
  ③ 负数的 `/` 向零截断（与 TS `Math.trunc` 同）——仍建议测试钉一条负数用例。

**已验证切片**：`work/tmp-godot-sim/` —— direction（18 断言）+ facing（26 断言，对应 TS 十条 test）
**与 TS 参考实现逐位一致全过**；RNG/双 FacingClass 语义（含平移/绕环/静止化）实锤。

| TS 测试 | 覆盖 | GDScript 移植目标 |
| --- | --- | --- |
| `direction.test.ts` | 八方向表/换算 | `test_direction.gd` ✅ 切片已验证 |
| `facing-state.test.ts` | FacingState 打点/推进/到点 | `test_facing.gd` |
| `facing.test.ts` | 转向时序（先转后走）+ 炮塔滞后 | `test_facing_时序.gd` |
| `path.test.ts` | A* 成本/防切角 | `test_path.gd` |
| `unit`/`movement.test.ts` | 斜向直线推进/速度消耗 | `test_movement.gd` |
| `collision.test.ts` | 逐格占位/被挡重规划 | `test_collision.gd` |
| `height.test.ts` / `terrain-speed.test.ts` / `crippled.test.ts` | 高度/地表/伤车系数 | 各对应 |
| `golden`（scenarios）| 固定场景 N tick 哈希 | **`test_golden.gd`（最后一件，见 §1.7）** |
| P2 战斗 | `combat/bullet/combat-step.test.ts` | 战斗线负责，接口按 §1.5/1.6 预留 |

## 3. 已知自定项与台账（移植时原样带注释）

- `DEFAULT_TURN_RATE=8192`（ROT 换算未核）、`TURRET_FOLLOW_RATE=4096`（TurretRate 键不存在）、
  A* 斜步软惩罚 10、被挡等待 15 tick、剩余速度不跨段结转、`TurretSpins` 门控语义（待核）。
- 其余见 `docs/ENGINE-MAP.md` 台账节与 `work/decompiled/ra2-engine/bridge-notes.md`。

---

*生成：引擎线 2026-10-13。相关：`docs/MIGRATION-GODOT.md`（总规格）。*
