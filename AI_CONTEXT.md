# BodyVista 项目入口

主站用于查看三维解剖图谱。首页顶部的「肌肉运动」进入同域全身动作回放，访客可直接播放固定动作、查看肌力。自定义动作和右臂实验台由本机 Python 服务提供。主站使用 `npm ci`、`npm run dev`、`npm test`、`npm run build`。实验台的安装、版本资源和启动命令见[中文说明](README.zh-CN.md)及[资源安装说明](experiments/body-lab/RELEASE_ASSETS.md)。

- **全身实验台**：本地 `/experiments/body-lab/`。当前模型 `ms740-shoulder-hand-franko-v5` 有 740 个肌腱单元。动作可从零设计、导入或从固定案例修改。自定义动作通过本地服务按关键帧求解；固定库的 11 个动作含 4 个哑铃动作，只有输入和模型版本均匹配才能读取预计算结果。两个[可编辑的腕、前臂与手指动作](experiments/body-lab/examples)没有附带力值。模型给出的是在指定姿势、速度、负重和支撑下的一组可行力值，不代表人体逐肌实测值。
- **计算与来源**：`experiments/body-lab/fullbody_engine.py` 读取派生模型；`fullbody_solver.py` 处理动作采样、支撑和力矩平衡；`franko_transmission.py` 与 `passive_series.py` 分别描述指定小指肌腱的传动和指定指屈肌的被动力。模型声明、来源与力学边界见 [FULLBODY.md](experiments/body-lab/FULLBODY.md)。任何帧不满足约束时，整段不输出可当作有效的肌力数字。
- **验证入口**：[独立力学核验](experiments/body-lab/fullbody-validation.json)、[网页验收](experiments/body-lab/fullbody-ui-validation.json)及[模型与动作库的匹配记录](experiments/body-lab/candidates/model-repair-20261106/model-ready-for-library.json)。`verify_suites.py` 分批检验烟雾用例、腕指联合、全身、站立和自定义动作；`refresh_library.py` 逐个更新固定案例。Windows 上使用一个计算核心、低于正常优先级及内存上限，批量程序还预留系统可用内存。
- **右臂实验台**：`/experiments/elbow-lab/` 单独使用六条肌束的模型。“观察肌束”只允许选择本动作中张力变化超过 0.01 N 的肌束；未列为可选不表示该肌束没有参与计算。

GitHub Pages 的部署流程从固定版本的 GitHub Release 校验并装配动作回放资源，随站提供模型信息和已算好的力值。完整动力学求解在本机运行。解剖二进制文件、来源数据和压缩的固定动作结果按同一标签的资源清单恢复并校验。
