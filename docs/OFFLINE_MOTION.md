# 在本机设计动作

在线版可以播放动作库中的案例、旋转观察肌肉表面、拖动时间轴查看受力。**安装离线版后，可以自己设计动作并计算受力。这项功能目前仍在开发。** 在线与离线使用同一套 BodyVista 顶栏。「设计动作」中的「打开本机实验台」会连接这台电脑上已经启动的服务。

## 首次安装

以下命令适用于 Windows PowerShell。先安装 Git、Python 3.13 和 Node.js 22.12 或更高的 22.x 版本。首次安装需要联网下载依赖、解剖模型和动作库。安装完成后，编辑和求解均可在本机运行。

```powershell
git clone --config core.autocrlf=false --branch v1.2.1 https://github.com/FreedomIntelligence/BodyVista.git BodyVista-v1.2.1
cd BodyVista-v1.2.1
py -3.13 -m venv .venv-fullbody
& ./.venv-fullbody/Scripts/python.exe -m pip install -r experiments/body-lab/candidates/runtime/requirements-lock.txt
& ./.venv-fullbody/Scripts/python.exe -X utf8 tools/install-motion-lab.py --download
npm ci
npm run build
```

## 启动和使用

在上述仓库目录运行以下命令，在使用期间保持该窗口打开。

```powershell
& ./.venv-fullbody/Scripts/python.exe -X utf8 experiments/elbow-lab/server.py --port 4192
```

打开本机的「肌肉运动」。先调整关节并记录第一个姿势，再调整角度、添加下一个关键帧，设定相邻姿势之间的时间，然后点击「计算受力」。也可以从实验台的「动作文件」导入已有 JSON 场景，编辑后再次计算。[打开本机实验台](http://127.0.0.1:4192/?workspace=muscle-motion)

可用这份右手动作检查安装。将 JSON 保存到本机后导入，点击「计算受力」，整段有 50 个采样帧，每个通过的帧包含 740 个肌腱单元的力值。调整关键帧、负重或支撑条件后，需要重新计算。力值是模型在指定动作与支撑条件下的估计。[右手弯腕、旋转前臂并握拳](../experiments/body-lab/examples/custom_right_rotate_bend_make_fist.json)
