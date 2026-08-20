# 3D 第一人称射击

零依赖的浏览器 WebGL 游戏。英文说明见 [README.md](README.md)。

游戏内界面为英文。本地运行请用静态服务器打开页面。

## 操作

- 点击画面锁定鼠标，`Esc` 解除锁定
- `WASD` 移动，`A` / `D` 平移
- `Shift` 冲刺
- `Space` 跳跃
- `F` 拾取附近的枪（替换当前手中的枪）
- `E` 丢掉当前武器
- `1` / `2` / `Q` 切换武器，带收枪和举枪动画
- `C` 循环镜头：第一人称、背后、正面
- `O` 自由飞行上帝视角（WASD 移动，鼠标转向，空格上升，Ctrl 下降，Shift 加速）
- 持枪时左键射击，右键开镜
- 徒手时左键出拳
- 开镜时滚轮调节倍率

## 功能

- 棕色地面、掩体墙和障碍物，无法穿墙
- 枪和手也有碰撞：贴墙或贴墙平移时模型会后收，避免穿模
- 地图上会刷新 AUG、AKM、M4A1，最多携带 2 把
- 每把枪的射速、后坐力和枪声不同
- 走跑脚步与手臂摆动同步；出拳时脚步静音
- 子弹在墙上留下弹孔，一段时间后淡出
- 开镜时隐藏枪模，保留准星和镜片遮罩
- 武器以 glTF（GLB）加载并使用 PBR 贴图；缺失时回退到方块模型
- 低头可见第一人称战术身体（背心、腿、靴）；腿部随步伐摆动
- 第三人称显示头、手臂和手掌；枪口火与曳光弹从枪管打出，命中对准准星
- 地上的枪有日照阴影；丢掉的枪会空出该槽位，直到你切换
- `C` 切换第一人称 / 背后 / 正面；`O` 开关上帝视角

## 武器 / Blender

第一人称枪模使用 `models/weapons/*.glb`。从 Blender 导出为 **GLB**，**8k–25k 三角面**，**2K** BaseColor / Normal / Metallic-Roughness。原点在握把，枪管朝 **+Z**，上方向 **+Y**。详见 [models/README.md](models/README.md)。

手模：`models/hands/`（待机、握枪、左手握枪无拇指、拳头）。身体：`models/player/`（躯干、腿、头、上臂、前臂）。可用脚本重建：

```bash
python3 scripts/build_hand_glb.py
python3 scripts/build_body_glb.py
python3 scripts/build_weapon_glb.py
```

## 运行

在项目目录启动静态服务器：

```bash
python3 -m http.server 4174
# 改过模型或代码后请强制刷新（缓存参数为 `?v=108`）
```

然后打开：

```text
http://localhost:4174/?v=108
```

## 远程仓库

- Cursor Origin（不公开）：`https://origin.cursor.com/sharbeeship/3D-game.git`
- GitHub：`https://github.com/sharbeeship/3D-game`

本仓库两边同步。`git push origin` 会把 `main` 推到 Origin 和 GitHub。若两边分叉（例如在 GitHub 网页上改过），运行：

```bash
./scripts/sync-origin-github.sh
```

脚本会拉取两边、合并 `main`，再推回去，不会强制推送。

可选云同步：在 GitHub Actions 里添加名为 `ORIGIN_TOKEN` 的密钥（Origin Git HTTPS token，用户名为 `x-access-token`）。`.github/workflows/sync-origin.yml` 会在定时任务和 GitHub 推送时双向复制提交。

## 许可证

本项目以 [MIT License](LICENSE) 开源。
