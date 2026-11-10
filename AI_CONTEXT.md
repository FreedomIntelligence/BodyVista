# BodyVista 项目入口

主站用于查看三维解剖图谱。「肌肉运动」是原顶栏中的工作区，地址为 `?workspace=muscle-motion`。栏目切换、语言和设置共用首页的顶栏，顶栏下方才加载动作回放。访客可播放固定动作、查看肌力，选中的案例可以通过 `case` 参数分享。回放和本机编辑器跟随主站切换中文、英文或日文，分享链接可指定 `lang=en` 或 `lang=ja`。自定义动作仍在开发，安装离线版即可通过本机 Python 服务在相同顶栏下编辑、导入并求解。主站使用 `npm ci`、`npm run dev`、`npm test`、`npm run build`。实验台的安装、版本资源和启动命令见[中文说明](README.zh-CN.md)及[资源安装说明](experiments/body-lab/RELEASE_ASSETS.md)。

- **全身实验台**：本地 `/experiments/body-lab/`。当前模型 `ms740-shoulder-hand-franko-v5` 有 740 个肌腱单元。动作可从零设计、导入或从固定案例修改。自定义动作通过本地服务按关键帧求解；v1.2.0 固定库的 50 个动作分为七类，含 6 个哑铃动作，共 2,066 个通过验证的采样帧，只有输入和模型版本均匹配才能读取预计算结果。两个[可编辑的腕、前臂与手指动作](experiments/body-lab/examples)没有附带力值。模型给出的是在指定姿势、速度、负重和支撑下的一组可行力值，不代表人体逐肌实测值。
- **计算与来源**：`experiments/body-lab/fullbody_engine.py` 读取派生模型；`fullbody_solver.py` 处理动作采样、支撑和力矩平衡；`franko_transmission.py` 与 `passive_series.py` 分别描述指定小指肌腱的传动和指定指屈肌的被动力。模型声明、来源与力学边界见 [FULLBODY.md](experiments/body-lab/FULLBODY.md)。任何帧不满足约束时，整段不输出可当作有效的肌力数字。
- **验证入口**：[独立力学核验](experiments/body-lab/fullbody-validation.json)、[网页验收](experiments/body-lab/fullbody-ui-validation.json)及[模型与动作库的匹配记录](experiments/body-lab/candidates/model-repair-20261106/model-ready-for-library.json)。`verify_suites.py` 分批检验烟雾用例、腕指联合、全身、站立和自定义动作；`refresh_library.py` 逐个更新固定案例。Windows 上使用一个计算核心、低于正常优先级及内存上限，批量程序还预留系统可用内存。
- **右臂实验台**：`/experiments/elbow-lab/` 单独使用六条肌束的模型。“观察肌束”只允许选择本动作中张力变化超过 0.01 N 的肌束；未列为可选不表示该肌束没有参与计算。

动作库的场景、构建程序和逐案验证结果在 `experiments/body-lab/showcase/`。新版本安装见[离线说明](docs/OFFLINE_MOTION.md)。GitHub Pages 的肌肉回放默认显示正式图谱的解剖表面。播放器从同域分块读取肌肉网格和骨接触体积，动作力值来自同版固定案例。选择「计算肌腱路径」可以查看模型用于配力的线条。部署时按固定 GitHub Release 校验模型和动作资源，完整动力学求解在本机运行。
