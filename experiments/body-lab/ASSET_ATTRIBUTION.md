# 全身与右肘实验资源：来源、许可和修改说明

BodyVista 自写代码与文档采用根目录的 [MIT License](../../LICENSE)。这项许可不覆盖下列第三方模型、数据或其衍生资源，也不替代原作者的署名和许可要求。本说明记录 v1.1.0 随版资源及上游归属。具体资源范围见[发行说明](candidates/model-repair-20261106/RELEASE_PREPARATION.md)。

## 资源与许可对应

| 资源 | 来源与许可 | 本项目的处理 |
|---|---|---|
| BodyVista 自写运行代码、安装器和说明 | MIT；版权 © 2026 FreedomAI | 与第三方代码、模型及数据分开标注，不替第三方材料重新授权 |
| `atlas-muscles.json` / `atlas-muscles.bin` 中的 460 项表面：458 项肌肉及左右跟腱 | Z-Anatomy 衍生图谱；本选集及其模型改动按 CC BY-SA 4.0 分享，同时保留 BodyParts3D / DBCLS 的原 CC BY-SA 2.1 Japan 归属 | 从原图谱筛选、转换、配准、细分、绑定，并加入显示形变；逐项来源 ID 与哈希保存在清单 |
| MS-Human-700 来源包及 BodyVista 的派生计算模型 | LNS Group 的 MS-Human-700，经固定 MuJoCo Menagerie 版本取得；来源包标注 Apache-2.0 | 保留原 LICENSE、README、完整来源清单；模型调整按各派生版本的 XML / manifest 记录 |
| `geometry/fullbody-bones.json` 及 `geometry/bone-volumes.json` / `.bin` | 从上述 MS-Human-700 原生网格导出、再生成体积，沿用这条 Apache-2.0 来源链 | 导出原生骨局部坐标、三角面与放置矩阵，再生成用于显示接触的距离体积；不是 460 项 Z-Anatomy 表面选集 |
| 参与图谱配准的 Z-Anatomy / BodyParts3D 骨参考 | 保留原图谱的逐对象归属及适用许可；其中的衍生显示数据不因进入本项目而改为 MIT | 用作图谱表面配准和显示绑定的参考；不能与 MS-Human-700 导出的骨网格混同，也不能借 460 项选集的核查替其他图谱对象完成许可核查 |
| 右肘 Arm26 模型与派生查找表 | OpenSim Development Team；原模型 credits 标注 CC BY 3.0 | 锁肩、提取右肘查找表，并调整教学实验重力常数；保留原模型归属 |
| v5 手指传动与 FDS 被动串联弹性 | Franko 等人（2011）表 2 的小指力臂拟合；OpenSim 4.6 Thelen2003Muscle 的肌腱应变默认值 0.04 | 本项目的两个计算模块分别校验其字节身份；对中指和其他手指保留原模型路径几何 |

## Z-Anatomy、BodyParts3D 与 460 项表面

原始图谱为 [Z-Anatomy — The libre 3D atlas of anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy)，建立在 BodyParts3D 等来源之上。保留以下归属：

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan

BodyParts3D 的原始分发入口为 [DBCLS / BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html)，许可为 [CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/legalcode)。本选集的衍生模型资源及本项目对它们的改动按 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en) 分享，保留原归属，不另附统一的“仅限研究”再利用限制。许可版本关系及选集核查依据见[发布准备审计的 460 项结论](candidates/model-repair-20261106/RELEASE_PREPARATION.md#460-个肌肉跟腱表面的许可结论)。

按上游所述角色，保留 Kousaku Okubo（原 BodyParts3D）、Gauthier Kervyn（设计、3D 与解剖）、Marcin Zielinski（Blender 工具）和 Lluís Vinent（Unity 开发）的署名。完整作者与其他来源以 [Z-Anatomy 原许可和归属文件](https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/5a07944a0c73f4802450ec6d2adb4a171e8cdb30/License.txt)为准；这些角色并不表示每位软件贡献者都是每块肌肉的独立建模者。发行时须保留上游原始署名与许可文本。

本项目对这批资源所做的修改包括：从根图谱选取肌肉与跟腱；将原 GLB 转为显示清单与二进制缓冲；对齐原生骨架坐标；进行网格细分、显示绑定及局部形变。显示调整不改变原作者身份，也不能解释为受试者实测几何或逐肌肉受力验证。具体来源和修改记录见 [atlas-muscles.json](atlas-muscles.json) 的 `sourceFile`、`sourceSha256`、`sourceAttribution`、绑定及形变字段；原图谱记录见根 [catalog.json](../../catalog.json)。

已有审计核对了全部 460 项：仓库 `assets/detail/*.js` 内解码 GLB 的 SHA-256 与各项 `sourceSha256` 一致，归属记录与根图谱一致。该选集由 458 项肌肉表面和左右 `calcaneal tendon` 组成，核对未发现上游具名的内耳、肾等 NC 例外类别。这项结论不扩大到根图谱全部 2,900 个结构；其他对象仍需按其具体来源处理。

**精确导出版本仍有记录缺口。** 上述 `5a07944…` 提交只固定了本次核对的上游许可文本，不能认作这批几何的导出提交。当前记录缺少原 Z-Anatomy 包版本、原始 `.blend` 哈希、完整导出日志和逐对象作者覆盖表；GLB 的 `Bio2Mesh Atlas` 生成器字段不能补足这些信息。较早的 `sourceAttribution.sha256` 尚未唯一绑定到某个上游几何版本。发行应保留已经核对的“仓库 GLB → 460 项表面”哈希链，并明确这些追溯边界，不猜测或补造源版本。

## MS-Human-700 与原生骨显示资源

模型由 [LNS Group](https://lnsgroup.cc/) 开发，官方项目为 [MS-Human-700](https://github.com/LNSGroup/MS-Human-700)。BodyVista 当前使用 [MuJoCo Menagerie 的固定来源目录](https://github.com/google-deepmind/mujoco_menagerie/tree/98a70c569c4c1b6da467a20012f766ee1f8dc521/ms_human_700)，提交为 `98a70c569c4c1b6da467a20012f766ee1f8dc521`。该包的 [上游 README](https://github.com/google-deepmind/mujoco_menagerie/blob/98a70c569c4c1b6da467a20012f766ee1f8dc521/ms_human_700/README.md) 和 [上游 LICENSE](https://github.com/google-deepmind/mujoco_menagerie/blob/98a70c569c4c1b6da467a20012f766ee1f8dc521/ms_human_700/LICENSE) 声明 Apache-2.0；安装后本地的 `candidates/ms-human-700/SOURCE_MANIFEST.json` 固定全部 251 个来源文件及其哈希。保留这些原文件、署名和适用的修改说明，不将模型包改称 MIT。

上游要求在学术使用时引用：Chenhui Zuo、Kaibo He、Jing Shao、Yanan Sui，*Self model for embodied intelligence: Modeling full-body human musculoskeletal system and locomotion control with hierarchical low-dimensional representation*，ICRA 2024，13062–13069。模型与论文入口见 [LNS Group 的 MS-Human 项目页](https://lnsgroup.cc/research/MS-Human)；原 BibTeX 保存在上述来源 README。

BodyVista 的派生模型包含本项目的关节、肌肉路径及校准调整，实际内容由对应模型 XML 和 manifest 决定。当前候选仍在研究和验收中；不能把上游模型的验证范围直接继承为本项目所有自定义动作的有效性。

骨显示资源有独立、可核对的生成链：[fullbody_engine.py](fullbody_engine.py) 的 `export_geometry()` 从原生模型的 mesh 几何导出 [fullbody-bones.json](geometry/fullbody-bones.json)；[build_bone_volumes.py](build_bone_volumes.py) 再由这些三角面生成距离体积。它们不是从 `atlas-muscles.bin` 提取，也不应因与 Z-Anatomy 肌肉同时显示而统一标成 CC BY-SA 4.0。体积清单保存 `sourceGeometrySha256`、二进制 SHA 和各骨审计记录；体素化、近表面距离及显示接触近似的限制见 [BONE_CONTACT.md](BONE_CONTACT.md)。

## OpenSim Arm26

右肘实验来源为 [OpenSim Arm26 的固定原始文件](https://github.com/opensim-org/opensim-models/blob/84b487c4e3245359a64381e01f01b9cf4772d457/Models/Arm26/arm26.osim)，提交 `84b487c4e3245359a64381e01f01b9cf4772d457`。原文件 credits 标注 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，署名为 OpenSim Development Team 的 J. Reinbolt、A. Seth、A. Habib、S. Hamner，依据 Kate Holzbaur 的模型改编。

相关论文为 [Holzbaur 等的上肢模型研究](https://doi.org/10.1007/s10439-005-3320-7)。BodyVista 从原模型导出锁肩的右肘查找表，将实验重力大小从 9.8066 调为 9.81 m/s²，并采用相应的教学负载和肌腱近似。原文件哈希、提取方法、修改与模型适用范围见 [Arm26 来源说明](../elbow-lab/model/README.md)。这些派生表和原模型保留 CC BY 3.0 归属，不归入自写代码的 MIT。

## 手指力臂与被动弹性

Orrin I. Franko、Taylor M. Winters、Timothy F. Tirrell、Eric R. Hentzen、Richard L. Lieber，*Moment arms of the human digital flexors*，*Journal of Biomechanics* 44(10), 1987–1990 (2011)，DOI `10.1016/j.jbiomech.2011.04.025`。BodyVista 采用表 2 的小指指深屈肌单关节力臂拟合，在左右小指各三个屈曲轴使用。两侧共同使用群体拟合是模型假设。其他手指保留原模型路径几何，适用轴和角度范围记录在同版 manifest。[论文摘要](https://pubmed.ncbi.nlm.nih.gov/21561624/) · [论文及表 2](https://pmc.ncbi.nlm.nih.gov/articles/PMC3124620/)

双侧八个指浅屈肌（FDS）单元的被动纤维和肌腱承受相同张力。BodyVista 使用 OpenSim 4.6 `Thelen2003Muscle` 中 `calcfse` 与 `calcfpe` 的曲线，以本地标准库计算给定伸长时的被动张力；最大等长肌力下肌腱应变为 0.04，肌纤维应变为 0.6，被动纤维形状参数为 5。它们沿用上游默认值，并未按特定动作调整。上游实现由 Stanford University 和作者依 Apache-2.0 发布。论文及 OpenSim 原始实现可通过链接查阅。[OpenSim 4.6 参数定义](https://github.com/opensim-org/opensim-core/blob/4.6/OpenSim/Actuators/Thelen2003Muscle.h#L110-L114) · [默认值和原始代码](https://github.com/opensim-org/opensim-core/blob/4.6/OpenSim/Actuators/Thelen2003Muscle.cpp#L165-L171)

## 发行时保留的记录

发行须随对应版本提供本说明、[根第三方声明](../../THIRD_PARTY_NOTICES.md)、适用的原始许可与署名、逐资源清单、修改说明和固定哈希。二进制即使另作为 Release 资源提供，仍须链接同版的这些记录。安装器校验字节，不重新判定第三方许可，也不证明模型数值有效；安装范围见 [RELEASE_ASSETS.md](RELEASE_ASSETS.md)。
