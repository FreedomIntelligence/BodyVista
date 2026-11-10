# 全身实验台的发行资源

## v1.3.0 的安装与升级

从 v1.3.0 源码启动新版实验台。它使用 v1.1.0 已发布的骨体积、肌肉表面、MS-Human 来源包，以及 v1.3.0 的完整动作 ZIP。动作目录和每个 gzip 的校验值随源码保存。以下命令使用 Git、Node.js 22 和 Python 3.13，从 PowerShell 运行。

```powershell
git clone --config core.autocrlf=false --branch v1.3.0 https://github.com/FreedomIntelligence/BodyVista.git BodyVista
Set-Location BodyVista
python -B -X utf8 tools/install-motion-lab.py --download
python -B -X utf8 tools/install-motion-lab.py --check
npm ci
npm run build
python -m venv .venv-fullbody
& ./.venv-fullbody/Scripts/python.exe -m pip install -r experiments/body-lab/candidates/runtime/requirements-lock.txt
& ./.venv-fullbody/Scripts/python.exe -X utf8 experiments/elbow-lab/server.py --port 4192
```

打开[本机肌肉运动工作区](http://127.0.0.1:4192/?workspace=muscle-motion)。本机服务支持播放和编辑案例、计算自定义动作。上述联网安装完成后，运行服务和播放动作可以断网。完整步骤见[离线使用说明](../../docs/OFFLINE_MOTION.md)。

已安装 v1.1.x 或 v1.2.x 的用户，可以先保存工作文件，运行 `git fetch origin tag v1.3.0` 和 `git switch --detach v1.3.0`，再执行上面的安装与启动命令。安装器复用核对成功的基础资源和旧案例，所有新结果就位后才切换动作目录。已有目录或文件与正式版本不符时，安装器会报告冲突并保留文件。首次安装和升级都可以重试。

要在没有网络的机器恢复模型和动作资源，事先准备下表四个附件，放进同一目录，然后从新版源码根目录运行 `python -B -X utf8 tools/install-motion-lab.py --from-bundle D:/BodyVista-bundles`。恢复软件环境另需本机已有对应 Python、锁定依赖或其离线安装包。`--check` 只读核验，成功返回 0，缺少资源返回 2，文件冲突或校验失败返回 1。

| 发行版本 | 要保存的附件 |
|---|---|
| [v1.1.0](https://github.com/FreedomIntelligence/BodyVista/releases/tag/v1.1.0) | `bodyvista-bone-volumes-v1.1.0.bin`、`bodyvista-atlas-muscles-v1.1.0.bin`、`bodyvista-ms-human-700-98a70c569c4c.zip` |
| [v1.3.0](https://github.com/FreedomIntelligence/BodyVista/releases/tag/v1.3.0) | `bodyvista-motion-cache-v1.3.0.zip` |

### 维护者复建网页和新版附件

GitHub Pages 工作流下载固定标签的解剖资源与动作 ZIP，使用源码里的发行清单校验每个成员、内容哈希、模型版本、分类、案例数和帧数，再将 gzip 原样复制到网页。浏览器选中案例后才请求对应的 gzip。复建网页时，基础包目录另需 v1.1.0 的 `release-assets.json`。

```powershell
npm ci
npm run build
python -B -X utf8 tools/build-pages-replay.py --bundle-dir D:/BodyVista-bundles --showcase-dir D:/BodyVista-bundles
```

要从已核验的合并目录重新打包，运行 `python -B -X utf8 tools/showcase_release.py --cache <motion-cache目录> --output <附件目录>`。输入目录包含 `catalog.json` 和按内容哈希命名的 `.json.gz`。工具在固定成员顺序、日期和权限下打包，并输出 `showcase-v1.3.0.json`，可与源码中 `tools/pages-assets/` 下的同名文件逐字节比较。

## v1.1.0 历史版本

BodyVista v1.1.0 的全身实验使用同版 `release-assets.json` 和四份发行资源。以下命令适用于检出 v1.1.0 的用户。

### 安装

准备 Git 和可用的 Python 3.13。资源安装器仅使用 Python 标准库。先从项目的正式发布说明取得标签和小清单，再检出该标签。以下 PowerShell 命令在用户选择的目录运行。该克隆使用仓库自己的 Git 配置，保留计算源码的原始换行字节。

```powershell
$ReleaseTag = 'v1.1.0'
git clone --config core.autocrlf=false --branch $ReleaseTag https://github.com/FreedomIntelligence/BodyVista.git BodyVista
Set-Location BodyVista
```

从仓库根目录运行检查和下载。示例假定同版清单保存在 `experiments/body-lab/release-assets.json`，若清单随 Release 单独提供，可将 `--manifest` 指向下载到本地的文件。`python` 可以替换为本机已安装的解释器命令。

```powershell
python -B -X utf8 experiments/body-lab/setup_release_assets.py --manifest experiments/body-lab/release-assets.json --check
python -B -X utf8 experiments/body-lab/setup_release_assets.py --manifest experiments/body-lab/release-assets.json --download
python -B -X utf8 experiments/body-lab/setup_release_assets.py --manifest experiments/body-lab/release-assets.json --check
```

`--check` 只读取本地文件。退出码 `0` 表示清单所列文件全部匹配，`2` 表示有可下载的资源缺失，`1` 表示清单、同版代码、许可或已有资源不匹配。`--download` 先校验已有文件，然后下载缺失的资源。已有文件哈希不符时会保留原件并报错。另一个已经检出的同版仓库可通过 `--root` 指定。

已有本地发行目录时，将其中的 `release-assets.json` 作为清单，`--from-bundle` 指向同一目录，即可完全离线安装。它校验四份本地包的长度和 SHA，随后使用和网络安装相同的成员检查、暂存与不覆盖规则。

```powershell
python -B -X utf8 experiments/body-lab/setup_release_assets.py --manifest "$Bundle/release-assets.json" --from-bundle $Bundle
```

维护者可在与 `sourceCommit` 匹配且尚无发行资产的干净检出中运行 `python -B -X utf8 experiments/body-lab/verify_bundle_restore.py --bundle $Bundle --root $CleanCheckout`。验证器还会检查安装前所有成员缺失、安装后全部逐文件匹配且 Git 工作树仍干净。

## 资源范围

| 角色 | 固定目标 | 来源或用途 |
|---|---|---|
| `bone-volumes` | `experiments/body-lab/geometry/bone-volumes.bin` | MS-Human 原生骨网格导出的距离体积 |
| `atlas-muscles` | `experiments/body-lab/atlas-muscles.bin` | 460 个已审核的肌肉和跟腱显示表面 |
| `ms-human-source` | `experiments/body-lab/candidates/ms-human-700/` | 固定 Menagerie 提交的来源清单和其全部 251 个文件，包括 XML、STL、纹理、README 和 Apache-2.0 原许可 |
| `motion-cache` | `experiments/body-lab/motion-cache/` | 最终目录及逐项引用的 11 个内容寻址 gzip，对应 803 个已验证采样帧 |

下载器只接受指定仓库、标签和文件名的 HTTPS Release 地址，重定向限于 GitHub 官方资产域名。它逐包校验长度和 SHA-256，再按仓库相对路径校验每个成员。ZIP 只接受 stored 或 deflate 的普通文件，拒绝路径越界、重复／额外成员、链接、多卷、ZIP64 和超限中央目录。每个资源／文件最多 512 MiB，清单内文件总量最多 2 GiB。

临时文件写入目标仓库的 `.runtime-cache/release-assets/`。所有缺失包都经校验后，安装器在同一文件系统通过硬链接逐文件创建目标。中断后可以再次执行，已完成且哈希匹配的文件会复用。资源完整性、模型回归和网页启动分别有各自的验证入口。

## 来源与许可

图谱的 458 个肌肉和 2 条跟腱保留 Z-Anatomy／BodyParts3D 名称、原始许可、作者及本项目修改说明。选集及其改动依 CC BY-SA 4.0 分发，保留 BodyParts3D 的 CC BY-SA 2.1 Japan 归属。原导出工具没有记录可唯一对应的上游几何版本。MS-Human 原生骨网格及衍生骨体积按其对应来源记录归属。右臂 Arm26 保留 OpenSim 来源和 CC BY 3.0。[上游原署名与许可](licenses/Z-Anatomy-License.txt) · [实验资源归属](ASSET_ATTRIBUTION.md) · [根第三方声明](../../THIRD_PARTY_NOTICES.md)

v5 在左右小指各三个屈曲轴采用指深屈肌力臂，保留中指几何。双侧八个指浅屈肌（FDS）单元另采用被动串联弹性。肌腱在最大等长肌力下的应变 0.04 来自 OpenSim 4.6 `Thelen2003Muscle` 的默认设置。该曲线在本项目中由标准库计算，用于给定长度下的被动张力。[OpenSim 4.6 参数定义](https://github.com/opensim-org/opensim-core/blob/4.6/OpenSim/Actuators/Thelen2003Muscle.h#L110-L114) · [默认值与实现](https://github.com/opensim-org/opensim-core/blob/4.6/OpenSim/Actuators/Thelen2003Muscle.cpp#L165-L171)

小指力臂研究引用 Orrin I. Franko、Taylor M. Winters、Timothy F. Tirrell、Eric R. Hentzen 和 Richard L. Lieber 的 *Moment arms of the human digital flexors*，发表于 *Journal of Biomechanics* 44(10), 1987–1990 (2011)，DOI `10.1016/j.jbiomech.2011.04.025`。论文表 2 给出基于腱位移测量的单关节力臂拟合。应用到指定 BodyVista 肌束、两侧或联合动作的范围，以最终模型声明和验证记录为准。发行说明提供书目信息和论文入口，包内的自写实现、来源数据及论文各自保留其归属。[PubMed 书目信息](https://pubmed.ncbi.nlm.nih.gov/21561624/) · [论文与表 2](https://pmc.ncbi.nlm.nih.gov/articles/PMC3124620/)

## 维护者的本地打包

打包器要求正式就绪记录同时声明 `ready:true` 和 `publicationValidated:true`。覆盖报告、全身数值报告和网页报告须与相同模型、XML 和计算版本匹配。网页报告须为 `status:passed`、`candidatePreview:false`、`fixedCacheValidated:true`，并记录带时区的完成时间。它核对模型 XML、派生记录及父版本，按引擎声明的实际模块次序核对计算指纹，逐案例核对场景与已验证结果字节。每帧复用缓存构建器的力账检查，按 XML 肌腱名、关节名和 manifest 分支核对 740 条记录、各项力矩、支撑与哑铃接触。v5 还要求传动状态为 `selected`，Franko 和被动串联模块分别与其声明的 SHA 匹配，v4 基础清单在同版 Git 文件中。两份 ZIP 使用固定路径顺序、日期、权限和 stored 格式。详细输入和输出见[发布准备说明](candidates/model-repair-20261106/RELEASE_PREPARATION.md)。

离线测试均可由任意本地 Python 3.13 从仓库根目录运行。打包器测试还使用 Git。临时样本位于仓库的 `.runtime-cache/`，测试结束清理。

```powershell
python -B -X utf8 experiments/body-lab/test_release_assets.py
python -B -X utf8 experiments/body-lab/test_prepare_release_bundle.py
python -B -X utf8 experiments/body-lab/test_make_release_spec.py
```

安装器的 23 项、打包器的 13 项及规格生成器的 4 项微型测试均通过，覆盖相同输入重复打包、安装器解包验证、版本和来源漂移、手指传动选择、Git 换行差异、页面资源引用及已有输出保护。同版数值和网页报告记录正式动作缓存的验证结果。
