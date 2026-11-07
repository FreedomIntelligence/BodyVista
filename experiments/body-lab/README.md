# 全身动作实验台

全身页使用 MS-Human-700 派生的 v5 肌骨模型。每个采样帧由 740 个肌腱单元共同配力，同时报告关节力矩、显式外部支撑和适用的哑铃接触力。左右小指各三个屈曲轴采用指深屈肌实测力臂，八个指浅屈肌单元使用被动串联弹性，中指沿用原路径几何。手部的 24 个被动参考坐标用于核对参考力矩。模型配置、动作使用方法及局限见[全身实验台说明](FULLBODY.md)。

`v1.1.0` 使用同版 `release-assets.json` 安装四份资源。[发行资源说明](RELEASE_ASSETS.md)在仓库根目录用 Python 3.13 建立 `.venv-fullbody`，安装[锁定依赖](candidates/runtime/requirements-lock.txt)，再启动本机服务。Windows PowerShell 命令如下。

```powershell
python -m venv .venv-fullbody
& ./.venv-fullbody/Scripts/python.exe -m pip install -r experiments/body-lab/candidates/runtime/requirements-lock.txt
& ./.venv-fullbody/Scripts/python.exe -B -X utf8 experiments/body-lab/setup_release_assets.py --manifest experiments/body-lab/release-assets.json --download
& ./.venv-fullbody/Scripts/python.exe -X utf8 experiments/elbow-lab/server.py --port 4192
```

打开[全身实验台](http://127.0.0.1:4192/experiments/body-lab/)，从“动作库”载入固定案例并播放。要编辑动作，可转动关节，确认关键帧，再设定时长、支撑和哑铃负重，点击“计算受力”。一帧不通过就停用整段定量结果并定位首个失败时间。GitHub Pages 只部署静态图谱，实时求解由本机服务提供。[右臂实验台](../elbow-lab/README.md)使用独立的六肌 Arm26 肘部模型。

可导入右手旋转、屈曲并握拳（50 帧）或左手旋转并松开（52 帧）的场景。两份 JSON 只含输入，在“动作文件 → 导入”后点击“计算受力”取得该版本的动力学估计。文献中的几何力臂与模型计算出的肌腱张力、器械接触力分别呈现。[右手场景](examples/custom_right_rotate_bend_make_fist.json) · [左手场景](examples/custom_left_open_while_rotating.json)

早期 Rajagopal 80 单元对照属于历史研究。此版安装和验证的全身入口为上述 MS740 页面与 `/api/fullbody/*`。
